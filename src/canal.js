'use strict';

/**
 * Estado del canal cifrado, compartido por HTTP y WebSocket.
 *
 * Vive en su propio modulo para que ws.js pueda consultarlo sin depender de
 * http.js, que a su vez ya depende de ws.js: hacerlo directo seria un ciclo.
 *
 * ------------------------------------------------------------------
 * Por que existe
 *
 * La consola de operador se servia por HTTPS pero seguia estando disponible
 * por HTTP "como respaldo". El resultado practico es que no se imponia nada:
 * basta que alguien teclee la direccion sin la ese —de memoria, de un marcador
 * viejo, del cartel impreso— para que el PIN y la sesion viajen en claro por
 * una red abierta, y nadie se entera.
 *
 * ------------------------------------------------------------------
 * Que hace ahora
 *
 * Cuando el canal cifrado esta arriba, el plano de administracion SOLO existe
 * ahi: la pagina del operador se redirige y las rutas /admin/* se rechazan.
 *
 * Cuando NO esta arriba —el certificado fallo, el puerto estaba ocupado— todo
 * sigue funcionando por HTTP. Esa es la parte que no se negocia: quedarse sin
 * consola en mitad de una emergencia es peor que cualquier escucha.
 *
 * ------------------------------------------------------------------
 * Limite honesto
 *
 * Una redireccion protege del descuido y de la captura pasiva, que es el
 * ataque realista en un WiFi abierto. NO protege de un intermediario activo:
 * quien controle la red puede quitar la redireccion y, si el operador ya esta
 * acostumbrado a aceptar el aviso del certificado, aceptaria tambien uno
 * suplantado. Es subir el liston, no cerrar la puerta.
 */

/** URL del canal cifrado, o null si no llego a levantarse. */
let urlSegura = null;

/**
 * Valvula de escape: SOS_ADMIN_HTTP=1 deja el plano de administracion
 * accesible tambien sin cifrar. Existe porque en terreno puede aparecer un
 * equipo donde el aviso del certificado no haya forma de aceptarlo —un
 * navegador corporativo bloqueado, un sistema muy viejo— y ahi es preferible
 * una consola sin cifrar a ninguna consola.
 */
const PERMITE_HTTP =
  process.env.SOS_ADMIN_HTTP === '1' || process.argv.includes('--admin-http');

function fijarCanalSeguro(url) {
  urlSegura = url || null;
}

function canalSeguro() {
  return urlSegura;
}

/**
 * ¿Hay que exigir cifrado en el plano de administracion? Solo si el canal
 * seguro esta realmente arriba y no se pidio lo contrario.
 */
function exigeCifrado() {
  return Boolean(urlSegura) && !PERMITE_HTTP;
}

/** ¿Llego esta peticion (o este socket) por el canal cifrado? */
function esSegura(req) {
  return Boolean(req?.secure || req?.socket?.encrypted || req?.connection?.encrypted);
}

module.exports = { fijarCanalSeguro, canalSeguro, exigeCifrado, esSegura, PERMITE_HTTP };
