'use strict';

/**
 * Diagnostico previo al despliegue. Se corre CON EL SERVIDOR APAGADO y dice,
 * en orden, todo lo que hay que arreglar antes de sacar el equipo a terreno.
 *
 *   node pruebas/diagnostico.js
 */

const net = require('node:net');
const dgram = require('node:dgram');
const os = require('node:os');
const { execFile } = require('node:child_process');
const config = require('../src/config');

const problemas = [];

function titulo(texto) {
  console.log('');
  console.log('  ' + texto);
  console.log('  ' + '─'.repeat(texto.length));
}

function ok(texto)    { console.log(`   [ OK ]  ${texto}`); }
function mal(texto, arreglo) {
  console.log(`   [FALLA] ${texto}`);
  problemas.push({ texto, arreglo });
}

function puertoTcpLibre(puerto) {
  return new Promise((resolver) => {
    const servidor = net.createServer();
    servidor.once('error', () => resolver(false));
    servidor.once('listening', () => servidor.close(() => resolver(true)));
    servidor.listen(puerto, '0.0.0.0');
  });
}

function puertoUdpLibre(puerto) {
  return new Promise((resolver) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', () => resolver(false));
    socket.once('listening', () => socket.close(() => resolver(true)));
    socket.bind(puerto, '0.0.0.0');
  });
}

function correr(comando, argumentos) {
  return new Promise((resolver) => {
    execFile(comando, argumentos, { windowsHide: true }, (err, salida) => resolver(err ? '' : salida));
  });
}

