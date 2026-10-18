// Los tres orígenes, llevados a una forma común.
//
// QUÉ ES ESTO. Hay tres herramientas que miran tres cosas distintas y que no
// se hablan:
//
//   probanza    ¿este envío salía con consentimiento vigente?
//   seguridad   ¿este sistema tiene esta vulnerabilidad?
//   conformidad ¿este procedimiento del manual se está cumpliendo?
//
// La tentación es fusionarlas en un solo evento. Sería un error: un
// consentimiento revocado y un puerto abierto no son la misma cosa, y una
// cadena que mezcla las dos no se puede leer. Lo que sí se puede compartir es
// la FORMA del hallazgo, que es lo que hace este módulo.
//
// CADA FUENTE EN SU CADENA. Los tres usan `Cadena` y el contrato `evento.v1`,
// pero cada una con su propia instancia y su propio `sistema`. Un evento de
// conformidad nunca se mete en la cadena de consentimiento.
//
// LA REGLA QUE NO SE ROMPE, y que es la misma de siempre: a la cadena va la
// huella, la clase y la gravedad. El título, el motivo y el detalle van al
// sidecar. Si el detalle se pierde, la cadena sigue diciendo la verdad.

import {readFileSync} from 'node:fs';
import {leerJsonDeTexto} from '../puerta/verificador.mjs';
import {verificarTodo} from '../nucleo/verificador.mjs';

export const FUENTES = Object.freeze({
  probanza: 'probanza',
  seguridad: 'seguridad',
  conformidad: 'conformidad',
});

/** Una forma común. Cada origen llena lo que puede. */
export function vacio(fuente, extra = {}) {
  return {
    fuente,
    id: null,
    titulo: null,
    nivel: 1,
    estado: null,
    motivo: null,
    ts: null,
    cwe: [],
    categoria: null,
    ref: null,          // referencia legal o del manual, va al sidecar
    enlace: null,       // endpoint, ruta o URL
    ...extra,
  };
}

/**
 * RIESGO a nivel. spaudit usa critico/alto/medio/bajo y Strix usa
 * critical/high/medium/low/info: son el mismo eje con dos alfabetos.
 */
const NIVEL_POR_RIESGO = {
  critico: 5, critical: 5,
  alto: 4, high: 4,
  medio: 3, medium: 3,
  bajo: 2, low: 2,
  informativo: 1, info: 1, none: 1,
};

/**
 * Una gravedad que no se reconoce NO degrada a `info`.
 *
 * Misma regla que en la puerta, y por el mismo motivo: bajarla a
 * informativa es la forma más común de que un tablero se deje pasar lo que no
 * entendió.
 */
export function nivelDe(riesgo) {
  const r = String(riesgo ?? '').trim().toLowerCase();
  if (r in NIVEL_POR_RIESGO) return {nivel: NIVEL_POR_RIESGO[r], desconocida: false};
  return {nivel: 5, desconocida: true};
}

/**
 * Extrae los CWE que aparezcan en cualquier campo de texto.
 *
 * Devuelve NÚMEROS, no cadenas. No es un detalle: `Map.get('306')` y
 * `Map.get(306)` son claves distintas, y un CWE textual que no calza con uno
 * numérico hace que la tabla entera parezca vacía sin dar ningún error. Ya
 * pasó: el cruce reportaba "ningún CWE de 306 tiene categoría conocida" con
 * 306 escrita en la tabla a la vista.
 */
export function cwesDe(...campos) {
  const hallados = new Set();
  for (const c of campos) {
    if (typeof c !== 'string') continue;
    for (const m of c.matchAll(/CWE-?(\d+)/gi)) hallados.add(Number(m[1]));
  }
  return [...hallados].sort((a, b) => a - b);
}

// ── 1. Conformidad: el informe de spaudit ────────────────────────────────────

/**
 * Lee `informe-auditoria.json`.
 *
 * Los estados de spaudit son un Histograma: `NO_CUMPLE`, `PARCIAL`,
 * `NO VERIFICADO`, `CUMPLE`, `NO APLICA`. Cada grupo viene con su propia
 * forma, y solo se pasan los dos primeros: `NO VERIFICADO` es una tarea
 * pendiente, no un hallazgo, y traerlo acá inflaría el tablero con 144 filas
 * que nadie va a leer.
 */
