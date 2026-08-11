'use strict';

const avisoOriginal = process.emitWarning;
process.emitWarning = function (aviso, ...resto) {
  const texto = typeof aviso === 'string' ? aviso : aviso?.message || '';
  if (texto.includes('SQLite is an experimental feature')) return;
  return avisoOriginal.call(process, aviso, ...resto);
};

/**
 * Prueba del cierre de operacion.
 *
 * Va en un archivo aparte de humo.js porque este flujo DESTRUYE datos: se
 * ejecuta contra una carpeta temporal (SOS_DATOS) para no tocar nada real.
 *
 *   node pruebas/cierre.js
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Tiene que fijarse ANTES de cargar config.
const temporal = fs.mkdtempSync(path.join(os.tmpdir(), 'sos-cierre-'));
process.env.SOS_DATOS = temporal;
process.env.SOS_PIN = '112233';

let pasadas = 0;
let fallidas = 0;

function revisar(nombre, condicion, detalle = '') {
  if (condicion) { pasadas++; console.log(`  OK   ${nombre}`); }
  else { fallidas++; console.log(`  FALLA ${nombre}${detalle ? ' -> ' + detalle : ''}`); }
}

function main() {
  console.log(`\nProbando el cierre en ${temporal}\n`);

  const { personas, mensajes } = require('../src/db');
  const cierre = require('../src/cierre');

  revisar('arranca con la operacion abierta', cierre.leer().estado === cierre.ESTADOS.ABIERTA);

  // Sin nadie registrado no hay nada que entregar.
  let error = null;
  try { cierre.cerrar(); } catch (e) { error = e.message; }
  revisar('no deja cerrar sin personas registradas', /nadie registrado/i.test(error || ''), error);

  const persona = personas.crear({
    nombre: 'Maria Gonzalez Perez',
    documento: '1098765432',
    estado: 'atrapado',
    ubicacion: 'Calle 12 numero 4-30',
  });
  mensajes.crear({ personaId: persona.id, direccion: 'persona', texto: 'estoy bajo escombros' });

  /* --- Paso 1: cerrar --- */
  const cerrada = cierre.cerrar();
  revisar('cierra la operacion', cerrada.estado === cierre.ESTADOS.CERRADA);
  revisar('cuenta las personas', cerrada.personas === 1);
  revisar('genera el censo definitivo', fs.existsSync(cerrada.rutaCsv));
  revisar('calcula la huella del archivo', /^[0-9a-f]{64}$/.test(cerrada.huellaCsv || ''));
  revisar('deja un respaldo del cierre',
    fs.existsSync(path.join(temporal, 'respaldos', cerrada.respaldo)));

  error = null;
  try { cierre.cerrar(); } catch (e) { error = e.message; }
  revisar('no deja cerrar dos veces', !!error, error);

  /* --- El orden no se puede saltar --- */
  error = null;
  try { cierre.purgar({ operador: 'X' }); } catch (e) { error = e.message; }
  revisar('no deja purgar antes de registrar la entrega', /entrega/i.test(error || ''), error);

  error = null;
  try { cierre.registrarEntrega({ receptor: '  ' }); } catch (e) { error = e.message; }
  revisar('exige anotar a quien se entrego', /QUIEN/i.test(error || ''), error);

  /* --- Paso 2: entrega --- */
  const entregada = cierre.registrarEntrega({
    receptor: 'Defensa Civil - Seccional Manizales',
    contacto: 'coordinador@ejemplo.org',
    medio: 'USB entregada en mano',
  });
  revisar('registra la entrega', entregada.estado === cierre.ESTADOS.ENTREGADA);
  revisar('guarda a quien se entrego',
    entregada.entrega.receptor.includes('Defensa Civil'));

  /* --- Paso 3: plazo de conservacion --- */
  const veredicto = cierre.puedePurgar();
  revisar('respeta el plazo de conservacion', veredicto.puede === false, veredicto.motivo);
  revisar('dice cuantos dias faltan', veredicto.faltan > 0, String(veredicto.faltan));

  error = null;
  try { cierre.purgar({ operador: 'X', forzar: true }); } catch (e) { error = e.message; }
  revisar('para purgar antes de plazo exige un motivo', /motivo/i.test(error || ''), error);

  /* --- Paso 4: purga --- */
  const purgada = cierre.purgar({
    operador: 'Cesar (prueba)',
    motivo: 'prueba automatica',
    forzar: true,
  });
  revisar('purga la operacion', purgada.estado === cierre.ESTADOS.PURGADA);
  revisar('marca que la purga fue anticipada', purgada.purga.anticipada === true);

  revisar('destruye la base de datos',
    !fs.existsSync(path.join(temporal, 'sos.sqlite3')));
  revisar('destruye los respaldos', !fs.existsSync(path.join(temporal, 'respaldos')));
  revisar('destruye las exportaciones CSV', !fs.existsSync(path.join(temporal, 'exportes')));

  /* --- La constancia sobrevive y no filtra nada --- */
  const rutaConstancia = path.join(temporal, 'CONSTANCIA-DE-CIERRE.txt');
  revisar('deja la constancia', fs.existsSync(rutaConstancia));

  const constancia = fs.readFileSync(rutaConstancia, 'utf8');
  revisar('la constancia dice a quien se entrego', constancia.includes('Defensa Civil'));
  revisar('la constancia lleva la huella del archivo', constancia.includes(cerrada.huellaCsv));
  revisar('la constancia anota la purga anticipada y su motivo',
    /purga anticipada/i.test(constancia) && constancia.includes('prueba automatica'));

  // Lo mas importante: el documento que sobrevive NO puede llevar datos de nadie.
  revisar('la constancia NO contiene el nombre de la persona',
    !constancia.includes('Maria Gonzalez'), 'filtraria datos personales');
  revisar('la constancia NO contiene la cedula', !constancia.includes('1098765432'));
  revisar('la constancia NO contiene la ubicacion', !constancia.includes('Calle 12'));

  console.log('');
  console.log(`  ${pasadas} pruebas OK, ${fallidas} fallidas`);
  console.log('');

  try { fs.rmSync(temporal, { recursive: true, force: true }); } catch { /* da igual */ }
  process.exit(fallidas ? 1 : 0);
}

main();
