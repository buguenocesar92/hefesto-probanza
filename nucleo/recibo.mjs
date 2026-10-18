// Recibo de salida: la prueba de qué vio el modelo.
//
// QUÉ RESUELVE. Cuando un vecino escribe «necesito la credencial de mi hijo» y
// eso llega a un proveedor externo, la pregunta que aparece un año después es
// «¿qué le mandamos exactamente?». Sin un recibo firmado, la única respuesta es
// «no lo sé» o, peor, «según el log» — y el log se edita.
//
// QUÉ FIRMA Y QUÉ NO.
//
//   Firma: el hash del texto tal como salió, los tipos de dato que se taparon,
//   cuántos eran, la cantidad de caracteres antes y después, el consentimiento
//   que lo cubrió, y el instante.
//
//   No firma, y no puede: el texto. Un recibo termina en un expediente, en un
//   requerimiento de una autoridad, y en un archivo con más permisos que el
//   propio texto que protege. Poner el texto ahí sería crear una segunda copia
//   de lo que se acababa de tapar.
//
// Lo que queda alcanza para comprobar la afirmación sin exponer el dato: si
// alguien dice «al modelo nunca le llegó su RUT», el recibo lo demuestra. No
// permite reconstruir qué dijo el vecino, y esa asimetría es deliberada.
//
// NO ES FIRMA ELECTRÓNICA ACREDITADA. Es Ed25519 sobre un manifiesto: prueba
// criptográfica de que el manifiesto no cambió desde que se emitió. No prueba
// quién es el emisor ante un tercero ni cumple la Ley 19.800. Para eso hace
// falta certificado y prestador de servicios de confianza.

import {
  createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomUUID, sign, verify,
} from 'node:crypto';
import {canonico} from './canonica.mjs';

export const VERSION_RECIBO = 'recibo.v1';
export const ALGORITMO = 'ed25519';

/**
 * Arma el manifiesto de una salida. Todavía NO está firmado.
 *
 * @returns {object} El manifiesto, listo para `firmarRecibo`.
 */
export function emitirRecibo({
  textoSeguro, tipos, cantidad, consentimiento, proposito, proveedor,
  caracteresOriginales, ts,
}) {
  if (typeof textoSeguro !== 'string') throw new Error('textoSeguro es obligatorio');
  if (!Array.isArray(tipos)) throw new Error('tipos debe ser una lista');
  if (!Number.isInteger(cantidad) || cantidad < 0) throw new Error('cantidad debe ser un entero >= 0');
  // Misma forma que exige el contrato del evento (`datos.tipos`), y a propósito.
  // El manifiesto es lo que se firma y lo que se archiva: es el objeto de vida
  // más larga de todo el sistema, así que no puede ser el más permisivo. Un
  // límite solo por longitud dejaría pasar "Nombre Completo" como tipo, que es
  // contenido disfrazado de etiqueta.
  if (tipos.some((t) => typeof t !== 'string' || !/^[a-z0-9_]{1,32}$/.test(t))) {
    throw new Error('tipos admite solo identificadores en minúsculas (ej. "rut"), no contenido');
  }
  if (consentimiento !== null && consentimiento !== undefined) {
    if (typeof consentimiento !== 'string' || !consentimiento.length) {
      throw new Error('consentimiento debe ser un identificador o null');
    }
  }

  return {
    v: VERSION_RECIBO,
    id: randomUUID(),
    ts: ts instanceof Date ? ts.toISOString() : ts,
    consentimiento: consentimiento ?? null,
    proposito,
    proveedor,
    // El texto entra SOLO como hash. Como los marcadores llevan un nonce por
    // mensaje, dos salidas distintas dan hashes distintos aunque el contenido
    // visible sea el mismo: es justo lo que hace el recibo útil como prueba de
    // que una salida concreta ocurrió.
    texto_sha256: createHash('sha256').update(textoSeguro, 'utf8').digest('hex'),
    caracteres_enviados: textoSeguro.length,
    caracteres_originales: caracteresOriginales,
    tipos: [...tipos].sort(),
    cantidad,
  };
}

