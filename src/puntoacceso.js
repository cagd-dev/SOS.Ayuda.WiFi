'use strict';

/**
 * Convierte la tarjeta WiFi del equipo en punto de acceso, usando la "red
 * hospedada" de Windows (netsh wlan hostednetwork).
 *
 * Por que esta y no el "Punto de acceso movil" de Windows: el punto de acceso
 * movil EXIGE una conexion a internet que compartir y se niega a arrancar sin
 * ella. En un terremoto no hay internet, asi que no sirve. La red hospedada
 * funciona sin conexion alguna.
 *
 * LIMITE IMPORTANTE: la red hospedada no puede ser abierta. Windows obliga a
 * WPA2 con clave de 8 caracteres o mas, asi que la clave TIENE que ir en el
 * cartel. Es el precio de no necesitar router.
 *
 * Otro limite: depende del driver. Muchas tarjetas modernas ya no lo soportan;
 * por eso `soportado()` se comprueba antes de ofrecer el modo.
 */

const { execFile } = require('node:child_process');
const os = require('node:os');

function correr(comando, argumentos) {
  return new Promise((resolver) => {
    execFile(comando, argumentos,
      { timeout: 15000, windowsHide: true, encoding: 'utf8' },
      (err, salida, error) => resolver({
        ok: !err,
        texto: `${salida || ''}${error || ''}`,
      }));
  });
}

/** netsh habla el idioma de Windows, asi que hay que reconocer los dos. */
function diceQueSi(linea) {
  return /:\s*(s[ií]|yes)\b/i.test(linea);
}

function lineaDe(texto, patron) {
  return texto.split('\n').find((l) => patron.test(l)) || '';
}

/**
 * ¿Puede esta tarjeta hacer de punto de acceso para un grupo de gente?
 *
 * Se miran DOS cosas, porque son mecanismos distintos:
 *   - "Red hospedada": el viejo netsh hostednetwork.
 *   - "Soft AP": lo que usa el Punto de acceso movil de Windows.
 * Con que una de las dos este, se puede montar el modo propio.
 *
 * Wi-Fi Direct NO cuenta aunque aparezca como compatible: suele venir limitado
 * a un punado de clientes y los iPhone no se conectan a una red asi.
 */
async function soportado() {
  if (os.platform() !== 'win32') {
    return { soportado: false, motivo: 'Esto solo funciona en Windows.' };
  }

  const drivers = await correr('netsh', ['wlan', 'show', 'drivers']);
  if (!drivers.ok || !drivers.texto.trim()) {
    return {
      soportado: false,
      tarjeta: null,
      motivo: 'No hay ninguna tarjeta WiFi utilizable en este equipo (¿es de escritorio?).',
    };
  }

  const lineaTarjeta = lineaDe(drivers.texto, /^\s*(controlador|driver)\s*:/i);
  const tarjeta = (lineaTarjeta.split(':').slice(1).join(':') || '').trim() || null;

  const lineaHospedada = lineaDe(drivers.texto, /hosted network supported|red hospedada/i);
  const hospedada = !!lineaHospedada && diceQueSi(lineaHospedada);

  const capacidades = await correr('netsh', ['wlan', 'show', 'wirelesscapabilities']);
  const compatible = (patron) => {
    const linea = lineaDe(capacidades.texto, patron);
    return !!linea && /:\s*compatible/i.test(linea) && !/no\s*compatible/i.test(linea);
  };

  const softAp = compatible(/soft\s*ap/i);
  // "GO" = Group Owner: es el que puede EMITIR una red. Sin GO, la tarjeta solo
  // sabe conectarse a la de otro y no nos sirve de nada.
  const wifiDirect = compatible(/wi-?fi\s*direct\s*go/i);

  // Tope de clientes del modo P2P, tal como lo reporta el propio driver. Es el
  // numero que decide si este camino sirve para algo, asi que se lee y se dice
  // en vez de suponerlo: va de 2 a 8 segun el adaptador.
  const lineaMax = lineaDe(capacidades.texto, /(m[aá]x.*clientes|max.*clients).*p2p|p2p.*(m[aá]x.*clientes|max.*clients)/i);
  const maximo = Number((lineaMax.match(/(\d+)\s*$/) || [])[1]) || null;

  if (hospedada || softAp) {
    return {
      soportado: true,
      tarjeta,
      mecanismo: hospedada ? 'hospedada' : 'softap',
      maximo: null,
      motivo: null,
    };
  }

  /**
   * Tercer camino: Wi-Fi Direct en modo LEGACY.
   *
   * Wi-Fi Direct "puro" no sirve —los iPhone no lo hablan y en Android vive en
   * un menu aparte, no en la lista normal de redes—, pero su modo legacy emite
   * un SSID corriente con clave WPA2, al que se conecta cualquier telefono sin
   * enterarse de lo que hay debajo.
   *
   * Se ofrece aunque el tope de clientes sea ridiculo comparado con un router.
   * El criterio es del operador: en un punto con poca gente, poder atender a
   * dos personas es infinitamente mejor que no poder atender a ninguna.
   */
  if (wifiDirect) {
    return {
      soportado: true,
      tarjeta,
      mecanismo: 'wifidirect',
      maximo,
      motivo:
        `La tarjeta "${tarjeta || 'WiFi'}" no admite red hospedada ni Soft AP, ` +
        'pero SI Wi-Fi Direct, que sirve como punto de acceso de emergencia.\n' +
        (maximo
          ? `TOPE REAL: ${maximo} ${maximo === 1 ? 'telefono' : 'telefonos'} a la vez. `
          : 'El tope de clientes lo pone el driver y suele ser muy bajo (2 a 8). ') +
        'Es poco, pero funciona sin router y sin internet.\n' +
        'Si esperas mas gente, usa el modo router.',
    };
  }

  return {
    soportado: false,
    tarjeta,
    mecanismo: null,
    maximo,
    motivo:
      `La tarjeta "${tarjeta || 'WiFi'}" NO puede emitir ninguna red: ` +
      'no admite red hospedada, ni Soft AP, ni Wi-Fi Direct como emisor.\n' +
      'Usa el modo router, o un adaptador WiFi que si lo admita ' +
      '(compruebalo con: netsh wlan show wirelesscapabilities).',
  };
}

