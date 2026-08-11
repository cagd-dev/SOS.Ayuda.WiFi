'use strict';

/**
 * Consola del puesto de mando. Prioriza sola: quien esta atrapado o herido
 * grave sube al tope de la lista, y quien ya fue atendido baja al fondo.
 * El operador no deberia tener que ordenar nada a mano bajo presion.
 */

const $ = (sel) => document.querySelector(sel);

let pin = null;
let sesion = null;   // token que devuelve /admin/login; el PIN no vuelve a salir
let operador = '';
let personas = [];
let seleccionada = null;
let mensajesVistos = new Set();
let soloPendientes = false;
let filtro = '';
let socket = null;

const ETIQUETA_NECESIDAD = {
  agua: 'Agua', comida: 'Comida', medicina: 'Medicina', abrigo: 'Abrigo',
  rescate: 'RESCATE', transporte: 'Transporte', carga: 'Cargar celular',
};

const COLOR_ESTADO = {
  atrapado: 'var(--critico)', herido_grave: 'var(--acento-fuerte)',
  herido_leve: 'var(--alerta)', busca: 'var(--info)', bien: 'var(--ok)',
};

/* ---------------- Acceso ---------------- */

async function entrar() {
  const error = $('#errorAcceso');
  error.hidden = true;
  const valor = $('#campoPin').value;

  try {
    const respuesta = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ pin: valor }),
    });
    const cuerpo = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(cuerpo.error || 'PIN incorrecto');

    sesion = cuerpo.sesion;
    pin = valor;
    operador = $('#campoOperador').value.trim();
    try {
      sessionStorage.setItem('sos_pin', pin);
      localStorage.setItem('sos_operador', operador);
    } catch { /* modo privado */ }
    $('#pantallaAcceso').style.display = 'none';
    $('#consola').hidden = false;
    await cargarPersonas();
    conectarWebSocket();
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
}

$('#btnEntrar').addEventListener('click', entrar);
$('#campoPin').addEventListener('keydown', (e) => { if (e.key === 'Enter') entrar(); });

/* ---------------- Datos ---------------- */

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(ruta, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opciones.headers || {}) },
  });
  if (respuesta.status === 401) {
    location.reload();
    throw new Error('Sesion expirada');
  }
  return respuesta;
}

async function cargarPersonas() {
  const respuesta = await api('/admin/api/personas');
  const cuerpo = await respuesta.json();
  personas = cuerpo.personas;
  pintarMetricas(cuerpo.resumen);
  pintarLista();
}

function pintarMetricas(resumen) {
  const porEstado = resumen.porEstado || {};
  const tarjetas = [
    { r: 'Total', n: resumen.total, clase: '' },
    { r: 'Atrapados', n: porEstado.atrapado || 0, clase: 'critico' },
    { r: 'Heridos', n: (porEstado.herido_grave || 0) + (porEstado.herido_leve || 0), clase: 'alerta' },
    { r: 'Bien', n: porEstado.bien || 0, clase: 'ok' },
    { r: 'Sin leer', n: resumen.sinLeer, clase: resumen.sinLeer ? 'alerta' : '' },
    { r: 'Dudosos', n: resumen.dudosos || 0, clase: '' },
  ];
  $('#metricas').innerHTML = tarjetas
    .map((t) => `<div class="metrica ${t.clase}"><span class="n">${t.n}</span><span class="r">${t.r}</span></div>`)
    .join('');
}

function personasVisibles() {
  const texto = filtro.toLowerCase();
  return personas.filter((p) => {
    if (soloPendientes && p.atendido) return false;
    if (!texto) return true;
    return [p.nombre, p.documento, p.codigo, p.acompanantes, p.ubicacion]
      .some((campo) => String(campo || '').toLowerCase().includes(texto));
  });
}

