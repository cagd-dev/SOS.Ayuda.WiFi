'use strict';

// node:sqlite avisa que es experimental en cada arranque. Silenciado para que
// la consola quede legible: se va a usar con prisa.
const avisoOriginal = process.emitWarning;
process.emitWarning = function (aviso, ...resto) {
  const texto = typeof aviso === 'string' ? aviso : aviso?.message || '';
  if (texto.includes('SQLite is an experimental feature')) return;
  return avisoOriginal.call(process, aviso, ...resto);
};

/**
 * Consola de administracion del puesto de mando.
 *
 * Todo lo que hay que hacerle al sistema en terreno cabe aqui: arrancar,
 * cambiar el PIN, exportar el censo, respaldar, vaciar, revisar. La idea es
 * que nadie tenga que abrir un editor ni recordar comandos a las 3 de la
 * manana.
 */

const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const readline = require('node:readline/promises');
const { spawn, spawnSync } = require('node:child_process');

const config = require('../src/config');
const ajustes = require('../src/ajustes');

const raiz = path.resolve(__dirname, '..');
const carpetaTls = path.join(config.carpetaDatos, 'tls');
const carpetaRespaldos = path.join(config.carpetaDatos, 'respaldos');

/* ------------------------------------------------------------------ *
 * Utilidades de consola
 * ------------------------------------------------------------------ */

const linea = (car = '─', largo = 62) => car.repeat(largo);

function limpiar() {
  // \x1Bc no funciona en algunas consolas viejas; el salto de linea si.
  process.stdout.write('\x1Bc');
  if (!process.stdout.isTTY) console.log('');
}

/**
 * UNA sola interfaz para toda la sesion, con cola de lineas propia.
 *
 * Dos razones para no usar rl.question() a secas:
 *  - Abrir y cerrar una interfaz por pregunta descarta lo que quedara en la
 *    entrada, y las respuestas siguientes se pierden.
 *  - question() solo atrapa la linea que llega mientras esta pendiente. Si la
 *    entrada llega de golpe (una tuberia, un script), todo lo demas se tira.
 *
 * Con la cola funciona igual escribiendo a mano que alimentando el menu desde
 * un archivo, que es como se puede automatizar el arranque.
 */
let entrada = null;
const lineasPendientes = [];
const preguntasEnEspera = [];

function abrirEntrada() {
  entrada = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: process.stdin.isTTY,
  });

  entrada.on('line', (linea) => {
    const resolver = preguntasEnEspera.shift();
    if (resolver) resolver(linea);
    else lineasPendientes.push(linea);
  });

  // Fin de la entrada (Ctrl+D o se acabo la tuberia): respondemos "salir".
  entrada.on('close', () => {
    while (preguntasEnEspera.length) preguntasEnEspera.shift()('0');
  });
}

async function preguntar(texto) {
  process.stdout.write(texto);

  if (lineasPendientes.length) {
    const linea = lineasPendientes.shift();
    if (!process.stdin.isTTY) process.stdout.write(`${linea}\n`);
    return linea.trim();
  }

  const linea = await new Promise((resolver) => preguntasEnEspera.push(resolver));
  return String(linea).trim();
}

async function pausa() {
  await preguntar('\n  Pulsa Enter para volver al menu... ');
}

async function confirmar(texto) {
  const respuesta = (await preguntar(`  ${texto} (escribe SI para confirmar): `)).toUpperCase();
  return respuesta === 'SI';
}

/**
 * Corre un comando mostrando su salida en vivo y devuelve el codigo de salida.
 * Pausamos nuestra lectura de la entrada mientras tanto: el hijo hereda stdin
 * y no queremos competir con el por las teclas (sobre todo por el Ctrl+C que
 * detiene el portal).
 */
function correr(comando, argumentos, opciones = {}) {
  entrada?.pause();
  try {
    const resultado = spawnSync(comando, argumentos, {
      stdio: 'inherit',
      cwd: raiz,
      shell: false,
      ...opciones,
    });
    return resultado.status;
  } finally {
    entrada?.resume();
  }
}

/* ------------------------------------------------------------------ *
 * Estado del sistema
 * ------------------------------------------------------------------ */

