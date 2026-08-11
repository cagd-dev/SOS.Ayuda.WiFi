'use strict';

// node:sqlite avisa que es experimental; silenciado para no ensuciar la salida.
const avisoOriginal = process.emitWarning;
process.emitWarning = function (aviso, ...resto) {
  const texto = typeof aviso === 'string' ? aviso : aviso?.message || '';
  if (texto.includes('SQLite is an experimental feature')) return;
  return avisoOriginal.call(process, aviso, ...resto);
};

/**
 * Exporta el censo a CSV. Es el archivo que se entrega a las autoridades.
 * Vive como script propio para que lo puedan usar tanto la consola de texto
 * como el panel grafico sin duplicar la logica.
 *
 *   node tools/exportar-csv.js [ruta-de-salida]
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');

function main() {
  if (!fs.existsSync(config.rutaBaseDatos)) {
    console.log('\n  Todavia no hay base de datos: no hay nada que exportar.\n');
    process.exit(1);
  }

  const { personas, exportarCsv } = require('../src/db');
  const total = personas.contar().total;
  if (!total) {
    console.log('\n  No hay nadie registrado todavia: no hay nada que exportar.\n');
    process.exit(1);
  }

  const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const destino = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(config.carpetaExportes, `censo-sos-${sello}.csv`);

  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, exportarCsv(), 'utf8');

  console.log(`\n  Exportadas ${total} persona(s) a:`);
  console.log(`  ${destino}`);
  console.log('\n  Abrelo con Excel. Este es el archivo que se entrega a las autoridades.\n');
}

main();
