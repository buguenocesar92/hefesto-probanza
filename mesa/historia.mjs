// Continuidad entre corridas: qué es nuevo, qué sigue abierto, qué se cerró.
//
// MISMA LECCIÓN QUE EN LA PUERTA, APLICADA A LAS TRES FUENTES. La clave de
// continuidad NO puede llevar el título, porque un agente LLM lo reescribe en
// cada corrida y eso convierte la deduplicación en ruido. Pero spaudit sí trae
// identificadores estables (`SP-18-03`), y probanza también (`c-revocable`).
//
// Aquí no hay caso difícil: cada origen ya trae su identificador estable, y
// eso es exactamente lo que hace que esto funcione y lo que no funcionó con
// Strix. El título se usa para Mostrar, nunca para Recordar.

import {createHash} from 'node:crypto';

const SEP = String.fromCharCode(0);

/**
 * La clave de continuidad de un hallazgo.
 *
 * `fuente:id` a secas. El identificador es estable **dentro** de su fuente y
 * no tiene por qué ser comparable entre fuentes: `SP-18-03` de conformidad y
 * `VULN-002` de seguridad son cosas distintas aunque los dos sean "4".
 */
export function claveDe(item) {
  return `${item.fuente}:${item.id ?? item.titulo ?? '?'}`;
}

/**
 * Huella del contenido, para detectar que un hallazgo cambió sin que se haya
 * cerrado. Sirve para el informe, no para la identidad.
 */
export function huellaDe(item) {
  return createHash('sha256')
    .update([item.nivel, item.titulo ?? '', item.motivo ?? ''].join(SEP))
    .digest('hex');
}

/**
 * Compara contra la corrida anterior.
 *
 * @param {object} p
 * @param {Array} p.ahora  Hallazgos de esta corrida, de cualquier fuente.
 * @param {object} [p.lineaBase] Mapa `clave -> {primera_vez, ultima_vez, huella}`.
 * @returns {object} Los mismos hallazgos con su estado de continuidad, más las
 *          listas de nuevos, persistentes y cerrados.
 */
export function historiar({ahora = [], lineaBase = {}} = {}) {
  const filas = [];
  const nuevos = [];
  const persistentes = [];
  const cerradas = [];

  for (const item of ahora) {
    const clave = claveDe(item);
    const huella = huellaDe(item);
    const previo = lineaBase[clave];

    const fila = {
      ...item,
      clave,
      huella,
      primera_vez: previo?.primera_vez ?? item.ts ?? null,
      visto_antes: Boolean(previo),
      // Un hallazgo que cambió de texto pero sigue ahí NO es uno nuevo. Es el
      // mismo problema, entendido otra vez.
      cambio_de_texto: Boolean(previo) && previo.huella !== huella,
    };

    if (!previo) nuevos.push(fila);
    else persistentes.push(fila);
    filas.push(fila);
  }

  const clavesActuales = new Set(filas.map((f) => f.clave));
  for (const [clave, previo] of Object.entries(lineaBase)) {
    if (!clavesActuales.has(clave)) cerradas.push({clave, ...previo});
  }

  // Lo abierto primero, y dentro de lo abierto, lo más grave. Un tablero donde
  // el problema está abajo es un tablero que no se lee.
  const porGravedad = (a, b) => b.nivel - a.nivel || a.clave.localeCompare(b.clave);
  filas.sort(porGravedad);

  return {
    filas,
    nuevos: nuevos.sort(porGravedad),
    persistentes: persistentes.sort(porGravedad),
    cerradas,
    resumen: {
      total: filas.length,
      nuevos: nuevos.length,
      persistentes: persistentes.length,
      cerrados: cerradas.length,
      cambios_de_texto: filas.filter((f) => f.cambio_de_texto).length,
      antiguedad_max: antiguedadMax(filas),
    },
  };
}

/** Cuánto lleva abierto lo más viejo, en días, para ponerlo en la cara. */
function antiguedadMax(filas) {
  const conFecha = filas
    .map((f) => Date.parse(f.primera_vez ?? ''))
    .filter((n) => !Number.isNaN(n));
  if (!conFecha.length) return null;
  const dias = Math.floor((Date.now() - Math.min(...conFecha)) / 86_400_000);
  return Number.isFinite(dias) && dias >= 0 ? dias : null;
}

/** La línea base que se guarda para la próxima corrida. */
export function lineaBaseDe(corrida) {
  const base = {};
  for (const f of corrida.filas) {
    base[f.clave] = {
      id: f.id,
      fuente: f.fuente,
      nivel: f.nivel,
      titulo: f.titulo,
      primera_vez: f.primera_vez,
      ultima_vez: f.ts ?? null,
      huella: f.huella,
    };
  }
  return base;
}