function pintarLista() {
  const visibles = personasVisibles();
  const contenedor = $('#listaPersonas');

  if (!visibles.length) {
    contenedor.innerHTML = '<div class="vacio">Nadie coincide con el filtro.</div>';
    return;
  }

  contenedor.innerHTML = visibles
    .map((p) => {
      const necesidades = p.necesidades.length
        ? ' · ' + p.necesidades.map((n) => ETIQUETA_NECESIDAD[n] || n).join(', ')
        : '';
      return `
        <div class="fila-persona ${p.atendido ? 'atendida' : ''} ${p.dudoso ? 'dudosa' : ''} ${seleccionada?.id === p.id ? 'activa' : ''}"
             data-id="${p.id}">
          <span class="avatar" style="background:${COLOR_ESTADO[p.estado] || 'var(--texto-suave)'}"></span>
          <div class="datos">
            <div class="nom">${escapar(p.nombre)}
              ${p.dudoso ? '<span class="marca-dudoso">DUDOSO</span>' : ''}
              ${p.sin_leer ? `<span class="globo">${p.sin_leer}</span>` : ''}
            </div>
            <div class="meta">${escapar(p.codigo)} · ${escapar(p.estadoEtiqueta)}${escapar(necesidades)}</div>
            ${p.ubicacion ? `<div class="meta">${escapar(p.ubicacion.split('\n')[0])}</div>` : ''}
          </div>
        </div>`;
    })
    .join('');

  for (const fila of contenedor.querySelectorAll('.fila-persona')) {
    fila.addEventListener('click', () => seleccionar(Number(fila.dataset.id)));
  }
}

/* ---------------- Ficha y chat ---------------- */

async function seleccionar(id) {
  const respuesta = await api(`/admin/api/personas/${id}`);
  const { persona, mensajes } = await respuesta.json();
  seleccionada = persona;

  $('#sinSeleccion').hidden = true;
  $('#detalle').hidden = false;
  $('#consola').dataset.vista = 'chat';

  $('#fichaNombre').textContent = persona.nombre;
  $('#fichaResumen').textContent =
    `${persona.codigo} · ${persona.estadoEtiqueta}` +
    (persona.necesidades.length
      ? ' · necesita ' + persona.necesidades.map((n) => ETIQUETA_NECESIDAD[n] || n).join(', ')
      : '');

  const filas = [
    ['Ubicacion', persona.ubicacion],
    ['Con quien esta', persona.acompanantes],
    ['Busca a', persona.busca_a],
    ['Documento', persona.documento],
    ['Telefono', persona.telefono],
    ['Edad', persona.edad],
    ['Avisar a', persona.contacto],
    ['Registrado', new Date(persona.creado_en).toLocaleString('es-CO')],
  ].filter(([, valor]) => valor !== null && valor !== undefined && valor !== '');

  $('#fichaDatos').innerHTML = filas
    .map(([clave, valor]) => `<dt>${clave}</dt><dd>${escapar(valor).replace(/\n/g, '<br>')}</dd>`)
    .join('');

  $('#campoNotas').value = persona.notas || '';
  $('#btnAtendido').textContent = persona.atendido ? 'Reabrir caso' : 'Marcar atendido';
  pintarDudoso(persona);

  mensajesVistos = new Set();
  $('#listaMensajes').innerHTML = '';
  for (const mensaje of mensajes) pintarMensaje(mensaje);

  await api(`/admin/api/personas/${id}/leido`, { method: 'POST' });
  const enLista = personas.find((p) => p.id === id);
  if (enLista) enLista.sin_leer = 0;
  pintarLista();
}

function pintarMensaje(mensaje) {
  if (mensajesVistos.has(mensaje.id)) return;
  mensajesVistos.add(mensaje.id);

  const claseDireccion =
    mensaje.direccion === 'persona' ? 'operador' :
    mensaje.direccion === 'difusion' ? 'difusion' :
    mensaje.direccion === 'sistema' ? 'sistema' : 'mia';

  const burbuja = document.createElement('div');
  burbuja.className = `burbuja ${claseDireccion}`;

  if (mensaje.direccion === 'sistema') {
    burbuja.textContent = mensaje.texto;
  } else {
    const autor = document.createElement('span');
    autor.className = 'autor';
    autor.textContent = mensaje.autor || (mensaje.direccion === 'persona' ? 'Persona' : 'Puesto');
    burbuja.appendChild(autor);

    const texto = document.createElement('span');
    texto.textContent = mensaje.texto;
    burbuja.appendChild(texto);

    const hora = document.createElement('span');
    hora.className = 'hora';
    hora.textContent = new Date(mensaje.creado_en).toLocaleTimeString('es-CO', {
      hour: '2-digit', minute: '2-digit',
    });
    burbuja.appendChild(hora);
  }

  const lista = $('#listaMensajes');
  lista.appendChild(burbuja);
  lista.scrollTop = lista.scrollHeight;
}

