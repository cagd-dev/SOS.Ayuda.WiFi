'use strict';

/**
 * Identificacion del dispositivo por su direccion MAC, leida de la tabla ARP.
 *
 * ¿Por que no basta una cookie? Porque el mini-navegador del portal cautivo y
 * el navegador de verdad (Chrome, Safari) tienen almacenes SEPARADOS: la
 * cookie que ponemos en uno no existe en el otro. La persona que se registra
 * en la ventanita y luego abre Chrome llega como una desconocida.
 *
 * La MAC si sobrevive ese salto, porque no vive en el navegador sino en el
 * telefono. Y aunque iOS y Android aleatorizan la MAC por seguridad, lo hacen
 * UNA VEZ POR RED: dentro de nuestro WiFi es estable, que es justo lo que
 * necesitamos.
 *
 * Limite conocido: quien este en esta misma red puede falsificar una MAC y
 * hacerse pasar por otra persona. En una red abierta de emergencia asumimos
 * ese riesgo a cambio de que nadie pierda su sesion.
 */

const { execFile } = require('node:child_process');
const os = require('node:os');

const PATRON_MAC = /([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i;

// La tabla ARP no cambia rapido y consultarla lanza un proceso: cacheamos.
const cache = new Map();
const VIDA_CACHE = 60_000;

/** Express entrega IPv4 mapeada sobre IPv6 (::ffff:192.168.0.51). La limpiamos. */
function normalizarIp(ip) {
  if (!ip) return null;
  const limpia = String(ip).replace(/^::ffff:/i, '').trim();
  return limpia || null;
}

function esLocal(ip) {
  return !ip || ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

function normalizarMac(mac) {
  return mac.toLowerCase().replace(/-/g, ':');
}

function ejecutar(comando, argumentos) {
  return new Promise((resolver) => {
    execFile(comando, argumentos, { timeout: 3000, windowsHide: true }, (err, salida) =>
      resolver(err ? '' : String(salida))
    );
  });
}

/**
 * MAC del dispositivo que tiene esa IP en nuestra red, o null si no se puede
 * averiguar. Nunca lanza: si falla, el sistema sigue funcionando con codigo
 * y cookie como hasta ahora.
 */
async function macDe(ip) {
  const limpia = normalizarIp(ip);
  if (esLocal(limpia)) return null;

  const enCache = cache.get(limpia);
  if (enCache && enCache.hasta > Date.now()) return enCache.mac;

  let salida = '';
  try {
    if (os.platform() === 'win32') {
      salida = await ejecutar('arp', ['-a', limpia]);
    } else {
      salida = await ejecutar('ip', ['neigh', 'show', limpia]);
      if (!salida) salida = await ejecutar('arp', ['-n', limpia]);
    }
  } catch {
    return null;
  }

  const mac = extraerMac(salida, limpia);
  cache.set(limpia, { mac, hasta: Date.now() + VIDA_CACHE });
  return mac;
}

/**
 * Saca la MAC de la salida de arp buscando la linea de ESA IP exacta.
 *
 * Comparar con includes() seria un error grave: "172.19.199.1" es subcadena de
 * "172.19.199.117", y devolver la MAC equivocada significaria entregarle a
 * alguien la sesion de otra persona. Por eso exigimos que la IP este delimitada
 * por espacios o por el principio y el final de la linea.
 */
function extraerMac(salida, ip) {
  const escapada = ip.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const esaIp = new RegExp(`(^|\\s)${escapada}(\\s|$)`);

  for (const l of String(salida).split('\n')) {
    if (!esaIp.test(l)) continue;
    const encontrada = l.match(PATRON_MAC);
    if (encontrada) return normalizarMac(encontrada[0]);
  }
  return null;
}

/**
 * ¿Viene de un mini-navegador de portal cautivo?
 *   Android: la WebView se identifica con "; wv)".
 *   iOS: la ventana del portal es una WKWebView, que a diferencia de Safari
 *        NO lleva "Safari/" al final del User-Agent.
 * No es infalible, pero acierta en la gran mayoria y solo lo usamos para
 * mostrar un aviso extra, nunca para bloquear nada.
 */
function esMiniNavegador(agente) {
  const ua = String(agente || '');
  if (!ua) return false;
  if (/CaptiveNetworkSupport/i.test(ua)) return true;
  if (/;\s*wv\)/i.test(ua)) return true;
  if (/iPhone|iPad|iPod/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua)) return true;
  return false;
}

/**
 * Vecinos visibles en la tabla ARP. Sirve para comprobar EN EL SITIO que el
 * reconocimiento por dispositivo va a funcionar: solo funciona si los
 * telefonos estan en el mismo segmento de red que este equipo.
 *
 * Si la VM esta en NAT, o el WiFi cuelga de otra subred, aqui no aparecera
 * nadie y el reconocimiento quedara desactivado en silencio. Mejor saberlo
 * antes de salir que descubrirlo en terreno.
 */
async function vecinos() {
  const salida = os.platform() === 'win32'
    ? await ejecutar('arp', ['-a'])
    : (await ejecutar('ip', ['neigh'])) || (await ejecutar('arp', ['-an']));

  const encontrados = [];
  for (const l of String(salida).split('\n')) {
    const ip = l.match(/\b(\d{1,3}(?:\.\d{1,3}){3})\b/);
    const mac = l.match(PATRON_MAC);
    if (!ip || !mac) continue;

    // Difusion y multidifusion no son dispositivos reales.
    const normalizada = normalizarMac(mac[0]);
    if (normalizada === 'ff:ff:ff:ff:ff:ff' || normalizada.startsWith('01:00:5e')) continue;

    encontrados.push({ ip: ip[1], mac: normalizada });
  }
  return encontrados;
}

module.exports = { macDe, extraerMac, normalizarIp, esMiniNavegador, vecinos };
