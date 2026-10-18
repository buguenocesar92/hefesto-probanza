// La cadena de la mesa: los tres orígenes, cada uno en la suya.
//
// POR QUÉ TRES CADENAS Y NO UNA. Un consentimiento revocado y un puerto
// abierto no son el mismo tipo de hecho, y una cadena que mezcla las dos no se
// puede leer ni interpretar. Lo que se comparte es la FORMA del hallazgo
// (mesa/fuentes.mjs) y la maquinaria criptográfica (nucleo/).
//
// LO QUE ESTO RESUELVE. Hoy, un informe de auditoría es un archivo: si alguien
// borra una fila de `NO_CUMPLE` y regenera, el archivo dice que no había nada
// y no hay forma de saberlo. Acá cada hallazgo se encadena y se firma, y el
// anclaje detecta la amputación aunque la cadena quede cuadrada.

import {Cadena} from '../nucleo/cadena.mjs';
import {canonico, sha256} from '../nucleo/canonica.mjs';

const SEP = String.fromCharCode(0);

/**
 * De dónde viene el hallazgo → qué sistema lo emite.
 *
 * `probanza` no es un sistema: es la vista que cruza los otros. El envío sin
 * cobertura lo emitió el anonimizador, y eso es lo que tiene que decir el
 * evento. Poner `probanza` ahí sería atribuir la falta a un sistema que no la
 * produjo.
 */
export const SISTEMA_POR_FUENTE = Object.freeze({
  probanza: 'anonimizador',
  seguridad: 'seguridad',
  conformidad: 'conformidad',
});

/** Un evento por hallazgo. El `sistema` dice de qué cadena es. */
export function eventoDe(item) {
  const ts = normalizaTiempo(item.ts);
  return {
    sistema: SISTEMA_POR_FUENTE[item.fuente] ?? item.fuente,
    tipo: 'hallazgo.detectado',
    proposito: 'superficie',
    consentimiento: null,
    sujeto_ref: null,
    datos: {
      tipos: tiposDe(item),
      huellas: [sha256(`${item.fuente}${SEP}${item.id ?? ''}`)],
      cantidad: 1,
      severidad: item.nivel,
    },
    ts,
  };
}

/**
 * Las etiquetas de `datos.tipos`. Deben pasar `/^[a-z0-9_]{1,32}$/`.
 *
 * Los estados de spaudit usan espacio ("NO VERIFICADO") y los de Strix usan
 * guion, y el contrato no admite espacios: por eso se normalizan aquí, y no
 * en el contrato, porque el contrato es más viejo que esto y no se toca por
 * accommodate a cada consumidor.
 */
function tiposDe(item) {
  const crudo = [
    item.fuente,
    item.categoria,
    item.estado,
    ...(item.cwe ?? []).map((c) => `cwe_${c}`),
  ];
  return [...new Set(
    crudo
      .filter(Boolean)
      .map((s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''))
      .filter(Boolean),
  )].slice(0, 4);
}

/**
 * Convierte a ISO-8601 UTC.
 *
 * spaudit emite `"2026-10-17 10:45:06"` (sin zona), Strix emite
 * `"2026-10-17 12:00:00 UTC"`. Los dos se parsean a mano por la misma razón
 * que en la puerta: `new Date()` los acepta por cortesía de V8, no por
 * especificación, y un parser que depende de la buena voluntad del motor se
 * rompe cuando el motor se pone estricto.
 *
 * Un tiempo sin zona se lee como UTC a propósito. En una auditoría de una
 * organización chilena, la hora del corrector es irrelevante: lo que ordena es
 * el orden en que aparecieron los hechos.
 */
function normalizaTiempo(ts) {
  if (typeof ts !== 'string' || !ts.length) throw new Error('hallazgo sin timestamp');
  const strix = ts.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (strix) {
    const [, a, m, d, hh, mm, ss] = strix;
    return `${a}-${m}-${d}T${hh}:${mm}:${ss}.000Z`;
  }
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(ts)) return ts;
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) throw new Error(`timestamp ilegible: ${JSON.stringify(ts)}`);
  return d.toISOString();
}

/**
 * Encadena todos los hallazgos de todas las fuentes, en una cadena por fuente.
 *
 * El orden es determinista (gravedad, luego clave) para que la misma entrada
 * dé siempre los mismos hashes. Si dos corridas dieran distinto hash sin que
 * cambiaran los hallazgos, el hash habría dejado de ser evidencia de algo.
 */
export function encadenar(items, {reloj = () => new Date()} = {}) {
  const porFuente = new Map();
  for (const item of items) {
    if (!porFuente.has(item.fuente)) porFuente.set(item.fuente, []);
    porFuente.get(item.fuente).push(item);
  }

  const cadenas = {};
  const errores = [];

  for (const [fuente, lista] of porFuente) {
    const cadena = Cadena.nueva();
    const ordenados = [...lista].sort((a, b) => b.nivel - a.nivel ||
      String(a.id ?? '').localeCompare(String(b.id ?? '')));
    for (const item of ordenados) {
      try {
        const e = eventoDe(item);
        if (!item.ts) e.ts = new Date(reloj()).toISOString();
        const agregado = cadena.agregar(e);
        item.seq = agregado.seq;
        item.hash = agregado.hash;
      } catch (e) {
        // Un hallazgo que no se puede encadenar no se tira en silencio: queda
        // anotado. Perder un hallazgo sin dejar rastro es peor que no
        // registrarlo, porque el informe haría como si no existiera.
        errores.push({id: item.id, fuente, motivo: e.message});
      }
    }
    cadenas[fuente] = cadena;
  }

  return {cadenas, errores};
}

/** Huella del conjunto: dos corridas iguales dan el mismo valor. */
export function huellaDe(cadenas) {
  const forma = {};
  for (const [fuente, cadena] of Object.entries(cadenas)) {
    forma[fuente] = cadena.eventos.map((e) => e.hash);
  }
  return sha256(canonico(forma));
}

/** Verifica las tres cadenas y devuelve un solo veredicto. */
export function verificarTodo(cadenas) {
  const porFuente = {};
  let ok = true;
  for (const [fuente, cadena] of Object.entries(cadenas)) {
    const r = cadena.verificar();
    porFuente[fuente] = {ok: r.ok, total: cadena.eventos.length, motivo: r.motivo ?? null};
    if (!r.ok) ok = false;
  }
  return {ok, porFuente};
}