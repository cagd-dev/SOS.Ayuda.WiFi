'use strict';

const avisoOriginal = process.emitWarning;
process.emitWarning = function (aviso, ...resto) {
  const texto = typeof aviso === 'string' ? aviso : aviso?.message || '';
  if (texto.includes('SQLite is an experimental feature')) return;
  return avisoOriginal.call(process, aviso, ...resto);
};

/**
 * Cierre de operacion, paso a paso.
 *
 *   node tools/cierre.js                      en que punto va
 *   node tools/cierre.js cerrar               genera el censo definitivo
 *   node tools/cierre.js entregar "Defensa Civil" "tel 123" "USB"
 *   node tools/cierre.js purgar "Operador" [motivo-si-es-anticipada]
 */

const cierre = require('../src/cierre');

const linea = (c = '-') => c.repeat(62);
const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-CO') : '—');

function mostrarEstado() {
  const e = cierre.leer();

  console.log('');
  console.log('  ' + linea('='));
  console.log('   CIERRE DE OPERACION');
  console.log('  ' + linea('='));
  console.log('');

  const pasos = [
    ['1. Operacion abierta', true],
    ['2. Cerrada y censo exportado', e.estado !== cierre.ESTADOS.ABIERTA],
    ['3. Entrega registrada', [cierre.ESTADOS.ENTREGADA, cierre.ESTADOS.PURGADA].includes(e.estado)],
    ['4. Datos personales destruidos', e.estado === cierre.ESTADOS.PURGADA],
  ];
  for (const [texto, hecho] of pasos) {
    console.log(`   [${hecho ? 'X' : ' '}] ${texto}`);
  }
  console.log('');

  if (e.estado === cierre.ESTADOS.ABIERTA) {
    console.log('   La operacion sigue abierta. Cuando termine:');
    console.log('     node tools/cierre.js cerrar');
    console.log('');
    return;
  }

  console.log(`   Personas registradas : ${e.personas}`);
  console.log(`   Cerrada el           : ${fecha(e.cerradaEn)}`);
  console.log(`   Archivo a entregar   : ${e.archivoCsv}`);
  console.log(`   Huella SHA-256       : ${(e.huellaCsv || '').slice(0, 32)}...`);
  console.log('');

  if (e.estado === cierre.ESTADOS.CERRADA) {
    console.log('   FALTA REGISTRAR LA ENTREGA. Cuando la hayas hecho:');
    console.log('     node tools/cierre.js entregar "A quien" "contacto" "medio"');
    console.log('');
    return;
  }

  console.log(`   Entregado a          : ${e.entrega.receptor}`);
  console.log(`   Fecha de entrega     : ${fecha(e.entrega.fecha)}`);
  console.log('');

  if (e.estado === cierre.ESTADOS.PURGADA) {
    console.log(`   DATOS DESTRUIDOS el ${fecha(e.purga.fecha)}`);
    console.log('   Queda la constancia en datos/CONSTANCIA-DE-CIERRE.txt');
    console.log('');
    return;
  }

  const veredicto = cierre.puedePurgar(e);
  if (veredicto.puede) {
    console.log('   PLAZO CUMPLIDO. Ya se pueden destruir los datos personales:');
    console.log('     node tools/cierre.js purgar "Tu nombre"');
  } else {
    console.log(`   ${veredicto.motivo}`);
    console.log(`   Llevan ${cierre.diasDesdeEntrega(e)} dia(s) desde la entrega.`);
  }
  console.log('');
}

function ejecutarCerrar() {
  try {
    const e = cierre.cerrar();
    console.log('');
    console.log(`  Operacion cerrada. ${e.personas} persona(s) en el censo.`);
    console.log('');
    console.log(`  Censo definitivo : ${e.rutaCsv}`);
    console.log(`  Huella SHA-256   : ${e.huellaCsv}`);
    console.log(`  Respaldo         : ${e.respaldo}`);
    console.log('');
    console.log('  Entrega ese CSV a la autoridad competente y despues anota la');
    console.log('  entrega:  node tools/cierre.js entregar "A quien" "contacto" "medio"');
    console.log('');
  } catch (err) {
    console.log(`\n  ${err.message}\n`);
    process.exit(1);
  }
}

function ejecutarEntregar([receptor, contacto, medio, notas]) {
  try {
    const e = cierre.registrarEntrega({ receptor, contacto, medio, notas });
    console.log('');
    console.log(`  Entrega registrada: ${e.entrega.receptor}`);
    console.log(`  Fecha: ${fecha(e.entrega.fecha)}`);
    console.log('');
    console.log(`  Los datos se conservan ${e.diasConservacion} dias mas, por si la`);
    console.log('  autoridad necesita una aclaracion. Despues se podran destruir.');
    console.log('');
  } catch (err) {
    console.log(`\n  ${err.message}\n`);
    process.exit(1);
  }
}

function ejecutarPurgar([operador, motivo]) {
  const e = cierre.leer();
  const veredicto = cierre.puedePurgar(e);

  console.log('');
  console.log('  ESTO DESTRUYE LOS DATOS PERSONALES Y NO SE PUEDE DESHACER.');
  console.log('  Se borran la base, los respaldos y las exportaciones CSV.');
  console.log('  Queda una constancia SIN datos personales.');
  console.log('');

  if (!veredicto.puede && e.estado === cierre.ESTADOS.ENTREGADA && !motivo) {
    console.log(`  ${veredicto.motivo}`);
    console.log('  Para purgar antes de plazo, pasa un motivo:');
    console.log('    node tools/cierre.js purgar "Tu nombre" "motivo"');
    console.log('');
    process.exit(1);
  }

  try {
    const r = cierre.purgar({ operador, motivo, forzar: !!motivo });
    console.log(`  Destruido: ${r.purga.borrados.join(', ')}`);
    console.log('');
    console.log('  Constancia en datos/CONSTANCIA-DE-CIERRE.txt');
    console.log('  Guardala: es la prueba de que los datos se entregaron y se');
    console.log('  destruyeron, y no contiene ningun dato personal.');
    console.log('');
  } catch (err) {
    console.log(`  ${err.message}\n`);
    process.exit(1);
  }
}

const [orden, ...resto] = process.argv.slice(2);
switch ((orden || '').toLowerCase()) {
  case 'cerrar':   ejecutarCerrar(); break;
  case 'entregar': ejecutarEntregar(resto); break;
  case 'purgar':   ejecutarPurgar(resto); break;
  default:         mostrarEstado();
}
