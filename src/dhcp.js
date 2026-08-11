'use strict';

/**
 * Servidor DHCP minimo (RFC 2131), para el modo en el que NO hay router.
 *
 * En modo router el DHCP lo pone el router y aqui no se usa nada de esto. Pero
 * si el punto de acceso es la propia tarjeta WiFi del equipo, alguien tiene que
 * repartir direcciones: sin DHCP el celular se queda en 169.254.x.x y no llega
 * a ningun sitio.
 *
 * Escrito a mano sobre dgram, como el DNS: en terreno no se puede instalar nada.
 *
 * Detalle que vale oro: la opcion 114 (RFC 8910) le dice al telefono la URL del
 * portal cautivo DIRECTAMENTE, sin depender del secuestro de DNS. Los sistemas
 * modernos la respetan y abren el portal de inmediato.
 */

const dgram = require('node:dgram');
const fs = require('node:fs');
const path = require('node:path');

const COOKIE_MAGICA = 0x63825363;

const MENSAJE = {
  DESCUBRIR: 1,   // DISCOVER
  OFRECER: 2,     // OFFER
  PEDIR: 3,       // REQUEST
  RECHAZAR: 4,    // DECLINE
  CONFIRMAR: 5,   // ACK
  NEGAR: 6,       // NAK
  LIBERAR: 7,     // RELEASE
  INFORMAR: 8,    // INFORM
};

const OPCION = {
  MASCARA: 1,
  ENRUTADOR: 3,
  DNS: 6,
  NOMBRE_HOST: 12,
  DIFUSION: 28,
  IP_PEDIDA: 50,
  ARRIENDO: 51,
  TIPO_MENSAJE: 53,
  ID_SERVIDOR: 54,
  LISTA_PETICION: 55,
  ID_CLIENTE: 61,
  PORTAL_CAUTIVO: 114,
  FIN: 255,
};

/* ------------------------------------------------------------------ *
 * Analisis y construccion de paquetes (sin sockets: se pueden probar)
 * ------------------------------------------------------------------ */

/** Convierte "192.168.99.1" a un entero de 32 bits. */
function ipANumero(ip) {
  const partes = String(ip).split('.').map(Number);
  if (partes.length !== 4 || partes.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    throw new Error(`IP invalida: ${ip}`);
  }
  return ((partes[0] << 24) >>> 0) + (partes[1] << 16) + (partes[2] << 8) + partes[3];
}

function numeroAIp(numero) {
  return [
    (numero >>> 24) & 0xff,
    (numero >>> 16) & 0xff,
    (numero >>> 8) & 0xff,
    numero & 0xff,
  ].join('.');
}

function macATexto(buffer) {
  return [...buffer].map((b) => b.toString(16).padStart(2, '0')).join(':');
}

/** Devuelve null si el paquete no es un DHCP valido, en vez de lanzar. */
function analizar(mensaje) {
  if (!Buffer.isBuffer(mensaje) || mensaje.length < 240) return null;
  if (mensaje.readUInt32BE(236) !== COOKIE_MAGICA) return null;

  const paquete = {
    op: mensaje[0],
    xid: mensaje.readUInt32BE(4),
    banderas: mensaje.readUInt16BE(10),
    ciaddr: numeroAIp(mensaje.readUInt32BE(12)),
    yiaddr: numeroAIp(mensaje.readUInt32BE(16)), // la que se entrega al cliente
    giaddr: numeroAIp(mensaje.readUInt32BE(24)),
    mac: macATexto(mensaje.subarray(28, 28 + Math.min(mensaje[2] || 6, 16))),
    opciones: {},
  };

  let i = 240;
  while (i < mensaje.length) {
    const codigo = mensaje[i];
    if (codigo === OPCION.FIN) break;
    if (codigo === 0) { i += 1; continue; } // relleno
    const largo = mensaje[i + 1];
    if (largo === undefined || i + 2 + largo > mensaje.length) break;
    paquete.opciones[codigo] = mensaje.subarray(i + 2, i + 2 + largo);
    i += 2 + largo;
  }

  const tipo = paquete.opciones[OPCION.TIPO_MENSAJE];
  paquete.tipo = tipo ? tipo[0] : null;

  const pedida = paquete.opciones[OPCION.IP_PEDIDA];
  paquete.ipPedida = pedida && pedida.length === 4 ? numeroAIp(pedida.readUInt32BE(0)) : null;

  const idServidor = paquete.opciones[OPCION.ID_SERVIDOR];
  paquete.idServidor = idServidor && idServidor.length === 4
    ? numeroAIp(idServidor.readUInt32BE(0)) : null;

  const nombre = paquete.opciones[OPCION.NOMBRE_HOST];
  paquete.nombreHost = nombre ? nombre.toString('utf8').replace(/\0/g, '') : null;

  return paquete;
}

