'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

fs.mkdirSync(config.carpetaDatos, { recursive: true });

const db = new DatabaseSync(config.rutaBaseDatos);

// WAL: si el proceso se cae de golpe (se fue la luz) no perdemos la base.
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA synchronous = FULL');

db.exec(`
  CREATE TABLE IF NOT EXISTS personas (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    token          TEXT    NOT NULL UNIQUE,
    codigo         TEXT    NOT NULL UNIQUE,
    nombre         TEXT    NOT NULL,
    documento      TEXT,
    telefono       TEXT,
    edad           INTEGER,
    estado         TEXT    NOT NULL DEFAULT 'bien',
    necesidades    TEXT    NOT NULL DEFAULT '[]',
    ubicacion      TEXT,
    acompanantes   TEXT,
    contacto       TEXT,
    busca_a        TEXT,
    notas          TEXT,
    atendido       INTEGER NOT NULL DEFAULT 0,
    dudoso         INTEGER NOT NULL DEFAULT 0,
    dudoso_motivo  TEXT,
    dudoso_por     TEXT,
    dudoso_en      TEXT,
    ip             TEXT,
    mac            TEXT,
    agente         TEXT,
    creado_en      TEXT    NOT NULL,
    actualizado_en TEXT    NOT NULL,
    visto_en       TEXT
  );

  CREATE TABLE IF NOT EXISTS mensajes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    persona_id     INTEGER NOT NULL,
    direccion      TEXT    NOT NULL,
    texto          TEXT    NOT NULL,
    autor          TEXT,
    creado_en      TEXT    NOT NULL,
    leido_operador INTEGER NOT NULL DEFAULT 0,
    leido_persona  INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (persona_id) REFERENCES personas(id)
  );

  CREATE TABLE IF NOT EXISTS eventos (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo      TEXT NOT NULL,
    detalle   TEXT,
    creado_en TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_mensajes_persona ON mensajes(persona_id, id);
  CREATE INDEX IF NOT EXISTS idx_personas_estado  ON personas(estado);
`);

/**
 * Migracion en caliente. Una base creada por una version anterior sigue
 * abriendo sin perder datos: se le agregan las columnas que le falten.
 */
