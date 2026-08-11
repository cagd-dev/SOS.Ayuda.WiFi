'use strict';

const avisoOriginal = process.emitWarning;
process.emitWarning = function (aviso, ...resto) {
  const texto = typeof aviso === 'string' ? aviso : aviso?.message || '';
  if (texto.includes('SQLite is an experimental feature')) return;
  return avisoOriginal.call(process, aviso, ...resto);
};

/**
 * Copia la base de datos a datos/respaldos/ con la fecha en el nombre.
 *
 * Se puede correr CON EL PORTAL ENCENDIDO: usa VACUUM INTO, que produce una
 * copia coherente aunque haya escrituras en curso. Copiar el archivo a secas
 * seria un error: en modo WAL los ultimos registros viven en el archivo -wal y
 * se quedarian fuera.
 *
 *   node tools/respaldar.js
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');

function main() {
  if (!fs.existsSync(config.rutaBaseDatos)) {
    console.log('\n  Todavia no hay base de datos que respaldar.\n');
    process.exit(1);
  }

  const { respaldarBase } = require('../src/db');

  const carpeta = path.join(config.carpetaDatos, 'respaldos');
  fs.mkdirSync(carpeta, { recursive: true });

  const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const destino = path.join(carpeta, `sos-${sello}.sqlite3`);

  try {
    const copia = respaldarBase(destino);
    const tamano = (fs.statSync(destino).size / 1024).toFixed(0);

    console.log('');
    console.log(`  Respaldo verificado: ${copia.personas} persona(s), ${copia.mensajes} mensaje(s).`);
    console.log(`  ${destino}  (${tamano} KB)`);
    console.log('');
    console.log('  Se comprobo que la copia se abre y tiene todos los registros.');
    console.log('  Copiala a una USB al terminar la jornada.');
    console.log('');
  } catch (err) {
    // Un respaldo a medias es peor que ninguno: si algo falla, se borra el
    // archivo incompleto para que nadie lo confunda con uno bueno.
    try { fs.rmSync(destino, { force: true }); } catch { /* nada que hacer */ }
    console.log('');
    console.log(`  NO SE PUDO RESPALDAR: ${err.message}`);
    console.log('  No se dejo ningun archivo a medias.');
    console.log('');
    process.exit(1);
  }
}

main();