async function estado() {
  const { ok, texto } = await correr('netsh', ['wlan', 'show', 'hostednetwork']);
  if (!ok) return { activo: false, ssid: null, clientes: 0 };

  const lineaEstado = lineaDe(texto, /^\s*(estado|status)\s*:/i);
  const activo = /iniciad|started|activ/i.test(lineaEstado);

  const lineaSsid = lineaDe(texto, /ssid\s+(de la red|name)?\s*:/i);
  const ssid = (lineaSsid.split(':')[1] || '').trim().replace(/^"|"$/g, '') || null;

  const lineaClientes = lineaDe(texto, /(numero de clientes|number of clients)/i);
  const clientes = Number((lineaClientes.match(/(\d+)\s*$/) || [])[1] || 0);

  return { activo, ssid, clientes, crudo: texto };
}

/**
 * Compone el nombre de la red metiendo la clave dentro.
 *
 * La idea: si la red se llama "SOS-AYUDA-CLAVE-12345678", la gente lee la clave
 * en la propia lista de WiFi del telefono y no depende de que alguien haya
 * leido el cartel. Es la mejor solucion al hecho de que Windows no permita red
 * hospedada abierta.
 *
 * El limite duro es que un SSID no puede pasar de 32 bytes. Si no cabe, se
 * devuelve solo el nombre base y se avisa, en vez de generar un SSID invalido
 * que Windows rechazaria sin explicar por que.
 */
function componerSsid({ base, clave, incluirClave = true }) {
  const limpio = String(base || 'SOS-AYUDA').trim();

  if (!incluirClave) {
    return { ssid: limpio, cabe: Buffer.byteLength(limpio, 'utf8') <= 32, aviso: null };
  }

  const compuesto = `${limpio}-CLAVE-${clave}`;
  const bytes = Buffer.byteLength(compuesto, 'utf8');

  if (bytes <= 32) return { ssid: compuesto, cabe: true, aviso: null };

  return {
    ssid: limpio,
    cabe: Buffer.byteLength(limpio, 'utf8') <= 32,
    aviso:
      `"${compuesto}" ocupa ${bytes} bytes y el maximo de un nombre de red son 32. ` +
      'Se usa solo el nombre base; acorta el nombre o la clave si quieres que la ' +
      'clave viaje en el nombre.',
  };
}