/** Construye la respuesta (OFFER / ACK / NAK). */
function construir(peticion, { tipo, ipCliente, ipServidor, mascara, arriendo, urlPortal }) {
  const cuerpo = Buffer.alloc(240);
  cuerpo[0] = 2;                                   // BOOTREPLY
  cuerpo[1] = 1;                                   // ethernet
  cuerpo[2] = 6;                                   // largo de la MAC
  cuerpo.writeUInt32BE(peticion.xid, 4);
  cuerpo.writeUInt16BE(peticion.banderas, 10);
  if (tipo !== MENSAJE.NEGAR) {
    cuerpo.writeUInt32BE(ipANumero(ipCliente), 16); // yiaddr
  }
  cuerpo.writeUInt32BE(ipANumero(ipServidor), 20);  // siaddr
  cuerpo.writeUInt32BE(ipANumero(peticion.giaddr), 24);

  const mac = Buffer.from(peticion.mac.split(':').map((h) => parseInt(h, 16)));
  mac.copy(cuerpo, 28);
  cuerpo.writeUInt32BE(COOKIE_MAGICA, 236);

  const opciones = [];
  const agregar = (codigo, datos) => {
    opciones.push(Buffer.from([codigo, datos.length]), datos);
  };

  agregar(OPCION.TIPO_MENSAJE, Buffer.from([tipo]));
  agregar(OPCION.ID_SERVIDOR, Buffer.from(ipServidor.split('.').map(Number)));

  if (tipo !== MENSAJE.NEGAR) {
    const arriendoBuf = Buffer.alloc(4);
    arriendoBuf.writeUInt32BE(arriendo);
    agregar(OPCION.ARRIENDO, arriendoBuf);
    agregar(OPCION.MASCARA, Buffer.from(mascara.split('.').map(Number)));

    // Puerta de enlace y DNS somos nosotros. La puerta no lleva a ningun sitio
    // (no hay internet), pero sin ella algunos equipos consideran la red rota.
    agregar(OPCION.ENRUTADOR, Buffer.from(ipServidor.split('.').map(Number)));
    agregar(OPCION.DNS, Buffer.from(ipServidor.split('.').map(Number)));

    const red = ipANumero(ipServidor) & ipANumero(mascara);
    const difusion = (red | (~ipANumero(mascara) >>> 0)) >>> 0;
    agregar(OPCION.DIFUSION, Buffer.from(numeroAIp(difusion).split('.').map(Number)));

    if (urlPortal) {
      agregar(OPCION.PORTAL_CAUTIVO, Buffer.from(urlPortal, 'utf8'));
    }
  }

  opciones.push(Buffer.from([OPCION.FIN]));
  return Buffer.concat([cuerpo, ...opciones]);
}

/* ------------------------------------------------------------------ *
 * Arrendamientos
 * ------------------------------------------------------------------ */

class Arrendamientos {
  constructor({ ipServidor, mascara, desde, hasta, duracion, archivo }) {
    this.ipServidor = ipServidor;
    this.mascara = mascara;
    this.desde = ipANumero(desde);
    this.hasta = ipANumero(hasta);
    this.duracion = duracion;
    this.archivo = archivo;
    this.porMac = new Map();
    this.cargar();
  }

  cargar() {
    if (!this.archivo) return;
    try {
      const guardado = JSON.parse(fs.readFileSync(this.archivo, 'utf8'));
      for (const [mac, datos] of Object.entries(guardado)) this.porMac.set(mac, datos);
    } catch { /* no hay nada guardado todavia */ }
  }

  guardar() {
    if (!this.archivo) return;
    try {
      fs.mkdirSync(path.dirname(this.archivo), { recursive: true });
      fs.writeFileSync(this.archivo, JSON.stringify(Object.fromEntries(this.porMac), null, 2));
    } catch { /* si no se puede persistir, seguimos en memoria */ }
  }

  /**
   * Misma MAC, misma IP siempre que se pueda. Importa mas de lo que parece:
   * el reconocimiento de personas por dispositivo y las sesiones abiertas
   * sobreviven a una reconexion.
   */
  asignar(mac, ipPedida) {
    const existente = this.porMac.get(mac);
    if (existente) {
      existente.hasta = Date.now() + this.duracion * 1000;
      this.guardar();
      return existente.ip;
    }

    if (ipPedida && this.enRango(ipPedida) && !this.ocupada(ipPedida, mac)) {
      return this.registrar(mac, ipPedida);
    }

    const ahora = Date.now();
    for (let n = this.desde; n <= this.hasta; n++) {
      const ip = numeroAIp(n);
      if (ip === this.ipServidor) continue;
      if (!this.ocupada(ip, mac, ahora)) return this.registrar(mac, ip);
    }
    return null; // rango agotado
  }

