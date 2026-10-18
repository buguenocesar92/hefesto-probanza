// La puerta: decide si un hallazgo nuevo puede pasar.
//
// EL PROBLEMA REAL QUE RESUELVE. Los escáneres de seguridad se leen una vez y
// después se archivan. La segunda corrida dice "0 nuevos" y todo el mundo
// entiende que no hay nada que hacer, aunque siga abierto un crítico del mes
// pasado. El ruido de lo conocido tapa lo que sí cambió, y lo que no cambió
// deja de importar.
//
// ACÁ LA COSA ES AL REVÉS. Un hallazgo que sigue abierto no se "cierra" por
// haber aparecido en el reporte anterior: sigue bloqueando, y además se dice
// aparte de los nuevos. El resultado tiene que poder leerse en una línea: qué
// es nuevo, qué sigue abierto, y si la puerta pasa.
//
// Y hay una asimetría deliberada: un hallazgo que NO se puede calificar bloquea.
// Igual que hace el `--fail-on` del propio Strix. Un gate que se deja pasar lo
// que no entendió no es un gate.

import {NOMBRE_NIVEL} from './traductor.mjs';

/** Umbral por nombre, como el `--fail-on` de Strix. */
export const UMBRAL = Object.freeze({critical: 5, high: 4, medium: 3, low: 2, info: 1});

/**
 * Lee un JSON desde texto tolerando el BOM.
 *
 * Python escribe `vulnerabilities.json` sin BOM, pero cualquier archivo que una
 * persona toque en Windows lo va a traer: el Bloc de notas lo agrega al
 * guardar y `Set-Content -Encoding UTF8` en PowerShell 5.1 también. Sin esto,
 * una línea base editada a mano revienta con un `Unexpected token '﻿'` que no
 * dice nada de dónde salió el problema.
 *
 * @param {string} texto
 * @returns {any}
 */
export function leerJsonDeTexto(texto) {
  return JSON.parse(String(texto).replace(/^\uFEFF/, ''));
}

/**
 * Acepta la línea base en las dos formas que existen en el mundo.
 *
 * Una es el sobre que escribe `ruta.mjs --guardar` (con `eventos` y
 * `sidecar`); la otra es el sidecar pelado. Leer el sobre como si fuera el
 * sidecar **no da error**: parece una línea base vacía, y el resultado es que
 * la corrida entera sale como "nueva". Es el peor modo de falla posible,
 * porque la deduplicación deja de hacer su trabajo sin delatar que dejó de
 * hacerlo.
 *
 * @param {any} crudo Lo que se leyó del disco.
 * @returns {object} Sidecar por huella.
 */
export function normalizarLineaBase(crudo) {
  // Si viene la clave `sidecar`, el archivo ES un sobre: o el sidecar está
  // bien, o el archivo está mal. Caerse al objeto de afuera cuando el sidecar
  // no sirve convertiría el sobre entero en un sidecar con una sola entrada
  // basura, y esa basura se contaría como un hallazgo cerrado.
  const esSobre = crudo !== null && typeof crudo === 'object' &&
    !Array.isArray(crudo) && 'sidecar' in crudo;

  const base = esSobre ? crudo.sidecar : crudo;

  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    throw new Error('la línea base no tiene la forma de un sidecar por huella');
  }
  return base;
}

/**
 * Compara la corrida actual contra una línea base.
 *
 * @param {object} p
 * @param {import('../nucleo/cadena.mjs').Cadena} p.cadena Cadena de esta corrida.
 * @param {object} p.sidecar  Detalle por huella de esta corrida.
 * @param {object} [p.lineaBase] Detalle por huella de la corrida anterior.
 * @param {number|string} [p.umbral] Nivel o nombre. Por defecto `high`.
 * @returns {object} Informe con `pasa`, `integridad` y las tres listas.
 */
