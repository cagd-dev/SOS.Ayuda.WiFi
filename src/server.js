'use strict';

/*
 * SOS · Conectate · Pide Ayuda — portal cautivo de emergencia
 * Copyright (C) 2026 Cesar A. Guevara D.
 *
 * Este programa es software libre: puedes redistribuirlo y/o modificarlo bajo
 * los terminos de la Licencia Publica General GNU publicada por la Free
 * Software Foundation, en su version 3 o, a tu eleccion, cualquier version
 * posterior.
 *
 * Se distribuye con la esperanza de que sea util, pero SIN NINGUNA GARANTIA;
 * ni siquiera la garantia implicita de COMERCIABILIDAD o IDONEIDAD PARA UN
 * PROPOSITO PARTICULAR. Consulta la Licencia Publica General GNU para mas
 * detalles: <https://www.gnu.org/licenses/>.
 */

// node:sqlite avisa que es experimental en cada arranque. Lo sabemos y es
// deliberado: nos ahorra compilar modulos nativos en terreno. Silenciamos solo
// ese aviso para que la consola quede limpia y legible bajo presion.
const avisoOriginal = process.emitWarning;
process.emitWarning = function (aviso, ...resto) {
  const texto = typeof aviso === 'string' ? aviso : aviso?.message || '';
  if (texto.includes('SQLite is an experimental feature')) return;
  return avisoOriginal.call(process, aviso, ...resto);
};

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const config = require('./config');
const { crearApp, sesionValida } = require('./http');
const { iniciarWs } = require('./ws');
const { iniciarDns } = require('./dns');
const { personas, eventos } = require('./db');

const VERBOSO_DNS = process.argv.includes('--dns-verboso');

/**
 * Archivo de estado para que la consola de administracion sepa si el portal
 * esta arriba y en que puertos. Mirar "el puerto 80" no sirve: el portal
 * puede estar corriendo en puertos altos y nos daria un falso negativo.
 */
const RUTA_ESTADO = path.join(config.carpetaDatos, 'servidor.json');

function anunciarEncendido(puertos) {
  try {
    fs.mkdirSync(config.carpetaDatos, { recursive: true });
    fs.writeFileSync(RUTA_ESTADO, JSON.stringify({
      pid: process.pid,
      inicio: new Date().toISOString(),
      ip: config.ip,
      urlBase: config.urlBase,
      // Para que el panel pueda cargar la consola por el canal cifrado.
      urlSegura: puertos.puertoHttps ? config.urlSegura : null,
      ...puertos,
    }, null, 2));
  } catch { /* si no se puede escribir, la consola caera al chequeo por puerto */ }
}

function anunciarApagado() {
  try { fs.rmSync(RUTA_ESTADO, { force: true }); } catch { /* da igual */ }
}

function linea(caracter = '─', largo = 66) {
  return caracter.repeat(largo);
}

/**
 * Levanta la red WiFi propia, si toca, y deja la IP cuadrada.
 *
 * El portal es el DUENO de esa red: por Wi-Fi Direct el anuncio vive mientras
 * viva el proceso que lo publica, y eso no puede colgar de una herramienta de
 * linea de comandos que termina — medido, la red se caia en cuanto el comando
 * volvia. El unico proceso que dura lo que dura la operacion es este.
 *
 * Con red hospedada o Soft AP no se toca nada: esa red la levanta el operador
 * desde el panel y sobrevive por su cuenta, porque netsh la deja puesta en el
 * sistema.
 */