async function responder() {
  if (!seleccionada) return;
  const campo = $('#campoMensaje');
  const texto = campo.value.trim();
  if (!texto) return;
  campo.value = '';

  const respuesta = await api(`/admin/api/personas/${seleccionada.id}/mensajes`, {
    method: 'POST',
    body: JSON.stringify({ texto, autor: operador || undefined }),
  });
  const { mensaje } = await respuesta.json();
  pintarMensaje(mensaje);
}

$('#formMensaje').addEventListener('submit', (evento) => {
  evento.preventDefault();
  responder();
});

// Llamada directa en vez de form.requestSubmit(): ese metodo no existe en
// navegadores algo viejos y ahi el Enter se quedaba mudo. isComposing evita
// tragarse el Enter que cierra un acento.
$('#campoMensaje').addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter' || evento.shiftKey) return;
  if (evento.isComposing || evento.keyCode === 229) return;
  evento.preventDefault();
  responder();
});

$('#btnAtendido').addEventListener('click', async () => {
  if (!seleccionada) return;
  const respuesta = await api(`/admin/api/personas/${seleccionada.id}/atendido`, {
    method: 'POST',
    body: JSON.stringify({ atendido: !seleccionada.atendido }),
  });
  seleccionada = (await respuesta.json()).persona;
  $('#btnAtendido').textContent = seleccionada.atendido ? 'Reabrir caso' : 'Marcar atendido';
  await cargarPersonas();
});

/* ---------------- Reporte dudoso ---------------- */

function pintarDudoso(persona) {
  $('#btnDudoso').textContent = persona.dudoso ? 'Quitar marca de dudoso' : 'Marcar dudoso';
  const banner = $('#bannerDudoso');

  if (!persona.dudoso) {
    banner.hidden = true;
    banner.textContent = '';
    return;
  }

  const cuando = persona.dudoso_en ? new Date(persona.dudoso_en).toLocaleString('es-CO') : '';
  banner.hidden = false;
  banner.innerHTML =
    '<strong>Marcado como reporte dudoso.</strong> Baja en la lista, pero sigue activo — ' +
    'no se ha descartado.<br>' +
    `<span style="font-size:.85em">Lo marco ${escapar(persona.dudoso_por || 'un operador')} el ${escapar(cuando)}` +
    (persona.dudoso_motivo ? ` · Motivo: ${escapar(persona.dudoso_motivo)}` : '') +
    '</span>';
}

$('#btnDudoso').addEventListener('click', async () => {
  if (!seleccionada) return;
  const marcando = !seleccionada.dudoso;

  let motivo = '';
  if (marcando) {
    // El motivo es obligatorio a proposito: obliga a articular la sospecha en
    // vez de bajar a alguien de prioridad por corazonada.
    motivo = prompt(
      '¿Por que consideras dudoso este reporte?\n\n' +
      'Queda registrado con tu nombre y la hora. La persona NUNCA ve esta marca.'
    );
    if (motivo === null) return;
    if (!motivo.trim()) {
      alert('Escribe un motivo. Sin motivo no se marca.');
      return;
    }
  } else if (!confirm('¿Quitar la marca de dudoso y devolverle su prioridad normal?')) {
    return;
  }

  const respuesta = await api(`/admin/api/personas/${seleccionada.id}/dudoso`, {
    method: 'POST',
    body: JSON.stringify({ dudoso: marcando, motivo, por: operador || 'operador sin nombre' }),
  });
  seleccionada = (await respuesta.json()).persona;
  pintarDudoso(seleccionada);
  await cargarPersonas();
});