function asegurarColumna(tabla, columna, definicion) {
  const columnas = db.prepare(`PRAGMA table_info(${tabla})`).all();
  if (columnas.some((c) => c.name === columna)) return;
  db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${columna} ${definicion}`);
}

asegurarColumna('personas', 'dudoso', 'INTEGER NOT NULL DEFAULT 0');
asegurarColumna('personas', 'dudoso_motivo', 'TEXT');
asegurarColumna('personas', 'dudoso_por', 'TEXT');
asegurarColumna('personas', 'dudoso_en', 'TEXT');
asegurarColumna('personas', 'mac', 'TEXT');

db.exec('CREATE INDEX IF NOT EXISTS idx_personas_mac ON personas(mac)');

/** Estados posibles y su peso de urgencia (mayor = se atiende primero). */
const ESTADOS = {
  atrapado:     { etiqueta: 'Atrapado / bajo escombros', urgencia: 4 },
  herido_grave: { etiqueta: 'Herido grave',              urgencia: 3 },
  herido_leve:  { etiqueta: 'Herido leve',               urgencia: 2 },
  busca:        { etiqueta: 'Busco a un familiar',       urgencia: 1 },
  bien:         { etiqueta: 'Estoy bien',                urgencia: 0 },
};

const NECESIDADES = ['agua', 'comida', 'medicina', 'abrigo', 'rescate', 'transporte', 'carga'];

const ahora = () => new Date().toISOString();

function urgenciaDe(persona) {
  const base = (ESTADOS[persona.estado] || ESTADOS.bien).urgencia;
  let extra = 0;
  try {
    const necesidades = JSON.parse(persona.necesidades || '[]');
    if (necesidades.includes('rescate')) extra += 2;
    if (necesidades.includes('medicina')) extra += 1;
  } catch { /* necesidades corruptas: no es motivo para tumbar la lista */ }
  return base * 10 + extra;
}

/** Codigo corto y pronunciable, para gritarlo por altavoz: "A-4821". */
function generarCodigo() {
  const letras = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sin I ni O: se confunden con 1 y 0
  for (let intento = 0; intento < 50; intento++) {
    const codigo =
      letras[crypto.randomInt(letras.length)] + '-' + String(crypto.randomInt(1000, 10000));
    const existe = db.prepare('SELECT 1 FROM personas WHERE codigo = ?').get(codigo);
    if (!existe) return codigo;
  }
  return 'X-' + Date.now().toString().slice(-6);
}

function hidratar(fila) {
  if (!fila) return null;
  let necesidades = [];
  try { necesidades = JSON.parse(fila.necesidades || '[]'); } catch { necesidades = []; }
  return {
    ...fila,
    necesidades,
    atendido: !!fila.atendido,
    dudoso: !!fila.dudoso,
    estadoEtiqueta: (ESTADOS[fila.estado] || ESTADOS.bien).etiqueta,
    urgencia: urgenciaDe(fila),
  };
}

/**
 * Version que SI se le puede mandar a la propia persona. Quita todo lo que es
 * criterio interno del puesto de mando: las notas del operador, la marca de
 * reporte dudoso y los datos tecnicos del dispositivo.
 *
 * Que alguien se entere de que lo marcaron como dudoso arruina la herramienta:
 * el operador dejaria de usarla por miedo al conflicto.
 */
function vistaPersona(persona) {
  if (!persona) return null;
  const {
    notas, dudoso, dudoso_motivo, dudoso_por, dudoso_en, ip, mac, agente, ...publico
  } = persona;
  return publico;
}

function normalizarNecesidades(valor) {
  const lista = Array.isArray(valor) ? valor : [];
  return JSON.stringify(lista.filter((n) => NECESIDADES.includes(n)));
}

const personas = {
  crear(datos) {
    const t = ahora();
    const token = crypto.randomBytes(16).toString('hex');
    const codigo = generarCodigo();
    const info = db
      .prepare(
        `INSERT INTO personas
           (token, codigo, nombre, documento, telefono, edad, estado, necesidades,
            ubicacion, acompanantes, contacto, busca_a, ip, mac, agente, creado_en, actualizado_en, visto_en)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
      )
      .run(
        token,
        codigo,
        String(datos.nombre || '').trim().slice(0, 120),
        (datos.documento || '').trim().slice(0, 40) || null,
        (datos.telefono || '').trim().slice(0, 40) || null,
        Number.isFinite(Number(datos.edad)) && datos.edad !== '' ? Number(datos.edad) : null,
        ESTADOS[datos.estado] ? datos.estado : 'bien',
        normalizarNecesidades(datos.necesidades),
        (datos.ubicacion || '').trim().slice(0, 300) || null,
        (datos.acompanantes || '').trim().slice(0, 300) || null,
        (datos.contacto || '').trim().slice(0, 200) || null,
        (datos.busca_a || '').trim().slice(0, 300) || null,
        datos.ip || null,
        datos.mac || null,
        (datos.agente || '').slice(0, 200) || null,
        t, t, t
      );
    return this.porId(Number(info.lastInsertRowid));
  },

  actualizar(id, datos) {
    const actual = db.prepare('SELECT * FROM personas WHERE id = ?').get(id);
    if (!actual) return null;
    db.prepare(
      `UPDATE personas SET
         nombre = ?, documento = ?, telefono = ?, edad = ?, estado = ?, necesidades = ?,
         ubicacion = ?, acompanantes = ?, contacto = ?, busca_a = ?, actualizado_en = ?
       WHERE id = ?`
    ).run(
      datos.nombre !== undefined ? String(datos.nombre).trim().slice(0, 120) : actual.nombre,
      datos.documento !== undefined ? (datos.documento || null) : actual.documento,
      datos.telefono !== undefined ? (datos.telefono || null) : actual.telefono,
      datos.edad !== undefined ? (datos.edad === '' ? null : Number(datos.edad)) : actual.edad,
      datos.estado !== undefined && ESTADOS[datos.estado] ? datos.estado : actual.estado,
      datos.necesidades !== undefined ? normalizarNecesidades(datos.necesidades) : actual.necesidades,
      datos.ubicacion !== undefined ? (datos.ubicacion || null) : actual.ubicacion,
      datos.acompanantes !== undefined ? (datos.acompanantes || null) : actual.acompanantes,
      datos.contacto !== undefined ? (datos.contacto || null) : actual.contacto,
      datos.busca_a !== undefined ? (datos.busca_a || null) : actual.busca_a,
      ahora(),
      id
    );
    return this.porId(id);
  },

  porId(id) {
    return hidratar(db.prepare('SELECT * FROM personas WHERE id = ?').get(id));
  },

  porToken(token) {
    if (!token) return null;
    return hidratar(db.prepare('SELECT * FROM personas WHERE token = ?').get(token));
  },

  /**
   * Ultima persona registrada desde ese telefono. Es lo que permite reconocer
   * a alguien que salto del mini-navegador a Chrome, donde no hay cookie.
   * Si dos personas usaron el mismo telefono devolvemos la mas reciente, y por
   * eso el portal PREGUNTA antes de darla por buena.
   */
  porMac(mac) {
    if (!mac) return null;
    return hidratar(
      db.prepare('SELECT * FROM personas WHERE mac = ? ORDER BY creado_en DESC LIMIT 1').get(mac)
    );
  },

  /** El telefono pudo cambiar de IP entre reconexiones; la MAC no. */
  refrescarRed(id, { ip, mac }) {
    db.prepare('UPDATE personas SET ip = COALESCE(?, ip), mac = COALESCE(?, mac) WHERE id = ?')
      .run(ip || null, mac || null, id);
  },

  marcarVisto(id) {
    db.prepare('UPDATE personas SET visto_en = ? WHERE id = ?').run(ahora(), id);
  },

  marcarAtendido(id, atendido) {
    db.prepare('UPDATE personas SET atendido = ?, actualizado_en = ? WHERE id = ?')
      .run(atendido ? 1 : 0, ahora(), id);
    return this.porId(id);
  },

  /**
   * Baja de prioridad un reporte que el operador considera dudoso, SIN borrarlo:
   * en una emergencia la duda se equivoca a menudo, y lo que hoy parece broma
   * mañana puede ser el unico rastro de alguien.
   */
  marcarDudoso(id, { dudoso, motivo, por }) {
    db.prepare(
      `UPDATE personas SET dudoso = ?, dudoso_motivo = ?, dudoso_por = ?, dudoso_en = ?, actualizado_en = ?
       WHERE id = ?`
    ).run(
      dudoso ? 1 : 0,
      dudoso ? (motivo || '').trim().slice(0, 300) || null : null,
      dudoso ? (por || '').trim().slice(0, 80) || null : null,
      dudoso ? ahora() : null,
      ahora(),
      id
    );
    return this.porId(id);
  },

  anotar(id, notas) {
    db.prepare('UPDATE personas SET notas = ?, actualizado_en = ? WHERE id = ?')
      .run(notas || null, ahora(), id);
    return this.porId(id);
  },

  /** Lista completa, ordenada por urgencia y luego por mensaje sin leer. */
  listar() {
    const filas = db
      .prepare(
        `SELECT p.*,
                (SELECT COUNT(*) FROM mensajes m
                  WHERE m.persona_id = p.id AND m.direccion = 'persona' AND m.leido_operador = 0
                ) AS sin_leer,
                (SELECT MAX(creado_en) FROM mensajes m WHERE m.persona_id = p.id) AS ultimo_mensaje
           FROM personas p`
      )
      .all();
    return filas
      .map((f) => ({ ...hidratar(f), sin_leer: f.sin_leer, ultimo_mensaje: f.ultimo_mensaje }))
      .sort((a, b) => {
        // Atendido al fondo del todo; el dudoso baja pero queda por encima,
        // porque sigue sin resolverse y puede resultar cierto.
        if (a.atendido !== b.atendido) return a.atendido ? 1 : -1;
        if (a.dudoso !== b.dudoso) return a.dudoso ? 1 : -1;
        if (b.urgencia !== a.urgencia) return b.urgencia - a.urgencia;
        if (b.sin_leer !== a.sin_leer) return b.sin_leer - a.sin_leer;
        return String(b.creado_en).localeCompare(String(a.creado_en));
      });
  },

  buscar(texto) {
    const q = `%${String(texto || '').trim().toLowerCase()}%`;
    return db
      .prepare(
        `SELECT * FROM personas
          WHERE lower(nombre) LIKE ? OR lower(COALESCE(documento,'')) LIKE ?
             OR lower(COALESCE(acompanantes,'')) LIKE ? OR lower(codigo) LIKE ?
          ORDER BY nombre`
      )
      .all(q, q, q, q)
      .map(hidratar);
  },

  contar() {
    const total = db.prepare('SELECT COUNT(*) AS n FROM personas').get().n;
    const porEstado = {};
    for (const fila of db.prepare('SELECT estado, COUNT(*) AS n FROM personas GROUP BY estado').all()) {
      porEstado[fila.estado] = fila.n;
    }
    const sinLeer = db
      .prepare(`SELECT COUNT(*) AS n FROM mensajes WHERE direccion = 'persona' AND leido_operador = 0`)
      .get().n;
    const dudosos = db.prepare('SELECT COUNT(*) AS n FROM personas WHERE dudoso = 1').get().n;
    return { total, porEstado, sinLeer, dudosos };
  },
};