async function levantarRedPropia() {
  if (config.modo !== 'propio') return { punto: null, avisoPunto: null };

  try {
    const puntoAcceso = require('./puntoacceso');
    const capacidad = await puntoAcceso.soportado();

    if (!capacidad.soportado) return { punto: null, avisoPunto: capacidad.motivo };
    if (capacidad.mecanismo !== 'wifidirect') return { punto: null, avisoPunto: null };

    const ap = config.puntoAcceso;
    const arranque = await puntoAcceso.iniciar({ ssid: ap.ssid, clave: ap.clave });
    if (!arranque.ok) return { punto: null, avisoPunto: arranque.error };

    console.log(`\n  Red WiFi "${ap.ssid}" levantada por Wi-Fi Direct` +
                `${arranque.maximo ? ` (tope: ${arranque.maximo} telefonos)` : ''}`);

    /* NO se le cambia la IP a la tarjeta. Se adopta la que Windows le puso.
     *
     * Esto va contra la intuicion y esta medido en terreno con un telefono de
     * verdad. Con Wi-Fi Direct, Windows levanta ademas su servicio de Conexion
     * Compartida (ICS), que se queda anclado a 192.168.137.1 sirviendo DHCP.
     * Nuestro servidor convive con el sin problema mientras la tarjeta siga en
     * ese segmento.
     *
     *   tarjeta en 192.168.137.1  ->  el telefono recibe direccion  [OK]
     *   tarjeta movida a otra IP  ->  deja de recibir               [FALLA]
     *
     * Y lo peor es que solo falla CON permisos de Administrador, que es
     * justamente como corre el panel: sin elevar, el cambio de IP no se podia
     * hacer y todo funcionaba. Un arreglo que solo rompe cuando tiene permiso
     * para actuar es de los que cuesta mucho encontrar.
     *
     * Asi que aqui no se manda: se obedece.
     */
    const todas = await puntoAcceso.ipsDelPuntoAcceso();
    const real = await puntoAcceso.ipDelPuntoAcceso();
    if (real && config.adoptarIp(real)) {
      console.log(`  Windows le puso ${real} a la tarjeta; el portal y el DHCP se mudan ahi.`);
      console.log('  (Wi-Fi Direct necesita su propio segmento: cambiarselo rompe el DHCP.)');
    }

    // Dos IPv4 en la misma tarjeta rompen el enrutamiento sin decir nada: el
    // telefono se conecta, recibe direccion, y las consultas de DNS no llegan
    // a ningun sitio. Pasa si alguna vez se le fijo una IP a mano. Cuesta
    // horas encontrarlo, asi que aqui se dice a la cara.
    if (todas.length > 1) {
      const sobran = todas.filter((ip) => ip !== real);
      console.log('');
      console.log(`  ATENCION: la tarjeta tiene ${todas.length} direcciones IPv4: ${todas.join(', ')}`);
      console.log('  Con mas de una, el portal cautivo NO se abre solo aunque todo lo demas');
      console.log('  parezca correcto. Quita la que sobra, como Administrador:');
      for (const ip of sobran) {
        console.log(`      Remove-NetIPAddress -IPAddress ${ip} -Confirm:$false`);
      }
    }

    return { punto: puntoAcceso, avisoPunto: null };
  } catch (err) {
    return { punto: null, avisoPunto: err.message };
  }
}

