'use strict';

/**
 * Cierre de operacion: el final del ciclo de vida de los datos.
 *
 * El censo contiene nombres, cedulas, telefonos y ubicaciones de victimas.
 * Recogerlos esta justificado por la emergencia; conservarlos para siempre
 * despues, no. Pero borrarlos sin mas tampoco vale: hay que poder demostrar
 * que se entregaron a quien correspondia antes de destruirlos.
 *
 * De ahi esta maquina de estados, que solo avanza:
 *
 *   ABIERTA  ->  CERRADA  ->  ENTREGADA  ->  PURGADA
 *                   |             |              |
 *              exporta y      se anota a      se destruyen
 *              respalda       quien se        los datos y
 *                             entrego         queda constancia
 *
 * La CONSTANCIA sobrevive a la purga y no contiene ni un dato personal: solo
 * cuantas personas hubo, cuando, a quien se entrego el archivo y su huella
 * digital. Es lo que permite responder "¿que paso con esos datos?" cuando ya
 * no existen.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('./config');

const ESTADOS = {
  ABIERTA: 'abierta',
  CERRADA: 'cerrada',
  ENTREGADA: 'entregada',
  PURGADA: 'purgada',
};

/** Dias que se conservan los datos tras la entrega, antes de poder purgarlos. */
const DIAS_CONSERVACION = Number(process.env.SOS_DIAS_CONSERVACION || 30);

const rutaEstado = () => path.join(config.carpetaDatos, 'cierre.json');

function leer() {
  try {
    return JSON.parse(fs.readFileSync(rutaEstado(), 'utf8'));
  } catch {
    return { estado: ESTADOS.ABIERTA };
  }
}

function guardar(datos) {
  fs.mkdirSync(config.carpetaDatos, { recursive: true });
  fs.writeFileSync(rutaEstado(), JSON.stringify(datos, null, 2));
  return datos;
}

function huellaDe(archivo) {
  return crypto.createHash('sha256').update(fs.readFileSync(archivo)).digest('hex');
}

/* ------------------------------------------------------------------ *
 * Paso 1: cerrar
 * ------------------------------------------------------------------ */

/**
 * Congela la operacion: genera el CSV definitivo y un respaldo verificado, y
 * anota la huella del archivo. A partir de aqui lo que se entregue tiene que
 * coincidir con esa huella.
 */
function cerrar() {
  const actual = leer();
  if (actual.estado !== ESTADOS.ABIERTA) {
    throw new Error(`La operacion ya esta ${actual.estado}, no se puede cerrar otra vez.`);
  }
  if (!fs.existsSync(config.rutaBaseDatos)) {
    throw new Error('No hay base de datos: no hay nada que cerrar.');
  }

  const { personas, exportarCsv, respaldarBase, db } = require('./db');
  const resumen = personas.contar();
  if (resumen.total === 0) {
    throw new Error('No hay nadie registrado: no hay nada que entregar.');
  }

  const sello = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

  fs.mkdirSync(config.carpetaExportes, { recursive: true });
  const rutaCsv = path.join(config.carpetaExportes, `censo-final-${sello}.csv`);
  fs.writeFileSync(rutaCsv, exportarCsv(), 'utf8');

  const carpetaRespaldos = path.join(config.carpetaDatos, 'respaldos');
  fs.mkdirSync(carpetaRespaldos, { recursive: true });
  const rutaRespaldo = path.join(carpetaRespaldos, `cierre-${sello}.sqlite3`);
  const copia = respaldarBase(rutaRespaldo);

  const primero = db.prepare('SELECT MIN(creado_en) AS f FROM personas').get().f;

  return guardar({
    estado: ESTADOS.CERRADA,
    puesto: config.nombrePuesto,
    aperturaOperacion: primero,
    cerradaEn: new Date().toISOString(),
    personas: resumen.total,
    mensajes: copia.mensajes,
    archivoCsv: path.basename(rutaCsv),
    rutaCsv,
    huellaCsv: huellaDe(rutaCsv),
    respaldo: path.basename(rutaRespaldo),
    diasConservacion: DIAS_CONSERVACION,
  });
}

/* ------------------------------------------------------------------ *
 * Paso 2: registrar la entrega
 * ------------------------------------------------------------------ */

function registrarEntrega({ receptor, contacto, medio, notas }) {
  const actual = leer();
  if (actual.estado !== ESTADOS.CERRADA) {
    throw new Error(
      actual.estado === ESTADOS.ABIERTA
        ? 'Primero hay que cerrar la operacion.'
        : `La operacion ya esta ${actual.estado}.`
    );
  }
  if (!String(receptor || '').trim()) {
    throw new Error('Hay que anotar a QUIEN se entrego (organismo o persona).');
  }

  return guardar({
    ...actual,
    estado: ESTADOS.ENTREGADA,
    entrega: {
      receptor: String(receptor).trim(),
      contacto: String(contacto || '').trim() || null,
      medio: String(medio || '').trim() || null,
      notas: String(notas || '').trim() || null,
      fecha: new Date().toISOString(),
    },
  });
}

/* ------------------------------------------------------------------ *
 * Paso 3: purgar
 * ------------------------------------------------------------------ */

function diasDesdeEntrega(estado = leer()) {
  if (!estado.entrega?.fecha) return null;
  const ms = Date.now() - new Date(estado.entrega.fecha).getTime();
  return Math.floor(ms / 86_400_000);
}