async function configurar({ ssid, clave }) {
  if (Buffer.byteLength(String(ssid || ''), 'utf8') > 32) {
    return { ok: false, error: 'El nombre de la red no puede pasar de 32 caracteres.' };
  }
  if (!ssid || ssid.length < 1) return { ok: false, error: 'Falta el nombre de la red (SSID).' };
  if (!clave || clave.length < 8) {
    return {
      ok: false,
      error: 'La clave debe tener 8 caracteres o mas: Windows no permite red hospedada abierta.',
    };
  }

  const r = await correr('netsh', [
    'wlan', 'set', 'hostednetwork', 'mode=allow', `ssid=${ssid}`, `key=${clave}`,
  ]);
  return { ok: r.ok, error: r.ok ? null : r.texto.trim() };
}

/* ------------------------------------------------------------------ *
 * Camino Wi-Fi Direct
 *
 * El anuncio de Wi-Fi Direct vive mientras viva el proceso que lo publica, asi
 * que no se puede "lanzar y olvidar" como netsh: hay que quedarse con el hijo
 * y matarlo para bajar la red.
 * ------------------------------------------------------------------ */
const { spawn } = require('node:child_process');
const path = require('node:path');

/**
 * El anuncio vive mientras viva el proceso que lo publica. Eso obliga a soltar
 * el hijo con unref(): si no, quien lo lanza no puede terminar nunca —Node se
 * queda esperando— y la herramienta de linea de comandos, o el panel que la
 * invoca, se cuelgan para siempre esperando una red que ya esta levantada.
 *
 * OJO: unref() SI, detached NO. Medido en esta misma maquina:
 *
 *   sin detached : LISTO, y el anuncio sigue vivo
 *   con detached : el proceso sale con codigo 0 al instante y sin emitir nada
 *
 * Al quedar suelto, la red sobrevive a quien la levanto. El precio es que
 * detener() ya no puede guardarse una referencia: tiene que salir a buscar el
 * proceso por su linea de comandos. Ver detenerWifiDirect().
 */
function iniciarWifiDirect({ ssid, clave }) {
  return new Promise((resolver) => {
    const hijo = spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-File', path.join(__dirname, 'wifidirect.ps1'),
      '-Ssid', ssid, '-Clave', clave,
    ], { windowsHide: true });

    let salida = '';
    let resuelto = false;

    const terminar = (resultado) => {
      if (resuelto) return;
      resuelto = true;
      resolver(resultado);
    };

    hijo.stdout.on('data', (d) => {
      salida += d.toString();
      if (/^LISTO:/m.test(salida)) {
        // Confirmado que la red esta arriba: se sueltan las tuberias y se deja
        // de contarlo como hijo, para que este proceso pueda terminar.
        hijo.stdout.destroy();
        hijo.stderr.destroy();
        hijo.unref();
        terminar({ ok: true, error: null });
      }
      const fallo = salida.match(/^ERROR:\s*(.+)$/m);
      if (fallo) terminar({ ok: false, error: fallo[1].trim() });
    });

    hijo.stderr.on('data', (d) => { salida += d.toString(); });

    hijo.on('close', () => {
      terminar({ ok: false, error: salida.trim() || 'El anuncio de Wi-Fi Direct no arranco.' });
    });

    hijo.on('error', (err) => terminar({ ok: false, error: err.message }));

    // Si en 12 s no dijo ni LISTO ni ERROR, algo se colgo. Mejor rendirse con
    // un mensaje claro que dejar al operador mirando una pantalla quieta.
    setTimeout(() => {
      if (resuelto) return;
      try { hijo.kill(); } catch { /* ya murio */ }
      terminar({ ok: false, error: 'Wi-Fi Direct no respondio a tiempo.' });
    }, 12000);
  });
}

/**
 * @param {object} [opciones] ssid y clave, necesarios solo por Wi-Fi Direct:
 *   la red hospedada ya los tiene guardados de configurar().
 */