function puertoOcupado(puerto) {
  return new Promise((resolver) => {
    const socket = net.connect({ host: '127.0.0.1', port: puerto });
    const cerrar = (respuesta) => {
      socket.destroy();
      resolver(respuesta);
    };
    socket.setTimeout(400);
    socket.on('connect', () => cerrar(true));
    socket.on('timeout', () => cerrar(false));
    socket.on('error', () => cerrar(false));
  });
}

/**
 * Estado real del portal, leido del archivo que escribe el servidor al
 * arrancar. Preguntar por "el puerto 80" daria un falso negativo cuando el
 * portal esta corriendo en puertos altos.
 */
function portalActivo() {
  const ruta = path.join(config.carpetaDatos, 'servidor.json');
  let estado;
  try {
    estado = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return null;
  }

  // ¿Ese proceso sigue vivo? La senal 0 no envia nada: solo comprueba.
  try {
    process.kill(estado.pid, 0);
  } catch {
    fs.rmSync(ruta, { force: true }); // quedo de un cierre brusco
    return null;
  }
  return estado;
}

function contarCenso() {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(config.rutaBaseDatos, { readOnly: true });
    const personas = db.prepare('SELECT COUNT(*) AS n FROM personas').get().n;
    const mensajes = db.prepare('SELECT COUNT(*) AS n FROM mensajes').get().n;
    db.close();
    return { personas, mensajes };
  } catch {
    return null;
  }
}

async function estadoActual() {
  const guardados = ajustes.leer();
  const portal = portalActivo();
  return {
    guardados,
    portal,
    ip: portal?.ip || guardados.ip || config.ip,
    ipForzada: !!guardados.ip,
    pin: guardados.pin || process.env.SOS_PIN || '1234',
    puesto: guardados.puesto || config.nombrePuesto,
    censo: contarCenso(),
    // El archivo de estado manda; el puerto es solo la red de seguridad por si
    // no se pudo escribir.
    corriendo: !!portal || (await puertoOcupado(config.puertoHttp)),
    certificado: fs.existsSync(path.join(carpetaTls, 'cert.pem')),
  };
}

/* ------------------------------------------------------------------ *
 * Acciones
 * ------------------------------------------------------------------ */

const espera = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

/**
 * Arranca el portal EN SU PROPIA VENTANA.
 *
 * Antes corria dentro de esta consola y la bloqueaba: para volver al menu
 * habia que detener el portal con Ctrl+C, lo que hacia imposible, por ejemplo,
 * correr la prueba de humo (que necesita el portal arriba). Con ventana aparte
 * el menu queda siempre disponible y el portal se detiene con la opcion 4.
 *
 * En Windows la ventana se abre con `cmd /k`, para que si el arranque falla el
 * error quede a la vista en vez de desaparecer en un parpadeo.
 */
async function lanzarPortal(argumentos, titulo, { minimizada = true } = {}) {
  const yaCorriendo = portalActivo();
  if (yaCorriendo) {
    console.log(`\n  El portal YA esta corriendo en ${yaCorriendo.urlBase} (PID ${yaCorriendo.pid}).`);
    console.log('  Detenlo primero con la opcion 4 si quieres arrancarlo de otra forma.');
    return;
  }

  console.log(`\n  ${titulo}`);
  console.log('  Se abre en una ventana aparte. Este menu sigue disponible.\n');

  const guionServidor = path.join('src', 'server.js');
  if (os.platform() === 'win32') {
    // OJO con dos detalles que costaron encontrarse:
    //
    //  - NADA de `detached: true`. En Windows desengancha la consola de ESTE
    //    proceso, y a partir de ahi los hijos que heredan stdio (diagnostico,
    //    prueba de humo) se ejecutan mudos. `start` ya independiza al portal
    //    por su cuenta, asi que no hace falta.
    //  - `/MIN` para que la ventana no salte al frente y le robe el teclado a
    //    quien este escribiendo en el menu. Queda en la barra de tareas.
    spawn(
      'cmd',
      [
        '/c', 'start', ...(minimizada ? ['/MIN'] : []), 'SOS Portal',
        'cmd', '/k', process.execPath, guionServidor, ...argumentos,
      ],
      { cwd: raiz, stdio: 'ignore' }
    ).unref();
  } else {
    spawn(process.execPath, [guionServidor, ...argumentos], {
      cwd: raiz, detached: true, stdio: 'ignore',
    }).unref();
  }

  // Esperamos a que escriba su archivo de estado para poder confirmar que
  // arranco de verdad, en vez de decir "listo" y que no sea cierto.
  process.stdout.write('  Arrancando');
  for (let intento = 0; intento < 20; intento++) {
    await espera(500);
    process.stdout.write('.');
    const portal = portalActivo();
    if (portal) {
      console.log('\n');
      console.log(`  LISTO — portal en ${portal.urlBase}`);
      console.log(`         consola de operador en ${portal.urlBase}/operador.html`);
      return;
    }
  }

  console.log('\n');
  console.log('  No confirmo el arranque en 10 segundos.');
  console.log('  Mira la ventana "SOS Portal": ahi esta el error.');
}