function puedePurgar(estado = leer()) {
  if (estado.estado !== ESTADOS.ENTREGADA) {
    return { puede: false, motivo: 'Todavia no se ha registrado la entrega.' };
  }
  const dias = diasDesdeEntrega(estado);
  const faltan = (estado.diasConservacion ?? DIAS_CONSERVACION) - dias;
  if (faltan > 0) {
    return {
      puede: false,
      faltan,
      motivo:
        `Faltan ${faltan} dia(s) del plazo de conservacion. ` +
        'Se conserva por si la autoridad necesita una aclaracion.',
    };
  }
  return { puede: true };
}

/**
 * Destruye los datos personales y deja una constancia que NO los contiene.
 *
 * `forzar` salta el plazo de conservacion, pero exige un motivo escrito que
 * queda en la constancia: si alguien acorta el plazo, tiene que decir por que.
 */
function purgar({ motivo, forzar = false, operador } = {}) {
  const estado = leer();
  const veredicto = puedePurgar(estado);

  if (!veredicto.puede) {
    if (estado.estado !== ESTADOS.ENTREGADA) throw new Error(veredicto.motivo);
    if (!forzar) throw new Error(veredicto.motivo);
    if (!String(motivo || '').trim()) {
      throw new Error('Para purgar antes de plazo hay que escribir un motivo.');
    }
  }

  // Cerramos nuestra conexion o Windows no dejara borrar el archivo.
  try { require('./db').db.close(); } catch { /* no estaba abierta */ }

  const borrados = [];
  const borrar = (ruta, etiqueta) => {
    try {
      if (!fs.existsSync(ruta)) return;
      fs.rmSync(ruta, { recursive: true, force: true });
      borrados.push(etiqueta);
    } catch (err) {
      throw new Error(`No se pudo borrar ${etiqueta}: ${err.message}`);
    }
  };

  borrar(config.rutaBaseDatos, 'base de datos');
  borrar(`${config.rutaBaseDatos}-wal`, 'diario WAL');
  borrar(`${config.rutaBaseDatos}-shm`, 'indice compartido');
  borrar(path.join(config.carpetaDatos, 'respaldos'), 'respaldos');
  borrar(config.carpetaExportes, 'exportaciones CSV');
  borrar(path.join(config.carpetaDatos, 'arrendamientos.json'), 'arriendos DHCP');

  const constancia = {
    ...estado,
    estado: ESTADOS.PURGADA,
    purga: {
      fecha: new Date().toISOString(),
      operador: String(operador || '').trim() || null,
      anticipada: !veredicto.puede,
      motivo: String(motivo || '').trim() || null,
      borrados,
    },
  };
  // La ruta del CSV ya no existe: dejarla apuntaria a un archivo destruido.
  delete constancia.rutaCsv;

  guardar(constancia);
  escribirConstancia(constancia);
  return constancia;
}

/* ------------------------------------------------------------------ *
 * Constancia legible
 * ------------------------------------------------------------------ */

function escribirConstancia(estado) {
  const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-CO') : '—');

  const lineas = [
    '='.repeat(64),
    '  CONSTANCIA DE CIERRE DE OPERACION',
    '  SOS · Conectate · Pide Ayuda',
    '='.repeat(64),
    '',
    `  Puesto de mando      : ${estado.puesto || '—'}`,
    `  Primer registro      : ${fecha(estado.aperturaOperacion)}`,
    `  Operacion cerrada    : ${fecha(estado.cerradaEn)}`,
    '',
    `  Personas registradas : ${estado.personas ?? '—'}`,
    `  Mensajes             : ${estado.mensajes ?? '—'}`,
    '',
    '  ENTREGA',
    `  Entregado a          : ${estado.entrega?.receptor || '—'}`,
    `  Contacto             : ${estado.entrega?.contacto || '—'}`,
    `  Medio de entrega     : ${estado.entrega?.medio || '—'}`,
    `  Fecha de entrega     : ${fecha(estado.entrega?.fecha)}`,
    estado.entrega?.notas ? `  Notas                : ${estado.entrega.notas}` : null,
    '',
    '  ARCHIVO ENTREGADO',
    `  Nombre               : ${estado.archivoCsv || '—'}`,
    `  Huella SHA-256       : ${estado.huellaCsv || '—'}`,
    '',
    '  DESTRUCCION DE DATOS',
    `  Fecha                : ${fecha(estado.purga?.fecha)}`,
    `  Realizada por        : ${estado.purga?.operador || '—'}`,
    `  Plazo cumplido       : ${estado.purga?.anticipada ? 'NO — purga anticipada' : 'si'}`,
    estado.purga?.motivo ? `  Motivo               : ${estado.purga.motivo}` : null,
    `  Elementos destruidos : ${(estado.purga?.borrados || []).join(', ') || '—'}`,
    '',
    '-'.repeat(64),
    '  Este documento NO contiene datos personales. La huella SHA-256',
    '  permite verificar que el archivo entregado a la autoridad es el',
    '  mismo que se genero al cerrar la operacion.',
    '-'.repeat(64),
    '',
  ].filter((l) => l !== null);

  const destino = path.join(config.carpetaDatos, 'CONSTANCIA-DE-CIERRE.txt');
  fs.writeFileSync(destino, lineas.join('\n'), 'utf8');
  return destino;
}

module.exports = {
  ESTADOS, DIAS_CONSERVACION,
  leer, cerrar, registrarEntrega, purgar,
  puedePurgar, diasDesdeEntrega, escribirConstancia,
};