async function iniciar(opciones = {}) {
  const capacidad = await soportado();

  if (capacidad.mecanismo === 'wifidirect') {
    if (!opciones.ssid || !opciones.clave) {
      return { ok: false, error: 'Wi-Fi Direct necesita el nombre de red y la clave.' };
    }
    const r = await iniciarWifiDirect(opciones);
    if (!r.ok) return { ok: false, error: `Wi-Fi Direct: ${r.error}` };

    // Windows le pone IP a la tarjeta virtual el solo (192.168.137.1, la de
    // siempre de "compartir conexion"). Se devuelve para que el DHCP reparta
    // en ESE segmento en vez de en uno inventado.
    await new Promise((resolver) => setTimeout(resolver, 1500));
    return {
      ok: true,
      error: null,
      mecanismo: 'wifidirect',
      maximo: capacidad.maximo,
      ip: await ipDelPuntoAcceso(),
    };
  }

  const r = await correr('netsh', ['wlan', 'start', 'hostednetwork']);
  if (r.ok) return { ok: true, error: null, mecanismo: 'hospedada' };

  // El mensaje crudo de netsh no le dice nada a nadie; traducimos las causas
  // que se dan de verdad en terreno.
  let pista = r.texto.trim();
  if (/no se pudo iniciar|could not be started/i.test(r.texto)) {
    pista += '\nCausas tipicas: la tarjeta WiFi esta apagada, o esta conectada a otra red, ' +
             'o el driver no admite red hospedada.';
  }
  return { ok: false, error: pista };
}

/**
 * Mata el proceso que publica el anuncio, buscandolo por su linea de comandos.
 *
 * No se puede guardar una referencia: el proceso va suelto a proposito, para
 * que la red sobreviva a quien la levanto. Asi que quien quiera bajarla —otra
 * corrida de la herramienta, el panel, o el operador tres horas despues— tiene
 * que salir a encontrarlo.
 */
async function detenerWifiDirect() {
  const r = await correr('powershell', ['-NoProfile', '-Command',
    "$p = Get-CimInstance Win32_Process -Filter \"Name='powershell.exe'\" | " +
    "Where-Object { $_.CommandLine -match 'wifidirect\\.ps1' }; " +
    'if (-not $p) { Write-Output "NINGUNO"; exit 0 }; ' +
    '$p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; ' +
    'Write-Output "DETENIDOS"']);

  return /DETENIDOS/.test(r.texto) ? 'detenido' : 'ninguno';
}

async function detener() {
  const wifi = await detenerWifiDirect();
  if (wifi === 'detenido') return { ok: true, error: null };

  const r = await correr('netsh', ['wlan', 'stop', 'hostednetwork']);
  return { ok: r.ok, error: r.ok ? null : r.texto.trim() };
}

/**
 * Pone IP fija en la tarjeta del punto de acceso. Sin esto Windows le deja una
 * 169.254.x.x y nuestro DHCP repartiria direcciones de una red que no existe.
 */
/**
 * IP que la tarjeta del punto de acceso tiene AHORA.
 *
 * Importa porque Windows no la deja en blanco: al levantar Wi-Fi Direct le
 * asigna sola 192.168.137.1, que es la direccion de siempre del "compartir
 * conexion". Pelearse con eso no aporta nada —y ademas exige Administrador—,
 * asi que se lee y se usa la que ya esta.
 */
async function ipsDelPuntoAcceso() {
  const r = await correr('powershell', ['-NoProfile', '-Command',
    "Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'Hosted Network Virtual|Wi-Fi Direct Virtual' -and $_.Status -eq 'Up' } | " +
    'ForEach-Object { (Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue).IPAddress }']);

  return String(r.texto || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\d+\.\d+\.\d+$/.test(l));
}

async function ipDelPuntoAcceso() {
  // La que pone Windows es 192.168.137.1. Si hay varias, esa es la buena: las
  // otras son restos de haberle fijado una a mano alguna vez.
  const todas = await ipsDelPuntoAcceso();
  return todas.find((ip) => ip.startsWith('192.168.137.')) || todas[0] || null;
}

