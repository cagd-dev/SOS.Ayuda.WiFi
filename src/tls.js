'use strict';

/**
 * Certificado propio para el canal HTTPS.
 *
 * ¿Por que necesitamos HTTPS si todo el portal es HTTP? Por una sola cosa: el
 * GPS. Los navegadores solo entregan la ubicacion en "contexto seguro", y en
 * terreno no hay autoridad certificadora que nos firme nada. Asi que nos
 * firmamos nosotros y guiamos a la persona para que acepte el aviso.
 *
 * El certificado se genera una vez y se guarda. Si cambia la IP del puesto de
 * mando se regenera solo, porque un certificado emitido para otra IP haria que
 * el navegador rechace la conexion sin ofrecer siquiera el boton de continuar.
 */

const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');

const carpeta = path.join(config.carpetaDatos, 'tls');
const rutaCert = path.join(carpeta, 'cert.pem');
const rutaClave = path.join(carpeta, 'clave.pem');
const rutaSello = path.join(carpeta, 'emitido-para.json');

function leerGuardado(ip, host) {
  try {
    const sello = JSON.parse(fs.readFileSync(rutaSello, 'utf8'));
    if (sello.ip !== ip || sello.host !== host) return null;
    return {
      cert: fs.readFileSync(rutaCert, 'utf8'),
      key: fs.readFileSync(rutaClave, 'utf8'),
      huella: sello.huella,
      nuevo: false,
    };
  } catch {
    return null; // no existe, esta corrupto, o es de otra IP
  }
}

async function asegurarCertificado({ ip, host }) {
  fs.mkdirSync(carpeta, { recursive: true });

  const guardado = leerGuardado(ip, host);
  if (guardado) return guardado;

  const selfsigned = require('selfsigned');

  // El subjectAltName es obligatorio: desde hace años los navegadores ignoran
  // el commonName. Sin la IP aqui dentro, ni Chrome ni Safari ofrecen continuar.
  const pems = await selfsigned.generate(
    [
      { name: 'commonName', value: ip },
      { name: 'organizationName', value: config.nombrePuesto },
      { name: 'countryName', value: 'CO' },
    ],
    {
      keySize: 2048,
      days: 3650,
      algorithm: 'sha256',
      extensions: [
        { name: 'basicConstraints', cA: true },
        {
          name: 'keyUsage',
          keyCertSign: true,
          digitalSignature: true,
          keyEncipherment: true,
        },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 7, ip },              // 7 = direccion IP
            { type: 2, value: host },     // 2 = nombre DNS
            { type: 2, value: 'localhost' },
            { type: 7, ip: '127.0.0.1' },
          ],
        },
      ],
    }
  );

  fs.writeFileSync(rutaCert, pems.cert, { mode: 0o600 });
  fs.writeFileSync(rutaClave, pems.private, { mode: 0o600 });
  fs.writeFileSync(
    rutaSello,
    JSON.stringify({ ip, host, huella: pems.fingerprint, creado: new Date().toISOString() }, null, 2)
  );

  return { cert: pems.cert, key: pems.private, huella: pems.fingerprint, nuevo: true };
}

module.exports = { asegurarCertificado };