export function verificarHallazgos({
  cadena,
  sidecar = {},
  lineaBase = {},
  umbral = 'high',
} = {}) {
  const nivel = typeof umbral === 'number' ? umbral : (UMBRAL[String(umbral).toLowerCase()] ?? UMBRAL.high);

  const integridad = cadena.verificar();

  const actuales = [];
  for (const [huella, detalle] of Object.entries(sidecar)) {
    const evento = cadena.eventos.find((e) => e.datos.huellas?.includes(huella));
    const sev = evento?.datos.severidad ?? 1;
    const desconocida = Boolean(detalle?.gravedad_desconocida);
    const sitio = detalle?.sitio ?? (evento?.datos.huellas ?? [])[1] ?? huella;
    // Conoce el sitio, no este registro exacto: es lo que sobrevive a que el
    // agente reescriba el título. Ver `sitioDe`.
    const previo = Boolean(lineaBase[huella]) || Object.values(lineaBase)
      .some((d) => d?.sitio === sitio);
    actuales.push({
      huella,
      sitio,
      titulo: detalle?.titulo ?? null,
      cwe: detalle?.cwe ?? null,
      objetivo: detalle?.objetivo ?? null,
      nivel: sev,
      nombre: NOMBRE_NIVEL[sev] ?? 'desconocida',
      desconocida,
      previa: previo,
    });
  }

  const nuevos = actuales.filter((h) => !h.previa);
  const persistentes = actuales.filter((h) => h.previa);
  // Un sitio se cierra cuando desaparece entero de la corrida. Un registro que
  // cambia de título no cierra nada: es el mismo problema redactado distinto.
  const sitiosActuales = new Set(actuales.map((h) => h.sitio));
  const sitiosBase = new Set(Object.values(lineaBase).map((d) => d?.sitio).filter(Boolean));
  const cerrados = [...sitiosBase].filter((s) => !sitiosActuales.has(s));

  // El trade-off de la clave por sitio, declarado en voz alta: si un sitio
  // conocido trae varios hallazgos distintos, la clave los funde y eso tiene
  // que leerse, no resolverse en silencio.
  const choques = [];
  const porSitio = new Map();
  for (const h of actuales) {
    const lista = porSitio.get(h.sitio) ?? [];
    lista.push(h);
    porSitio.set(h.sitio, lista);
  }
  for (const [sitio, lista] of porSitio) {
    if (lista.length > 1) {
      choques.push({
        sitio,
        titulos: lista.map((h) => h.titulo),
        motivo: `${lista.length} hallazgos distintos comparten CWE, método y endpoint: la clave por sitio no los separa`,
      });
    }
  }

  const grave = (h) => h.desconocida || h.nivel >= nivel;

  const bloqueantes = [...nuevos, ...persistentes].filter(grave);

  // El motivo va en la lista. Un "no pasa" sin razones obliga a volver a abrir
  // el reporte, que es exactamente el trabajo que la puerta vino a evitar.
  const motivoDe = (h) => {
    if (h.desconocida) return `gravedad "${h.titulo}" no reconocida: bloquea por definición`;
    const base = h.previa ? 'ya estaba abierto' : 'nuevo';
    return `${base}, gravedad ${h.nombre} (nivel ${h.nivel})`;
  };

  const comercial = [...nuevos, ...persistentes]
    .filter(grave)
    .sort((a, b) => b.nivel - a.nivel)
    .map((h) => ({...h, motivo: motivoDe(h)}));

  return {
    pasa: bloqueantes.length === 0 && integridad.ok,
    umbral: nivel,
    integridad,
    nuevos,
    persistentes,
    cerrados,
    choques,
    bloqueantes,
    comercial,
    rotura: integridad.ok ? null : integridad,
    resumen: {
      total: actuales.length,
      nuevos: nuevos.length,
      persistentes: persistentes.length,
      cerrados: cerrados.length,
      choques: choques.length,
      bloqueantes: bloqueantes.length,
      gravedad_desconocida: actuales.filter((h) => h.desconocida).length,
    },
  };
}