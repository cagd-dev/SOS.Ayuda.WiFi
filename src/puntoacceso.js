'use strict';

/**
 * Convierte la tarjeta WiFi del equipo en punto de acceso, usando la "red
 * hospedada" de Windows (netsh wlan hostednetwork).
 *
 * Por que esta y no el "Punto de acceso movil" de Windows: el punto de acceso
 * movil EXIGE una conexion a internet que compartir y se niega a arrancar sin
 * ella. En un terremoto no hay internet, asi que no sirve. La red hospedada
 * funciona sin conexion alguna.
 *
 * LIMITE IMPORTANTE: la red hospedada no puede ser abierta. Windows obliga a
 * WPA2 con clave de 8 caracteres o mas, asi que la clave TIENE que ir en el
 * cartel. Es el precio de no necesitar router.
 *
 * Otro limite: depende del driver. Muchas tarjetas modernas ya no lo soportan;
 * por eso `soportado()` se comprueba antes de ofrecer el modo.
 */

const { execFile } = require('node:child_process');
const os = require('node:os');

function correr(comando, argumentos) {
  return new Promise((resolver) => {
    execFile(comando, argumentos,
      { timeout: 15000, windowsHide: true, encoding: 'utf8' },
      (err, salida, error) => resolver({
        ok: !err,
        texto: `${salida || ''}${error || ''}`,
      }));
  });
}

/** netsh habla el idioma de Windows, asi que hay que reconocer los dos. */
function diceQueSi(linea) {
  return /:\s*(s[ií]|yes)\b/i.test(linea);
}

function lineaDe(texto, patron) {
  return texto.split('\n').find((l) => patron.test(l)) || '';
}

/**
 * ¿Puede esta tarjeta hacer de punto de acceso para un grupo de gente?
 *
 * Se miran DOS cosas, porque son mecanismos distintos:
 *   - "Red hospedada": el viejo netsh hostednetwork.
 *   - "Soft AP": lo que usa el Punto de acceso movil de Windows.
 * Con que una de las dos este, se puede montar el modo propio.
 *
 * Wi-Fi Direct NO cuenta aunque aparezca como compatible: suele venir limitado
 * a un punado de clientes y los iPhone no se conectan a una red asi.
 */
async function soportado() {
  if (os.platform() !== 'win32') {
    return { soportado: false, motivo: 'Esto solo funciona en Windows.' };
  }

  const drivers = await correr('netsh', ['wlan', 'show', 'drivers']);
  if (!drivers.ok || !drivers.texto.trim()) {
    return {
      soportado: false,
      tarjeta: null,
      motivo: 'No hay ninguna tarjeta WiFi utilizable en este equipo (¿es de escritorio?).',
    };
  }

  const lineaTarjeta = lineaDe(drivers.texto, /^\s*(controlador|driver)\s*:/i);
  const tarjeta = (lineaTarjeta.split(':').slice(1).join(':') || '').trim() || null;

  const lineaHospedada = lineaDe(drivers.texto, /hosted network supported|red hospedada/i);
  const hospedada = !!lineaHospedada && diceQueSi(lineaHospedada);

  const capacidades = await correr('netsh', ['wlan', 'show', 'wirelesscapabilities']);
  const lineaSoftAp = lineaDe(capacidades.texto, /soft\s*ap/i);
  // Aqui netsh dice "compatible" / "no compatible", no si/no.
  const softAp = !!lineaSoftAp && /:\s*compatible/i.test(lineaSoftAp) &&
                 !/no\s*compatible/i.test(lineaSoftAp);

  if (hospedada || softAp) {
    return {
      soportado: true,
      tarjeta,
      mecanismo: hospedada ? 'hospedada' : 'softap',
      motivo: null,
    };
  }

  const lineaMax = lineaDe(capacidades.texto, /(m[aá]x.*clientes|max.*clients)/i);
  const maximo = (lineaMax.match(/(\d+)\s*$/) || [])[1];

  return {
    soportado: false,
    tarjeta,
    mecanismo: null,
    motivo:
      `La tarjeta "${tarjeta || 'WiFi'}" NO puede hacer de punto de acceso: ` +
      'no admite red hospedada ni Soft AP.' +
      (maximo ? ` Solo admite Wi-Fi Direct, y con un tope de ${maximo} clientes.` : '') +
      '\nUsa el modo router, o un adaptador WiFi que si lo admita ' +
      '(compruebalo con: netsh wlan show wirelesscapabilities).',
  };
}