async function detenerPortal() {
  const portal = portalActivo();
  if (!portal) {
    return console.log('\n  El portal no esta corriendo.');
  }

  console.log(`\n  Portal corriendo en ${portal.urlBase} (PID ${portal.pid}).`);
  if (!(await confirmar('¿Detenerlo?'))) {
    return console.log('\n  Cancelado, sigue corriendo.');
  }

  try {
    process.kill(portal.pid);
  } catch {
    console.log('\n  Ese proceso ya no existia. Limpiando el estado.');
  }

  for (let intento = 0; intento < 10; intento++) {
    await espera(300);
    if (!portalActivo()) {
      console.log('\n  Portal detenido. Los datos estan guardados.');
      return;
    }
  }
  console.log('\n  No se pudo detener. Cierra a mano la ventana "SOS Portal".');
}

/**
 * Arranca registrando cada consulta DNS. Sirve para responder LA pregunta que
 * importa cuando el portal no abre solo: ¿los celulares nos estan preguntando?
 * Si aqui no aparece nada, el fallo esta en el router, no en el servidor.
 */
async function modoDiagnostico() {
  limpiar();
  console.log('\n  MODO DIAGNOSTICO — ¿por que no abre solo el portal?\n');
  console.log('  Vas a ver cada consulta DNS que llegue, con la IP del telefono.');
  console.log('');
  console.log('  Con esto en pantalla, coge un celular y:');
  console.log('    1. Olvida la red WiFi y vuelve a conectarte.');
  console.log('    2. Mira lo que aparece aqui abajo.');
  console.log('');
  console.log('  QUE SIGNIFICA LO QUE VEAS:');
  console.log('');
  console.log('   · Aparecen lineas [dns] con dominios');
  console.log('       -> El DNS funciona. Si aun asi no abre el portal, revisa');
  console.log('          el firewall del puerto 80 (opcion 7).');
  console.log('');
  console.log('   · NO aparece nada');
  console.log('       -> El celular no nos esta preguntando. El router no esta');
  console.log('          entregando esta IP como DNS, o entrega tambien un DNS');
  console.log('          secundario y el celular usa ese.');
  console.log('');
  console.log('   · Aparecen consultas pero solo de una IP que no es el celular');
  console.log('       -> Es el router relevando. Suele funcionar igual.');
  console.log('');
  await preguntar('  Pulsa Enter para arrancar en modo diagnostico... ');

  await lanzarPortal(['--dns-verboso'], 'Portal en MODO DIAGNOSTICO — mira las lineas [dns] en la otra ventana');
}

async function cambiarPin() {
  const estado = await estadoActual();
  console.log(`\n  PIN actual: ${estado.pin}${estado.pin === '1234' ? '   <-- es el de fabrica' : ''}`);
  console.log('  Usa solo digitos: el celular abre el teclado numerico.\n');

  const nuevo = await preguntar('  PIN nuevo (4 a 8 digitos, vacio para cancelar): ');
  if (!nuevo) return console.log('\n  Cancelado, no se cambio nada.');

  if (!/^\d{4,8}$/.test(nuevo)) {
    return console.log('\n  No sirve: tienen que ser entre 4 y 8 digitos.');
  }
  const repetido = await preguntar('  Escribelo otra vez: ');
  if (nuevo !== repetido) {
    return console.log('\n  No coinciden. No se cambio nada.');
  }

  ajustes.guardar({ pin: nuevo });
  console.log(`\n  PIN cambiado a ${nuevo}.`);
  console.log('  Se aplica la proxima vez que arranques el portal.');
  console.log('  Los operadores que ya estan dentro tendran que volver a entrar.');
}

