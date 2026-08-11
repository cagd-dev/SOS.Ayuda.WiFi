'use strict';

/**
 * Aviso y salida del mini-navegador del portal cautivo.
 *
 * Cuando el telefono abre solo la ventanita de "Iniciar sesion en la red", eso
 * NO es Chrome ni Safari: es una ventana del sistema que se cierra sola cuando
 * al telefono le da la gana, y que no comparte cookies con el navegador real.
 *
 * No existe forma fiable de saltar de ahi al navegador de verdad: el sistema
 * lo aisla a proposito. En Android lo intentamos con un enlace intent:// y, si
 * no pasa nada, mostramos los pasos a mano. En iPhone no hay truco que
 * funcione, asi que vamos directo a las instrucciones.
 *
 * Lo importante es que perder esta ventana ya NO cuesta la sesion: el servidor
 * reconoce el telefono por su MAC.
 */

function montarAvisoNavegador(contenedor, configServidor, opciones = {}) {
  if (!contenedor || contenedor.dataset.avisoMontado) return;
  if (!esMiniNavegador(configServidor)) return;

  contenedor.dataset.avisoMontado = '1';

  const direccion = (configServidor?.urlBase || location.origin).replace(/^https?:\/\//, '');
  const esAndroid = /Android/i.test(navigator.userAgent);

  const bloque = document.createElement('section');
  bloque.className = 'aviso fuerte';
  bloque.style.marginTop = '1rem';
  bloque.innerHTML = `
    <h2>Estas en la ventana de conexion</h2>
    <p style="margin-bottom:.6rem">
      Esta ventanita <strong>puede cerrarse sola</strong>. Para que no te pase,
      pasate a tu navegador normal.
    </p>
    <p class="direccion-portal" id="direccionPortal">${escaparTexto(direccion)}</p>
    <div class="botones-navegador">
      <button type="button" class="boton" id="btnAbrirNavegador">Abrir en mi navegador</button>
      <button type="button" class="boton secundario chico" id="btnCopiarDireccion">Copiar direccion</button>
    </div>
    <div id="pasosNavegador" hidden style="margin-top:.75rem">
      <p style="font-weight:700;margin-bottom:.35rem">Hazlo a mano:</p>
      <ol style="padding-left:1.2rem;margin:0">
        ${esAndroid
          ? `<li>Pulsa el boton de <strong>Inicio</strong> del telefono.</li>
             <li>Abre <strong>Chrome</strong>.</li>`
          : `<li>Cierra esta ventana con <strong>Cancelar</strong> o <strong>Listo</strong>, arriba.</li>
             <li>Abre <strong>Safari</strong>.</li>`}
        <li>Escribe: <strong>${escaparTexto(direccion)}</strong></li>
      </ol>
      <p style="margin:.6rem 0 0;font-size:.9em">
        Si te aparece "seguir conectado a una red sin internet", responde que <strong>SI</strong>.
      </p>
    </div>
    <p style="margin:.75rem 0 0;font-size:.9em">
      <strong>No pierdes nada si se cierra.</strong> Te reconocemos por tu telefono
      y recuperas tu chat solo${opciones.codigo ? `, o con tu codigo ${escaparTexto(opciones.codigo)}` : ''}.
    </p>`;

  contenedor.appendChild(bloque);

  const pasos = bloque.querySelector('#pasosNavegador');

  bloque.querySelector('#btnAbrirNavegador').addEventListener('click', () => {
    if (esAndroid) {
      // Si la WebView no maneja intent:// no pasa absolutamente nada, asi que
      // destapamos los pasos manuales al poco rato y siempre hay salida.
      try {
        location.href =
          `intent://${direccion}/#Intent;scheme=http;action=android.intent.action.VIEW;end`;
      } catch { /* la WebView lo rechazo */ }
      setTimeout(() => { pasos.hidden = false; }, 1200);
    } else {
      pasos.hidden = false;
    }
  });

  bloque.querySelector('#btnCopiarDireccion').addEventListener('click', (evento) => {
    copiar(`http://${direccion}`, evento.target);
    pasos.hidden = false;
  });
}

function esMiniNavegador(configServidor) {
  // El servidor lo decide mirando el User-Agent completo; aqui solo repetimos
  // la comprobacion por si /api/config no llego.
  if (configServidor && typeof configServidor.miniNavegador === 'boolean') {
    return configServidor.miniNavegador;
  }
  const ua = navigator.userAgent || '';
  if (/;\s*wv\)/i.test(ua)) return true;
  if (/iPhone|iPad|iPod/i.test(ua) && /AppleWebKit/i.test(ua) && !/Safari\//i.test(ua)) return true;
  return false;
}

/**
 * navigator.clipboard no existe fuera de contexto seguro, y el portal va por
 * HTTP. Caemos al metodo viejo, que en estas ventanas sigue funcionando.
 */
function copiar(texto, boton) {
  const original = boton.textContent;
  let bien = false;

  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    area.setSelectionRange(0, texto.length);
    bien = document.execCommand('copy');
    document.body.removeChild(area);
  } catch {
    bien = false;
  }

  boton.textContent = bien ? 'Direccion copiada' : 'Copiala a mano';
  setTimeout(() => { boton.textContent = original; }, 2500);
}

function escaparTexto(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}
