'use strict';

const avisoOriginal = process.emitWarning;
process.emitWarning = function (aviso, ...resto) {
  const texto = typeof aviso === 'string' ? aviso : aviso?.message || '';
  if (texto.includes('SQLite is an experimental feature')) return;
  return avisoOriginal.call(process, aviso, ...resto);
};

/**
 * Copia la base de datos a datos/respaldos/ con la fecha en el nombre.
 * Se puede correr con el portal encendido: SQLite en modo WAL permite leer
 * mientras se escribe, asi que respaldar no interrumpe la operacion.
 *
 *   node tools/respaldar.js
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');

function contar() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(config.rutaBaseDatos, { readOnly: true });
    const n = db.prepare('SELECT COUNT(*) AS n FROM personas').get().n;
    db.close();
    return n;
  } catch {
    return null;
  }
}

function main() {
  if (!fs.existsSync(config.rutaBaseDatos)) {
    console.log('\n  Todavia no hay base de datos que respaldar.\n');
    process.exit(1);
  }

  const carpeta = path.join(config.carpetaDatos, 'respaldos');
  fs.mkdirSync(carpeta, { recursive: true });

  const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const destino = path.join(carpeta, `sos-${sello}.sqlite3`);
  fs.copyFileSync(config.rutaBaseDatos, destino);

  const personas = contar();
  console.log(`\n  Respaldo guardado${personas !== null ? ` (${personas} personas)` : ''}:`);
  console.log(`  ${destino}`);
  console.log('\n  Copialo a una USB al terminar la jornada.\n');
}

main();
