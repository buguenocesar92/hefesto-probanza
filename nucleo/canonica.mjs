// Forma canónica de un evento.
//
// AQUÍ SE DECIDE ALGO QUE DESPUÉS NO SE PUEDE CAMBIAR: la manera de calcular el
// hash tiene que dar el MISMO resultado en JavaScript, en Python y en el motor
// de quien verifique dentro de diez años.
//
// Regla: JSON con claves ordenadas, sin espacios, UTF-8. Diez líneas en
// cualquier lenguaje, cero dependencias, sin ambigüedad.
//
// Lo que NO puede ser canónico, y por eso queda prohibido en el contrato:
//   - el orden de un Map de JavaScript (no está definido por la especificación),
//   - un decimal: 0.1 no tiene una única representación entre lenguajes,
//   - una fecha en formato local.
// El tiempo viaja como ISO-8601 UTC en texto y los contadores son enteros.

import {createHash} from 'node:crypto';

export const VERSION_EVENTO = 'evento.v1';

/**
 * JSON canónico: claves ordenadas, sin espacios, UTF-8.
 * @param {*} valor
 * @returns {string}
 */
export function canonico(valor) {
  if (valor === null || valor === undefined) return 'null';

  const t = typeof valor;

  if (t === 'boolean') return valor ? 'true' : 'false';

  if (t === 'number') {
    if (!Number.isFinite(valor)) {
      throw new Error('Un evento no puede llevar NaN ni Infinity: no es canónico.');
    }
    if (!Number.isInteger(valor)) {
      // 0.1 y -0 no tienen una representación única entre lenguajes. La cadena
      // de evidencia no necesita decimales, así que un decimal es seña de un
      // evento mal formado y conviene que se note acá, no en una auditoría.
      throw new Error('El contrato no admite decimales; llegó ' + valor);
    }
    return Object.is(valor, -0) ? '0' : String(valor);
  }

  if (t === 'string') return JSON.stringify(valor);

  if (Array.isArray(valor)) return '[' + valor.map(canonico).join(',') + ']';

  if (t === 'object') {
    const claves = Object.keys(valor)
      .filter((k) => valor[k] !== undefined)
      .sort();
    return '{' + claves.map((k) => JSON.stringify(k) + ':' + canonico(valor[k])).join(',') + '}';
  }

  throw new Error('Tipo no canónico: ' + t);
}