  registrar(mac, ip) {
    this.porMac.set(mac, { ip, hasta: Date.now() + this.duracion * 1000 });
    this.guardar();
    return ip;
  }

  enRango(ip) {
    try {
      const n = ipANumero(ip);
      return n >= this.desde && n <= this.hasta;
    } catch { return false; }
  }

  ocupada(ip, salvoMac, ahora = Date.now()) {
    for (const [mac, datos] of this.porMac) {
      if (mac === salvoMac) continue;
      if (datos.ip === ip && datos.hasta > ahora) return true;
    }
    return false;
  }

  liberar(mac) {
    this.porMac.delete(mac);
    this.guardar();
  }

  activos(ahora = Date.now()) {
    return [...this.porMac.entries()]
      .filter(([, d]) => d.hasta > ahora)
      .map(([mac, d]) => ({ mac, ip: d.ip, hasta: new Date(d.hasta).toISOString() }));
  }
}

/* ------------------------------------------------------------------ *
 * Servidor
 * ------------------------------------------------------------------ */

function iniciarDhcp({
  ipServidor,
  mascara = '255.255.255.0',
  desde,
  hasta,
  duracion = 3600,
  urlPortal = null,
  archivoArriendos = null,
  verboso = false,
  alAsignar = null,
}) {
  const arrendamientos = new Arrendamientos({
    ipServidor, mascara, desde, hasta, duracion, archivo: archivoArriendos,
  });

  return new Promise((resolver, rechazar) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let entregadas = 0;

    socket.on('message', (mensaje) => {
      let peticion;
      try { peticion = analizar(mensaje); } catch { return; }
      if (!peticion || peticion.op !== 1) return;

      const registrar = (texto) => { if (verboso) console.log(`  [dhcp] ${texto}`); };

      if (peticion.tipo === MENSAJE.LIBERAR) {
        arrendamientos.liberar(peticion.mac);
        registrar(`${peticion.mac} libero su direccion`);
        return;
      }

      if (peticion.tipo !== MENSAJE.DESCUBRIR && peticion.tipo !== MENSAJE.PEDIR) return;

      const ip = arrendamientos.asignar(peticion.mac, peticion.ipPedida);

      if (!ip) {
        // Rango agotado: mejor negar explicitamente que dejar al equipo
        // esperando para siempre.
        const nak = construir(peticion, {
          tipo: MENSAJE.NEGAR, ipServidor, mascara, arriendo: duracion,
        });
        socket.send(nak, 0, nak.length, 68, '255.255.255.255');
        registrar(`${peticion.mac} SIN DIRECCIONES LIBRES`);
        return;
      }

      const esOferta = peticion.tipo === MENSAJE.DESCUBRIR;
      const respuesta = construir(peticion, {
        tipo: esOferta ? MENSAJE.OFRECER : MENSAJE.CONFIRMAR,
        ipCliente: ip,
        ipServidor,
        mascara,
        arriendo: duracion,
        urlPortal,
      });

      socket.send(respuesta, 0, respuesta.length, 68, '255.255.255.255', () => {});

      if (!esOferta) {
        entregadas += 1;
        if (alAsignar) alAsignar({ mac: peticion.mac, ip, nombre: peticion.nombreHost });
      }
      registrar(
        `${esOferta ? 'ofrecida' : 'confirmada'} ${ip} a ${peticion.mac}` +
        (peticion.nombreHost ? ` (${peticion.nombreHost})` : '')
      );
    });

    socket.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        rechazar(new Error(
          'El puerto 67/UDP ya esta ocupado. Suele ser el Servicio de acceso compartido\n' +
          'a Internet (ICS) de Windows. Como Administrador:  net stop sharedaccess'
        ));
      } else if (err.code === 'EACCES') {
        rechazar(new Error('Sin permiso para el puerto 67. Abre el panel como Administrador.'));
      } else {
        rechazar(err);
      }
    });

    socket.bind(67, '0.0.0.0', () => {
      socket.setBroadcast(true);
      resolver({
        socket,
        arrendamientos,
        estadisticas: () => ({ entregadas, activos: arrendamientos.activos() }),
        cerrar: () => new Promise((r) => socket.close(r)),
      });
    });
  });
}

module.exports = {
  iniciarDhcp, analizar, construir, Arrendamientos,
  ipANumero, numeroAIp, MENSAJE, OPCION,
};
