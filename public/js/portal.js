'use strict';

/**
 * Portal de registro. Corre dentro del mini-navegador del portal cautivo, que
 * es un entorno hostil: sin service workers, a veces sin WebSocket, y en iOS
 * se cierra solo cuando el sistema decide que "ya hay internet". Por eso:
 *   - nada de dependencias externas,
 *   - el formulario tambien funciona sin JavaScript (POST nativo),
 *   - al terminar mostramos el codigo Y la URL para reabrir desde el navegador.
 */

const $ = (sel) => document.querySelector(sel);

const almacen = {
  guardar(clave, valor) {
    try { localStorage.setItem(clave, valor); } catch { /* modo privado */ }
  },
  leer(clave) {
    try { return localStorage.getItem(clave); } catch { return null; }
  },
};

let configServidor = null;

async function cargarConfig() {
  try {
    const respuesta = await fetch('/api/config', { headers: { Accept: 'application/json' } });
    configServidor = await respuesta.json();
    $('#nombrePuesto').textContent = configServidor.puesto;
    $('#avisoBienvenida').textContent = configServidor.bienvenida;
    $('#urlManual').textContent = configServidor.urlBase;
  } catch { /* sin config seguimos: el HTML ya trae valores por defecto */ }
}

/** Si ya hay sesion guardada, saltamos directo al chat. */
async function revisarSesionPrevia() {
  const token = almacen.leer('sos_token');
  const url = token ? `/api/yo?t=${encodeURIComponent(token)}` : '/api/yo';
  try {
    const respuesta = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!respuesta.ok) return false;
    const { persona } = await respuesta.json();
    irAlChat(persona);
    return true;
  } catch {
    return false;
  }
}

function irAlChat(persona) {
  almacen.guardar('sos_token', persona.token);
  window.location.href = `/chat.html?t=${encodeURIComponent(persona.token)}`;
}

function mostrarPaso(id) {
  for (const seccion of ['#pasoRegistro', '#pasoRecuperar', '#pasoListo']) {
    $(seccion).hidden = seccion !== id;
  }
  window.scrollTo(0, 0);
}

/* ---------------- GPS ---------------- */

/**
 * IMPORTANTE: los navegadores solo entregan la ubicacion en "contexto seguro"
 * (HTTPS o localhost). Nuestro portal es HTTP puro sobre una IP local, porque en
 * terreno no hay autoridad certificadora que firme un certificado valido.
 *
 * Consecuencia: en los celulares el navegador bloquea el GPS sin ni siquiera
 * preguntarle al usuario. En vez de mostrar un boton que va a fallar siempre,
 * detectamos el caso y explicamos como copiar las coordenadas a mano.
 */
if (!window.isSecureContext || !navigator.geolocation) {
  mostrarComoCopiarCoordenadas();
} else {
  $('#btnGps').addEventListener('click', pedirUbicacion);
}

function pedirUbicacion() {
  const boton = $('#btnGps');
  boton.disabled = true;
  boton.textContent = 'Buscando senal GPS...';

  navigator.geolocation.getCurrentPosition(
    (posicion) => {
      const { latitude, longitude, accuracy } = posicion.coords;
      const campo = $('#ubicacion');
      const coordenadas = `GPS: ${latitude.toFixed(6)}, ${longitude.toFixed(6)} (+/- ${Math.round(accuracy)} m)`;
      campo.value = campo.value ? `${campo.value}\n${coordenadas}` : coordenadas;
      boton.textContent = 'Ubicacion GPS agregada';
      boton.disabled = false;
    },
    (fallo) => {
      boton.disabled = false;
      // Distinguir la causa importa: cada una se arregla distinto.
      if (fallo.code === 1) {
        boton.textContent = 'Diste permiso denegado. Revisa los permisos del navegador.';
        mostrarComoCopiarCoordenadas();
      } else if (fallo.code === 3) {
        boton.textContent = 'El GPS tardo demasiado. Toca para reintentar.';
      } else {
        boton.textContent = 'Sin senal GPS. Sal a un espacio abierto y reintenta.';
        mostrarComoCopiarCoordenadas();
      }
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 }
  );
}