async function cambiarPuesto() {
  const estado = await estadoActual();
  console.log(`\n  Nombre actual: ${estado.puesto}`);
  console.log('  Es el nombre que la gente ve en el portal y en el chat.\n');

  const nuevo = await preguntar('  Nombre nuevo (vacio para cancelar): ');
  if (!nuevo) return console.log('\n  Cancelado.');

  ajustes.guardar({ puesto: nuevo.slice(0, 60) });
  console.log(`\n  Guardado: ${nuevo.slice(0, 60)}`);
  console.log('  Se aplica la proxima vez que arranques el portal.');
}

async function elegirIp() {
  const interfaces = config.listarIpsLan();
  if (!interfaces.length) {
    return console.log('\n  No hay ninguna tarjeta de red con IP. Conecta el cable al router.');
  }

  console.log('\n  Tarjetas de red detectadas:\n');
  interfaces.forEach((i, indice) => {
    const marca = i.ip === config.ip ? '  <-- en uso ahora' : '';
    console.log(`   ${indice + 1}. ${i.ip.padEnd(16)} ${i.nombre}${i.virtual ? '  (virtual)' : ''}${marca}`);
  });
  console.log('\n   0. Volver a la deteccion automatica');
  console.log('\n  Elige la que este en el MISMO rango que tu router.');
  console.log('  Esa misma IP es la que va como DNS primario en el DHCP.\n');

  const eleccion = await preguntar('  Numero (vacio para cancelar): ');
  if (!eleccion) return console.log('\n  Cancelado.');

  if (eleccion === '0') {
    ajustes.guardar({ ip: null });
    return console.log('\n  Vuelve a detectarse sola al arrancar.');
  }

  const elegida = interfaces[Number(eleccion) - 1];
  if (!elegida) return console.log('\n  Ese numero no esta en la lista.');

  ajustes.guardar({ ip: elegida.ip });
  console.log(`\n  Fijada la IP ${elegida.ip} (${elegida.nombre}).`);
  console.log(`  Recuerda poner ${elegida.ip} como DNS primario en el DHCP del router.`);
}

// Exportar y respaldar viven en scripts propios para que el panel grafico y
// esta consola compartan exactamente la misma implementacion.
const exportarCenso = () => correr(process.execPath, [path.join('tools', 'exportar-csv.js')]);
const respaldar = () => correr(process.execPath, [path.join('tools', 'respaldar.js')]);

async function vaciarBase() {
  const estado = await estadoActual();
  if (estado.corriendo) {
    console.log('\n  El portal esta CORRIENDO. Detenlo antes de vaciar la base.');
    return;
  }
  const censo = contarCenso();
  if (!censo) {
    return console.log('\n  La base ya esta limpia.');
  }

  console.log(`\n  Vas a borrar ${censo.personas} persona(s) y ${censo.mensajes} mensaje(s).`);
  console.log('  Se guarda un respaldo automatico antes de borrar.');
  if (!(await confirmar('¿Seguro?'))) {
    return console.log('\n  Cancelado, no se borro nada.');
  }
  correr(process.execPath, [path.join('tools', 'reiniciar-bd.js')]);
}

async function regenerarCertificado() {
  console.log('\n  Esto emite un certificado nuevo para el canal del GPS.');
  console.log('  Hazlo si CAMBIO LA IP del puesto de mando.');
  console.log('\n  OJO: los celulares que ya aceptaron el aviso lo veran otra vez.');
  if (!(await confirmar('¿Emitir uno nuevo?'))) {
    return console.log('\n  Cancelado.');
  }
  fs.rmSync(carpetaTls, { recursive: true, force: true });
  console.log('\n  Certificado borrado. Se emite uno nuevo al arrancar el portal.');
}

