'use strict';

/**
 * Prueba de humo. Verifica que el sistema completo responde antes de salir a
 * terreno: registro, chat, consola, exportacion, DNS, canal seguro del GPS y
 * las sondas de portal cautivo de Android/iOS/Windows.
 *
 * OJO: crea personas de ejemplo en la base. Correla ANTES de operar y limpia
 * despues con `npm run limpiar`. Las comprobaciones de orden se hacen contra
 * las personas de esta misma corrida, asi que no falla si la base ya trae
 * gente, pero los datos de prueba si se quedan ahi.
 *
 *   node pruebas/humo.js                       (contra http://127.0.0.1)
 *   node pruebas/humo.js --url http://127.0.0.1:8099 --dns 5399 --pin 9876
 */

const dns = require('node:dns');
const nodeHttps = require('node:https');
const WebSocket = require('ws');

const flag = (nombre, porDefecto) => {
  const i = process.argv.indexOf(nombre);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
};

const URL_BASE = flag('--url', 'http://127.0.0.1');
const PUERTO_DNS = Number(flag('--dns', '53'));
const PUERTO_SEGURO = Number(flag('--seguro', '443'));
const PIN = flag('--pin', process.env.SOS_PIN || '1234');

/**
 * Cliente del canal HTTPS. Aceptamos el certificado sin verificar a proposito:
 * es autofirmado, que es justo lo que estamos probando. Ademas devolvemos el
 * certificado del servidor para poder inspeccionarlo.
 */
function pedirSeguro(ruta, opciones = {}) {
  return new Promise((resolver, rechazar) => {
    const peticion = nodeHttps.request(
      {
        host: '127.0.0.1',
        port: PUERTO_SEGURO,
        path: ruta,
        method: opciones.method || 'GET',
        rejectUnauthorized: false,
        headers: opciones.headers,
      },
      (respuesta) => {
        // Hay que leer el certificado AQUI: para cuando llega el evento 'end'
        // el socket ya esta desacoplado y respuesta.socket es null.
        const certificado = respuesta.socket ? respuesta.socket.getPeerCertificate() : null;
        let cuerpo = '';
        respuesta.on('data', (trozo) => { cuerpo += trozo; });
        respuesta.on('end', () => resolver({ estado: respuesta.statusCode, cuerpo, certificado }));
      }
    );
    peticion.on('error', rechazar);
    if (opciones.body) peticion.write(opciones.body);
    peticion.end();
  });
}

let pasadas = 0;
let fallidas = 0;
let omitidas = 0;

function revisar(nombre, condicion, detalle = '') {
  if (condicion) {
    pasadas += 1;
    console.log(`  OK   ${nombre}`);
  } else {
    fallidas += 1;
    console.log(`  FALLA ${nombre}${detalle ? ' -> ' + detalle : ''}`);
  }
}

/**
 * Para lo que no se puede probar en este arranque concreto. Se marca aparte
 * de los fallos: decir "FALLA el DNS" cuando el DNS ni siquiera esta encendido
 * manda a buscar el problema al sitio equivocado.
 */
function omitir(nombre, motivo) {
  omitidas += 1;
  console.log(`  --   ${nombre}  (omitida: ${motivo})`);
}

const json = (respuesta) => respuesta.json();

