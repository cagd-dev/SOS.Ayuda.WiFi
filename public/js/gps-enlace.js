'use strict';

/**
 * Widget compartido por el portal y el chat: el camino guiado hacia el GPS.
 *
 * El problema que resuelve: la ventana segura muestra un aviso de certificado
 * que asusta. Si la persona lo ve sin contexto, se devuelve. Asi que primero
 * le explicamos exactamente que va a ver y que boton tocar en SU navegador, y
 * solo despues abrimos la ventana.
 *
 * Uso:  montarBotonGps(document.querySelector('#donde'), token, config);
 */

function montarBotonGps(contenedor, token, configServidor) {
  if (!contenedor || contenedor.dataset.gpsMontado) return;
  contenedor.dataset.gpsMontado = '1';
  contenedor.innerHTML = '';

  /**
   * En la ventanita del portal cautivo NO hay GPS. No es un permiso que falte:
   * el sistema —en iPhone sobre todo— simplemente no expone la ubicacion a esa
   * WebView. Ofrecer aqui el boton manda a la persona a intentarlo, fallar sin
   * explicacion y rendirse.
   *
   * Se le dice lo que si funciona: salir al navegador normal, donde el GPS va.
   */
  if (typeof esMiniNavegador === 'function' && esMiniNavegador(configServidor)) {
    contenedor.appendChild(bloqueSalirPrimero(configServidor));
    return;
  }

  // Sin canal seguro no hay GPS posible: mostramos el camino manual y ya.
  if (!configServidor || !configServidor.urlSegura) {
    contenedor.appendChild(bloqueManual());
    return;
  }

  const destino = `${configServidor.urlSegura}/ubicacion.html?t=${encodeURIComponent(token)}`;

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'boton';
  boton.textContent = 'Enviar mi ubicacion exacta (GPS)';

  const explicacion = document.createElement('div');
  explicacion.hidden = true;
  explicacion.className = 'tarjeta';
  explicacion.style.marginTop = '.75rem';
  explicacion.innerHTML = `
    <h2>Antes de abrir, lee esto</h2>
    <p>Vamos a abrir una ventana aparte. <strong>Va a salir un aviso de seguridad.
    Es normal aqui</strong> y tienes que continuar.</p>

    <div class="mock-aviso">
      <div class="mock-titulo">La conexion no es privada</div>
      <div class="mock-texto">Es posible que atacantes esten intentando robar tu informacion...</div>
      <div class="mock-botones"><span>Volver</span><span class="mock-clave">Configuracion avanzada</span></div>
    </div>

    <p style="font-size:.92rem">
      <strong>Por que sale:</strong> esta red no tiene internet, asi que no podemos
      obtener el sello oficial que reconocen los navegadores. La ventana es del
      mismo puesto de mando al que ya estas conectado.
    </p>

    <p style="font-weight:700;margin-bottom:.4rem">Que tocar segun tu telefono:</p>
    <div class="pasos-navegador">
      <div>
        <strong>Android / Chrome</strong>
        <span>"Configuracion avanzada" → "Acceder a ${escaparTexto(configServidor.urlSegura.replace('https://', ''))} (sitio no seguro)"</span>
      </div>
      <div>
        <strong>iPhone / Safari</strong>
        <span>"Mostrar detalles" → "visitar este sitio web" → "Visitar"</span>
      </div>
      <div>
        <strong>Firefox</strong>
        <span>"Avanzado..." → "Aceptar el riesgo y continuar"</span>
      </div>
    </div>

    <p style="font-size:.92rem;color:var(--texto-suave)">
      Despues te va a preguntar si permites la ubicacion. Responde
      <strong>Permitir</strong>. Tu registro ya esta guardado: si algo sale mal,
      no pierdes nada.
    </p>
  `;

  const abrir = document.createElement('button');
  abrir.type = 'button';
  abrir.className = 'boton';
  abrir.textContent = 'Entendido, abrir la ventana';

  const enlaceRespaldo = document.createElement('p');
  enlaceRespaldo.hidden = true;
  enlaceRespaldo.className = 'aviso';
  enlaceRespaldo.style.marginTop = '.75rem';

  const rendirse = document.createElement('button');
  rendirse.type = 'button';
  rendirse.className = 'boton secundario';
  rendirse.style.marginTop = '.5rem';
  rendirse.textContent = 'Mejor no, escribo la direccion';

  boton.addEventListener('click', () => {
    boton.hidden = true;
    explicacion.hidden = false;
  });

  abrir.addEventListener('click', () => {
    const ventana = window.open(destino, '_blank');
    // En el navegador del portal cautivo window.open suele venir bloqueado.
    // Entonces damos el enlace para que lo toque a mano.
    if (!ventana) {
      enlaceRespaldo.hidden = false;
      enlaceRespaldo.innerHTML =
        'Tu navegador bloqueo la ventana. Toca este enlace: ' +
        `<a href="${escaparTexto(destino)}" target="_blank" rel="noopener" style="color:var(--info);word-break:break-all">${escaparTexto(destino)}</a>`;
    }
  });

  rendirse.addEventListener('click', () => {
    explicacion.hidden = true;
    contenedor.appendChild(bloqueManual());
    rendirse.remove();
    abrir.remove();
  });

  explicacion.appendChild(abrir);
  explicacion.appendChild(rendirse);
  explicacion.appendChild(enlaceRespaldo);
  contenedor.appendChild(boton);
  contenedor.appendChild(explicacion);
}

/**
 * Estamos en la ventanita del portal: el GPS no existe aqui. En vez de un
 * boton que va a fallar, la salida — y debajo, el camino manual, que si
 * funciona en cualquier sitio.
 */
function bloqueSalirPrimero(configServidor) {
  const direccion = (configServidor?.urlBase || location.origin).replace(/^https?:\/\//, '');
  const bloque = document.createElement('div');
  bloque.innerHTML = `
    <div class="aviso" style="margin-bottom:.6rem">
      <strong>Para mandar tu ubicacion necesitas tu navegador normal.</strong>
      Esta ventana de conexion del telefono no da acceso al GPS — no es algo que
      puedas activar, el sistema no lo permite aqui.
      <p style="margin:.5rem 0 0">
        Usa el boton <strong>"Salir a mi navegador"</strong> de arriba, y una vez
        en Chrome o Safari entra a <strong>${escaparTexto(direccion)}</strong> y
        vuelve a intentarlo desde el chat.
      </p>
    </div>`;
  bloque.appendChild(bloqueManual());
  return bloque;
}

/** Camino sin GPS: copiar coordenadas a mano. Funciona siempre. */
function bloqueManual() {
  const bloque = document.createElement('div');
  bloque.className = 'aviso';
  bloque.style.marginTop = '.6rem';
  bloque.innerHTML = `
    <strong>Copia tus coordenadas a mano.</strong>
    Funciona sin internet y sin permisos.
    <ul style="margin:.5rem 0 0;padding-left:1.1rem">
      <li><strong>iPhone:</strong> abre la app <strong>Brujula</strong>.
          Las coordenadas salen abajo.</li>
      <li><strong>Android:</strong> abre <strong>Google Maps</strong> y manten
          pulsado tu punto azul. Salen en la barra de busqueda.</li>
    </ul>
    <span style="display:block;margin-top:.5rem;font-size:.85em">
      Si no puedes, describe el sitio: barrio, calle, piso y algo que se vea
      desde afuera.
    </span>`;
  return bloque;
}

function escaparTexto(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}
