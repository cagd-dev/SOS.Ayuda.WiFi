'use strict';

/**
 * Deja la base de datos vacia, lista para operar.
 *
 *   npm run limpiar            respalda y borra
 *   npm run limpiar -- --todo  ademas borra el certificado (se emite uno nuevo)
 *
 * SIEMPRE respalda antes de borrar. Este script se va a correr con prisa y
 * medio dormido, y la unica forma de que un borrado accidental no sea el fin
 * del censo es que la copia ya exista antes de que nadie la pida.
 */

// Mismo silenciado que en el servidor: node:sqlite avisa que es experimental
// y ese ruido estorba en una salida que hay que leer con prisa.
const avisoOriginal = process.emitWarning;
process.emitWarning = function (aviso, ...resto) {
  const texto = typeof aviso === 'string' ? aviso : aviso?.message || '';
  if (texto.includes('SQLite is an experimental feature')) return;
  return avisoOriginal.call(process, aviso, ...resto);
};

const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');

const BORRAR_TODO = process.argv.includes('--todo');

const carpetaRespaldos = path.join(config.carpetaDatos, 'respaldos');
const carpetaTls = path.join(config.carpetaDatos, 'tls');

// SQLite en modo WAL deja tres archivos. Si borras solo el principal, el -wal
// puede resucitar datos que creias eliminados.
const archivosBase = [
  config.rutaBaseDatos,
  `${config.rutaBaseDatos}-wal`,
  `${config.rutaBaseDatos}-shm`,
];

function contarPersonas() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(config.rutaBaseDatos, { readOnly: true });
    const total = db.prepare('SELECT COUNT(*) AS n FROM personas').get().n;
    const mensajes = db.prepare('SELECT COUNT(*) AS n FROM mensajes').get().n;
    db.close();
    return { total, mensajes };
  } catch {
    return null; // base nueva, corrupta, o en uso
  }
}

function main() {
  console.log('');

  if (!fs.existsSync(config.rutaBaseDatos)) {
    console.log('  La base ya esta limpia: no hay nada que borrar.');
    console.log(`  (se creara sola al arrancar, en ${config.rutaBaseDatos})`);
    console.log('');
    return;
  }

  const conteo = contarPersonas();
  if (conteo) {
    console.log(`  Contenido actual: ${conteo.total} persona(s) y ${conteo.mensajes} mensaje(s).`);
  }

  // 1. Respaldo primero, siempre. Y verificado: con VACUUM INTO, no copiando
  //    el archivo, porque en modo WAL los ultimos registros viven en el -wal
  //    y una copia plana los perderia justo antes de borrarlo todo.
  fs.mkdirSync(carpetaRespaldos, { recursive: true });
  const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const destino = path.join(carpetaRespaldos, `sos-${sello}.sqlite3`);

  try {
    const { db, respaldarBase } = require('../src/db');
    const copia = respaldarBase(destino);
    // Cerramos nuestra propia conexion o Windows no dejara borrar el archivo.
    db.close();
    console.log(`  Respaldo verificado (${copia.personas} personas): ${destino}`);
  } catch (err) {
    try { fs.rmSync(destino, { force: true }); } catch { /* nada que hacer */ }
    console.log('');
    console.log('  NO SE PUDO RESPALDAR — no se borro nada.');
    console.log(`  ${err.message}`);
    console.log('');
    process.exit(1);
  }

  // 2. Borrar.
  let borrados = 0;
  for (const archivo of archivosBase) {
    if (!fs.existsSync(archivo)) continue;
    try {
      fs.unlinkSync(archivo);
      borrados += 1;
    } catch (err) {
      console.log('');
      if (err.code === 'EBUSY' || err.code === 'EPERM') {
        console.log('  NO SE PUDO BORRAR: el archivo esta en uso.');
        console.log('  Detén el servidor (Ctrl+C en su ventana) y vuelve a intentarlo.');
      } else {
        console.log(`  NO SE PUDO BORRAR ${archivo}: ${err.message}`);
      }
      console.log(`  Tu respaldo sigue a salvo en ${destino}`);
      console.log('');
      process.exit(1);
    }
  }

  console.log(`  Base borrada (${borrados} archivo(s)). Se creara vacia al arrancar.`);

  // 3. Certificado: solo si lo piden expresamente.
  if (BORRAR_TODO) {
    fs.rmSync(carpetaTls, { recursive: true, force: true });
    console.log('  Certificado borrado: se emitira uno nuevo al arrancar.');
    console.log('  OJO: los celulares que ya lo aceptaron veran el aviso otra vez.');
  } else if (fs.existsSync(carpetaTls)) {
    console.log('  Certificado conservado (usa --todo si quieres emitir uno nuevo).');
  }

  console.log('');
  console.log('  Listo. Arranca con:  npm start');
  console.log('');
}

main();
