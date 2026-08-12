'use strict';

/**
 * Chat de la persona. Estrategia de dos carriles:
 *   1. WebSocket, que es instantaneo.
 *   2. Si el WebSocket no levanta o se cae (pasa mucho en el mini-navegador
 *      del portal cautivo y en redes saturadas), pasamos a preguntar cada
 *      3 segundos por HTTP. Mas lento, pero nunca se queda mudo.
 * El indicador de la cabecera dice en cual de los dos estamos.
 */

const $ = (sel) => document.querySelector(sel);

const token =
  new URLSearchParams(location.search).get('t') ||
  (() => { try { return localStorage.getItem('sos_token'); } catch { return null; } })();

if (!token) location.replace('/');

try { localStorage.setItem('sos_token', token); } catch { /* modo privado */ }

// Una vez guardado, el token sale de la barra de direcciones: si no, queda en
// el historial del navegador y en cualquier captura de pantalla. En un telefono
// prestado o compartido eso entrega la sesion de otra persona.
if (new URLSearchParams(location.search).has('t')) {
  try { history.replaceState(null, '', location.pathname); } catch { /* navegador viejo */ }
}

let persona = null;
let configServidor = null;
let ultimoId = 0;
let socket = null;
let temporizadorPolling = null;
let reintentos = 0;

/* ---------------- Conexion ---------------- */

function marcarConexion(clase, texto) {
  const indicador = $('#estadoConexion');
  indicador.className = `conexion ${clase}`;
  indicador.textContent = texto;
}

function conectarWebSocket() {
  const protocolo = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try {
    socket = new WebSocket(`${protocolo}//${location.host}/ws?t=${encodeURIComponent(token)}`);
  } catch {
    return caerAPolling();
  }

  socket.addEventListener('open', () => {
    reintentos = 0;
    marcarConexion('viva', 'en linea');
    detenerPolling();
    // Recuperamos lo que nos perdimos mientras estabamos desconectados.
    sincronizarMensajes();
  });

  socket.addEventListener('message', (evento) => {
    let datos;
    try { datos = JSON.parse(evento.data); } catch { return; }
    if (datos.tipo === 'mensaje') pintarMensaje(datos.mensaje);
    if (datos.tipo === 'listo' && datos.persona) aplicarPersona(datos.persona);

    // El servidor descarto el mensaje por ir demasiado rapido. Se avisa como
    // mensaje de sistema, dentro de la conversacion, para que la persona sepa
    // que ESE mensaje no llego — callarlo seria peor que el limite.
    if (datos.tipo === 'lento') {
      pintarAvisoSistema(datos.mensaje || 'Vas muy rapido. Espera un momento.');
    }
    // Las coordenadas llegan desde la OTRA ventana (la segura). Reflejamos el
    // cambio aqui para que la persona vea que si llegaron.
    if (datos.tipo === 'ubicacion') {
      if (persona) persona.ubicacion = datos.ubicacion;
      $('#campoUbicacion').value = datos.ubicacion || '';
      // Llego lo que el panel pedia: se cierra solo y deja ver el mensaje de
      // sistema que confirma el envio.
      cerrarPanel('panelGps');
    }
  });

  socket.addEventListener('close', () => {
    marcarConexion('lenta', 'reconectando');
    caerAPolling();
    // Backoff suave: hasta 15 s. En una red congestionada insistir empeora todo.
    const espera = Math.min(1000 * 2 ** reintentos++, 15000);
    setTimeout(conectarWebSocket, espera);
  });

  socket.addEventListener('error', () => { try { socket.close(); } catch { /* ya cerrado */ } });
}

function caerAPolling() {
  if (temporizadorPolling) return;
  marcarConexion('lenta', 'modo lento');
  temporizadorPolling = setInterval(sincronizarMensajes, 3000);
}

function detenerPolling() {
  clearInterval(temporizadorPolling);
  temporizadorPolling = null;
}

/* ---------------- Mensajes ---------------- */

async function sincronizarMensajes() {
  try {
    const respuesta = await fetch(`/api/mensajes?desde=${ultimoId}&t=${encodeURIComponent(token)}`, {
      headers: { Accept: 'application/json' },
    });
    if (!respuesta.ok) {
      if (respuesta.status === 404) location.replace('/');
      return;
    }
    const { mensajes } = await respuesta.json();
    for (const mensaje of mensajes) pintarMensaje(mensaje);
    if (temporizadorPolling) marcarConexion('lenta', 'modo lento');
  } catch {
    marcarConexion('muerta', 'sin senal');
  }
}