const mensajes = {
  crear({ personaId, direccion, texto, autor }) {
    const t = ahora();
    const info = db
      .prepare(
        `INSERT INTO mensajes (persona_id, direccion, texto, autor, creado_en, leido_operador, leido_persona)
         VALUES (?,?,?,?,?,?,?)`
      )
      .run(
        personaId,
        direccion,
        String(texto).trim().slice(0, 2000),
        autor || null,
        t,
        direccion === 'persona' ? 0 : 1,
        direccion === 'persona' ? 1 : 0
      );
    return db.prepare('SELECT * FROM mensajes WHERE id = ?').get(Number(info.lastInsertRowid));
  },

  deLaPersona(personaId, desdeId = 0) {
    return db
      .prepare('SELECT * FROM mensajes WHERE persona_id = ? AND id > ? ORDER BY id')
      .all(personaId, desdeId);
  },

  marcarLeidosPorOperador(personaId) {
    db.prepare(`UPDATE mensajes SET leido_operador = 1 WHERE persona_id = ? AND direccion = 'persona'`)
      .run(personaId);
  },

  marcarLeidosPorPersona(personaId) {
    db.prepare(`UPDATE mensajes SET leido_persona = 1 WHERE persona_id = ? AND direccion != 'persona'`)
      .run(personaId);
  },

  /** Difusion: un mismo texto a todas las personas registradas. */
  difundir(texto, autor) {
    const ids = db.prepare('SELECT id FROM personas').all().map((f) => f.id);
    const creados = [];
    for (const id of ids) {
      creados.push(this.crear({ personaId: id, direccion: 'difusion', texto, autor }));
    }
    return creados;
  },
};

