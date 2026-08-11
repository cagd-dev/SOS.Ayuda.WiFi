'use strict';

/**
 * Chat en vivo. El WebSocket es el camino rapido, pero NO se puede dar por
 * garantizado: el mini-navegador del portal cautivo (sobre todo en iPhone)
 * a veces lo bloquea. Por eso el cliente siempre puede caer a polling contra
 * /api/mensajes, y este modulo solo acelera lo que de todos modos funciona.
 */

const { WebSocketServer } = require('ws');
const { personas, mensajes, vistaPersona } = require('./db');

/** personaId -> Set<WebSocket> */
const conexionesPersona = new Map();
/** Set<WebSocket> de consolas de operador */
const conexionesOperador = new Set();

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

function iniciarWs(servidorHttp, { pinValido }) {
  const wss = new WebSocketServer({ server: servidorHttp, path: '/ws' });

  wss.on('connection', (socket, req) => {
    const url = new URL(req.url, 'http://interno');
    const rol = url.searchParams.get('rol');
    socket.estaVivo = true;
    socket.on('pong', () => { socket.estaVivo = true; });

    if (rol === 'operador') {
      if (!pinValido(url.searchParams.get('pin'))) {
        enviar(socket, 'error', { mensaje: 'PIN invalido' });
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
    conexionesPersona.get(persona.id).add(socket);
    personas.marcarVisto(persona.id);
    notificarOperadores('presencia', { personaId: persona.id, enLinea: true });
    enviar(socket, 'listo', { rol: 'persona', persona: vistaPersona(persona) });

    socket.on('message', (crudo) => {
      let datos;
      try { datos = JSON.parse(crudo.toString()); } catch { return; }
      if (datos.tipo !== 'mensaje' || !String(datos.texto || '').trim()) return;

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
