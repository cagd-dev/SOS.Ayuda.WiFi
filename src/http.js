'use strict';

const crypto = require('node:crypto');
const express = require('express');
const config = require('./config');
const {
  personas, mensajes, eventos, vistaPersona, exportarCsv, ESTADOS, NECESIDADES,
} = require('./db');
const ws = require('./ws');
const { macDe, normalizarIp, esMiniNavegador } = require('./red');

/* ------------------------------------------------------------------ *
 * Sesion de operador: token aleatorio en memoria. Al reiniciar el
 * servidor hay que volver a poner el PIN, y eso esta bien.
 * ------------------------------------------------------------------ */
const sesionesOperador = new Set();

function pinValido(pin) {
  const a = Buffer.from(String(pin ?? ''), 'utf8');
  const b = Buffer.from(config.pinOperador, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** La usa el WebSocket para no tener que ver nunca el PIN. */
function sesionValida(sesion) {
  return !!sesion && sesionesOperador.has(sesion);
}

/**
 * Texto comparable: sin mayusculas, sin tildes y sin espacios de sobra.
 *
 * Se usa para cotejar el nombre al recuperar la sesion. Quien se registro como
 * "María" teclea "maria" media hora despues, con el celular roto y las manos
 * temblando, y tiene que entrar igual.
 */
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // los acentos, ya separados por NFD
    .trim()
    .toLowerCase();
}

/* ------------------------------------------------------------------ *
 * Cuotas por dispositivo
 *
 * El almacen vive en src/cuotas.js porque el WebSocket usa el MISMO: el chat
 * tiene dos carriles y con contadores separados bastaria alternar entre ellos
 * para tener el doble de presupuesto.
 * ------------------------------------------------------------------ */
const { limitar } = require('./cuotas');

function cuota(nombre, maximo, ventana) {
  return (req, res, siguiente) => {
    const veredicto = limitar({
      clave: `${nombre}:${normalizarIp(req.ip)}`, maximo, ventana,
    });
    if (veredicto.permitido) return siguiente();

    res.set('Retry-After', String(veredicto.esperar));
    res.status(429).json({
      error: `Demasiados intentos. Espera ${veredicto.esperar} segundos.`,
    });
  };
}

/**
 * Retardo creciente para el PIN: cada fallo desde la misma IP tarda mas en
 * responder. Frena la prueba a ciegas sin bloquear a nadie, que es lo que
 * importa cuando el operador puede estar equivocandose de tecla con prisa.
 */
const fallosPin = new Map();

function retardoPorFallos(ip) {
  const fallos = fallosPin.get(ip)?.cuenta || 0;
  return Math.min(fallos * fallos * 250, 8000); // 0, 250ms, 1s, 2.2s... hasta 8s
}

function apuntarFalloPin(ip) {
  const actual = fallosPin.get(ip) || { cuenta: 0 };
  actual.cuenta += 1;
  actual.ultimo = Date.now();
  fallosPin.set(ip, actual);
}

function limpiarFallosPin(ip) {
  fallosPin.delete(ip);
}

function leerCookies(req) {
  const crudo = req.headers.cookie;
  if (!crudo) return {};
  const salida = {};
  for (const parte of crudo.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    salida[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return salida;
}

function ponerCookie(res, nombre, valor) {
  // 30 dias, sin Secure porque el portal es HTTP puro (no hay CA en terreno).
  res.append('Set-Cookie', `${nombre}=${encodeURIComponent(valor)}; Path=/; Max-Age=2592000; SameSite=Lax`);
}

function escapar(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/* ------------------------------------------------------------------ *
 * Deteccion de portal cautivo
 * ------------------------------------------------------------------ */

/** Rutas exactas que usan los sistemas operativos para preguntar "¿hay internet?" */
const RUTAS_SONDA = new Set([
  '/generate_204',            // Android / Chrome
  '/gen_204',
  '/hotspot-detect.html',     // iOS / macOS
  '/library/test/success.html',
  '/connecttest.txt',         // Windows 10/11
  '/ncsi.txt',                // Windows legacy
  '/success.txt',             // Firefox
  '/canonical.html',          // Ubuntu / NetworkManager
  '/check_network_status.txt',
  '/nm-check.txt',
  '/mobile/status.php',
  '/kindle-wifi/wifistub.html',
]);

function crearApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(express.json({ limit: '64kb' }));
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  const misHosts = new Set([
    config.ip, config.host, 'localhost', '127.0.0.1',
    ...config.listarIpsLan().map((i) => i.ip),
  ]);

  /**
   * Intercepta cualquier peticion que no venga dirigida a nosotros y la manda
   * al portal. Como el DNS resuelve todo hacia esta maquina, aqui cae el mundo
   * entero: las sondas del sistema y cualquier dominio que la gente teclee.
   */
  app.use((req, res, siguiente) => {
    const esSonda = RUTAS_SONDA.has(req.path);
    const hostAjeno = !misHosts.has(req.hostname);

    if (!esSonda && !hostAjeno) return siguiente();

    // 302 hacia el portal: esto es lo que dispara el aviso "Iniciar sesion en
    // la red" y abre la ventanita del portal cautivo en el celular.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.set('Pragma', 'no-cache');
    return res.redirect(302, `${config.urlBase}/?portal=1`);
  });

  app.use((req, res, siguiente) => {
    res.set('Cache-Control', 'no-store');
    // El token de sesion viaja a veces en la URL (?t=...). Sin esto, ese token
    // saldria en la cabecera Referer hacia cualquier recurso que se cargue.
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    siguiente();
  });

  /* Cuotas por dispositivo. Generosas a proposito: en una emergencia la gente
     se registra a rafagas y frenar a quien pide ayuda seria el peor error. */
  const MINUTO = 60_000;
  const cuotaRegistro   = cuota('registro', 12, 5 * MINUTO);
  const cuotaRecuperar  = cuota('recuperar', 20, 5 * MINUTO);
  const cuotaMensajes   = cuota('mensajes', 90, MINUTO);
  const cuotaLogin      = cuota('login', 25, 5 * MINUTO);
  const cuotaUbicacion  = cuota('ubicacion', 30, 5 * MINUTO);
  // Alta: el tablon se consulta mientras se teclea, letra a letra.
  const cuotaDirectorio = cuota('directorio', 120, 5 * MINUTO);
  const cuotaReconocer  = cuota('reconocer', 40, 5 * MINUTO);

  /* ---------------- API de la persona ---------------- */

  function personaDeLaPeticion(req) {
    const token =
      req.get('X-SOS-Token') ||
      req.query.t ||
      req.body?.token ||
      leerCookies(req).sos_token;
    return personas.porToken(token);
  }

  app.get('/api/config', (req, res) => {
    res.json({
      puesto: config.nombrePuesto,
      bienvenida: config.mensajeBienvenida,
      host: config.host,
      urlBase: config.urlBase,
      urlSegura: config.httpsActivo ? config.urlSegura : null,
      estados: Object.entries(ESTADOS).map(([clave, v]) => ({ clave, etiqueta: v.etiqueta })),
      necesidades: NECESIDADES,
      // Para que el portal sepa si tiene que avisar de que esta en la ventanita
      // del portal cautivo, que puede cerrarse sola.
      miniNavegador: esMiniNavegador(req.get('User-Agent')),
      // Para el cartel imprimible. En modo router la red la monta el router y
      // el nombre lo pone el operador a mano en el cartel.
      red: config.modo === 'propio' ? {
        ssid: config.puntoAcceso.ssid,
        clave: config.puntoAcceso.clave,
        claveEnNombre: config.puntoAcceso.claveEnNombre,
      } : null,
    });
  });

  app.post('/api/registro', cuotaRegistro, async (req, res) => {
    const nombre = String(req.body.nombre || '').trim();
    if (nombre.length < 2) {
      return responder(req, res, 400, { error: 'Escribe tu nombre para poder ubicarte.' });
    }

    const persona = personas.crear({
      ...req.body,
      necesidades: normalizarLista(req.body.necesidades),
      ip: normalizarIp(req.ip),
      mac: await macDe(req.ip),
      agente: req.get('User-Agent'),
    });

    eventos.registrar('registro', { id: persona.id, codigo: persona.codigo, nombre: persona.nombre });
    ponerCookie(res, 'sos_token', persona.token);
    ws.notificarOperadores('persona-nueva', { persona });

    mensajes.crear({
      personaId: persona.id,
      direccion: 'sistema',
      texto: `${persona.nombre} se registro en el punto de encuentro. Codigo ${persona.codigo}.`,
    });

    // Queda como primer mensaje del hilo: la regla de uso viaja con la
    // conversacion, no solo en la pantalla de registro que ya paso.
    mensajes.crear({
      personaId: persona.id,
      direccion: 'sistema',
      texto:
        'Este chat lo atiende un puesto de mando de emergencia. Escribe solo informacion ' +
        'verdadera: con esto se decide a quien se rescata primero. Un reporte falso desvia ' +
        'una brigada y le quita el turno a alguien atrapado de verdad.',
    });

    return responder(req, res, 200, { ok: true, persona: vistaPersona(persona) }, `/chat.html?t=${persona.token}`);
  });

  /**
   * Recuperar la sesion con codigo + nombre.
   *
   * El codigo es una CREDENCIAL, no un identificador: quien lo tiene entra al
   * chat de esa persona y puede cambiarle estado, necesidades y ubicacion. Por
   * eso el nombre es la segunda mitad de la prueba y se exige de verdad.
   *
   * Aqui hubo un agujero: se comparaba con startsWith(nombre.slice(0, 3)), y
   * con el nombre vacio eso es startsWith('') — cierto SIEMPRE. Bastaba un
   * codigo, que el tablon publico ademas regalaba, para llevarse la sesion.
   */
  app.post('/api/recuperar', cuotaRecuperar, (req, res) => {
    const codigo = String(req.body.codigo || '').trim().toUpperCase();
    const nombre = normalizar(req.body.nombre);
    if (nombre.length < 3) {
      return res.status(400).json({ error: 'Escribe al menos las tres primeras letras de tu nombre.' });
    }

    const fila = personas.porCodigo(codigo);
    if (!fila || !normalizar(fila.nombre).startsWith(nombre.slice(0, 3))) {
      return res.status(404).json({ error: 'No encontramos ese codigo con ese nombre.' });
    }
    ponerCookie(res, 'sos_token', fila.token);
    res.json({ ok: true, persona: vistaPersona(fila) });
  });

  /**
   * ¿Ya conocemos este telefono? Se usa cuando no hay token: la persona salto
   * del mini-navegador del portal cautivo a Chrome o Safari, donde la cookie
   * y el localStorage no existen.
   *
   * No devolvemos el token: solo el nombre y el codigo, para preguntarle si es
   * ella. Confirmar es un toque, y evita darle la sesion de otro a quien
   * comparte el telefono.
   */
  app.get('/api/reconocer', cuotaReconocer, async (req, res) => {
    const mac = await macDe(req.ip);
    if (!mac) return res.json({ reconocido: false });

    const persona = personas.porMac(mac);
    if (!persona) return res.json({ reconocido: false });

    res.json({
      reconocido: true,
      nombre: persona.nombre,
      codigo: persona.codigo,
      registrado: persona.creado_en,
    });
  });

  /** Confirmacion del paso anterior: ahora si entregamos la sesion. */
  app.post('/api/reconocer', async (req, res) => {
    const mac = await macDe(req.ip);
    const persona = mac ? personas.porMac(mac) : null;
    if (!persona) return res.status(404).json({ error: 'No reconocimos este telefono.' });

    personas.refrescarRed(persona.id, { ip: normalizarIp(req.ip), mac });
    personas.marcarVisto(persona.id);
    ponerCookie(res, 'sos_token', persona.token);
    res.json({ ok: true, persona: vistaPersona(persona) });
  });

  app.get('/api/yo', (req, res) => {
    const persona = personaDeLaPeticion(req);
    if (!persona) return res.status(404).json({ error: 'Sin sesion' });
    personas.marcarVisto(persona.id);
    res.json({ persona: vistaPersona(persona) });
  });

  app.post('/api/yo', (req, res) => {
    const persona = personaDeLaPeticion(req);
    if (!persona) return res.status(404).json({ error: 'Sin sesion' });
    const actualizada = personas.actualizar(persona.id, {
      ...req.body,
      necesidades: req.body.necesidades !== undefined ? normalizarLista(req.body.necesidades) : undefined,
    });
    ws.notificarOperadores('persona-actualizada', { persona: actualizada });
    res.json({ ok: true, persona: vistaPersona(actualizada) });
  });

  app.get('/api/mensajes', (req, res) => {
    const persona = personaDeLaPeticion(req);
    if (!persona) return res.status(404).json({ error: 'Sin sesion' });
    const desde = Number(req.query.desde || 0);
    personas.marcarVisto(persona.id);
    mensajes.marcarLeidosPorPersona(persona.id);
    res.json({ mensajes: mensajes.deLaPersona(persona.id, desde) });
  });

  app.post('/api/mensajes', cuotaMensajes, (req, res) => {
    const persona = personaDeLaPeticion(req);
    if (!persona) return res.status(404).json({ error: 'Sin sesion' });
    const texto = String(req.body.texto || '').trim();
    if (!texto) return res.status(400).json({ error: 'Mensaje vacio' });

    const guardado = mensajes.crear({
      personaId: persona.id,
      direccion: 'persona',
      texto,
      autor: persona.nombre,
    });
    ws.notificarPersona(persona.id, 'mensaje', { mensaje: guardado });
    ws.notificarOperadores('mensaje', { mensaje: guardado, persona: personas.porId(persona.id) });
    res.json({ ok: true, mensaje: guardado });
  });

  /**
   * Recibe las coordenadas desde la ventana HTTPS. Es el unico endpoint que se
   * usa desde el canal seguro: la persona ya esta registrada y solo enriquece
   * su ficha con el GPS.
   */
  app.post('/api/ubicacion', cuotaUbicacion, (req, res) => {
    const persona = personaDeLaPeticion(req);
    if (!persona) return res.status(404).json({ error: 'Sin sesion' });

    const lat = Number(req.body.lat);
    const lon = Number(req.body.lon);
    const precision = Number(req.body.precision);

    if (!Number.isFinite(lat) || !Number.isFinite(lon) ||
        lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return res.status(400).json({ error: 'Coordenadas invalidas' });
    }

    const linea =
      `GPS: ${lat.toFixed(6)}, ${lon.toFixed(6)}` +
      (Number.isFinite(precision) ? ` (+/- ${Math.round(precision)} m)` : '');

    // Conservamos lo que la persona escribio y reemplazamos solo la linea de
    // GPS anterior: si se movio, la nueva manda, pero la descripcion del sitio
    // no se pierde.
    const descripcion = String(persona.ubicacion || '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('GPS:'))
      .join('\n')
      .trim();

    const actualizada = personas.actualizar(persona.id, {
      ubicacion: descripcion ? `${descripcion}\n${linea}` : linea,
    });

    mensajes.crear({
      personaId: persona.id,
      direccion: 'sistema',
      texto: `Ubicacion GPS recibida: ${linea.replace('GPS: ', '')}`,
    });

    eventos.registrar('ubicacion-gps', { id: persona.id, codigo: persona.codigo, lat, lon, precision });
    ws.notificarOperadores('persona-actualizada', { persona: actualizada });
    ws.notificarPersona(persona.id, 'ubicacion', { ubicacion: actualizada.ubicacion });

    res.json({ ok: true, ubicacion: linea });
  });

  /**
   * Tablon publico para que la gente busque a los suyos.
   *
   * Responde a una sola pregunta: "¿esta esta persona registrada y como esta?".
   * Todo lo que no haga falta para eso se queda fuera, porque cualquiera en la
   * red abierta puede consultarlo.
   *
   * - NO devuelve el codigo. El codigo es la credencial con la que se recupera
   *   la sesion: publicarlo aqui equivalia a repartir las llaves, y encadenado
   *   con /api/recuperar dejaba entrar al chat de cualquiera.
   * - Busca SOLO por nombre. Antes usaba la busqueda del operador, que tambien
   *   casa cedula y codigo: se tecleaban digitos y salian personas.
   * - Exige tres caracteres y tiene cuota propia, para que no se pueda barrer
   *   el censo a fuerza de combinaciones.
   */
  app.get('/api/directorio', cuotaDirectorio, (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 3) {
      return res.json({
        total: personas.contar().total,
        personas: [],
        aviso: 'Escribe al menos tres letras del nombre que buscas.',
      });
    }

    const lista = personas.buscarPorNombre(q).slice(0, 50);
    res.json({
      total: personas.contar().total,
      personas: lista.map((p) => ({
        nombre: p.nombre,
        estado: p.estado,
        estadoEtiqueta: p.estadoEtiqueta,
        acompanantes: p.acompanantes,
        creado_en: p.creado_en,
      })),
    });
  });

  /* ---------------- API del operador ---------------- */

  app.post('/admin/login', cuotaLogin, async (req, res) => {
    const ip = normalizarIp(req.ip) || 'desconocida';

    // El retardo se aplica ANTES de comprobar: quien acierta a la primera no
    // espera nada, y quien va probando se encuentra con esperas crecientes.
    const espera = retardoPorFallos(ip);
    if (espera) await new Promise((r) => setTimeout(r, espera));

    if (!pinValido(req.body.pin)) {
      apuntarFalloPin(ip);
      eventos.registrar('login-fallido', { ip, intentos: fallosPin.get(ip)?.cuenta });
      return res.status(401).json({ error: 'PIN incorrecto' });
    }

    limpiarFallosPin(ip);
    const sesion = crypto.randomBytes(24).toString('hex');
    sesionesOperador.add(sesion);
    ponerCookie(res, 'sos_op', sesion);
    res.json({ ok: true, sesion });
  });

  function soloOperador(req, res, siguiente) {
    const sesion = req.get('X-SOS-Sesion') || leerCookies(req).sos_op || req.query.s;
    if (!sesion || !sesionesOperador.has(sesion)) {
      return res.status(401).json({ error: 'No autorizado' });
    }
    siguiente();
  }

  app.get('/admin/api/resumen', soloOperador, (req, res) => {
    res.json({ resumen: personas.contar(), puesto: config.nombrePuesto });
  });

  app.get('/admin/api/personas', soloOperador, (req, res) => {
    res.json({ personas: personas.listar(), resumen: personas.contar() });
  });

  app.get('/admin/api/personas/:id', soloOperador, (req, res) => {
    const persona = personas.porId(Number(req.params.id));
    if (!persona) return res.status(404).json({ error: 'No existe' });
    res.json({ persona, mensajes: mensajes.deLaPersona(persona.id) });
  });

  app.post('/admin/api/personas/:id/mensajes', soloOperador, (req, res) => {
    const persona = personas.porId(Number(req.params.id));
    if (!persona) return res.status(404).json({ error: 'No existe' });
    const texto = String(req.body.texto || '').trim();
    if (!texto) return res.status(400).json({ error: 'Mensaje vacio' });

    const guardado = mensajes.crear({
      personaId: persona.id,
      direccion: 'operador',
      texto,
      autor: req.body.autor || config.nombrePuesto,
    });
    ws.notificarPersona(persona.id, 'mensaje', { mensaje: guardado });
    ws.notificarOperadores('mensaje', { mensaje: guardado, persona });
    res.json({ ok: true, mensaje: guardado });
  });

  app.post('/admin/api/personas/:id/leido', soloOperador, (req, res) => {
    mensajes.marcarLeidosPorOperador(Number(req.params.id));
    res.json({ ok: true });
  });

  app.post('/admin/api/personas/:id/atendido', soloOperador, (req, res) => {
    const persona = personas.marcarAtendido(Number(req.params.id), !!req.body.atendido);
    ws.notificarOperadores('persona-actualizada', { persona });
    res.json({ ok: true, persona });
  });

  app.post('/admin/api/personas/:id/dudoso', soloOperador, (req, res) => {
    const persona = personas.marcarDudoso(Number(req.params.id), {
      dudoso: !!req.body.dudoso,
      motivo: req.body.motivo,
      por: req.body.por,
    });
    if (!persona) return res.status(404).json({ error: 'No existe' });

    eventos.registrar('dudoso', {
      id: persona.id,
      codigo: persona.codigo,
      dudoso: persona.dudoso,
      motivo: persona.dudoso_motivo,
      por: persona.dudoso_por,
    });
    ws.notificarOperadores('persona-actualizada', { persona });
    res.json({ ok: true, persona });
  });

  app.post('/admin/api/personas/:id/notas', soloOperador, (req, res) => {
    const persona = personas.anotar(Number(req.params.id), String(req.body.notas || ''));
    ws.notificarOperadores('persona-actualizada', { persona });
    res.json({ ok: true, persona });
  });

  app.post('/admin/api/difusion', soloOperador, (req, res) => {
    const texto = String(req.body.texto || '').trim();
    if (!texto) return res.status(400).json({ error: 'Mensaje vacio' });
    const creados = mensajes.difundir(texto, req.body.autor || config.nombrePuesto);
    for (const mensaje of creados) {
      ws.notificarPersona(mensaje.persona_id, 'mensaje', { mensaje });
    }
    ws.notificarOperadores('difusion', { total: creados.length, texto });
    eventos.registrar('difusion', { total: creados.length, texto });
    res.json({ ok: true, total: creados.length });
  });

  app.get('/admin/api/exportar.csv', soloOperador, (req, res) => {
    const csv = exportarCsv();
    const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="censo-sos-${sello}.csv"`);
    res.send(csv);
  });

  /* ---------------- Estaticos y portal ---------------- */

  app.use(express.static(config.publico, { index: 'index.html', maxAge: 0 }));

  // Cualquier otra cosa (dominios tecleados a mano, rutas inventadas) al portal.
  app.use((req, res) => res.redirect(302, `${config.urlBase}/?portal=1`));

  /* ---------------- Auxiliares ---------------- */

  function normalizarLista(valor) {
    if (Array.isArray(valor)) return valor;
    if (typeof valor === 'string') return valor.split(',').map((s) => s.trim()).filter(Boolean);
    return [];
  }

  /**
   * Responde JSON al fetch() normal, y HTML plano si el navegador mando el
   * formulario sin JavaScript (pasa en portales cautivos viejos).
   */
  function responder(req, res, codigo, cuerpo, destinoHtml) {
    const quiereJson = (req.get('Accept') || '').includes('application/json');
    if (quiereJson) return res.status(codigo).json(cuerpo);

    if (cuerpo.error) {
      return res.status(codigo).send(paginaSimple('No pudimos registrarte', `
        <p class="error">${escapar(cuerpo.error)}</p>
        <a class="boton" href="/">Volver e intentar de nuevo</a>`));
    }
    return res.status(codigo).send(paginaSimple('Registro guardado', `
      <p>Tu codigo es <strong class="codigo">${escapar(cuerpo.persona.codigo)}</strong></p>
      <p>Guardalo. Con el te podemos ubicar y puedes recuperar tu chat.</p>
      <a class="boton" href="${escapar(destinoHtml)}">Abrir el chat</a>`));
  }

  function paginaSimple(titulo, contenido) {
    return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapar(titulo)}</title><link rel="stylesheet" href="/css/app.css"></head>
<body class="simple"><main class="tarjeta"><h1>${escapar(titulo)}</h1>${contenido}</main></body></html>`;
  }

  return app;
}

module.exports = { crearApp, pinValido, sesionValida };