$('#btnGuardarNotas').addEventListener('click', async () => {
  if (!seleccionada) return;
  const boton = $('#btnGuardarNotas');
  boton.textContent = 'Guardando...';
  await api(`/admin/api/personas/${seleccionada.id}/notas`, {
    method: 'POST',
    body: JSON.stringify({ notas: $('#campoNotas').value }),
  });
  boton.textContent = 'Notas guardadas';
  setTimeout(() => { boton.textContent = 'Guardar notas'; }, 1500);
});

/* ---------------- Herramientas ---------------- */

$('#filtroTexto').addEventListener('input', (e) => { filtro = e.target.value; pintarLista(); });

$('#btnPendientes').addEventListener('click', (e) => {
  soloPendientes = !soloPendientes;
  e.target.textContent = soloPendientes ? 'Ver todos' : 'Pendientes';
  pintarLista();
});

$('#btnDifusion').addEventListener('click', async () => {
  const texto = prompt('Aviso general para TODAS las personas registradas:');
  if (!texto || !texto.trim()) return;
  const respuesta = await api('/admin/api/difusion', {
    method: 'POST',
    body: JSON.stringify({ texto: texto.trim(), autor: operador || undefined }),
  });
  const cuerpo = await respuesta.json();
  alert(`Aviso enviado a ${cuerpo.total} persona(s).`);
});

$('#btnExportar').addEventListener('click', () => { window.location.href = '/admin/api/exportar.csv'; });

$('#btnVolverLista').addEventListener('click', () => { $('#consola').dataset.vista = 'lista'; });

/* ---------------- Tiempo real ---------------- */

function conectarWebSocket() {
  const protocolo = location.protocol === 'https:' ? 'wss:' : 'ws:';
  // Va la SESION, nunca el PIN: una URL acaba en el historial del navegador y
  // en cualquier registro que guarde direcciones, y el PIN es reutilizable.
  socket = new WebSocket(`${protocolo}//${location.host}/ws?rol=operador&s=${encodeURIComponent(sesion)}`);

  socket.addEventListener('message', (evento) => {
    let datos;
    try { datos = JSON.parse(evento.data); } catch { return; }

    if (datos.tipo === 'mensaje') {
      if (seleccionada && datos.mensaje.persona_id === seleccionada.id) pintarMensaje(datos.mensaje);
      cargarPersonas();
      if (datos.mensaje.direccion === 'persona') sonar();
    }
    if (datos.tipo === 'persona-nueva' || datos.tipo === 'persona-actualizada') {
      cargarPersonas();
      if (datos.tipo === 'persona-nueva') sonar();
    }
  });

  // Sin reconexion agresiva: recargamos cada 20 s de todos modos.
  socket.addEventListener('close', () => setTimeout(conectarWebSocket, 3000));
}

// Red de seguridad: aunque el WebSocket muera, la lista nunca se queda vieja.
setInterval(() => { if (pin) cargarPersonas().catch(() => {}); }, 20000);

/** Pitido corto generado en el navegador: no necesitamos archivo de audio. */
function sonar() {
  try {
    const contexto = new (window.AudioContext || window.webkitAudioContext)();
    const oscilador = contexto.createOscillator();
    const ganancia = contexto.createGain();
    oscilador.connect(ganancia);
    ganancia.connect(contexto.destination);
    oscilador.frequency.value = 880;
    ganancia.gain.setValueAtTime(0.15, contexto.currentTime);
    ganancia.gain.exponentialRampToValueAtTime(0.001, contexto.currentTime + 0.3);
    oscilador.start();
    oscilador.stop(contexto.currentTime + 0.3);
  } catch { /* el navegador bloqueo el audio: no es critico */ }
}

function escapar(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

/* ---------------- Arranque ---------------- */

// Si recargamos la pagina, no volvemos a pedir el PIN en la misma pestana.
try {
  $('#campoOperador').value = localStorage.getItem('sos_operador') || '';
  const guardado = sessionStorage.getItem('sos_pin');
  if (guardado) { $('#campoPin').value = guardado; entrar(); }
} catch { /* modo privado: se pide el PIN normalmente */ }
