'use strict';

/**
 * Salida de la ventanita del portal cautivo.
 *
 * Cuando el telefono abre solo "Iniciar sesion en la red", eso NO es Chrome ni
 * Safari: es una WebView del sistema, recortada a proposito.
 *
 * En iPhone (Captive Network Assistant) las limitaciones son duras:
 *   - No se puede saltar a Safari desde dentro. No hay truco.
 *   - NO entrega el GPS. Apple no lo expone ahi, asi que no hay permiso que
 *     pedir ni forma de arreglarlo desde el codigo.
 *   - Y mientras el sistema siga considerando la red "cautiva", cerrar la
 *     ventanita equivale a abandonar el portal: iOS SUELTA el WiFi.
 *
 * Por eso esto ya no es un aviso, es una PUERTA. El servidor libera el
 * dispositivo en cuanto la persona queda registrada; aqui se le pide al
 * sistema que lo compruebe, navegando a su propia sonda de conectividad. El
 * telefono la ve responder "hay internet", cierra la ventanita solo y se queda
 * conectado. A partir de ahi Safari funciona, y con el, el GPS.
 *
 * La version anterior llenaba la pantalla de advertencias sobre lo que podia
 * salir mal y no daba salida a ninguna. En una emergencia eso no es informar,
 * es estorbar.
 */

function montarAvisoNavegador(contenedor, configServidor, opciones = {}) {
  if (!contenedor || contenedor.dataset.avisoMontado) return;
  if (!esMiniNavegador(configServidor)) return;

  contenedor.dataset.avisoMontado = '1';

  const direccion = (configServidor?.urlBase || location.origin).replace(/^https?:\/\//, '');
  const esApple = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  const bloque = document.createElement('section');
  bloque.className = 'aviso';
  bloque.style.marginTop = '.75rem';
  bloque.innerHTML = `
    <p style="margin:0 0 .6rem">
      <strong>Estas en la ventana de conexion del telefono.</strong>
      Aqui no funciona el envio de ubicacion. Sal a tu navegador normal
      cuando termines de registrarte.
    </p>
    <button type="button" class="boton" id="btnSalirPortal">Salir a mi navegador</button>
    <div id="pasosNavegador" hidden style="margin-top:.75rem">
      <p style="font-weight:700;margin:.2rem 0 .35rem">Si no se cerro sola:</p>
      <ol style="padding-left:1.2rem;margin:0">
        ${esApple
          ? `<li>Toca <strong>Cancelar</strong> arriba y elige
               <strong>Usar sin Internet</strong>.
               <em>No toques "Cerrar": eso desconecta el WiFi.</em></li>
             <li>Abre <strong>Safari</strong>.</li>`
          : `<li>Pulsa el boton de <strong>Inicio</strong> del telefono.</li>
             <li>Abre <strong>Chrome</strong>.</li>`}
        <li>Escribe: <strong>${escaparTexto(direccion)}</strong></li>
      </ol>
      <p style="margin:.6rem 0 0">
        <button type="button" class="boton secundario chico" id="btnCopiarDireccion">Copiar direccion</button>
      </p>
    </div>
    <p style="margin:.75rem 0 0;font-size:.9em">
      No pierdes nada al salir: te reconocemos por tu telefono${
        opciones.codigo ? ` y tu codigo es <strong>${escaparTexto(opciones.codigo)}</strong>` : ''
      }.
    </p>`;

  contenedor.appendChild(bloque);

  const pasos = bloque.querySelector('#pasosNavegador');

  bloque.querySelector('#btnSalirPortal').addEventListener('click', async (evento) => {
    const boton = evento.currentTarget;
    boton.disabled = true;
    boton.textContent = 'Preparando la salida...';

    let liberado = false;
    try {
      const respuesta = await fetch('/api/salir', { method: 'POST', headers: { Accept: 'application/json' } });
      liberado = (await respuesta.json()).ok === true;
    } catch { /* sin red: quedan los pasos a mano */ }

    /* NO se navega a ningun sitio.
     *
     * La version anterior mandaba la ventana a la sonda del sistema para
     * forzar la comprobacion. Y funcionaba... pero si el telefono NO cerraba
     * la ventanita, la persona se quedaba mirando la respuesta cruda de la
     * sonda —una pagina en blanco— sin ningun camino de vuelta: al navegar,
     * esta pagina moria y con ella el aviso con los pasos manuales.
     *
     * Ahora solo se libera el dispositivo y se explica que va a pasar. El
     * sistema vuelve a sondear por su cuenta cada pocos segundos, encuentra
     * que "hay internet" y cierra la ventanita el solo. Si no lo hace, los
     * pasos manuales estan aqui mismo, que es donde tienen que estar.
     */
    boton.hidden = true;
    pasos.hidden = false;

    const aviso = document.createElement('p');
    aviso.style.fontWeight = '700';
    aviso.style.margin = '0 0 .5rem';
    aviso.textContent = liberado
      ? 'Listo. Esta ventana se cerrara sola en unos segundos y el WiFi se queda conectado.'
      : 'No se pudo avisar al servidor. Sal a mano con estos pasos:';
    pasos.prepend(aviso);

    bloque.querySelector('#btnCopiarDireccion')
      ?.addEventListener('click', (e) => copiar(`http://${direccion}`, e.target));
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
