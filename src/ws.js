'use strict';

/**
 * Chat en vivo. El WebSocket es el camino rapido, pero NO se puede dar por
 * garantizado: el mini-navegador del portal cautivo (sobre todo en iPhone)
 * a veces lo bloquea. Por eso el cliente siempre puede caer a polling contra
 * /api/mensajes, y este modulo solo acelera lo que de todos modos funciona.
 */

const { WebSocketServer } = require('ws');
const { personas, mensajes, vistaPersona } = require('./db');
const { limitar } = require('./cuotas');
const { normalizarIp } = require('./red');
const canal = require('./canal');

/** personaId -> Set<WebSocket> */
const conexionesPersona = new Map();
/** Set<WebSocket> de consolas de operador */
const conexionesOperador = new Set();
/** ip -> numero de sockets abiertos, para el tope por dispositivo */
const conexionesPorIp = new Map();

/* ------------------------------------------------------------------ *
 * Limites del carril WebSocket
 *
 * El maxPayload de 64 KB limita el TAMANO de cada mensaje, no cuantos. Sin
 * esto, cualquiera con un token legitimo —se registra en diez segundos— podia
 * meter miles de mensajes por el socket y llenar la base o ahogar la consola
 * del operador, porque la cuota de /api/mensajes solo cubre el carril HTTP.
 *
 * Al pasarse NO se cierra la conexion: se descarta el mensaje y se le avisa a
 * la persona. Echar a quien pide ayuda por escribir rapido seria peor que el
 * problema que se evita. Solo se corta ante un exceso que ningun humano puede
 * producir.
 * ------------------------------------------------------------------ */
const MINUTO = 60_000;

/** Por persona. 40 mensajes en un minuto es uno cada segundo y medio, sostenido. */
const MENSAJES_POR_PERSONA = 40;
/** Por dispositivo, COMPARTIDO con POST /api/mensajes (misma clave). */
const MENSAJES_POR_IP = 90;
/** A partir de aqui no hay dedos humanos: se cierra con 1008 (policy violation). */
const EXCESO_INTOLERABLE = 100;

const MAX_CONEXIONES_POR_PERSONA = 4;  // celular + navegador real + alguna colgada
const MAX_CONEXIONES_POR_IP = 12;

function enviar(socket, tipo, datos) {
  if (socket.readyState !== socket.OPEN) return;
  try {
    socket.send(JSON.stringify({ tipo, ...datos }));
  } catch { /* conexion caida: el heartbeat la limpiara */ }
}

function notificarPersona(personaId, tipo, datos) {
  for (const socket of conexionesPersona.get(personaId) || []) enviar(socket, tipo, datos);
}

function notificarOperadores(tipo, datos) {
  for (const socket of conexionesOperador) enviar(socket, tipo, datos);
}

function notificarTodos(tipo, datos) {
  for (const conjunto of conexionesPersona.values()) {
    for (const socket of conjunto) enviar(socket, tipo, datos);
  }
}