async function main() {
  console.log('');
  console.log('  ══════════════════════════════════════════════════════════');
  console.log('   DIAGNOSTICO — SOS · Conectate · Pide Ayuda');
  console.log('  ══════════════════════════════════════════════════════════');

  /* ---- 1. Red ---- */
  titulo('1. Red');

  const interfaces = config.listarIpsLan();
  if (!interfaces.length) {
    mal('No hay ninguna tarjeta de red con IP.', 'Conecta el cable de red al router y vuelve a correr esto.');
  } else {
    console.log('   Tarjetas de red detectadas:');
    for (const i of interfaces) {
      const marca = i.ip === config.ip ? '  <-- ELEGIDA' : '';
      console.log(`     ${i.ip.padEnd(16)} ${i.nombre}${i.virtual ? '  (virtual)' : ''}${marca}`);
    }
    console.log('');

    if (config.ip.startsWith('169.254.')) {
      mal(`La IP elegida (${config.ip}) es de "sin DHCP".`,
        'El router no te dio IP. Revisa el cable o enciende el DHCP del router.');
    } else if (config.ip === '127.0.0.1') {
      mal('No se detecto ninguna IP de red local.', 'Conectate al router primero.');
    } else {
      ok(`IP del puesto de mando: ${config.ip}`);
    }

    if (interfaces.length > 1) {
      console.log('');
      console.log(`   AVISO: hay ${interfaces.length} tarjetas. Si la elegida no es la del router,`);
      console.log('          arranca asi:  node src/server.js --ip 192.168.X.X');
    }
  }

  /* ---- 2. Puertos ---- */
  titulo('2. Puertos');

  if (await puertoTcpLibre(config.puertoHttp)) {
    ok(`Puerto ${config.puertoHttp}/TCP (portal web) libre`);
  } else {
    mal(`Puerto ${config.puertoHttp}/TCP ocupado.`,
      'Normalmente es IIS o el servicio HTTP de Windows. Como Administrador:  net stop http\n' +
      '   Alternativa sin tocar nada:  npm run puertos-altos');
  }

  if (!config.httpsActivo) {
    console.log(`   [ AV ]  Canal HTTPS desactivado: el boton de GPS no va a funcionar.`);
  } else if (await puertoTcpLibre(config.puertoHttps)) {
    ok(`Puerto ${config.puertoHttps}/TCP (canal seguro para el GPS) libre`);
  } else {
    mal(`Puerto ${config.puertoHttps}/TCP ocupado.`,
      'Sin este puerto la gente no podra enviar su ubicacion GPS.\n' +
      '   Cierra lo que lo ocupe, o arranca con:  node src/server.js --https 8443');
  }

  if (await puertoUdpLibre(config.puertoDns)) {
    ok(`Puerto ${config.puertoDns}/UDP (DNS) libre`);
  } else {
    mal(`Puerto ${config.puertoDns}/UDP ocupado.`,
      'Suele ser el "Cliente DNS" o un servidor DNS instalado. Como Administrador:\n' +
      '     net stop dnscache\n' +
      '   Sin DNS el portal NO se abre solo; la gente tendria que teclear la direccion.');
  }

  /* ---- 3. Firewall ---- */
  titulo('3. Firewall de Windows');

  if (os.platform() !== 'win32') {
    ok('No es Windows: revisa tu firewall manualmente.');
  } else {
    const perfil = await correr('netsh', ['advfirewall', 'show', 'currentprofile']);
    const activo = /State\s+ON|Estado\s+ACTIVADO/i.test(perfil);

    const reglas = await correr('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=SOS Portal HTTP']);
    const reglaHttp = /SOS Portal HTTP/i.test(reglas);
    const reglasDns = await correr('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=SOS Portal DNS']);
    const reglaDns = /SOS Portal DNS/i.test(reglasDns);
    const reglasHttps = await correr('netsh', ['advfirewall', 'firewall', 'show', 'rule', 'name=SOS Portal HTTPS']);
    const reglaHttps = /SOS Portal HTTPS/i.test(reglasHttps);

    if (!activo) {
      ok('El firewall del perfil actual esta apagado: los celulares podran entrar.');
    } else if (reglaHttp && reglaDns && reglaHttps) {
      ok('Las tres reglas de firewall del portal ya existen.');
    } else {
      mal('Faltan reglas de firewall: los celulares no van a poder conectarse.',
        'Abre PowerShell COMO ADMINISTRADOR y pega estas tres lineas:\n' +
        `     netsh advfirewall firewall add rule name="SOS Portal HTTP" dir=in action=allow protocol=TCP localport=${config.puertoHttp}\n` +
        `     netsh advfirewall firewall add rule name="SOS Portal DNS" dir=in action=allow protocol=UDP localport=${config.puertoDns}\n` +
        `     netsh advfirewall firewall add rule name="SOS Portal HTTPS" dir=in action=allow protocol=TCP localport=${config.puertoHttps}`);
    }
  }

  /* ---- 4. Reconocimiento de dispositivos ---- */
  titulo('4. Reconocimiento de telefonos (para no perder sesiones)');

  const { vecinos } = require('../src/red');
  const listaVecinos = await vecinos();

  // Nos interesan los que comparten segmento con nosotros: son los unicos
  // cuya MAC vamos a poder leer.
  const miSegmento = config.ip.split('.').slice(0, 3).join('.') + '.';
  const mismos = listaVecinos.filter((v) => v.ip.startsWith(miSegmento) && v.ip !== config.ip);

  if (mismos.length) {
    ok(`ARP operativo: ${mismos.length} dispositivo(s) visibles en ${miSegmento}0/24`);
    console.log('        Los telefonos que pierdan la ventanita podran recuperar su sesion solos.');
  } else if (listaVecinos.length) {
    mal('No se ve ningun dispositivo en el mismo segmento que este equipo.',
      'El reconocimiento por telefono no va a funcionar y la gente dependera de su codigo.\n' +
      '   Causas tipicas:\n' +
      '     - La VM esta en NAT en vez de PUENTE (bridge).\n' +
      '     - El WiFi del router cuelga de otra subred distinta a la del cable.\n' +
      '     - Todavia no hay nadie conectado (normal si el router acaba de encenderse).');
  } else {
    mal('La tabla ARP esta vacia: no se puede leer la MAC de nadie.',
      'Conectate al router y comprueba que la VM esta en modo PUENTE.\n' +
      '   Sin esto el sistema funciona igual, pero quien pierda su codigo\n' +
      '   tendra que registrarse otra vez.');
  }

  /* ---- 5. Energia ---- */
  titulo('5. Energia y autonomia');
  const bateria = await correr('powershell', ['-NoProfile', '-Command',
    '(Get-CimInstance Win32_Battery | Select-Object -First 1 -ExpandProperty EstimatedChargeRemaining)']);
  const nivel = Number(String(bateria).trim());
  if (Number.isFinite(nivel) && nivel > 0) {
    if (nivel < 50) {
      mal(`Bateria del portatil al ${nivel}%.`, 'Cargalo antes de salir. Sin PC no hay portal.');
    } else {
      ok(`Bateria del portatil al ${nivel}%`);
    }
  } else {
    console.log('   (equipo de escritorio: sin bateria propia — necesitas UPS o planta)');
  }
  console.log('   Recuerda: el ROUTER tambien necesita energia. Sin el no hay WiFi.');

  /* ---- Resumen ---- */
  console.log('');
  console.log('  ══════════════════════════════════════════════════════════');
  if (!problemas.length) {
    console.log('   TODO LISTO. Arranca con:  npm start');
    console.log('');
    console.log('   Y configura el router una sola vez:');
    console.log(`     DHCP -> DNS primario = ${config.ip}   (borra el secundario)`);
  } else {
    console.log(`   HAY ${problemas.length} COSA(S) POR ARREGLAR:`);
    problemas.forEach((p, i) => {
      console.log('');
      console.log(`   ${i + 1}. ${p.texto}`);
      for (const linea of p.arreglo.split('\n')) console.log(`      ${linea}`);
    });
  }
  console.log('  ══════════════════════════════════════════════════════════');
  console.log('');
  process.exit(problemas.length ? 1 : 0);
}

main();