async function arrancar() {
  /* La red WiFi propia se levanta LO PRIMERO, antes de crear nada.
   *
   * El orden importa: la URL del portal, el certificado del canal seguro y el
   * rango del DHCP se calculan a partir de la IP, y esa IP puede cambiar aqui.
   * Windows le asigna 192.168.137.1 a la tarjeta de Wi-Fi Direct y cambiarla
   * exige Administrador; cuando no se puede, nos mudamos a su segmento en vez
   * de repartir direcciones donde no hay nadie escuchando. */
  const { punto, avisoPunto } = await levantarRedPropia();

  const app = crearApp();
  const servidor = http.createServer(app);
  iniciarWs(servidor, { sesionValida });

  await new Promise((resolver, rechazar) => {
    servidor.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        rechazar(new Error(
          `El puerto ${config.puertoHttp} esta ocupado.\n` +
          `   En Windows suele ser IIS o el servicio HTTP. Prueba:\n` +
          `     net stop http           (como Administrador)\n` +
          `   o arranca en puertos altos:\n` +
          `     npm run puertos-altos   (portal en http://${config.ip}:8080)`
        ));
      } else if (err.code === 'EACCES') {
        rechazar(new Error(`Sin permiso para el puerto ${config.puertoHttp}. Abre la terminal como Administrador.`));
      } else {
        rechazar(err);
      }
    });
    servidor.listen(config.puertoHttp, '0.0.0.0', resolver);
  });

  // Canal seguro. Nacio para una sola cosa —que el navegador entregue el GPS—
  // y ahora sirve tambien para la consola de operador: ahi viajan el PIN, la
  // sesion y los datos de las victimas por un WiFi abierto, donde capturar
  // trafico es trivial. Al operador SI se le puede pedir que acepte una vez el
  // aviso del certificado; a alguien atrapado, no. Por eso el portal de la
  // gente sigue en HTTP puro.
  let servidorSeguro = null;
  let avisoHttps = null;
  if (config.httpsActivo) {
    try {
      const { asegurarCertificado } = require('./tls');
      const certificado = await asegurarCertificado({ ip: config.ip, host: config.host });
      if (certificado.nuevo) {
        console.log(`\n  Certificado nuevo emitido para ${config.ip} (huella ${certificado.huella.slice(0, 17)}...)`);
      }

      servidorSeguro = https.createServer({ cert: certificado.cert, key: certificado.key }, app);

      // El WebSocket tambien sobre el canal seguro. Sin esto la consola por
      // HTTPS cargaba —es el mismo Express— pero pedia wss:// y no habia nadie
      // escuchando: el chat en vivo se quedaba mudo y caia a polling.
      //
      // Los mapas de conexiones son de modulo, asi que una persona conectada
      // por HTTP y un operador por HTTPS se siguen viendo entre si.
      iniciarWs(servidorSeguro, { sesionValida });

      await new Promise((resolver, rechazar) => {
        servidorSeguro.once('error', (err) => {
          rechazar(new Error(
            err.code === 'EADDRINUSE'
              ? `El puerto ${config.puertoHttps} esta ocupado.`
              : err.message
          ));
        });
        servidorSeguro.listen(config.puertoHttps, '0.0.0.0', resolver);
      });

      // A partir de aqui el plano de administracion se exige por este canal.
      // Se marca DESPUES de que escuche de verdad: marcarlo antes dejaria la
      // consola inaccesible por los dos lados si el listen fallara.
      require('./canal').fijarCanalSeguro(config.urlSegura);
    } catch (err) {
      servidorSeguro = null;
      avisoHttps = err.message;
    }
  }

  // En modo propio no hay router que reparta direcciones: el DHCP lo ponemos
  // nosotros o los celulares se quedan en 169.254.x.x sin llegar a ningun sitio.
  let dhcp = null;
  let avisoDhcp = null;
  if (config.modo === 'propio') {
    try {
      const { iniciarDhcp } = require('./dhcp');
      const ap = config.puntoAcceso;
      dhcp = await iniciarDhcp({
        ipServidor: config.ip,
        mascara: ap.mascara,
        desde: ap.desde,
        hasta: ap.hasta,
        duracion: ap.arriendo,
        urlPortal: `${config.urlBase}/`,
        archivoArriendos: path.join(config.carpetaDatos, 'arrendamientos.json'),
        verboso: VERBOSO_DNS,
        alAsignar: ({ mac, ip, nombre }) =>
          console.log(`  [dhcp] ${ip} -> ${mac}${nombre ? ` (${nombre})` : ''}`),
      });
    } catch (err) {
      avisoDhcp = err.message;
    }
  }

  let dns = null;
  let avisoDns = null;
  if (config.dnsActivo) {
    try {
      dns = await iniciarDns({ ip: config.ip, puerto: config.puertoDns, verboso: VERBOSO_DNS });
    } catch (err) {
      avisoDns = err.message;
    }
  }

  const resumen = personas.contar();
  eventos.registrar('arranque', { ip: config.ip, puertoHttp: config.puertoHttp });
  anunciarEncendido({
    puertoHttp: config.puertoHttp,
    puertoHttps: servidorSeguro ? config.puertoHttps : null,
    puertoDns: dns ? config.puertoDns : null,
    // El DHCP solo existe en modo propio. Se distingue "apagado porque no
    // toca" de "deberia estar y no arranco": lo segundo deja a los celulares
    // en 169.254.x.x sin llegar a ningun sitio, y tiene que verse.
    dhcp: config.modo === 'propio' ? (dhcp ? 'activo' : 'fallo') : 'no-aplica',
  });

  console.log('');
  console.log(linea('═'));
  console.log(`  SOS · CONECTATE · PIDE AYUDA        ${config.nombrePuesto}`);
  console.log(linea('═'));
  console.log('');
  console.log(`  IP del puesto de mando : ${config.ip}`);
  console.log(`  Portal para la gente   : ${config.urlBase}`);
  // Se ofrece primero la consola por HTTPS: por ahi van el PIN y los datos de
  // las victimas, y esta red es abierta. La de HTTP queda como respaldo, por si
  // el aviso del certificado da problemas en algun equipo.
  console.log(`  Consola de operador    : ${servidorSeguro ? `${config.urlSegura}/operador.html` : `${config.urlBase}/operador.html`}   (PIN ${config.pinOperador})`);
  if (servidorSeguro) {
    const { PERMITE_HTTP } = require('./canal');
    console.log(PERMITE_HTTP
      ? '     (acepta el aviso del certificado una vez; SOS_ADMIN_HTTP=1: tambien sin cifrar)'
      : '     (acepta el aviso del certificado una vez; por HTTP redirige aqui)');
  }
  console.log(`  Canal seguro (GPS)     : ${servidorSeguro ? config.urlSegura : 'APAGADO'}`);
  console.log(`  Servidor DNS           : ${dns ? `activo en el puerto ${config.puertoDns}` : 'APAGADO'}`);
  console.log(`  Modo de red            : ${config.modo === 'propio'
    ? `PROPIO — WiFi de este equipo, DHCP ${dhcp ? `repartiendo ${config.puntoAcceso.desde}-${config.puntoAcceso.hasta}` : 'APAGADO'}`
    : 'ROUTER — el router reparte DHCP'}`);
  console.log('');
  console.log(`  Personas registradas   : ${resumen.total}   ·   Mensajes sin leer: ${resumen.sinLeer}`);
  console.log('');
  console.log(linea());
  if (config.modo === 'propio') {
    console.log('  MODO PROPIO — el punto de acceso es este equipo:');
    console.log(`    Red WiFi : ${config.puntoAcceso.ssid}`);
    console.log(`    Clave    : ${config.puntoAcceso.clave}`);
    console.log('    (Windows NO permite red hospedada abierta: la clave va en el cartel)');
    console.log('');
    console.log('    Aqui no hay router que configurar: el DHCP y el DNS los ponemos');
    console.log('    nosotros, y ademas anunciamos la URL del portal por DHCP.');
  } else {
    console.log('  CONFIGURA EL ROUTER ASI (una sola vez):');
    console.log(`    1. Entra a la administracion del router.`);
    console.log(`    2. Servidor DHCP -> "DNS primario" = ${config.ip}`);
    console.log(`       Borra el DNS secundario. Si queda uno, el celular lo usara`);
    console.log(`       y el portal NO abrira solo.`);
    console.log(`    3. Reserva la IP ${config.ip} para este PC (DHCP estatico).`);
    console.log(`    4. Reinicia el WiFi del celular para tomar el DNS nuevo.`);
  }
  console.log(linea());

  if (avisoDns) {
    console.log('');
    console.log('  AVISO — el DNS no arranco:');
    for (const l of avisoDns.split('\n')) console.log(`    ${l}`);
    console.log('    Sin DNS el portal NO se abre solo; la gente tendra que');
    console.log(`    teclear ${config.urlBase} a mano.`);
  }

  if (avisoPunto) {
    console.log('');
    console.log('  AVISO — la red WiFi propia no se levanto:');
    for (const l of String(avisoPunto).split('\n')) console.log(`    ${l}`);
    console.log('    Sin red WiFi no hay a que conectarse. Usa el modo router.');
  }

  if (avisoDhcp) {
    console.log('');
    console.log('  AVISO — el DHCP no arranco:');
    for (const l of avisoDhcp.split('\n')) console.log(`    ${l}`);
    console.log('    Sin DHCP los celulares no reciben direccion y no llegan al portal.');
  }

  if (avisoHttps) {
    console.log('');
    console.log('  AVISO — el canal seguro no arranco:');
    console.log(`    ${avisoHttps}`);
    console.log('    Sin el, el boton de GPS no funcionara y la gente tendra que');
    console.log('    escribir la direccion a mano.');
  }

  if (config.pinRecienGenerado) {
    console.log('');
    console.log(`  ANOTA ESTE PIN: ${config.pinOperador}`);
    console.log('    Se genero al azar en este primer arranque y ya quedo guardado.');
    console.log('    Es el que abre la consola de operador. Cambialo desde el panel si quieres.');
  }

  console.log('');
  console.log('  Ctrl+C para detener.');
  console.log('');

  /**
   * Latido del DNS. Es el diagnostico mas util del sistema: si no llega
   * NINGUNA consulta, el problema no esta aqui sino en el router, que no esta
   * entregando esta IP como servidor DNS. Sin esto habria que adivinar.
   */
  if (dns) {
    let ultimoContado = -1;
    const latido = setInterval(() => {
      const { consultas, clientes } = dns.estadisticas();

      if (consultas === 0) {
        console.log(`  [dns] SIN CONSULTAS todavia — el router no esta entregando ${config.ip} como DNS`);
        console.log('        (o ningun celular se ha conectado aun)');
        return;
      }
      if (consultas === ultimoContado) return; // sin novedad: no ensuciamos la consola
      ultimoContado = consultas;
      console.log(`  [dns] ${consultas} consultas de ${clientes} dispositivo(s)`);
    }, 30000);
    latido.unref?.();
  }

  const apagar = async () => {
    console.log('\n  Cerrando... los datos ya estan guardados en datos/sos.sqlite3');
    eventos.registrar('apagado', null);
    anunciarApagado();
    await dns?.cerrar?.().catch(() => {});
    await dhcp?.cerrar?.().catch(() => {});
    // Si la levantamos nosotros, la bajamos nosotros: dejar una red WiFi
    // emitiendo despues de apagar el portal seria peor que no levantarla.
    if (punto) {
      console.log('  Bajando la red WiFi...');
      await punto.detener().catch(() => {});
    }
    servidorSeguro?.close();
    servidor.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', apagar);
  process.on('SIGTERM', apagar);
}

arrancar().catch((err) => {
  console.error('\n  NO SE PUDO ARRANCAR:\n');
  for (const l of String(err.message).split('\n')) console.error(`   ${l}`);
  console.error('');
  process.exit(1);
});
