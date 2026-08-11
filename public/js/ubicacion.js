'use strict';

/**
 * Pagina que corre en el canal HTTPS. Su unica razon de existir es que aqui SI
 * hay contexto seguro, y por tanto el navegador entrega el GPS.
 *
 * La persona ya esta registrada: llega con su token en la URL. Esta pagina no
 * la registra ni la deja chatear, solo enriquece su ficha con las coordenadas.
 */

const $ = (sel) => document.querySelector(sel);

const token = new URLSearchParams(location.search).get('t');

let cuentaAtras = null;

function mostrar(id) {
  for (const seccion of ['#pasoPedir', '#pasoBuscando', '#pasoListo', '#pasoFallo']) {
    $(seccion).hidden = seccion !== id;
  }
}

if (!token) {
  mostrar('#pasoFallo');
  $('#mensajeFallo').textContent =
    'Falta tu identificacion. Vuelve al chat y toca de nuevo el boton de ubicacion.';
  $('#btnReintentar').hidden = true;
}

function pedirUbicacion() {
  if (!navigator.geolocation) {
    return fallar('Este telefono no expone el GPS al navegador.', false);
  }

  mostrar('#pasoBuscando');

  // Cuenta atras visible: sin ella la gente cree que se colgo y cierra.
  let restante = 30;
  $('#contador').textContent = restante;
  clearInterval(cuentaAtras);
  cuentaAtras = setInterval(() => {
    restante -= 1;
    $('#contador').textContent = Math.max(restante, 0);
  }, 1000);

  navigator.geolocation.getCurrentPosition(enviar, manejarFallo, {
    enableHighAccuracy: true,
    timeout: 30000,
    maximumAge: 0,
  });
}

async function enviar(posicion) {
  clearInterval(cuentaAtras);
  const { latitude, longitude, accuracy } = posicion.coords;

  try {
    const respuesta = await fetch('/api/ubicacion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ token, lat: latitude, lon: longitude, precision: accuracy }),
    });
    const cuerpo = await respuesta.json();
    if (!respuesta.ok) throw new Error(cuerpo.error || 'No se pudo enviar');

    $('#coordenadas').textContent = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    $('#precision').textContent = `Precision aproximada: ${Math.round(accuracy)} metros`;
    mostrar('#pasoListo');
  } catch (err) {
    fallar(
      `Leimos tu ubicacion pero no pudimos enviarla (${err.message}). ` +
      'Revisa que sigas conectado al WiFi de emergencia.',
      true
    );
  }
}

function manejarFallo(fallo) {
  clearInterval(cuentaAtras);

  if (fallo.code === 1) {
    return fallar('Tocaste "No permitir".', true, `
      <p>Para volver a intentarlo tienes que darle permiso al navegador:</p>
      <ul style="padding-left:1.1rem">
        <li><strong>iPhone:</strong> Ajustes → Safari → Ubicacion → Preguntar o Permitir.</li>
        <li><strong>Android:</strong> toca el candado o el icono junto a la direccion,
            entra a Permisos y activa Ubicacion.</li>
      </ul>
      <p>Tambien revisa que el <strong>GPS del telefono</strong> este encendido.</p>`);
  }

  if (fallo.code === 3) {
    return fallar('El GPS tardo demasiado en fijar la senal.', true, `
      <p>Suele pasar bajo techo o entre paredes gruesas. Acercate a una ventana o
      sal a un espacio abierto y reintenta.</p>`);
  }

  return fallar('No hay senal de GPS disponible.', true, `
    <p>Revisa que la <strong>ubicacion del telefono</strong> este encendida
    (el interruptor de GPS, no el del WiFi) y reintenta desde un sitio mas abierto.</p>`);
}

function fallar(mensaje, puedeReintentar, ayudaHtml = '') {
  $('#mensajeFallo').textContent = mensaje;
  $('#ayudaFallo').innerHTML = ayudaHtml;
  $('#btnReintentar').hidden = !puedeReintentar;
  mostrar('#pasoFallo');
}

$('#btnPedir').addEventListener('click', pedirUbicacion);
$('#btnReintentar').addEventListener('click', pedirUbicacion);
$('#btnReenviar').addEventListener('click', pedirUbicacion);
