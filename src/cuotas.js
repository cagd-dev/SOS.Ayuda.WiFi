'use strict';

/**
 * Cuotas por dispositivo, compartidas por HTTP y WebSocket.
 *
 * Vive en su propio modulo por una razon concreta: el chat tiene DOS carriles
 * —POST /api/mensajes y el socket— y si cada uno llevara su propia cuenta,
 * bastaria con alternar entre los dos para tener el doble de presupuesto. Con
 * un unico almacen, el limite es el mismo se entre por donde se entre.
 *
 * Criterio general del proyecto: NO es un bloqueo global. Dejar fuera a quien
 * pide ayuda —o al operador— seria mucho peor que el abuso que se evita. Los
 * limites son altos a proposito, porque en una emergencia la gente escribe a
 * rafagas, y lo que se hace al superarlos es frenar, no expulsar.
 */

const contadores = new Map();

/**
 * Ventana fija por clave. Devuelve si se permite y cuanto falta para que se
 * reabra la ventana.
 */
function limitar({ clave, maximo, ventana }) {
  const ahoraMs = Date.now();
  const registro = contadores.get(clave);

  if (!registro || ahoraMs > registro.hasta) {
    contadores.set(clave, { cuenta: 1, hasta: ahoraMs + ventana });
    return { permitido: true, restante: maximo - 1 };
  }

  registro.cuenta += 1;
  if (registro.cuenta > maximo) {
    return {
      permitido: false,
      esperar: Math.ceil((registro.hasta - ahoraMs) / 1000),
      exceso: registro.cuenta - maximo,
    };
  }
  return { permitido: true, restante: maximo - registro.cuenta };
}

/** Cuantas veces se ha contado esa clave en la ventana viva. Para diagnostico. */
function cuentaDe(clave) {
  const registro = contadores.get(clave);
  if (!registro || Date.now() > registro.hasta) return 0;
  return registro.cuenta;
}

function olvidar(clave) {
  contadores.delete(clave);
}

/** Limpieza periodica: sin esto el mapa crece con cada IP que pasa. */
const barrido = setInterval(() => {
  const ahoraMs = Date.now();
  for (const [clave, registro] of contadores) {
    if (ahoraMs > registro.hasta) contadores.delete(clave);
  }
}, 60_000);
barrido.unref?.();

module.exports = { limitar, cuentaDe, olvidar };