/**
 * Censo completo en CSV. Vive aqui y no en la ruta HTTP porque la consola de
 * administracion tiene que poder exportar con el servidor apagado.
 */
function exportarCsv() {
  const columnas = [
    'codigo', 'nombre', 'documento', 'telefono', 'edad', 'estado', 'estadoEtiqueta',
    'necesidades', 'ubicacion', 'acompanantes', 'contacto', 'busca_a', 'notas',
    'atendido', 'dudoso', 'dudoso_motivo', 'dudoso_por', 'dudoso_en',
    'creado_en', 'actualizado_en',
  ];
  const celda = (valor) => {
    const texto = Array.isArray(valor)
      ? valor.join(' | ')
      : valor === null || valor === undefined ? '' : String(valor);
    return `"${texto.replace(/"/g, '""')}"`;
  };
  const filas = personas.listar().map((p) => columnas.map((c) => celda(p[c])).join(';'));
  // BOM + separador ";": asi Excel en espanol abre el archivo sin asistente.
  return '﻿' + [columnas.join(';'), ...filas].join('\r\n');
}

const eventos = {
  registrar(tipo, detalle) {
    db.prepare('INSERT INTO eventos (tipo, detalle, creado_en) VALUES (?,?,?)')
      .run(tipo, typeof detalle === 'string' ? detalle : JSON.stringify(detalle ?? null), ahora());
  },
};

module.exports = {
  db, personas, mensajes, eventos, vistaPersona, exportarCsv,
  ESTADOS, NECESIDADES, ahora,
};