/** 255.255.255.0 -> 24. New-NetIPAddress trabaja con longitud de prefijo. */
function longitudPrefijo(mascara) {
  const octetos = String(mascara || '255.255.255.0').split('.').map(Number);
  if (octetos.length !== 4 || octetos.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return 24;
  return octetos
    .map((o) => o.toString(2).padStart(8, '0'))
    .join('')
    .replace(/0+$/, '')
    .length;
}

async function fijarIp({ adaptador, ip, mascara }) {
  if (!adaptador) return { ok: false, error: 'No se sabe que tarjeta configurar.' };

  /**
   * Se busca la tarjeta y se le pone la IP en UNA sola pasada de PowerShell,
   * sin que su nombre salga nunca de ahi. Dos motivos, los dos aprendidos a
   * golpes:
   *
   *   - La tarjeta virtual se llama "Conexion de area local* 12". Ese
   *     ASTERISCO hace que netsh falle con un error sobre nombres de archivo
   *     que no tiene nada que ver con lo que esta pasando.
   *   - Y lleva ACENTOS, que se corrompen al pasar por la tuberia: el nombre
   *     vuelve como "Conexi?n de ?rea local* 12" y ya no casa con nada.
   *
   * Por dentro se trabaja con el indice de interfaz, que es un numero.
   */
  const prefijo = longitudPrefijo(mascara);

  const r = await correr('powershell', ['-NoProfile', '-Command', `
    $ErrorActionPreference = 'Stop'
    $tarjeta = Get-NetAdapter |
      Where-Object { $_.InterfaceDescription -match 'Hosted Network Virtual|Wi-Fi Direct Virtual' -and $_.Status -eq 'Up' } |
      Select-Object -First 1
    if (-not $tarjeta) { Write-Output 'ERROR: no hay ninguna tarjeta de punto de acceso levantada'; exit 1 }
    try {
      Remove-NetIPAddress -InterfaceIndex $tarjeta.ifIndex -AddressFamily IPv4 -Confirm:$false -ErrorAction SilentlyContinue
      Remove-NetRoute -InterfaceIndex $tarjeta.ifIndex -AddressFamily IPv4 -Confirm:$false -ErrorAction SilentlyContinue
    } catch { }
    New-NetIPAddress -InterfaceIndex $tarjeta.ifIndex -IPAddress '${ip}' -PrefixLength ${prefijo} | Out-Null
    Write-Output 'LISTO'
  `.trim()]);

  const salida = r.texto.trim();
  if (/^LISTO/m.test(salida)) return { ok: true, error: null };
  return { ok: false, error: salida || 'No se pudo asignar la IP.' };
}

/**
 * Nombre de la tarjeta virtual sobre la que vive la red que emitimos.
 *
 * Es la pieza que hay que acertar: si se le pone la IP a la tarjeta
 * equivocada, la red se ve desde el celular pero el DHCP reparte direcciones
 * de un segmento que no existe y nadie llega a ningun sitio. Un fallo que
 * parece "el portal no carga" y no tiene nada que ver con el portal.
 *
 * Los dos mecanismos crean adaptadores distintos:
 *   - red hospedada  -> "Microsoft Hosted Network Virtual Adapter"
 *   - Wi-Fi Direct   -> "Microsoft Wi-Fi Direct Virtual Adapter"
 * Se busca por la DESCRIPCION del adaptador, no por el nombre de la conexion:
 * el nombre es "Conexion de area local* 12" y cambia de numero cada vez.
 */
async function adaptadorHospedado() {
  const { ok, texto } = await correr('powershell', ['-NoProfile', '-Command',
    "Get-NetAdapter | Where-Object { $_.InterfaceDescription -match 'Hosted Network Virtual|Wi-Fi Direct Virtual' -and $_.Status -eq 'Up' } | " +
    'Select-Object -First 1 -ExpandProperty Name']);

  const nombre = ok ? texto.trim().split('\n')[0].trim() : '';
  if (nombre) return nombre;

  // Respaldo por si PowerShell no esta disponible: el listado de netsh, donde
  // la ultima columna es el nombre de la conexion.
  const alterno = await correr('netsh', ['interface', 'show', 'interface']);
  if (!alterno.ok) return null;
  const linea = alterno.texto.split('\n')
    .find((l) => /hosted network|red hospedada|conexi.n de .rea local\* /i.test(l));
  if (!linea) return null;
  const columnas = linea.trim().split(/\s{2,}/);
  return columnas[columnas.length - 1] || null;
}

module.exports = {
  soportado, estado, configurar, iniciar, detener, fijarIp, adaptadorHospedado,
  componerSsid, ipDelPuntoAcceso, ipsDelPuntoAcceso,
};