function iniciarWs(servidorHttp, { sesionValida }) {
  const wss = new WebSocketServer({
    server: servidorHttp,
    path: '/ws',
    // Un mensaje de chat no llega a 2 KB. 64 KB deja margen de sobra y evita
    // que alguien reserve memoria del servidor mandando tramas enormes.
    maxPayload: 64 * 1024,
  });

  wss.on('connection', (socket, req) => {
    const url = new URL(req.url, 'http://interno');
    const rol = url.searchParams.get('rol');
    const ip = normalizarIp(req.socket.remoteAddress) || 'desconocida';
    socket.estaVivo = true;
    socket.on('pong', () => { socket.estaVivo = true; });

    // Tope de conexiones por dispositivo. Se rechaza LA NUEVA, nunca las que ya
    // estan abiertas: quien ya esta hablando con el puesto de mando no se cae
    // porque alguien abra sockets desde su misma IP.
    const abiertasIp = conexionesPorIp.get(ip) || 0;
    if (rol !== 'operador' && abiertasIp >= MAX_CONEXIONES_POR_IP) {
      enviar(socket, 'error', { mensaje: 'Demasiadas conexiones desde este dispositivo.' });
      return socket.close(1008, 'demasiadas conexiones');
    }
    conexionesPorIp.set(ip, abiertasIp + 1);
    socket.on('close', () => {
      const quedan = (conexionesPorIp.get(ip) || 1) - 1;
      if (quedan <= 0) conexionesPorIp.delete(ip);
      else conexionesPorIp.set(ip, quedan);
    });

    if (rol === 'operador') {
      // Mismo criterio que en las rutas /admin/*: si el canal cifrado esta
      // arriba, el operador entra por ahi. Si no, este socket seria la puerta
      // de atras que deja pasar en claro lo que la puerta de delante bloquea.
      if (canal.exigeCifrado() && !canal.esSegura(req)) {
        enviar(socket, 'error', {
          mensaje: 'La consola de operador solo funciona por el canal cifrado.',
        });
        return socket.close(1008, 'canal sin cifrar');
      }

      // Se valida la SESION obtenida en /admin/login, no el PIN. El PIN en la
      // URL acabaria en el historial del navegador y en cualquier registro que
      // guarde direcciones, y ademas es reutilizable indefinidamente; la
      // sesion muere al reiniciar el servidor.
      if (!sesionValida(url.searchParams.get('s'))) {
        enviar(socket, 'error', { mensaje: 'Sesion invalida' });
        return socket.close();
      }
      conexionesOperador.add(socket);
      enviar(socket, 'listo', { rol: 'operador', resumen: personas.contar() });
      socket.on('close', () => conexionesOperador.delete(socket));
      return;
    }

    const persona = personas.porToken(url.searchParams.get('t'));
    if (!persona) {
      enviar(socket, 'error', { mensaje: 'Sesion no encontrada' });
      return socket.close();
    }

    if (!conexionesPersona.has(persona.id)) conexionesPersona.set(persona.id, new Set());
    const suyas = conexionesPersona.get(persona.id);
    if (suyas.size >= MAX_CONEXIONES_POR_PERSONA) {
      enviar(socket, 'error', { mensaje: 'Demasiadas ventanas abiertas con esta sesion.' });
      return socket.close(1008, 'demasiadas conexiones');
    }
    suyas.add(socket);
    personas.marcarVisto(persona.id);
    notificarOperadores('presencia', { personaId: persona.id, enLinea: true });
    enviar(socket, 'listo', { rol: 'persona', persona: vistaPersona(persona) });

    socket.on('message', (crudo) => {
      let datos;
      try { datos = JSON.parse(crudo.toString()); } catch { return; }
      if (datos.tipo !== 'mensaje' || !String(datos.texto || '').trim()) return;

      // Se cobra ANTES de escribir en la base: si no, el limite no protege de
      // nada, que era justo el agujero.
      //
      // La clave de la IP es la misma que usa POST /api/mensajes en http.js
      // ("mensajes:<ip>") a proposito: los dos carriles gastan del mismo
      // presupuesto y no se puede duplicar alternando entre ellos.
      const porIp = limitar({ clave: `mensajes:${ip}`, maximo: MENSAJES_POR_IP, ventana: MINUTO });
      const porPersona = limitar({
        clave: `ws-persona:${persona.id}`, maximo: MENSAJES_POR_PERSONA, ventana: MINUTO,
      });

      if (!porIp.permitido || !porPersona.permitido) {
        const esperar = porPersona.esperar ?? porIp.esperar ?? 60;

        // Al operador se le avisa una sola vez por persona y ventana: es
        // informacion util para el triaje, pero no puede convertirse ella
        // misma en la inundacion que intenta reportar.
        const avisar = limitar({
          clave: `aviso-rafaga:${persona.id}`, maximo: 1, ventana: 5 * MINUTO,
        });
        if (avisar.permitido) {
          notificarOperadores('rafaga', {
            personaId: persona.id,
            nombre: persona.nombre,
            codigo: persona.codigo,
          });
        }

        // Se cierra SOLO por el contador de la persona, nunca por el de la IP.
        // Una IP puede estar compartida —un repetidor con NAT delante— y
        // entonces un inundador tumbaria la sesion de sus vecinos, que es
        // exactamente lo que no puede pasar. El de la IP frena; el de la
        // persona, que identifica a UNA sesion, es el unico que expulsa.
        if ((porPersona.exceso || 0) > EXCESO_INTOLERABLE) {
          enviar(socket, 'error', { mensaje: 'Conexion cerrada por exceso de mensajes.' });
          return socket.close(1008, 'exceso de mensajes');
        }

        // Se descarta el mensaje, pero la sesion sigue viva: la persona puede
        // seguir recibiendo instrucciones del puesto de mando.
        return enviar(socket, 'lento', {
          mensaje: `Vas muy rapido. Espera ${esperar} segundos y vuelve a escribir.`,
          esperar,
        });
      }

      const guardado = mensajes.crear({
        personaId: persona.id,
        direccion: 'persona',
        texto: datos.texto,
        autor: persona.nombre,
      });
      notificarPersona(persona.id, 'mensaje', { mensaje: guardado });
      notificarOperadores('mensaje', { mensaje: guardado, persona: personas.porId(persona.id) });
    });

    socket.on('close', () => {
      const conjunto = conexionesPersona.get(persona.id);
      if (!conjunto) return;
      conjunto.delete(socket);
      if (conjunto.size === 0) {
        conexionesPersona.delete(persona.id);
        notificarOperadores('presencia', { personaId: persona.id, enLinea: false });
      }
    });
  });

  // Latido: en una red saturada las conexiones mueren sin avisar.
  const latido = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.estaVivo) { socket.terminate(); continue; }
      socket.estaVivo = false;
      try { socket.ping(); } catch { /* ya estaba muerta */ }
    }
  }, 30000);
  latido.unref?.();

  return {
    wss,
    enLinea: (personaId) => conexionesPersona.has(personaId),
    idsEnLinea: () => [...conexionesPersona.keys()],
  };
}

module.exports = { iniciarWs, notificarPersona, notificarOperadores, notificarTodos };