export function desdeConformidad(ruta) {
  const d = leerJsonDeTexto(readFileSync(ruta, 'utf8'));
  const resultados = d?.resultados;
  if (!Array.isArray(resultados)) {
    throw new Error('el informe de spaudit no trae "resultados": se esperaba una lista');
  }

  const generacion = d.generado || null;

  const items = [];
  const sinVerificar = [];
  const cumplidos = [];

  for (const r of resultados) {
    const base = vacio(FUENTES.conformidad, {
      id: r.id,
      titulo: r.enunciado ? String(r.enunciado).slice(0, 160) : r.id,
      estado: r.estado,
      ts: generacion,
      cwe: cwesDe(r.referencia, r.brecha),
      categoria: r.categoria ?? null,
      ref: r.referencia ?? null,
      enlace: r.procedimiento ? `procedimiento ${r.procedimiento}, página ${r.pagina}` : null,
      pagina: r.pagina ?? null,
      procedimiento: r.procedimiento ?? null,
      brecha: r.brecha ?? null,
      remediacion: r.remediacion ?? null,
      error: r.error ?? null,
      // Lo que se necesita para que deje de estar "sin verificar" es
      // información de gestión, no un parche. Por eso viaja al sidecar.
      verificacion: r.verificacion ?? null,
      // Va en la base y no solo en los hallazgos: un control sin verificar
      // puede tener un verificador escrito que nadie ejecutó, y ese es
      // justamente el grupo que un escaneo puede resolver. Si esto se queda
      // solo en los hallazgos, "resolubles" sale en cero y el cruce parece
      // inútil.
      automatizable: Boolean(r.automatizable),
    });

    if (r.estado === 'NO VERIFICADO') {
      sinVerificar.push(base);
      continue;
    }
    if (r.estado === 'CUMPLE') {
      // Un control que cumple no es un hallazgo: no va al tablero ni a la
      // cadena. Pero SÍ es cobertura, y es lo que hace que la cobertura suba.
      // Descartarlo hacía que la mesa viera 146 controles donde el informe
      // dice 147, y que esa diferencia no se descontara de la cobertura.
      cumplidos.push(base);
      continue;
    }
    if (r.estado === 'NO APLICA') continue;

    const {nivel, desconocida} = nivelDe(r.riesgo);
    items.push({
      ...base,
      nivel,
      desconocida,
      motivo: r.brecha || r.detalle || r.estado,
    });
  }

  return {
    fuente: FUENTES.conformidad,
    generacion,
    dominio: d.dominio ?? null,
    resumen: d.resumen ?? null,
    items,
    // Se devuelven aparte y NO son hallazgos. Son la lista de trabajo.
    sinVerificar,
    // Tampoco son hallazgos: es evidencia de que alguien comprobó. Cuentan
    // para el total y para la cobertura, y se cruzan con la sonda (un CUMPLE
    // del manual junto a un problema de la sonda es contradicción), pero no
    // entran al tablero ni a la cadena.
    cumplidos,
    totales: {
      controles: resultados.length,
      hallazgos: items.length,
      sin_verificar: sinVerificar.length,
      cumplidos: cumplidos.length,
    },
  };
}

// ── 2. Seguridad: el reporte de Strix ───────────────────────────────────────

/** Lee `vulnerabilities.json` de una corrida de Strix. */
export function desdeSeguridad(ruta) {
  const hallazgos = leerJsonDeTexto(readFileSync(ruta, 'utf8'));
  if (!Array.isArray(hallazgos)) {
    throw new Error('vulnerabilities.json de Strix debe ser una lista');
  }

  const items = hallazgos.map((h) => {
    const {nivel, desconocida} = nivelDe(h?.severity);
    return vacio(FUENTES.seguridad, {
      id: h?.id ?? null,
      titulo: h?.title ?? null,
      nivel,
      desconocida,
      estado: h?.finding_class ?? 'dynamic',
      motivo: h?.description ?? h?.impact ?? null,
      ts: h?.timestamp ?? null,
      cwe: cwesDe(h?.cwe, h?.title, h?.description),
      categoria: h?.finding_class ?? null,
      ref: h?.cve ?? h?.cwe ?? null,
      enlace: h?.endpoint ?? null,
      metodo: h?.method ?? null,
      objetivo: h?.target ?? null,
      remediacion: h?.remediation_steps ?? null,
      confianza: h?.confidence ?? null,
      clase: h?.finding_class ?? 'dynamic',
    });
  });

  return {
    fuente: FUENTES.seguridad,
    generacion: items.map((i) => i.ts).sort().pop() ?? null,
    items,
    sinVerificar: [],
    totales: {controles: items.length, hallazgos: items.length, sin_verificar: 0},
  };
}

// ── 3. Probanza: la cadena de consentimiento ─────────────────────────────────

/**
 * Lee el verificador de probanza.
 *
 * Un envío no es "un hallazgo abierto": un envío es un hecho, y ya quedó
 * registrado. Lo que sigue abierto es el **consentimiento** que lo permitió mal.
 * Por eso la clave de continuidad es `consentimiento` y no el seq del evento:
 * mandar tres mensajes con el mismo consentimiento revocado es una sola cosa
 * abierta, no tres.
 */
export function desdeProbanza({cadena, consents, acciones}) {
  const verificadorTodo = verificarTodo(cadena, {consents, acciones});

  const abiertas = new Map();
  let accionesables = 0;

  for (const fila of verificadorTodo.filas) {
    if (fila.veredicto === 'cubierto') continue;
    accionesables++;

    const id = fila.consentimiento ?? `seq-${fila.seq}`;
    const nivel = fila.veredicto === 'revocado' ? 5
      : fila.veredicto === 'vencido' ? 4
        : 3;

    const previo = abiertas.get(id);
    if (previo) {
      previo.envios++;
      continue;
    }
    abiertas.set(id, vacio(FUENTES.probanza, {
      id,
      titulo: `consentimiento ${id}`,
      nivel,
      estado: fila.veredicto,
      motivo: fila.motivo,
      ts: fila.ts ?? null,
      cwe: [],
      categoria: fila.veredicto,
      ref: fila.consentimiento ?? null,
      enlace: null,
      primera_vez: fila.ts ?? null,
      envios: 1,
    }));
  }

  const items = [...abiertas.values()].sort((a, b) => b.nivel - a.nivel);
  return {
    fuente: FUENTES.probanza,
    generacion: cadena.eventos.at(-1)?.ts ?? null,
    items,
    sinVerificar: [],
    verificador: verificadorTodo,
    totales: {
      controles: cadena.eventos.length,
      hallazgos: items.length,
      sin_verificar: 0,
      envios_accionables: accionesables,
    },
  };
}