/** Camino manual: funciona siempre, sin internet y sin permisos del navegador. */
function mostrarComoCopiarCoordenadas() {
  const zona = $('#zonaGps');
  if (zona.dataset.ayudaPuesta) return;
  zona.dataset.ayudaPuesta = '1';

  const boton = $('#btnGps');
  if (boton && !window.isSecureContext) boton.remove();

  const ayuda = document.createElement('div');
  ayuda.className = 'aviso';
  ayuda.style.marginTop = '.6rem';
  ayuda.innerHTML = `
    <strong>Copia tus coordenadas a mano y pegalas arriba.</strong>
    Funciona sin internet y es lo que mas ayuda a los rescatistas.
    <ul style="margin:.5rem 0 0;padding-left:1.1rem">
      <li><strong>iPhone:</strong> abre la app <strong>Brujula</strong>.
          Las coordenadas salen abajo en la pantalla.</li>
      <li><strong>Android:</strong> abre <strong>Google Maps</strong> y manten
          pulsado tu punto azul. Las coordenadas salen en la barra de busqueda.</li>
    </ul>
    <span style="display:block;margin-top:.5rem;font-size:.85em">
      Si no puedes, describe el sitio lo mejor posible: barrio, calle, numero de piso
      y algo que se vea desde afuera.
    </span>
    <span style="display:block;margin-top:.5rem;font-size:.85em">
      <strong>Apenas termines de registrarte</strong> te vamos a ofrecer enviar tu
      GPS exacto por un canal seguro. Ahi si funciona.
    </span>`;
  zona.appendChild(ayuda);
}

/* ---------------- Registro ---------------- */

$('#formRegistro').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const boton = $('#btnRegistrar');
  const error = $('#errorRegistro');
  error.hidden = true;

  const formulario = new FormData(evento.target);
  const datos = Object.fromEntries(formulario.entries());
  datos.necesidades = formulario.getAll('necesidades');

  if (!String(datos.nombre || '').trim()) {
    error.textContent = 'Necesitamos tu nombre para poder ubicarte.';
    error.hidden = false;
    return;
  }

  boton.disabled = true;
  boton.textContent = 'Registrando...';

  try {
    const respuesta = await fetch('/api/registro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(datos),
    });
    const cuerpo = await respuesta.json();
    if (!respuesta.ok) throw new Error(cuerpo.error || 'No pudimos registrarte');

    almacen.guardar('sos_token', cuerpo.persona.token);
    $('#codigoAsignado').textContent = cuerpo.persona.codigo;
    $('#enlaceChat').href = `/chat.html?t=${encodeURIComponent(cuerpo.persona.token)}`;

    // Ahora si tenemos token: se puede ofrecer el camino guiado hacia el GPS.
    montarBotonGps($('#zonaGpsListo'), cuerpo.persona.token, configServidor);
    // Y si estamos en la ventanita del portal cautivo, avisar de que puede
    // cerrarse sola antes de que pase.
    montarAvisoNavegador($('#zonaNavegador'), configServidor, { codigo: cuerpo.persona.codigo });

    mostrarPaso('#pasoListo');
  } catch (err) {
    error.textContent = err.message + ' Revisa que sigas conectado al WiFi de emergencia.';
    error.hidden = false;
    boton.disabled = false;
    boton.textContent = 'Es verdad · Registrarme y pedir ayuda';
  }
});

/* ---------------- Recuperar ---------------- */

$('#btnMostrarRecuperar').addEventListener('click', () => mostrarPaso('#pasoRecuperar'));
$('#btnVolverRegistro').addEventListener('click', () => mostrarPaso('#pasoRegistro'));

$('#btnRecuperar').addEventListener('click', async () => {
  const error = $('#errorRecuperar');
  error.hidden = true;
  try {
    const respuesta = await fetch('/api/recuperar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        codigo: $('#codigoRecuperar').value,
        nombre: $('#nombreRecuperar').value,
      }),
    });
    const cuerpo = await respuesta.json();
    if (!respuesta.ok) throw new Error(cuerpo.error || 'No encontramos ese codigo');
    irAlChat(cuerpo.persona);
  } catch (err) {
    error.textContent = err.message;
    error.hidden = false;
  }
});

