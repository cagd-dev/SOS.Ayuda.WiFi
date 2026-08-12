'use strict';

/**
 * Comprueba y controla el punto de acceso WiFi del equipo.
 *
 *   node tools/punto-acceso.js            ¿puede esta tarjeta ser punto de acceso?
 *   node tools/punto-acceso.js iniciar    levanta la red
 *   node tools/punto-acceso.js detener    la baja
 *
 * Sirve para probar dongles: conectas uno, corres esto, y te dice si vale.
 */

const ap = require('../src/puntoacceso');
const config = require('../src/config');

async function diagnosticar() {
  console.log('');
  console.log('  ¿PUEDE ESTE EQUIPO SER PUNTO DE ACCESO?');
  console.log('  ' + '─'.repeat(56));

  const soporte = await ap.soportado();
  console.log(`  Tarjeta : ${soporte.tarjeta || '(ninguna)'}`);
  console.log('');

  const NOMBRE_MECANISMO = {
    hospedada: 'red hospedada',
    softap: 'Soft AP',
    wifidirect: 'Wi-Fi Direct (modo legacy)',
  };

  if (soporte.soportado) {
    console.log('   [ SI ]  Puede montar la red por su cuenta.');
    console.log(`           Mecanismo: ${NOMBRE_MECANISMO[soporte.mecanismo] || soporte.mecanismo}`);

    // El tope de clientes es EL dato que decide si este camino sirve para el
    // sitio donde se va a desplegar. Va aqui arriba y no enterrado en un motivo.
    if (soporte.mecanismo === 'wifidirect') {
      console.log('');
      for (const l of String(soporte.motivo || '').split('\n')) console.log(`           ${l}`);
    }

    console.log('');
    console.log(`  Red      : ${config.puntoAcceso.ssid}`);
    console.log(`  Clave    : ${config.puntoAcceso.clave}` +
      (config.puntoAcceso.claveEnNombre ? '   (va dentro del nombre de la red)' : ''));
    console.log(`  IP       : ${config.puntoAcceso.ip}`);
    console.log(`  Reparte  : ${config.puntoAcceso.desde} a ${config.puntoAcceso.hasta}`);
    if (config.puntoAcceso.avisoSsid) {
      console.log('');
      console.log(`  AVISO: ${config.puntoAcceso.avisoSsid}`);
    }
    console.log('');
    console.log('  Levantala con:  node tools/punto-acceso.js iniciar');
  } else {
    console.log('   [ NO ]  Esta tarjeta no sirve como punto de acceso.');
    console.log('');
    for (const l of String(soporte.motivo).split('\n')) console.log(`           ${l}`);
    console.log('');
    console.log('  QUE BUSCAR EN UN ADAPTADOR QUE SI SIRVA:');
    console.log('    Conectalo y vuelve a correr este comando. Tiene que decir SI.');
    console.log('    Suelen servir  : Intel (AX200/AX210/AC), Qualcomm/Atheros,');
    console.log('                     MediaTek MT7921AU, Realtek RTL8812AU/8814AU.');
    console.log('    Suelen fallar  : Realtek RTL81xx baratos (RTL8188/8192).');
    console.log('');
    console.log('  Mientras tanto, usa el MODO ROUTER: llega mas lejos y aguanta');
    console.log('  mas gente de todas formas.');
  }

  const estado = await ap.estado();
  if (estado.activo) {
    console.log('');
    console.log(`  AHORA MISMO hay una red levantada: ${estado.ssid} (${estado.clientes} cliente/s)`);
  }
  console.log('');
}

async function iniciar() {
  const soporte = await ap.soportado();
  if (!soporte.soportado) {
    console.log(`\n  No se puede: ${soporte.motivo}\n`);
    process.exit(1);
  }

  const { ssid, clave, ip, mascara } = config.puntoAcceso;
  console.log(`\n  Configurando la red "${ssid}"...`);

  // configurar() es "netsh wlan set hostednetwork", que solo tiene sentido para
  // la red hospedada: exige Administrador y no aporta nada por Wi-Fi Direct,
  // donde el nombre y la clave viajan directos al anuncio. Pedirle permisos de
  // administrador al operador para un comando que no vamos a usar es la clase
  // de friccion que hace que algo "no funcione" sin motivo real.
  if (soporte.mecanismo !== 'wifidirect') {
    const conf = await ap.configurar({ ssid, clave });
    if (!conf.ok) { console.log(`  FALLO: ${conf.error}\n`); process.exit(1); }
  }

  // El SSID y la clave van SIEMPRE: la red hospedada ya los tiene guardados de
  // configurar(), pero Wi-Fi Direct los necesita al publicar el anuncio.
  const arranque = await ap.iniciar({ ssid, clave });
  if (!arranque.ok) { console.log(`  FALLO: ${arranque.error}\n`); process.exit(1); }

  console.log(`  Red levantada por ${arranque.mecanismo === 'wifidirect' ? 'Wi-Fi Direct' : 'red hospedada'}.`);
  if (arranque.maximo) {
    console.log(`  OJO: esta tarjeta admite ${arranque.maximo} telefono/s a la vez como maximo.`);
  }

  // Por Wi-Fi Direct NO se le cambia la IP a la tarjeta: Windows levanta con
  // ella su Conexion Compartida (ICS) anclada a 192.168.137.1, y moverla rompe
  // el reparto de direcciones. Medido con un telefono real. Solo se avisa.
  if (arranque.mecanismo === 'wifidirect') {
    const actual = await ap.ipDelPuntoAcceso();
    if (actual) {
      console.log(`  La tarjeta esta en ${actual}: el portal debe arrancar en ese segmento.`);
      console.log('  El portal lo hace solo; no le cambies la IP a la tarjeta.');
    }
    console.log('\n  Ahora arranca el portal en modo propio.\n');
    return;
  }

  const adaptador = config.puntoAcceso.adaptador || await ap.adaptadorHospedado();
  if (adaptador) {
    const fijada = await ap.fijarIp({ adaptador, ip, mascara });
    console.log(fijada.ok
      ? `  IP ${ip} fijada en "${adaptador}".`
      : `  AVISO: no se pudo fijar la IP: ${fijada.error}`);
  } else {
    console.log('  AVISO: no se encontro la tarjeta virtual para fijarle la IP.');
    console.log(`         Ponsela a mano: ${ip} / ${mascara}`);
  }

  console.log('\n  Ahora arranca el portal en modo propio.\n');
}

async function detener() {
  const r = await ap.detener();
  console.log(r.ok ? '\n  Red detenida.\n' : `\n  No se pudo detener: ${r.error}\n`);
}

const orden = (process.argv[2] || '').toLowerCase();
if (orden === 'iniciar') iniciar();
else if (orden === 'detener') detener();
else diagnosticar();
