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

  if (soporte.soportado) {
    console.log('   [ SI ]  Puede montar la red por su cuenta.');
    console.log(`           Mecanismo: ${soporte.mecanismo === 'hospedada' ? 'red hospedada' : 'Soft AP'}`);
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

  const conf = await ap.configurar({ ssid, clave });
  if (!conf.ok) { console.log(`  FALLO: ${conf.error}\n`); process.exit(1); }

  const arranque = await ap.iniciar();
  if (!arranque.ok) { console.log(`  FALLO: ${arranque.error}\n`); process.exit(1); }
  console.log('  Red levantada.');

  const adaptador = config.puntoAcceso.adaptador || await ap.adaptadorHospedado();
  if (adaptador) {
    const fijada = await ap.fijarIp({ adaptador, ip, mascara });
    console.log(fijada.ok
      ? `  IP ${ip} fijada en "${adaptador}".`
      : `  AVISO: no se pudo fijar la IP en "${adaptador}": ${fijada.error}`);
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