/**
 * Firma un manifiesto.
 *
 * El manifiesto firmado y la firma son objetos separados a propósito. Un
 * auditor recibe `{manifiesto, kid, firma}` y comprueba la firma sobre la forma
 * canónica del manifiesto, sin que esta implementación tenga que reconstruir
 * qué campos iba a tener la firma. Si el sobre fuera un solo objeto, toda
 * recomposición sería un lugar donde la verificación puede mentir.
 *
 * @param {object} manifiesto Salida de `emitirRecibo`.
 * @param {string} privadaPEM
 * @param {string} kid Identificador de la llave, para poder rotar sin ambigüedad.
 * @returns {{manifiesto: object, kid: string, firma: string, alg: string}}
 */
export function firmarRecibo(manifiesto, privadaPEM, kid) {
  if (!kid) throw new Error('kid es obligatorio: sin identificador no se puede rotar la llave');
  const firma = sign(null, Buffer.from(canonico(manifiesto), 'utf8'), createPrivateKey(privadaPEM));
  return {manifiesto, kid, alg: ALGORITMO, firma: firma.toString('base64')};
}

/**
 * Verifica el sobre. Devuelve el motivo si falla, no un `false` pelado: el que
 * audita necesita saber si fue una alteración o una llave desconocida.
 *
 * @param {{manifiesto:object, kid:string, firma:string, alg:string}} sobre
 * @returns {{ok:boolean, motivo:string}}
 */
export function verificarRecibo(sobre) {
  if (!sobre || !sobre.manifiesto) return {ok: false, motivo: 'sobre incompleto'};
  if (sobre.alg !== ALGORITMO) return {ok: false, motivo: `algoritmo desconocido: ${sobre.alg}`};
  if (sobre.manifiesto.v !== VERSION_RECIBO) {
    return {ok: false, motivo: `versión de manifiesto desconocida: ${sobre.manifiesto.v}`};
  }
  if (!sobre.firma || !sobre.kid) return {ok: false, motivo: 'sobre sin firmar'};

  let publica;
  try {
    publica = LLAVES.get(sobre.kid);
  } catch {
    publica = undefined;
  }
  if (!publica) {
    return {
      ok: false,
      motivo: `llave desconocida: "${sobre.kid}". Un recibo firmado con una llave que no está en el registro no se puede verificar.`,
    };
  }

  let ok = false;
  try {
    ok = verify(
      null,
      Buffer.from(canonico(sobre.manifiesto), 'utf8'),
      createPublicKey(publica),
      Buffer.from(sobre.firma, 'base64'),
    );
  } catch (e) {
    return {ok: false, motivo: 'la firma no es un Ed25519 válido: ' + e.message};
  }

  return ok
    ? {ok: true, motivo: 'la firma corresponde al manifiesto'}
    : {ok: false, motivo: 'la firma no corresponde al manifiesto: fue editado o lo firmó otra llave'};
}

// ── Registro de llaves públicas ─────────────────────────────────────────────
// En un despliegue real esto viene de un KMS o de un almacén versionado, nunca
// de una variable de entorno: una llave pública que se puede reemplazar sin
// dejar rastro no sirve para probar nada.
const LLAVES = new Map();

export function registrarLlave(kid, publicaPEM) {
  if (!kid || !publicaPEM) throw new Error('kid y publicaPEM son obligatorios');
  LLAVES.set(kid, publicaPEM);
}

export function olvidarLlave(kid) { LLAVES.delete(kid); }
export function llavesRegistradas() { return [...LLAVES.keys()]; }

/** Par de llaves Ed25519 para desarrollo y pruebas. En producción, del KMS. */
export function generarParDeLLAves(kid) {
  const {publicKey, privateKey} = generateKeyPairSync('ed25519');
  const publica = publicKey.export({type: 'spki', format: 'pem'}).toString();
  const privada = privateKey.export({type: 'pkcs8', format: 'pem'}).toString();
  if (kid) registrarLlave(kid, publica);
  return {publica, privada, kid};
}