/* ---------------- Directorio ---------------- */

let temporizadorBusqueda = null;

$('#buscarDirectorio').addEventListener('input', (evento) => {
  clearTimeout(temporizadorBusqueda);
  const texto = evento.target.value.trim();
  const contenedor = $('#resultadoDirectorio');

  if (texto.length < 2) {
    contenedor.innerHTML = '';
    return;
  }

  temporizadorBusqueda = setTimeout(async () => {
    try {
      const respuesta = await fetch(`/api/directorio?q=${encodeURIComponent(texto)}`, {
        headers: { Accept: 'application/json' },
      });
      const { personas } = await respuesta.json();

      if (!personas.length) {
        contenedor.innerHTML =
          '<p style="color:var(--texto-suave)">Todavia no se ha registrado nadie con ese nombre aqui.</p>';
        return;
      }

      contenedor.innerHTML = personas
        .map((p) => `
          <div style="padding:.6rem 0;border-bottom:1px solid var(--borde)">
            <strong>${escapar(p.nombre)}</strong>
            <span style="color:var(--texto-suave);font-size:.85rem"> · ${escapar(p.codigo)}</span><br>
            <span style="font-size:.85rem;color:var(--texto-suave)">${escapar(p.estadoEtiqueta)}${
              p.acompanantes ? ' · con ' + escapar(p.acompanantes) : ''
            }</span>
          </div>`)
        .join('');
    } catch {
      contenedor.innerHTML = '<p class="error">No se pudo buscar. Revisa la conexion al WiFi.</p>';
    }
  }, 300);
});

function escapar(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

/* ---------------- Reconocer el telefono ---------------- */

/**
 * Ultimo recurso para no perder a nadie: si no hay cookie ni token (tipico al
 * saltar del mini-navegador del portal cautivo a Chrome), le preguntamos al
 * servidor si conoce este telefono por su MAC.
 *
 * Preguntamos en vez de entrar directo porque un mismo telefono lo pueden
 * haber usado dos personas distintas.
 */
async function ofrecerReconocimiento() {
  let datos;
  try {
    const respuesta = await fetch('/api/reconocer', { headers: { Accept: 'application/json' } });
    datos = await respuesta.json();
  } catch {
    return;
  }
  if (!datos.reconocido) return;

  const bloque = $('#bloqueReconocido');
  bloque.innerHTML = `
    <h2>Ya te conocemos</h2>
    <p style="margin:0">
      Desde este telefono se registro <strong>${escapar(datos.nombre)}</strong>
      (codigo ${escapar(datos.codigo)}).
    </p>
    <div class="botones">
      <button type="button" class="boton" id="btnSoyYo">Si, soy yo — abrir mi chat</button>
      <button type="button" class="boton secundario" id="btnNoSoyYo">No, soy otra persona</button>
    </div>`;
  bloque.hidden = false;

  $('#btnSoyYo').addEventListener('click', async () => {
    const boton = $('#btnSoyYo');
    boton.disabled = true;
    boton.textContent = 'Entrando...';
    try {
      const respuesta = await fetch('/api/reconocer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      });
      const cuerpo = await respuesta.json();
      if (!respuesta.ok) throw new Error(cuerpo.error);
      irAlChat(cuerpo.persona);
    } catch {
      boton.disabled = false;
      boton.textContent = 'No se pudo. Registrate de nuevo abajo.';
    }
  });

  $('#btnNoSoyYo').addEventListener('click', () => {
    bloque.hidden = true;
    $('#nombre').focus();
  });
}

/* ---------------- Arranque ---------------- */

async function arrancar() {
  await cargarConfig();
  // Si ya hay sesion en este navegador, se va derecho al chat.
  if (await revisarSesionPrevia()) return;
  await ofrecerReconocimiento();
}

arrancar();
