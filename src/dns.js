'use strict';

/**
 * Servidor DNS minimo que responde TODA consulta con la IP del puesto de mando.
 * Es el corazon del portal cautivo: cuando el celular pregunta por
 * "connectivitycheck.gstatic.com" le contestamos con nuestra IP, el chequeo de
 * internet falla, y el sistema operativo abre solo la ventana de "Iniciar sesion".
 *
 * Escrito a mano sobre dgram para no depender de ningun paquete externo: en
 * terreno no vamos a poder hacer `npm install`.
 */

const dgram = require('node:dgram');

const TIPO = { A: 1, AAAA: 28, HTTPS: 65 };
const CLASE_IN = 1;
const TTL = 30; // corto: si movemos el servidor, los equipos se reajustan rapido

function leerNombre(buf, offset) {
  const partes = [];
  let pos = offset;
  let saltos = 0;

  while (pos < buf.length) {
    const largo = buf[pos];
    if (largo === 0) { pos += 1; break; }

    if ((largo & 0xc0) === 0xc0) {
      if (saltos++ > 5) throw new Error('bucle de compresion DNS');
      const destino = ((largo & 0x3f) << 8) | buf[pos + 1];
      const sub = leerNombre(buf, destino);
      partes.push(sub.nombre);
      return { nombre: partes.filter(Boolean).join('.'), fin: pos + 2 };
    }

    pos += 1;
    partes.push(buf.subarray(pos, pos + largo).toString('latin1'));
    pos += largo;
  }

  return { nombre: partes.join('.'), fin: pos };
}

function construirRespuesta(consulta, ip) {
  if (consulta.length < 12) return null;

  const id = consulta.readUInt16BE(0);
  const banderas = consulta.readUInt16BE(2);
  const esConsulta = (banderas & 0x8000) === 0;
  const opcode = (banderas >> 11) & 0x0f;
  const rd = (banderas >> 8) & 1;
  const qdcount = consulta.readUInt16BE(4);

  if (!esConsulta || opcode !== 0 || qdcount < 1) return null;

  const { nombre, fin } = leerNombre(consulta, 12);
  const finPregunta = fin + 4;
  if (finPregunta > consulta.length) return null;

  const qtype = consulta.readUInt16BE(fin);
  const qclase = consulta.readUInt16BE(fin + 2);

  // Solo respondemos A/IN con nuestra IP. Para AAAA y HTTPS devolvemos NOERROR
  // sin respuestas: asi el equipo deja de insistir por IPv6 y cae a IPv4 (a
  // nosotros). Si devolvieramos error, algunos Android se quedan colgados.
  const respondemos = qclase === CLASE_IN && qtype === TIPO.A;

  const cabecera = Buffer.alloc(12);
  cabecera.writeUInt16BE(id, 0);
  // QR=1, AA=1, RA=1, RCODE=0, y respetamos el RD que nos pidieron
  cabecera.writeUInt16BE(0x8400 | (rd << 8) | 0x0080, 2);
  cabecera.writeUInt16BE(1, 4);                    // QDCOUNT
  cabecera.writeUInt16BE(respondemos ? 1 : 0, 6);  // ANCOUNT
  cabecera.writeUInt16BE(0, 8);                    // NSCOUNT
  cabecera.writeUInt16BE(0, 10);                   // ARCOUNT (descartamos EDNS)

  const pregunta = consulta.subarray(12, finPregunta);
  if (!respondemos) return { buffer: Buffer.concat([cabecera, pregunta]), nombre, qtype };

  const respuesta = Buffer.alloc(16);
  respuesta.writeUInt16BE(0xc00c, 0);   // puntero al nombre de la pregunta
  respuesta.writeUInt16BE(TIPO.A, 2);
  respuesta.writeUInt16BE(CLASE_IN, 4);
  respuesta.writeUInt32BE(TTL, 6);
  respuesta.writeUInt16BE(4, 10);       // RDLENGTH
  for (const [i, octeto] of ip.split('.').entries()) respuesta[12 + i] = Number(octeto) & 0xff;

  return { buffer: Buffer.concat([cabecera, pregunta, respuesta]), nombre, qtype };
}

function iniciarDns({ ip, puerto = 53, verboso = false, alResolver }) {
  return new Promise((resolver, rechazar) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let consultas = 0;
    // Contamos dispositivos distintos: es la senal de si el router esta
    // entregando nuestra IP como DNS o no. Cero clientes = el problema esta
    // en el router, no aqui.
    const clientes = new Set();

    socket.on('message', (mensaje, remitente) => {
      let respuesta;
      try {
        respuesta = construirRespuesta(mensaje, ip);
      } catch {
        return; // paquete malformado: lo ignoramos en silencio
      }
      if (!respuesta) return;

      consultas += 1;
      clientes.add(remitente.address);
      if (verboso) {
        console.log(`  [dns] ${remitente.address} -> ${respuesta.nombre} (tipo ${respuesta.qtype})`);
      }
      if (alResolver) alResolver(respuesta.nombre, remitente.address);

      socket.send(respuesta.buffer, remitente.port, remitente.address, () => {});
    });

    socket.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        rechazar(
          new Error(
            `El puerto ${puerto} ya esta ocupado.\n` +
            (puerto === 53
              ? 'En Windows suele ser el "Cliente DNS". Como Administrador: net stop dnscache'
              : puerto === 5353
                ? 'El 5353 es el de mDNS/Bonjour, que viene con iTunes y otros. Usa otro puerto.'
                : 'Cierra lo que lo ocupe o elige otro puerto.') +
            '\nAlternativa sin tocar nada:  npm run puertos-altos'
          )
        );
      } else if (err.code === 'EACCES') {
        rechazar(new Error(`Sin permiso para abrir el puerto ${puerto}. Abre la terminal como Administrador.`));
      } else {
        rechazar(err);
      }
    });

    socket.bind(puerto, '0.0.0.0', () => resolver({
      socket,
      estadisticas: () => ({ consultas, clientes: clientes.size, listaClientes: [...clientes] }),
      cerrar: () => new Promise((r) => socket.close(r)),
    }));
  });
}

module.exports = { iniciarDns, construirRespuesta };