export function sha256(texto) {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

/**
 * Calcula el hash de un evento. La cadena se construye como
 *
 *     sha256( previo || "\0" || canónico(evento sin su campo hash) )
 *
 * El separador `\0` no puede aparecer dentro de ninguno de los dos operandos
 * porque el primero es hex y el segundo es JSON, así que la concatenación es
 * inequívoca: no hay forma de mover bytes de un lado al otro y obtener el
 * mismo hash.
 *
 * @param {object} evento El evento, con o sin su campo `hash`.
 * @returns {string} 64 hexadecimales
 */
export function hashEvento(evento) {
  const {hash, ...sinHash} = evento;
  void hash;
  return sha256(`${evento.previo || ''}\0${canonico(sinHash)}`);
}

/**
 * Valida la forma de un evento antes de dejarlo entrar a la cadena. Es
 * deliberadamente estricta: un evento mal formado que entra ahora es un evento
 * que hay que reconstruir a mano dentro de un año.
 *
 * La regla que más importa: `datos` NUNCA lleva valores, solo tipos y
 * conteos. Es la misma línea que sostiene todo el ecosistema: la auditoría
 * registra qué pasó, nunca el contenido.
 */
export function validarEvento(e) {
  const errores = [];
  const requiere = (cond, msg) => { if (!cond) errores.push(msg); };

  requiere(e && typeof e === 'object' && !Array.isArray(e), 'el evento debe ser un objeto');
  // Si no es un objeto no hay nada más que mirar: seguir leyendo campos de
  // algo que no los tiene sólo daría un TypeError en vez de un diagnóstico.
  if (errores.length) return errores;

  requiere(e.v === VERSION_EVENTO, `v debe ser "${VERSION_EVENTO}"`);
  requiere(Number.isInteger(e.seq) && e.seq >= 0, 'seq debe ser un entero >= 0');
  requiere(typeof e.ts === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(e.ts),
    'ts debe ser ISO-8601 UTC terminado en Z');
  requiere(['anonimizador', 'arcop', 'gen_auditor', 'seguridad', 'conformidad'].includes(e.sistema),
    `sistema desconocido: ${e.sistema}`);
  requiere(typeof e.tipo === 'string' && e.tipo.length > 0, 'tipo obligatorio');
  requiere(typeof e.proposito === 'string' && e.proposito.length > 0,
    'proposito obligatorio: sin él no hay forma de saber si un consentimiento cubría el envío');

  if (e.consentimiento !== null && e.consentimiento !== undefined) {
    requiere(typeof e.consentimiento === 'string' && e.consentimiento.length > 0,
      'consentimiento debe ser un identificador o null');
  }

  if (e.sujeto_ref !== null && e.sujeto_ref !== undefined) {
    // El sujeto es un HMAC de 64 hex, nunca el titular.
    requiere(typeof e.sujeto_ref === 'string' && /^[a-f0-9]{64}$/.test(e.sujeto_ref),
      'sujeto_ref debe ser 64 hexadecimales (HMAC) o null');
  }

  requiere(e.previo === null || (typeof e.previo === 'string' && /^[a-f0-9]{64}$/.test(e.previo)),
    'previo debe ser 64 hexadecimales o null');

  requiere(e.datos && typeof e.datos === 'object' && !Array.isArray(e.datos),
    'datos debe ser un objeto');

  if (e.datos && typeof e.datos === 'object') {
    for (const clave of Object.keys(e.datos)) {
      const valor = e.datos[clave];
      // `severidad` entra junto a los conteos porque es un entero acotado, no
      // un valor: el orden de gravedad de un hallazgo tiene que quedar en la
      // cadena, y meterlo en una lista de texto abriría la puerta a lo que este
      // contrato no admite.
      const esConteo = Number.isInteger(valor) && /^(cantidad|total|bloques|severidad)$/.test(clave);
      // `huellas` es la lista de huellas que permite deduplicar: el mismo
      // hallazgo en dos corridas es el mismo hallazgo, y sin eso cada corrida
      // agregaría ruido y los hallazgos antiguos pasarían desapercibidos.
      const esLista = Array.isArray(valor) && /^(tipos|propositos|categorias|roles|huellas)$/.test(clave);
      requiere(esConteo || esLista,
        `datos.${clave} no es un conteo ni una lista de tipos: el contrato no admite valores`);
      if (esConteo && clave === 'severidad') {
        requiere(valor >= 1 && valor <= 5, 'datos.severidad va de 1 (informativa) a 5 (crítica)');
      }
      if (esLista) {
        for (const v of valor) {
          // Forma, no longitud. "Juan Pérez" tiene 10 caracteres y entraría
          // fácil en un límite de 40; lo que lo delata es el espacio y la
          // mayúscula. Un tipo de dato es un identificador en minúsculas, y
          // esa restricción deja pasar cualquier detector nuevo sin dejar
          // pasar una frase.
          //
          // La segunda forma es una huella de 64 hexadecimales: no lleva
          // contenido, y es lo que permite refers a un hallazgo sin escribirlo
          // en la cadena.
          requiere(
            typeof v === 'string' && (/^[a-z0-9_]{1,32}$/.test(v) || /^[a-f0-9]{64}$/.test(v)),
            `datos.${clave} admite solo identificadores en minúsculas (ej. "rut", "discapacidad") o huellas de 64 hex, no contenido`,
          );
        }
      }
    }
  }

  return errores;
}