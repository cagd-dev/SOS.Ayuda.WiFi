'use strict';

/**
 * Ajustes que el operador puede cambiar sin tocar codigo ni archivos .bat:
 * PIN, nombre del puesto, IP forzada, mensaje de bienvenida.
 *
 * Vive en datos/configuracion.json porque contiene el PIN y esa carpeta ya
 * esta fuera del control de versiones.
 *
 * Este modulo NO depende de config.js: es al reves. Por eso calcula su propia
 * ruta en vez de pedirsela a nadie.
 */

const fs = require('node:fs');
const path = require('node:path');

const carpeta = path.resolve(__dirname, '..', 'datos');
const ruta = path.join(carpeta, 'configuracion.json');

function leer() {
  try {
    const contenido = JSON.parse(fs.readFileSync(ruta, 'utf8'));
    return contenido && typeof contenido === 'object' ? contenido : {};
  } catch {
    return {}; // no existe todavia, o quedo corrupto: seguimos con defaults
  }
}

function guardar(parciales) {
  const nuevo = { ...leer(), ...parciales, actualizado: new Date().toISOString() };
  fs.mkdirSync(carpeta, { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify(nuevo, null, 2), { mode: 0o600 });
  return nuevo;
}

module.exports = { leer, guardar, ruta };