async function reglasFirewall() {
  if (os.platform() !== 'win32') {
    return console.log('\n  Esto solo aplica en Windows.');
  }

  const reglas = [
    ['SOS Portal HTTP', 'TCP', config.puertoHttp],
    ['SOS Portal HTTPS', 'TCP', config.puertoHttps],
    ['SOS Portal DNS', 'UDP', config.puertoDns],
  ];

  console.log('\n  Abriendo los puertos del portal en el firewall...\n');
  let fallos = 0;
  for (const [nombre, protocolo, puerto] of reglas) {
    const codigo = correr('netsh', [
      'advfirewall', 'firewall', 'add', 'rule',
      `name=${nombre}`, 'dir=in', 'action=allow',
      `protocol=${protocolo}`, `localport=${puerto}`,
    ], { stdio: 'ignore' });
    const bien = codigo === 0;
    if (!bien) fallos += 1;
    console.log(`   ${bien ? '[ OK ]' : '[FALLA]'} ${nombre.padEnd(18)} ${protocolo}/${puerto}`);
  }

  if (fallos) {
    console.log('\n  Alguna regla fallo. Casi siempre es falta de permisos:');
    console.log('  cierra esto y vuelve a abrirlo COMO ADMINISTRADOR.');
  } else {
    console.log('\n  Listo. Los celulares ya pueden alcanzar el portal.');
  }
}