function pintarMensaje(mensaje) {
  if (!mensaje || mensaje.id <= ultimoId) return; // el WS y el polling se solapan
  ultimoId = mensaje.id;

  const lista = $('#listaMensajes');
  const marcador = lista.querySelector('.cargando');
  if (marcador) marcador.remove();

  const claseDireccion =
    mensaje.direccion === 'persona' ? 'mia' :
    mensaje.direccion === 'difusion' ? 'difusion' :
    mensaje.direccion === 'sistema' ? 'sistema' : 'operador';

  const burbuja = document.createElement('div');
  burbuja.className = `burbuja ${claseDireccion}`;

  if (mensaje.direccion === 'sistema') {
    burbuja.textContent = mensaje.texto;
  } else {
    if (mensaje.direccion !== 'persona') {
      const autor = document.createElement('span');
      autor.className = 'autor';
      autor.textContent = mensaje.direccion === 'difusion'
        ? `AVISO GENERAL · ${mensaje.autor || ''}`
        : (mensaje.autor || 'Puesto de mando');
      burbuja.appendChild(autor);
    }
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

  const pegadoAbajo = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 120;
  lista.appendChild(burbuja);
  if (pegadoAbajo) lista.scrollTop = lista.scrollHeight;
}

/**
 * Aviso del sistema en el hilo, sin pasar por la base. Se usa para lo que la
 * persona necesita saber en el momento y no forma parte de la conversacion
 * con el puesto de mando.
 */
function pintarAvisoSistema(texto) {
  const lista = $('#listaMensajes');
  const burbuja = document.createElement('div');
  burbuja.className = 'burbuja sistema';
  burbuja.textContent = texto;
  lista.appendChild(burbuja);
  lista.scrollTop = lista.scrollHeight;
}

function enviarMensaje(texto) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ tipo: 'mensaje', texto }));
    return;
  }
  fetch('/api/mensajes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ texto, token }),
  })
    .then(() => sincronizarMensajes())
    .catch(() => marcarConexion('muerta', 'no se envio'));
}

function enviarDelCampo() {
  const campo = $('#campoMensaje');
  const texto = campo.value.trim();
  if (!texto) return;
  enviarMensaje(texto);
  campo.value = '';
  campo.style.height = 'auto';
  campo.focus();
}

$('#formMensaje').addEventListener('submit', (evento) => {
  evento.preventDefault();
  enviarDelCampo();
});

/**
 * Enter envia, Shift+Enter hace salto de linea.
 *
 * Llamamos a enviarDelCampo() en vez de form.requestSubmit(): ese metodo no
 * existe en Safari anterior al 16 y ahi el Enter se quedaba muerto sin dar
 * ninguna senal. Esto funciona en cualquier navegador.
 *
 * isComposing evita tragarse el Enter que cierra un acento o una dieresis.
 */
$('#campoMensaje').addEventListener('keydown', (evento) => {
  if (evento.key !== 'Enter' || evento.shiftKey) return;
  if (evento.isComposing || evento.keyCode === 229) return;
  evento.preventDefault();
  enviarDelCampo();
});

$('#campoMensaje').addEventListener('input', (evento) => {
  evento.target.style.height = 'auto';
  evento.target.style.height = Math.min(evento.target.scrollHeight, 140) + 'px';
});

/* ---------------- Paneles plegables ----------------
 *
 * Dos paneles ("Mi estado" y "Enviar mi ubicacion") que se abren sobre el
 * chat. Solo uno a la vez: abrir el segundo cierra el primero, para que no se
 * coman la lista de mensajes entre los dos.
 *
 * Salir tiene que ser tan facil como entrar. Se puede cerrar con la X, con el
 * mismo boton que lo abrio y con Escape. En la version anterior el unico
 * camino era volver a pulsar un boton que ya no decia lo que hacia, y la
 * gente se quedaba atascada dentro del panel.
 */

const PANELES = {
  panelEstado: '#btnEstado',
  panelGps: '#btnUbicacion',
};

function cerrarPanel(id) {
  const panel = document.getElementById(id);
  if (!panel || panel.hidden) return;
  panel.hidden = true;
  const boton = $(PANELES[id]);
  if (boton) {
    boton.setAttribute('aria-expanded', 'false');
    if (boton.dataset.textoOriginal) boton.textContent = boton.dataset.textoOriginal;
  }
}