async function estado() {
  const { ok, texto } = await correr('netsh', ['wlan', 'show', 'hostednetwork']);
  if (!ok) return { activo: false, ssid: null, clientes: 0 };

  const lineaEstado = lineaDe(texto, /^\s*(estado|status)\s*:/i);
  const activo = /iniciad|started|activ/i.test(lineaEstado);

  const lineaSsid = lineaDe(texto, /ssid\s+(de la red|name)?\s*:/i);
  const ssid = (lineaSsid.split(':')[1] || '').trim().replace(/^"|"$/g, '') || null;

  const lineaClientes = lineaDe(texto, /(numero de clientes|number of clients)/i);
  const clientes = Number((lineaClientes.match(/(\d+)\s*$/) || [])[1] || 0);

  return { activo, ssid, clientes, crudo: texto };
}

/**
 * Compone el nombre de la red metiendo la clave dentro.
 *
 * La idea: si la red se llama "SOS-AYUDA-CLAVE-12345678", la gente lee la clave
 * en la propia lista de WiFi del telefono y no depende de que alguien haya
 * leido el cartel. Es la mejor solucion al hecho de que Windows no permita red
 * hospedada abierta.
 *
 * El limite duro es que un SSID no puede pasar de 32 bytes. Si no cabe, se
 * devuelve solo el nombre base y se avisa, en vez de generar un SSID invalido
 * que Windows rechazaria sin explicar por que.
 */
function componerSsid({ base, clave, incluirClave = true }) {
  const limpio = String(base || 'SOS-AYUDA').trim();

  if (!incluirClave) {
    return { ssid: limpio, cabe: Buffer.byteLength(limpio, 'utf8') <= 32, aviso: null };
  }

  const compuesto = `${limpio}-CLAVE-${clave}`;
  const bytes = Buffer.byteLength(compuesto, 'utf8');

  if (bytes <= 32) return { ssid: compuesto, cabe: true, aviso: null };

  return {
    ssid: limpio,
    cabe: Buffer.byteLength(limpio, 'utf8') <= 32,
    aviso:
      `"${compuesto}" ocupa ${bytes} bytes y el maximo de un nombre de red son 32. ` +
      'Se usa solo el nombre base; acorta el nombre o la clave si quieres que la ' +
      'clave viaje en el nombre.',
  };
}

async function configurar({ ssid, clave }) {
  if (Buffer.byteLength(String(ssid || ''), 'utf8') > 32) {
    return { ok: false, error: 'El nombre de la red no puede pasar de 32 caracteres.' };
  }
  if (!ssid || ssid.length < 1) return { ok: false, error: 'Falta el nombre de la red (SSID).' };
  if (!clave || clave.length < 8) {
    return {
      ok: false,
      error: 'La clave debe tener 8 caracteres o mas: Windows no permite red hospedada abierta.',
    };
  }

  const r = await correr('netsh', [
    'wlan', 'set', 'hostednetwork', 'mode=allow', `ssid=${ssid}`, `key=${clave}`,
  ]);
  return { ok: r.ok, error: r.ok ? null : r.texto.trim() };
}

async function iniciar() {
  const r = await correr('netsh', ['wlan', 'start', 'hostednetwork']);
  if (r.ok) return { ok: true, error: null };

  // El mensaje crudo de netsh no le dice nada a nadie; traducimos las causas
  // que se dan de verdad en terreno.
  let pista = r.texto.trim();
  if (/no se pudo iniciar|could not be started/i.test(r.texto)) {
    pista += '\nCausas tipicas: la tarjeta WiFi esta apagada, o esta conectada a otra red, ' +
             'o el driver no admite red hospedada.';
  }
  return { ok: false, error: pista };
}

async function detener() {
  const r = await correr('netsh', ['wlan', 'stop', 'hostednetwork']);
  return { ok: r.ok, error: r.ok ? null : r.texto.trim() };
}

/**
 * Pone IP fija en la tarjeta del punto de acceso. Sin esto Windows le deja una
 * 169.254.x.x y nuestro DHCP repartiria direcciones de una red que no existe.
 */
async function fijarIp({ adaptador, ip, mascara }) {
  if (!adaptador) return { ok: false, error: 'No se sabe que tarjeta configurar.' };
  const r = await correr('netsh', [
    'interface', 'ip', 'set', 'address', `name=${adaptador}`, 'static', ip, mascara,
  ]);
  return { ok: r.ok, error: r.ok ? null : r.texto.trim() };
}

/** Nombre de la tarjeta virtual que crea la red hospedada. */
async function adaptadorHospedado() {
  const { ok, texto } = await correr('netsh', ['interface', 'show', 'interface']);
  if (!ok) return null;
  const linea = texto.split('\n').find((l) => /hosted network|red hospedada|conexi.n de red local\* /i.test(l));
  if (!linea) return null;
  // La ultima columna es el nombre de la conexion.
  const columnas = linea.trim().split(/\s{2,}/);
  return columnas[columnas.length - 1] || null;
}

module.exports = {
  soportado, estado, configurar, iniciar, detener, fijarIp, adaptadorHospedado,
  componerSsid,
};