async function verCenso() {
  const censo = contarCenso();
  if (!censo || censo.personas === 0) {
    return console.log('\n  Todavia no se ha registrado nadie.');
  }

  const { personas } = require('../src/db');
  const lista = personas.listar();
  const porEstado = {};
  for (const p of lista) porEstado[p.estadoEtiqueta] = (porEstado[p.estadoEtiqueta] || 0) + 1;

  console.log(`\n  ${censo.personas} persona(s) registrada(s), ${censo.mensajes} mensaje(s).\n`);
  for (const [etiqueta, cuantos] of Object.entries(porEstado)) {
    console.log(`   ${String(cuantos).padStart(4)}  ${etiqueta}`);
  }

  const pendientes = lista.filter((p) => !p.atendido && p.urgencia >= 30);
  if (pendientes.length) {
    console.log(`\n  ${pendientes.length} caso(s) grave(s) sin atender:\n`);
    for (const p of pendientes.slice(0, 10)) {
      console.log(`   ${p.codigo}  ${p.nombre}  —  ${p.estadoEtiqueta}`);
      if (p.ubicacion) console.log(`            ${p.ubicacion.split('\n')[0]}`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Menu
 * ------------------------------------------------------------------ */

async function pintarMenu() {
  const estado = await estadoActual();
  limpiar();

  console.log('');
  console.log('  ' + linea('═'));
  console.log('   SOS · CONECTATE · PIDE AYUDA — Consola de administracion');
  console.log('  ' + linea('═'));
  console.log('');
  console.log(`   Puesto  : ${estado.puesto}`);
  console.log(`   IP      : ${estado.ip}${estado.ipForzada ? '  (fijada a mano)' : '  (automatica)'}`);
  console.log(`   Portal  : ${estado.corriendo
    ? `CORRIENDO en ${estado.portal?.urlBase || config.urlBase}`
    : 'detenido'}`);
  // Que el DNS no haya arrancado es silencioso y fatal: el portal deja de
  // abrirse solo en los celulares. Aqui no puede pasar desapercibido.
  if (estado.corriendo) {
    console.log(`   DNS     : ${estado.portal?.puertoDns
      ? `activo en el puerto ${estado.portal.puertoDns}`
      : 'APAGADO — el portal NO se abrira solo (mira la ventana del portal)'}`);
  }
  console.log(`   Censo   : ${estado.censo ? `${estado.censo.personas} personas` : 'base vacia'}`);
  console.log(`   PIN     : ${estado.pin}${estado.pin === '1234' ? '   <-- CAMBIALO (opcion 5)' : ''}`);
  console.log(`   GPS     : ${estado.certificado ? 'certificado listo' : 'se emite al arrancar'}`);
  // Los ajustes se leen al ARRANCAR el portal, no en caliente. Si no se dice,
  // el orden correcto (configurar y despues iniciar) no es evidente.
  if (!estado.corriendo && (estado.pin === '1234' || !estado.ipForzada)) {
    console.log('   ┌──────────────────────────────────────────────────────────┐');
    console.log('   │  ¿Primera vez? Configura (5 a 8) y DESPUES arranca (1).  │');
    console.log('   │  Los cambios se aplican al iniciar el portal, no antes.  │');
    console.log('   └──────────────────────────────────────────────────────────┘');
    console.log('');
  }

  console.log('  ' + linea());
  console.log('   PORTAL');
  console.log('    1. Iniciar el portal            (puertos 80 / 443 / 53)');
  console.log('    2. Iniciar en puertos altos     (pruebas, sin Administrador)');
  console.log('    3. Iniciar en modo diagnostico  (¿el portal no abre solo?)');
  console.log(`    4. Detener el portal            ${estado.corriendo ? '' : '(ahora mismo no corre)'}`);
  console.log('');
  console.log('   CONFIGURAR');
  console.log('    5. Cambiar el PIN de operador');
  console.log('    6. Cambiar el nombre del puesto');
  console.log('    7. Elegir la tarjeta de red / IP');
  console.log('    8. Abrir los puertos en el firewall');
  console.log('');
  console.log('   DATOS');
  console.log('    9. Ver resumen del censo');
  console.log('   10. Exportar el censo a CSV');
  console.log('   11. Respaldar la base de datos');
  console.log('   12. Vaciar la base de datos');
  console.log('');
  console.log('   VERIFICAR');
  console.log('   13. Diagnostico previo al despliegue');
  console.log('   14. Prueba de humo end-to-end');
  console.log('   15. Emitir un certificado nuevo para el GPS');
  console.log('');
  console.log('    0. Salir');
  console.log('  ' + linea());
}

const acciones = {
  1: () => lanzarPortal([], 'Iniciando el portal en los puertos reales...'),
  2: () => lanzarPortal(
    ['--http', '8080', '--dns', '5354', '--https', '8443'],
    'Iniciando en puertos altos: http://localhost:8080'
  ),
  3: modoDiagnostico,
  4: detenerPortal,
  5: cambiarPin,
  6: cambiarPuesto,
  7: elegirIp,
  8: reglasFirewall,
  9: verCenso,
  10: exportarCenso,
  11: respaldar,
  12: vaciarBase,
  13: () => correr(process.execPath, [path.join('pruebas', 'diagnostico.js')]),
  14: async () => {
    let estado = await estadoActual();

    // Antes esto decia "arrancalo y vuelve", cosa imposible cuando el portal
    // bloqueaba la consola. Ahora podemos ofrecer arrancarlo aqui mismo.
    if (!estado.corriendo) {
      console.log('\n  La prueba necesita el portal corriendo.');
      if (!(await confirmar('¿Lo arranco en puertos altos y sigo?'))) {
        return console.log('\n  Cancelado.');
      }
      await lanzarPortal(
        ['--http', '8080', '--dns', '5354', '--https', '8443'],
        'Arrancando para la prueba...'
      );
      estado = await estadoActual();
      if (!estado.corriendo) return console.log('\n  No arranco. Revisa la otra ventana.');
    }
    // Usamos los puertos REALES del portal que esta arriba, no los que
    // tendria este proceso por configuracion.
    const portal = estado.portal;
    console.log('\n  OJO: la prueba crea personas de ejemplo en la base.');
    console.log('  Si ya estas en operacion, no la corras.\n');
    if (!(await confirmar('¿Correr la prueba de todos modos?'))) {
      return console.log('\n  Cancelado.');
    }
    // Si el portal arranco sin DNS pasamos 0 para que esas pruebas se omitan
    // en vez de apuntar al puerto por defecto y fallar con un timeout que
    // despista.
    correr(process.execPath, [
      path.join('pruebas', 'humo.js'),
      '--url', portal?.urlBase || config.urlBase,
      '--dns', String(portal?.puertoDns || 0),
      '--seguro', String(portal?.puertoHttps || config.puertoHttps),
      '--pin', estado.pin,
    ]);
  },
  15: regenerarCertificado,
};

async function main() {
  abrirEntrada();
  for (;;) {
    await pintarMenu();
    const eleccion = await preguntar('\n   Opcion (Enter = 1, iniciar): ');

    if (eleccion === '0') {
      console.log('\n  Hasta luego.\n');
      entrada?.close();
      return;
    }

    const accion = acciones[eleccion === '' ? 1 : Number(eleccion)];
    if (!accion) {
      console.log('\n  Esa opcion no existe.');
      await pausa();
      continue;
    }

    try {
      await accion();
    } catch (err) {
      console.log(`\n  Algo fallo: ${err.message}`);
    }
    await pausa();
  }
}

main().catch((err) => {
  console.error(`\n  Error inesperado: ${err.message}\n`);
  process.exit(1);
});