async function main() {
  console.log(`\nProbando ${URL_BASE}\n`);

  /* --- Configuracion --- */
  const config = await fetch(`${URL_BASE}/api/config`, { headers: { Accept: 'application/json' } }).then(json);
  revisar('GET /api/config responde', !!config.puesto);
  revisar('config trae los 5 estados', config.estados?.length === 5, `vinieron ${config.estados?.length}`);

  /* --- Sondas de portal cautivo --- */
  const sondas = [
    ['Android', '/generate_204', 'connectivitycheck.gstatic.com'],
    ['iOS/macOS', '/hotspot-detect.html', 'captive.apple.com'],
    ['Windows', '/connecttest.txt', 'www.msftconnecttest.com'],
    ['Firefox', '/success.txt', 'detectportal.firefox.com'],
  ];
  for (const [sistema, ruta, host] of sondas) {
    const respuesta = await fetch(`${URL_BASE}${ruta}`, { headers: { Host: host }, redirect: 'manual' });
    revisar(`sonda ${sistema} (${ruta}) redirige al portal`, respuesta.status === 302, `dio ${respuesta.status}`);
  }

  const ajeno = await fetch(`${URL_BASE}/lo-que-sea`, { headers: { Host: 'www.google.com' }, redirect: 'manual' });
  revisar('dominio ajeno redirige al portal', ajeno.status === 302, `dio ${ajeno.status}`);

  /* --- Registro --- */
  // Cedula inventada, pero con un valor raro a proposito: sirve para comprobar
  // mas abajo que el tablon publico NO deja buscar por documento.
  const DOCUMENTO_PRUEBA = '99887766';

  const registro = await fetch(`${URL_BASE}/api/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      nombre: 'Prueba De Humo',
      documento: DOCUMENTO_PRUEBA,
      estado: 'atrapado',
      necesidades: ['rescate', 'agua'],
      ubicacion: 'Calle falsa 123',
      acompanantes: 'Dos ninos',
    }),
  }).then(json);

  revisar('POST /api/registro crea la persona', !!registro.persona?.id);
  revisar('asigna codigo pronunciable', /^[A-Z]-\d{4}$/.test(registro.persona?.codigo || ''), registro.persona?.codigo);
  revisar('calcula urgencia maxima para atrapado+rescate', registro.persona?.urgencia === 42, String(registro.persona?.urgencia));

  const token = registro.persona.token;
  const idPersona = registro.persona.id;

  const sinNombre = await fetch(`${URL_BASE}/api/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ nombre: ' ' }),
  });
  revisar('rechaza registro sin nombre', sinNombre.status === 400, `dio ${sinNombre.status}`);

  /* --- Sesion de la persona --- */
  const yo = await fetch(`${URL_BASE}/api/yo?t=${token}`, { headers: { Accept: 'application/json' } }).then(json);
  revisar('GET /api/yo recupera la sesion', yo.persona?.id === idPersona);

  const tokenMalo = await fetch(`${URL_BASE}/api/yo?t=noexiste`, { headers: { Accept: 'application/json' } });
  revisar('token invalido da 404', tokenMalo.status === 404, `dio ${tokenMalo.status}`);

  const recuperada = await fetch(`${URL_BASE}/api/recuperar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ codigo: registro.persona.codigo, nombre: 'Prueba' }),
  }).then(json);
  revisar('recupera sesion con codigo + nombre', recuperada.persona?.id === idPersona);

  /* --- Mini-navegador del portal cautivo y reconocimiento del telefono --- */
  const red = require('../src/red');

  revisar('normaliza IPv4 mapeada sobre IPv6',
    red.normalizarIp('::ffff:192.168.0.51') === '192.168.0.51');
  revisar('no busca MAC del loopback', (await red.macDe('127.0.0.1')) === null);

  // Tabla real de Windows, con una IP que es prefijo de otra. Si el emparejado
  // fuera por subcadena, "172.19.199.1" se llevaria la MAC de "...117" y le
  // daria a alguien la sesion de otra persona.
  const tablaArp = [
    'Interfaz: 172.19.199.99 --- 0xd',
    '  Direccion de Internet          Direccion fisica      Tipo',
    '  172.19.199.117        1e-4f-87-36-14-f6     dinamico',
    '  172.19.199.1          bc-24-11-ba-64-81     dinamico',
  ].join('\n');
  revisar('saca la MAC de la IP exacta, no de la que la contiene',
    red.extraerMac(tablaArp, '172.19.199.1') === 'bc:24:11:ba:64:81',
    red.extraerMac(tablaArp, '172.19.199.1'));
  revisar('y la de la IP larga sigue siendo la suya',
    red.extraerMac(tablaArp, '172.19.199.117') === '1e:4f:87:36:14:f6');
  revisar('devuelve null si esa IP no esta en la tabla',
    red.extraerMac(tablaArp, '172.19.199.200') === null);
  revisar('detecta la WebView de Android',
    red.esMiniNavegador('Mozilla/5.0 (Linux; Android 13; SM-A536E; wv) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'));
  revisar('detecta la ventana de portal de iOS',
    red.esMiniNavegador('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148'));
  revisar('NO confunde a Safari normal con la ventanita',
    !red.esMiniNavegador('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'));
  revisar('NO confunde a Chrome de escritorio',
    !red.esMiniNavegador('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36'));

  const configWebView = await fetch(`${URL_BASE}/api/config`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36',
    },
  }).then(json);
  revisar('el portal avisa cuando viene de la ventanita', configWebView.miniNavegador === true);
  revisar('y no avisa en un navegador normal', config.miniNavegador === false);

  // Sobre loopback no hay MAC que mirar, asi que debe declinar con elegancia
  // en vez de romperse o, peor, entregarle la sesion de alguien a un extrano.
  const reconocimiento = await fetch(`${URL_BASE}/api/reconocer`, {
    headers: { Accept: 'application/json' },
  }).then(json);
  revisar('no reconoce a un dispositivo sin MAC', reconocimiento.reconocido === false);

  const confirmacion = await fetch(`${URL_BASE}/api/reconocer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  revisar('no entrega sesion sin MAC reconocida', confirmacion.status === 404, `dio ${confirmacion.status}`);

  /* --- Servidor DHCP (modo sin router) --- */
  const dhcp = require('../src/dhcp');

  /** Arma un paquete de cliente como el que manda un celular al conectarse. */
  function paqueteCliente({ tipo, mac, xid = 0x1234, ipPedida = null, nombre = null }) {
    const cabecera = Buffer.alloc(240);
    cabecera[0] = 1; cabecera[1] = 1; cabecera[2] = 6;
    cabecera.writeUInt32BE(xid, 4);
    cabecera.writeUInt16BE(0x8000, 10); // pide respuesta por difusion
    Buffer.from(mac.split(':').map((h) => parseInt(h, 16))).copy(cabecera, 28);
    cabecera.writeUInt32BE(0x63825363, 236);

    const opciones = [Buffer.from([53, 1, tipo])];
    if (ipPedida) opciones.push(Buffer.from([50, 4, ...ipPedida.split('.').map(Number)]));
    if (nombre) opciones.push(Buffer.from([12, nombre.length, ...Buffer.from(nombre, 'utf8')]));
    opciones.push(Buffer.from([255]));
    return Buffer.concat([cabecera, ...opciones]);
  }

  const leerOpcion = (paquete, codigo) => paquete.opciones[codigo];

  revisar('DHCP: descarta basura', dhcp.analizar(Buffer.from('hola')) === null);
  revisar('DHCP: descarta paquete sin la cookie magica',
    dhcp.analizar(Buffer.alloc(300)) === null);

  const descubrir = dhcp.analizar(paqueteCliente({
    tipo: dhcp.MENSAJE.DESCUBRIR, mac: 'aa:bb:cc:dd:ee:01', nombre: 'celular-de-maria',
  }));
  revisar('DHCP: analiza un DISCOVER', descubrir !== null);
  revisar('DHCP: extrae la MAC', descubrir?.mac === 'aa:bb:cc:dd:ee:01', descubrir?.mac);
  revisar('DHCP: extrae el nombre del equipo',
    descubrir?.nombreHost === 'celular-de-maria', descubrir?.nombreHost);

  const arriendos = new dhcp.Arrendamientos({
    ipServidor: '192.168.99.1', mascara: '255.255.255.0',
    desde: '192.168.99.50', hasta: '192.168.99.52', duracion: 3600, archivo: null,
  });

  const ip1 = arriendos.asignar('aa:bb:cc:dd:ee:01', null);
  revisar('DHCP: asigna una IP del rango', ip1 === '192.168.99.50', ip1);
  revisar('DHCP: la misma MAC recibe SIEMPRE la misma IP',
    arriendos.asignar('aa:bb:cc:dd:ee:01', null) === ip1);
  const ip2 = arriendos.asignar('aa:bb:cc:dd:ee:02', null);
  revisar('DHCP: otra MAC recibe otra IP', ip2 === '192.168.99.51', ip2);

  arriendos.asignar('aa:bb:cc:dd:ee:03', null);
  revisar('DHCP: avisa cuando se agota el rango',
    arriendos.asignar('aa:bb:cc:dd:ee:04', null) === null);
  arriendos.liberar('aa:bb:cc:dd:ee:03');
  revisar('DHCP: al liberar, la direccion vuelve al rango',
    arriendos.asignar('aa:bb:cc:dd:ee:04', null) === '192.168.99.52');

  const oferta = dhcp.analizar(dhcp.construir(descubrir, {
    tipo: dhcp.MENSAJE.OFRECER,
    ipCliente: '192.168.99.50',
    ipServidor: '192.168.99.1',
    mascara: '255.255.255.0',
    arriendo: 3600,
    urlPortal: 'http://192.168.99.1/',
  }));

  revisar('DHCP: la oferta es una respuesta (op=2)', oferta?.op === 2);
  revisar('DHCP: conserva el identificador de la peticion', oferta?.xid === descubrir.xid);
  revisar('DHCP: entrega la IP en yiaddr', oferta?.yiaddr === '192.168.99.50', oferta?.yiaddr);
  revisar('DHCP: el tipo es OFFER', leerOpcion(oferta, 53)?.[0] === dhcp.MENSAJE.OFRECER);
  revisar('DHCP: manda la mascara', [...leerOpcion(oferta, 1)].join('.') === '255.255.255.0');
  revisar('DHCP: se anuncia como puerta de enlace', [...leerOpcion(oferta, 3)].join('.') === '192.168.99.1');
  revisar('DHCP: se anuncia como DNS', [...leerOpcion(oferta, 6)].join('.') === '192.168.99.1',
    'sin esto el portal cautivo no se abre solo');
  revisar('DHCP: anuncia la duracion del arriendo', leerOpcion(oferta, 51)?.readUInt32BE(0) === 3600);
  revisar('DHCP: calcula la direccion de difusion',
    [...leerOpcion(oferta, 28)].join('.') === '192.168.99.255');
  revisar('DHCP: incluye la URL del portal cautivo (opcion 114)',
    leerOpcion(oferta, 114)?.toString() === 'http://192.168.99.1/');

  const negativa = dhcp.analizar(dhcp.construir(descubrir, {
    tipo: dhcp.MENSAJE.NEGAR, ipServidor: '192.168.99.1',
    mascara: '255.255.255.0', arriendo: 3600,
  }));
  revisar('DHCP: el NAK no entrega direccion', negativa?.yiaddr === '0.0.0.0');
  revisar('DHCP: el NAK no lleva opciones de red', leerOpcion(negativa, 1) === undefined);

  /* --- Nombre de red con la clave dentro --- */
  const { componerSsid } = require('../src/puntoacceso');

  const compuesto = componerSsid({ base: 'SOS-AYUDA', clave: '12345678' });
  revisar('SSID: mete la clave en el nombre de la red',
    compuesto.ssid === 'SOS-AYUDA-CLAVE-12345678', compuesto.ssid);
  revisar('SSID: y cabe en el limite de 32 bytes', compuesto.cabe && !compuesto.aviso);

  // 17 + "-CLAVE-" (7) + 8 = 32 justos, el maximo que admite un SSID.
  const justo = componerSsid({ base: 'SOS-PUNTO-NORTE01', clave: '12345678' });
  revisar('SSID: acepta exactamente 32 bytes', justo.ssid.length === 32 && justo.cabe, justo.ssid);

  const pasado = componerSsid({ base: 'SOS-PUNTO-NORTE012', clave: '12345678' });
  revisar('SSID: si no cabe, cae al nombre base en vez de inventar uno invalido',
    pasado.ssid === 'SOS-PUNTO-NORTE012' && !!pasado.aviso, pasado.ssid);

  const sinClave = componerSsid({ base: 'SOS-AYUDA', clave: '12345678', incluirClave: false });
  revisar('SSID: se puede dejar la clave fuera del nombre', sinClave.ssid === 'SOS-AYUDA');

  /* --- Mensajes por HTTP (el carril de respaldo) --- */
  await fetch(`${URL_BASE}/api/mensajes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ token, texto: 'Estoy bajo una losa, oigo voces afuera' }),
  });
  const hilo = await fetch(`${URL_BASE}/api/mensajes?t=${token}`, { headers: { Accept: 'application/json' } }).then(json);
  revisar('el hilo trae los mensajes de sistema y el de la persona', hilo.mensajes?.length >= 3, `trajo ${hilo.mensajes?.length}`);
  revisar('el hilo abre con el aviso de uso responsable',
    hilo.mensajes?.some((m) => m.direccion === 'sistema' && m.texto.includes('informacion verdadera')));

  /* --- Canal seguro y GPS --- */
  const seguro = await pedirSeguro('/api/config').catch((err) => ({ error: err.message }));
  revisar('el canal HTTPS responde', seguro.estado === 200, seguro.error || `estado ${seguro.estado}`);

  const alt = seguro.certificado?.subjectaltname || '';
  revisar('el certificado incluye la IP en subjectAltName', alt.includes('IP Address:127.0.0.1'), alt);
  revisar('el certificado incluye el nombre DNS del puesto', alt.includes('DNS:'), alt);

  const configSegura = JSON.parse(seguro.cuerpo || '{}');
  revisar('el portal anuncia la URL segura', /^https:\/\//.test(configSegura.urlSegura || ''), configSegura.urlSegura);

  const enviarGps = (cuerpo) =>
    pedirSeguro('/api/ubicacion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(cuerpo),
    });

  const sinToken = await enviarGps({ lat: 4.6, lon: -74.08 });
  revisar('rechaza coordenadas sin sesion', sinToken.estado === 404, `dio ${sinToken.estado}`);

  const coordsMalas = await enviarGps({ token, lat: 999, lon: -74.08 });
  revisar('rechaza coordenadas fuera de rango', coordsMalas.estado === 400, `dio ${coordsMalas.estado}`);

  const gps = await enviarGps({ token, lat: 4.60971, lon: -74.08175, precision: 12.5 });
  revisar('acepta las coordenadas por el canal seguro', gps.estado === 200, `dio ${gps.estado}`);

  const conGps = await fetch(`${URL_BASE}/api/yo?t=${token}`, { headers: { Accept: 'application/json' } }).then(json);
  revisar('guarda las coordenadas en la ficha', /GPS: 4\.609710, -74\.081750/.test(conGps.persona.ubicacion || ''),
    conGps.persona.ubicacion);
  revisar('conserva la direccion escrita a mano', (conGps.persona.ubicacion || '').includes('Calle falsa 123'));
  revisar('anota la precision', (conGps.persona.ubicacion || '').includes('+/- 13 m'), conGps.persona.ubicacion);

  // Si la persona se mueve y reenvia, la linea de GPS se reemplaza, no se apila.
  await enviarGps({ token, lat: 4.70000, lon: -74.10000, precision: 8 });
  const reenviado = await fetch(`${URL_BASE}/api/yo?t=${token}`, { headers: { Accept: 'application/json' } }).then(json);
  const lineasGps = (reenviado.persona.ubicacion || '').split('\n').filter((l) => l.startsWith('GPS:'));
  revisar('al reenviar reemplaza la linea de GPS, no la duplica', lineasGps.length === 1, `hay ${lineasGps.length}`);
  revisar('la linea de GPS es la nueva', lineasGps[0]?.includes('4.700000'), lineasGps[0]);

  /* --- Consola de operador --- */
  const pinMalo = await fetch(`${URL_BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ pin: 'pin-incorrecto' }),
  });
  revisar('PIN incorrecto da 401', pinMalo.status === 401, `dio ${pinMalo.status}`);

  const sinSesion = await fetch(`${URL_BASE}/admin/api/personas`, { headers: { Accept: 'application/json' } });
  revisar('la API de operador exige sesion', sinSesion.status === 401, `dio ${sinSesion.status}`);

  const acceso = await fetch(`${URL_BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ pin: PIN }),
  }).then(json);
  revisar('PIN correcto abre sesion', !!acceso.sesion);

  const cabecerasOp = { Accept: 'application/json', 'Content-Type': 'application/json', 'X-SOS-Sesion': acceso.sesion };

  const lista = await fetch(`${URL_BASE}/admin/api/personas`, { headers: cabecerasOp }).then(json);
  revisar('la lista incluye a la persona', lista.personas?.some((p) => p.id === idPersona));
  revisar('el atrapado va primero en la lista', lista.personas?.[0]?.estado === 'atrapado', lista.personas?.[0]?.estado);
  revisar('cuenta el mensaje sin leer', lista.personas.find((p) => p.id === idPersona)?.sin_leer >= 1);

  await fetch(`${URL_BASE}/admin/api/personas/${idPersona}/mensajes`, {
    method: 'POST',
    headers: cabecerasOp,
    body: JSON.stringify({ texto: 'Te ubicamos. Va una brigada en camino.' }),
  });

  // Leemos bytes crudos: fetch().text() descarta el BOM al decodificar y no
  // podriamos comprobar que Excel lo va a recibir.
  const csvBytes = new Uint8Array(
    await fetch(`${URL_BASE}/admin/api/exportar.csv`, { headers: cabecerasOp }).then((r) => r.arrayBuffer())
  );
  const csv = new TextDecoder('utf-8').decode(csvBytes);
  revisar('el CSV incluye a la persona', csv.includes('Prueba De Humo'));
  revisar('el CSV lleva BOM para Excel',
    csvBytes[0] === 0xef && csvBytes[1] === 0xbb && csvBytes[2] === 0xbf,
    [...csvBytes.slice(0, 3)].join(','));

  const difusion = await fetch(`${URL_BASE}/admin/api/difusion`, {
    method: 'POST',
    headers: cabecerasOp,
    body: JSON.stringify({ texto: 'Punto de agua abierto en la escuela' }),
  }).then(json);
  revisar('la difusion llega a todos', difusion.total >= 1, `llego a ${difusion.total}`);

  /* --- Reporte dudoso y confidencialidad de lo interno --- */
  await fetch(`${URL_BASE}/admin/api/personas/${idPersona}/notas`, {
    method: 'POST',
    headers: cabecerasOp,
    body: JSON.stringify({ notas: 'NOTA INTERNA DEL OPERADOR' }),
  });

  const segunda = await fetch(`${URL_BASE}/api/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ nombre: 'Segunda Persona', estado: 'bien' }),
  }).then(json);

  const marcado = await fetch(`${URL_BASE}/admin/api/personas/${idPersona}/dudoso`, {
    method: 'POST',
    headers: cabecerasOp,
    body: JSON.stringify({ dudoso: true, motivo: 'reporte inconsistente', por: 'Operador Prueba' }),
  }).then(json);
  revisar('marca el reporte como dudoso', marcado.persona?.dudoso === true);
  revisar('guarda quien lo marco', marcado.persona?.dudoso_por === 'Operador Prueba');
  revisar('guarda el motivo', marcado.persona?.dudoso_motivo === 'reporte inconsistente');
  revisar('guarda cuando se marco', !!marcado.persona?.dudoso_en);

  const conDudoso = await fetch(`${URL_BASE}/admin/api/personas`, { headers: cabecerasOp }).then(json);
  const posDudoso = conDudoso.personas.findIndex((p) => p.id === idPersona);
  const posNormal = conDudoso.personas.findIndex((p) => p.id === segunda.persona.id);
  revisar('el dudoso baja por debajo de un caso normal', posDudoso > posNormal,
    `dudoso en ${posDudoso}, normal en ${posNormal}`);
  revisar('el dudoso NO se borra, sigue en la lista', posDudoso !== -1);
  revisar('el resumen cuenta los dudosos', conDudoso.resumen?.dudosos === 1, String(conDudoso.resumen?.dudosos));

  // Lo interno del puesto de mando jamas debe llegarle a la persona.
  const yoTrasMarca = await fetch(`${URL_BASE}/api/yo?t=${token}`, {
    headers: { Accept: 'application/json' },
  }).then(json);
  revisar('la persona NO ve la marca de dudoso', yoTrasMarca.persona.dudoso === undefined);
  revisar('la persona NO ve el motivo ni quien la marco',
    yoTrasMarca.persona.dudoso_motivo === undefined && yoTrasMarca.persona.dudoso_por === undefined);
  revisar('la persona NO ve las notas internas del operador', yoTrasMarca.persona.notas === undefined);
  revisar('la persona NO ve su IP, su MAC ni su dispositivo',
    yoTrasMarca.persona.ip === undefined &&
    yoTrasMarca.persona.mac === undefined &&
    yoTrasMarca.persona.agente === undefined);
  revisar('pero si sigue viendo lo suyo', yoTrasMarca.persona.codigo === registro.persona.codigo);

  const csvDudoso = await fetch(`${URL_BASE}/admin/api/exportar.csv`, { headers: cabecerasOp }).then((r) => r.text());
  revisar('el CSV documenta el motivo del dudoso', csvDudoso.includes('reporte inconsistente'));

  // Inyeccion de formulas: el CSV lo abre la autoridad en Excel, y una formula
  // metida en un nombre se ejecutaria en SU equipo.
  const conFormula = await fetch(`${URL_BASE}/api/registro`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ nombre: '=1+1', estado: 'bien', ubicacion: '@SUM(A1)' }),
  }).then(json);
  revisar('acepta un nombre que parece formula', !!conFormula.persona?.id);

  const csvFormulas = await fetch(`${URL_BASE}/admin/api/exportar.csv`, { headers: cabecerasOp }).then((r) => r.text());
  revisar('el CSV neutraliza las formulas de Excel',
    csvFormulas.includes('"\'=1+1"') && csvFormulas.includes('"\'@SUM(A1)"'),
    'deben salir con apostrofo delante');
  revisar('y no deja ninguna celda empezando por =',
    !/;"=/.test(csvFormulas) && !/^"=/m.test(csvFormulas));

  const desmarcado = await fetch(`${URL_BASE}/admin/api/personas/${idPersona}/dudoso`, {
    method: 'POST',
    headers: cabecerasOp,
    body: JSON.stringify({ dudoso: false }),
  }).then(json);
  revisar('quitar la marca devuelve la prioridad', desmarcado.persona?.dudoso === false);

  // Comparamos contra la persona que creamos en ESTA corrida, no contra la
  // posicion absoluta: si la base ya trae gente, el tope depende de ellos.
  const reordenada = await fetch(`${URL_BASE}/admin/api/personas`, { headers: cabecerasOp }).then(json);
  const posTrasQuitar = reordenada.personas.findIndex((p) => p.id === idPersona);
  const posNormalFinal = reordenada.personas.findIndex((p) => p.id === segunda.persona.id);
  revisar('al desmarcar recupera su prioridad sobre el caso normal',
    posTrasQuitar < posNormalFinal, `dudoso en ${posTrasQuitar}, normal en ${posNormalFinal}`);

  /* --- Directorio publico --- */
  const directorio = await fetch(`${URL_BASE}/api/directorio?q=Prueba`, { headers: { Accept: 'application/json' } }).then(json);
  revisar('el directorio encuentra por nombre', directorio.personas?.length >= 1);
  revisar('el directorio NO expone el token', !JSON.stringify(directorio).includes(token));

  // Sin esto, cualquiera en la red se descargaba el censo entero pidiendo la
  // ruta sin texto de busqueda.
  const volcado = await fetch(`${URL_BASE}/api/directorio`, { headers: { Accept: 'application/json' } }).then(json);
  revisar('el directorio NO vuelca el censo sin busqueda', volcado.personas?.length === 0,
    `devolvio ${volcado.personas?.length}`);
  const dosLetras = await fetch(`${URL_BASE}/api/directorio?q=Pr`, { headers: { Accept: 'application/json' } }).then(json);
  revisar('el directorio exige tres letras', dosLetras.personas?.length === 0);

  /* --- Apropiacion de sesion: la cadena directorio -> recuperar ---
   *
   * Cualquiera en la red podia buscar en el tablon, quedarse con el codigo que
   * venia en la respuesta y cambiarlo por el token de esa persona enviandolo a
   * /api/recuperar con el nombre vacio. Con el token entraba a su chat y le
   * cambiaba estado, necesidades y ubicacion.
   *
   * Cada una de las cuatro pruebas rompe un eslabon distinto. Si alguna cae,
   * la cadena vuelve a estar servida. */
  revisar('el directorio NO expone el codigo de recuperacion',
    !JSON.stringify(directorio).includes(registro.persona.codigo));

  const porCedula = await fetch(
    `${URL_BASE}/api/directorio?q=${encodeURIComponent(DOCUMENTO_PRUEBA)}`,
    { headers: { Accept: 'application/json' } }).then(json);
  revisar('el directorio NO busca por cedula', porCedula.personas?.length === 0,
    `devolvio ${porCedula.personas?.length}`);

  const nombreVacio = await fetch(`${URL_BASE}/api/recuperar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ codigo: registro.persona.codigo, nombre: '' }),
  });
  revisar('recuperar RECHAZA el nombre vacio', nombreVacio.status === 400,
    `dio ${nombreVacio.status} — startsWith('') es cierto siempre`);

  const nombreAjeno = await fetch(`${URL_BASE}/api/recuperar`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ codigo: registro.persona.codigo, nombre: 'Otra Persona' }),
  });
  revisar('recuperar rechaza el codigo correcto con otro nombre', nombreAjeno.status === 404,
    `dio ${nombreAjeno.status}`);

  /* --- WebSocket --- */
  await new Promise((resolver) => {
    const wsUrl = URL_BASE.replace('http', 'ws') + `/ws?t=${token}`;
    const socket = new WebSocket(wsUrl);
    const limite = setTimeout(() => {
      revisar('el WebSocket responde', false, 'se agoto el tiempo');
      try { socket.close(); } catch { /* ya cerrado */ }
      resolver();
    }, 5000);

    socket.on('message', (crudo) => {
      const datos = JSON.parse(crudo.toString());
      if (datos.tipo === 'listo') {
        revisar('el WebSocket autentica con token', datos.persona?.id === idPersona);
        socket.send(JSON.stringify({ tipo: 'mensaje', texto: 'mensaje por websocket' }));
      }
      if (datos.tipo === 'mensaje') {
        revisar('el WebSocket entrega el mensaje', datos.mensaje?.texto === 'mensaje por websocket');
        clearTimeout(limite);
        socket.close();
        resolver();
      }
    });
    socket.on('error', () => {
      revisar('el WebSocket responde', false, 'error de conexion');
      clearTimeout(limite);
      resolver();
    });
  });

  // El WebSocket de operador ya NO acepta el PIN: exige la sesion de /admin/login.
  await new Promise((resolver) => {
    const socket = new WebSocket(
      `${URL_BASE.replace('http', 'ws')}/ws?rol=operador&pin=${encodeURIComponent(PIN)}`);
    let rechazado = false;
    socket.on('message', (crudo) => {
      if (JSON.parse(crudo.toString()).tipo === 'error') rechazado = true;
    });
    socket.on('close', () => { revisar('el WebSocket de operador rechaza el PIN en la URL', rechazado); resolver(); });
    socket.on('error', () => { revisar('el WebSocket de operador rechaza el PIN en la URL', true); resolver(); });
    setTimeout(resolver, 4000);
  });

  await new Promise((resolver) => {
    const socket = new WebSocket(
      `${URL_BASE.replace('http', 'ws')}/ws?rol=operador&s=${encodeURIComponent(acceso.sesion)}`);
    const limite = setTimeout(() => {
      revisar('el WebSocket de operador acepta la sesion', false, 'se agoto el tiempo');
      try { socket.close(); } catch { /* ya cerrado */ }
      resolver();
    }, 5000);
    socket.on('message', (crudo) => {
      const datos = JSON.parse(crudo.toString());
      if (datos.tipo === 'listo') {
        revisar('el WebSocket de operador acepta la sesion', datos.rol === 'operador');
        clearTimeout(limite);
        socket.close();
        resolver();
      }
    });
    socket.on('error', () => {
      revisar('el WebSocket de operador acepta la sesion', false, 'error de conexion');
      clearTimeout(limite);
      resolver();
    });
  });

  await new Promise((resolver) => {
    const socket = new WebSocket(URL_BASE.replace('http', 'ws') + '/ws?t=token-falso');
    let rechazado = false;
    socket.on('message', (crudo) => {
      if (JSON.parse(crudo.toString()).tipo === 'error') rechazado = true;
    });
    socket.on('close', () => {
      revisar('el WebSocket rechaza token falso', rechazado);
      resolver();
    });
    socket.on('error', () => { revisar('el WebSocket rechaza token falso', true); resolver(); });
    setTimeout(resolver, 4000);
  });

  /* --- DNS --- */
  if (!PUERTO_DNS) {
    omitir('el DNS responde a cualquier dominio', 'el portal arranco sin DNS');
    omitir('el DNS secuestra la sonda de Android', 'el portal arranco sin DNS');
    omitir('el DNS devuelve IPv6 vacio sin error', 'el portal arranco sin DNS');
    return terminar();
  }

  await new Promise((resolver) => {
    const resolvedor = new dns.Resolver({ timeout: 3000, tries: 1 });
    resolvedor.setServers([`127.0.0.1:${PUERTO_DNS}`]);
    resolvedor.resolve4('cualquier-cosa-inventada.example', (err, direcciones) => {
      revisar('el DNS responde a cualquier dominio', !err && direcciones?.length === 1, err?.code || String(direcciones));
      resolver();
    });
  });

  await new Promise((resolver) => {
    const resolvedor = new dns.Resolver({ timeout: 3000, tries: 1 });
    resolvedor.setServers([`127.0.0.1:${PUERTO_DNS}`]);
    resolvedor.resolve4('connectivitycheck.gstatic.com', (err, direcciones) => {
      revisar('el DNS secuestra la sonda de Android', !err && direcciones?.length === 1, err?.code);
      resolver();
    });
  });

  await new Promise((resolver) => {
    const resolvedor = new dns.Resolver({ timeout: 3000, tries: 1 });
    resolvedor.setServers([`127.0.0.1:${PUERTO_DNS}`]);
    // AAAA vacio (no error) es lo que hace que el celular caiga a IPv4.
    resolvedor.resolve6('captive.apple.com', (err) => {
      revisar('el DNS devuelve IPv6 vacio sin error', err?.code === 'ENODATA', err?.code || 'devolvio direcciones');
      resolver();
    });
  });

  terminar();
}

function terminar() {
  console.log('');
  console.log(
    `  ${pasadas} pruebas OK, ${fallidas} fallidas` +
    (omitidas ? `, ${omitidas} omitidas` : '')
  );
  if (omitidas) {
    console.log('  Las omitidas no son fallos: no se pudieron probar en este arranque.');
  }
  console.log('');
  process.exit(fallidas ? 1 : 0);
}

main().catch((err) => {
  console.error('\n  La prueba se cayo:', err.message);
  console.error('  ¿Esta corriendo el servidor?  npm start\n');
  process.exit(1);
});
