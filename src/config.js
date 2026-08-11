'use strict';

const os = require('node:os');
const path = require('node:path');
const ajustes = require('./ajustes').leer();

/**
 * Adaptadores que casi nunca son la red real del router: VMware, Hyper-V, WSL,
 * VPNs. En la maquina de despliegue suelen aparecer primero y arruinarian la
 * deteccion automatica, asi que los mandamos al final de la lista.
 */
const ADAPTADOR_VIRTUAL = /vmware|hyper-?v|vethernet|vmnet|virtual|wsl|loopback|tap|tun|zerotier|tailscale|radmin|ppp/i;

function puntajeDeRed(ip) {
  if (ip.startsWith('192.168.')) return 0; // rango tipico de router casero
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
  if (ip.startsWith('10.')) return 2;
  if (ip.startsWith('169.254.')) return 9; // link-local: no hubo DHCP
  return 5;
}

/**
 * Devuelve la IP LAN por la que nos van a ver los celulares.
 * Se puede forzar con la variable de entorno SOS_IP o el flag --ip.
 */
function detectarIpLan() {
  // En modo propio la IP no se detecta: la fijamos nosotros en la tarjeta del
  // punto de acceso, asi que es un dato de configuracion, no del entorno.
  if ((process.env.SOS_MODO || ajustes.modo) === 'propio') {
    return leerFlag('--ip') || process.env.SOS_IP || ajustes.apIp || '192.168.99.1';
  }

  // Prioridad: flag de la linea de comandos > variable de entorno > lo que
  // haya elegido el operador en la consola > deteccion automatica.
  const forzada = leerFlag('--ip') || process.env.SOS_IP || ajustes.ip;
  if (forzada) return forzada;

  const candidatas = [];
  for (const [nombre, direcciones] of Object.entries(os.networkInterfaces())) {
    for (const dir of direcciones || []) {
      if (dir.family !== 'IPv4' || dir.internal) continue;
      candidatas.push({
        nombre,
        ip: dir.address,
        puntaje: puntajeDeRed(dir.address) + (ADAPTADOR_VIRTUAL.test(nombre) ? 20 : 0),
      });
    }
  }
  candidatas.sort((a, b) => a.puntaje - b.puntaje);
  return candidatas.length ? candidatas[0].ip : '127.0.0.1';
}

function listarIpsLan() {
  const salida = [];
  for (const [nombre, direcciones] of Object.entries(os.networkInterfaces())) {
    for (const dir of direcciones || []) {
      if (dir.family !== 'IPv4' || dir.internal) continue;
      salida.push({ nombre, ip: dir.address, virtual: ADAPTADOR_VIRTUAL.test(nombre) });
    }
  }
  return salida;
}

function leerFlag(nombre) {
  const i = process.argv.indexOf(nombre);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

const raiz = path.resolve(__dirname, '..');

/**
 * Dos formas de montar la red:
 *
 *  'router' — hay un router que reparte DHCP. Nosotros solo ponemos DNS y web.
 *             Mas alcance y mas gente: es el modo bueno cuando hay router.
 *
 *  'propio' — el punto de acceso es la tarjeta WiFi de este equipo y el DHCP lo
 *             ponemos nosotros. No depende de nadie, pero llega menos lejos y
 *             aguanta menos telefonos.
 */
const MODO = process.env.SOS_MODO || ajustes.modo || 'router';

const nombreRedBase = process.env.SOS_SSID || ajustes.apNombre || ajustes.apSsid || 'SOS-AYUDA';
// La red hospedada de Windows NO puede ser abierta: exige WPA2 con 8 caracteres
// o mas. En vez de confiar en que la gente lea el cartel, metemos la clave
// DENTRO del nombre de la red, y asi se lee en la lista de WiFi del telefono.
const claveRed = String(process.env.SOS_CLAVE || ajustes.apClave || '12345678');
const claveEnNombre = ajustes.apClaveEnNombre !== false;

const nombreCompuesto = require('./puntoacceso').componerSsid({
  base: nombreRedBase, clave: claveRed, incluirClave: claveEnNombre,
});

const puntoAcceso = {
  nombreBase: nombreRedBase,
  ssid: nombreCompuesto.ssid,
  claveEnNombre,
  avisoSsid: nombreCompuesto.aviso,
  clave: claveRed,
  ip: ajustes.apIp || '192.168.99.1',
  mascara: '255.255.255.0',
  desde: ajustes.apDesde || '192.168.99.50',
  hasta: ajustes.apHasta || '192.168.99.200',
  arriendo: Number(ajustes.apArriendo || 3600),
  adaptador: ajustes.apAdaptador || null,
};

const config = {
  raiz,
  modo: MODO,
  puntoAcceso,
  publico: path.join(raiz, 'public'),
  carpetaDatos: path.join(raiz, 'datos'),
  rutaBaseDatos: path.join(raiz, 'datos', 'sos.sqlite3'),
  carpetaExportes: path.join(raiz, 'exportes'),

  ip: detectarIpLan(),
  puertoHttp: Number(leerFlag('--http') || process.env.SOS_PUERTO_HTTP || 80),
  puertoDns: Number(leerFlag('--dns') || process.env.SOS_PUERTO_DNS || 53),
  dnsActivo: process.env.SOS_DNS !== '0' && !process.argv.includes('--sin-dns'),

  // Canal HTTPS. Existe por una sola razon: los navegadores solo entregan el
  // GPS en contexto seguro. El portal en si sigue siendo HTTP, porque la
  // deteccion de portal cautivo lo necesita.
  puertoHttps: Number(leerFlag('--https') || process.env.SOS_PUERTO_HTTPS || 443),
  httpsActivo: process.env.SOS_HTTPS !== '0' && !process.argv.includes('--sin-https'),

  // Nombre bonito que la gente puede teclear. NO usar .local: los iPhone lo
  // resuelven por mDNS y se saltan nuestro DNS.
  host: process.env.SOS_HOST || 'sos.ayuda',

  // PIN de la consola de operador. Los datos son sensibles: cambialo desde
  // ADMINISTRAR.bat (opcion 3), que lo guarda en datos/configuracion.json.
  pinOperador: String(process.env.SOS_PIN || ajustes.pin || '1234'),

  nombrePuesto: process.env.SOS_PUESTO || ajustes.puesto || 'Puesto de Mando SOS',
  mensajeBienvenida:
    process.env.SOS_BIENVENIDA ||
    ajustes.bienvenida ||
    'Estas conectado a la red de emergencia. Registrate para que sepamos que estas aqui.',

  listarIpsLan,
};

config.urlBase = `http://${config.ip}${config.puertoHttp === 80 ? '' : ':' + config.puertoHttp}`;
config.urlSegura = `https://${config.ip}${config.puertoHttps === 443 ? '' : ':' + config.puertoHttps}`;

module.exports = config;
