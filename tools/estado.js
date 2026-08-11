'use strict';

const avisoOriginal = process.emitWarning;
process.emitWarning = function (aviso, ...resto) {
  const texto = typeof aviso === 'string' ? aviso : aviso?.message || '';
  if (texto.includes('SQLite is an experimental feature')) return;
  return avisoOriginal.call(process, aviso, ...resto);
};

/**
 * Estado del sistema en JSON, para que el panel grafico no tenga que abrir la
 * base de datos por su cuenta (no hay cliente de SQLite en .NET sin traer un
 * paquete extra, y en terreno no se puede descargar nada).
 *
 *   node tools/estado.js
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('../src/config');
const ajustes = require('../src/ajustes');

function censo() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(config.rutaBaseDatos, { readOnly: true });
    const leer = (sql) => db.prepare(sql).get().n;
    const salida = {
      personas: leer('SELECT COUNT(*) AS n FROM personas'),
      mensajes: leer('SELECT COUNT(*) AS n FROM mensajes'),
      dudosos: leer('SELECT COUNT(*) AS n FROM personas WHERE dudoso = 1'),
      sinLeer: leer(
        "SELECT COUNT(*) AS n FROM mensajes WHERE direccion = 'persona' AND leido_operador = 0"
      ),
      atrapados: leer("SELECT COUNT(*) AS n FROM personas WHERE estado = 'atrapado'"),
      heridos: leer(
        "SELECT COUNT(*) AS n FROM personas WHERE estado IN ('herido_grave','herido_leve')"
      ),
    };
    db.close();
    return salida;
  } catch {
    return null; // base todavia inexistente
  }
}

function portal() {
  try {
    const estado = JSON.parse(
      fs.readFileSync(path.join(config.carpetaDatos, 'servidor.json'), 'utf8')
    );
    process.kill(estado.pid, 0); // ¿sigue vivo?
    return estado;
  } catch {
    return null;
  }
}

const guardados = ajustes.leer();

function estadoCierre() {
  try {
    const cierre = require('../src/cierre');
    const actual = cierre.leer();
    const veredicto = cierre.puedePurgar(actual);
    return {
      estado: actual.estado,
      personas: actual.personas ?? null,
      archivoCsv: actual.archivoCsv ?? null,
      huellaCsv: actual.huellaCsv ?? null,
      receptor: actual.entrega?.receptor ?? null,
      entregadaEn: actual.entrega?.fecha ?? null,
      purgadaEn: actual.purga?.fecha ?? null,
      puedePurgar: veredicto.puede,
      motivoBloqueo: veredicto.motivo ?? null,
      diasFaltan: veredicto.faltan ?? 0,
    };
  } catch {
    return { estado: 'abierta', puedePurgar: false };
  }
}

console.log(JSON.stringify({
  modo: config.modo,
  cierre: estadoCierre(),
  // La capacidad de la tarjeta NO se comprueba aqui: lanza netsh y esto se
  // consulta cada pocos segundos. Va en tools/punto-acceso.js, bajo demanda.
  puntoAcceso: {
    nombreBase: config.puntoAcceso.nombreBase,
    ssid: config.puntoAcceso.ssid,
    clave: config.puntoAcceso.clave,
    claveEnNombre: config.puntoAcceso.claveEnNombre,
    avisoSsid: config.puntoAcceso.avisoSsid,
    ip: config.puntoAcceso.ip,
    desde: config.puntoAcceso.desde,
    hasta: config.puntoAcceso.hasta,
  },
  carpetaDatos: config.carpetaDatos,
  ip: guardados.ip || config.ip,
  ipFijada: !!guardados.ip,
  puesto: guardados.puesto || config.nombrePuesto,
  pin: guardados.pin || '1234',
  pinDeFabrica: (guardados.pin || '1234') === '1234',
  certificado: fs.existsSync(path.join(config.carpetaDatos, 'tls', 'cert.pem')),
  hayBase: fs.existsSync(config.rutaBaseDatos),
  censo: censo(),
  portal: portal(),
  adaptadores: config.listarIpsLan(),
}, null, 2));