function alternarPanel(id) {
  const panel = document.getElementById(id);
  if (!panel) return;
  const seVaAAbrir = panel.hidden;

  for (const otro of Object.keys(PANELES)) cerrarPanel(otro);
  if (!seVaAAbrir) return;

  panel.hidden = false;
  const boton = $(PANELES[id]);
  if (boton) {
    boton.setAttribute('aria-expanded', 'true');
    // Solo el boton de la cabecera cambia de texto: el de la barra es un icono
    // y quedarse sin el pin lo volveria irreconocible.
    if (boton.id === 'btnEstado') {
      boton.dataset.textoOriginal = boton.dataset.textoOriginal || boton.textContent;
      boton.textContent = 'Cerrar';
    }
  }
  panel.scrollIntoView({ block: 'nearest' });
  panel.querySelector('.cerrar-panel')?.focus({ preventScroll: true });
}

$('#btnEstado').addEventListener('click', () => alternarPanel('panelEstado'));

$('#btnUbicacion').addEventListener('click', () => {
  // El widget se monta al abrir y no antes: necesita la config del servidor,
  // que puede tardar en llegar en una red saturada.
  if (configServidor) montarBotonGps($('#zonaGpsChat'), token, configServidor);
  alternarPanel('panelGps');
});

for (const boton of document.querySelectorAll('.cerrar-panel')) {
  boton.addEventListener('click', () => cerrarPanel(boton.dataset.cierra));
}

document.addEventListener('keydown', (evento) => {
  if (evento.key !== 'Escape') return;
  for (const id of Object.keys(PANELES)) cerrarPanel(id);
});

function pintarPanelEstado() {
  if (!configServidor || !persona) return;

  $('#listaEstados').innerHTML = configServidor.estados
    .map((e) => `
      <label class="estado-op" data-estado="${e.clave}">
        <input type="radio" name="estado" value="${e.clave}" ${e.clave === persona.estado ? 'checked' : ''}>
        <span class="cuerpo"><span class="punto"></span><span class="texto">${e.etiqueta}</span></span>
      </label>`)
    .join('');

  const etiquetas = {
    agua: 'Agua', comida: 'Comida', medicina: 'Medicina', abrigo: 'Abrigo',
    rescate: 'Rescate', transporte: 'Transporte', carga: 'Cargar celular',
  };
  $('#listaNecesidades').innerHTML = configServidor.necesidades
    .map((n) => `
      <label class="chip">
        <input type="checkbox" value="${n}" ${persona.necesidades.includes(n) ? 'checked' : ''}>
        <span class="cuerpo">${etiquetas[n] || n}</span>
      </label>`)
    .join('');

  $('#campoUbicacion').value = persona.ubicacion || '';
}

$('#btnGuardarEstado').addEventListener('click', async () => {
  const boton = $('#btnGuardarEstado');
  boton.disabled = true;
  boton.textContent = 'Guardando...';

  const estado = document.querySelector('#listaEstados input:checked')?.value;
  const necesidades = [...document.querySelectorAll('#listaNecesidades input:checked')].map((i) => i.value);

  try {
    const respuesta = await fetch('/api/yo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token, estado, necesidades, ubicacion: $('#campoUbicacion').value }),
    });
    const cuerpo = await respuesta.json();
    aplicarPersona(cuerpo.persona);
    cerrarPanel('panelEstado');
    enviarMensaje(`[Actualice mi estado: ${cuerpo.persona.estadoEtiqueta}${
      necesidades.length ? ' · necesito ' + necesidades.join(', ') : ''
    }]`);
  } catch {
    alert('No se pudo guardar. Revisa que sigas conectado al WiFi.');
  } finally {
    boton.disabled = false;
    boton.textContent = 'Guardar y avisar al puesto';
  }
});

/* ---------------- Arranque ---------------- */

function aplicarPersona(nueva) {
  persona = nueva;
  $('#miNombre').textContent = persona.nombre;
  $('#miCodigo').textContent = persona.codigo;
  pintarPanelEstado();
}

async function arrancar() {
  try {
    const [respConfig, respYo] = await Promise.all([
      fetch('/api/config', { headers: { Accept: 'application/json' } }),
      fetch(`/api/yo?t=${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' } }),
    ]);

    if (!respYo.ok) return location.replace('/');

    configServidor = await respConfig.json();
    $('#tituloChat').textContent = configServidor.puesto;
    aplicarPersona((await respYo.json()).persona);
    // Se monta al arrancar, no al abrir el panel: asi el primer toque del boton
    // ya encuentra el contenido listo en vez de un panel vacio.
    montarBotonGps($('#zonaGpsChat'), token, configServidor);
    montarAvisoNavegador($('#zonaNavegador'), configServidor, { codigo: persona?.codigo });

    $('#listaMensajes').innerHTML = '';
    await sincronizarMensajes();
    conectarWebSocket();
  } catch {
    marcarConexion('muerta', 'sin senal');
    caerAPolling();
  }
}

// Al volver del segundo plano el WebSocket suele estar muerto sin avisar.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') sincronizarMensajes();
});

arrancar();
