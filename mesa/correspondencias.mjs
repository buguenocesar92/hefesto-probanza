// Qué control de conformidad puede corroborar qué hallazgo de seguridad.
//
// POR QUÉ ES UN ARCHIVO DE DATOS Y NO UNA FUNCIÓN. Cruzar "SP-22-02 dice que
// faltan cabeceras de seguridad" con "Strix encontró cabeceras de seguridad
// ausentes" es una afirmación sobre el mundo, y una afirmación sobre el mundo
// se puede discutir. Si la regla estuviera enterrada en el código, nadie la
// revisaría; acá está en una tabla que se lee de un vistazo y que se puede
// corregir sin tocar el motor.
//
// CÓMO SE HIZO. Leyendo las 34 categorías REALES del catálogo de spaudit, no
// de memoria. La primera versión de esta tabla tenía siete categorías
// inventadas —"Web", "Correo", "Identidad", "Red"—, de las cuales dos
// existían. El cruce no dio ningún resultado y lo dijo: ninguna de las 34
// categorías tenía correspondencia. Esa es la razón de que exista el estado
// `desconocida`.
//
// LOS TRES ESTADOS, Y NO UNO. Hay una diferencia real entre "esta categoría no
// la sé cruzar" y "esta categoría no la puede sondear nadie desde afuera". La
// segunda es una verdad sobre el mundo: un escáner web no comprueba si la
// puerta del depot tiene cerradura. Confundirlas hace que el informe diga
// "no sé" donde en realidad debería decir "esto no se comprueba por Internet",
// que es información distinta y más útil.

/**
 * Categorías de spaudit → familias de CWE que las puede corroborar.
 *
 * Solo se mapea lo que una sonda externa puede llegar a comprobar. Cada clave
 * debe existir de verdad en el catálogo; `desconocidas()` falla la suite si
 * alguna no aparece nunca.
 */
export const FAMILIAS = Object.freeze({
  // 22 (path traversal), 78 (command injection), 88 (argument injection),
  // 434 (subida sin restringir) y 502 (deserialización insegura) son los
  // icónoclastos de "servidor web expuesto": la primera versión de esta tabla
  // no tenía ninguno de los cinco y el hallazgo de traversal no cruzaba con
  // ningún control de Web, que es absurdo.
  Web: [22, 77, 78, 88, 89, 79, 93, 113, 200, 209, 319, 352, 400, 434, 502, 522, 611, 693, 787, 918, 1021, 1275],
  Correo: [345, 93, 320, 350, 532, 918],
  Identidad: [287, 521, 308, 613, 522],
  'Acceso lógico': [284, 862, 863, 306, 639],
  'Acceso remoto': [306, 522, 312, 88, 918],
  Red: [284, 16, 200, 918, 311, 312, 306, 400, 419, 590, 732],
  Endpoint: [693, 269, 427, 367, 732, 400, 78],
  Sistema: [693, 16, 269, 250, 732],
  Respaldo: [693, 269, 212, 530],
  'Datos personales': [200, 359, 311, 312, 922],
  'Gestión remota': [306, 522, 312, 88, 918],
  Monitoreo: [778],
  Incidentes: [778, 693],
  Plataformas: [287, 306, 521, 200],
  Registro: [778],
  Claves: [259, 321, 522, 798],
  Software: [1104, 1035, 937, 494],
  Videovigilancia: [312, 359, 200, 284],
});

/**
 * Categorías que existen pero que una sonda externa no puede comprobar.
 *
 * No es una limitación de la herramienta: es que el hecho vive en un documento,
 * en una puerta física o en una conversación. Declararlas evita que el informe
 * insinúe que están cubiertas por el escaneo.
 */
export const NO_SONDEABLES = Object.freeze({
  'Acceso físico': 'se comprueba con una visita, no desde Internet',
  Bajas: 'es un procedimiento, no un estado comprobable por sonda',
  Llaves: 'inventario físico de llaves',
  Movimientos: 'procedimiento interno',
  Reparaciones: 'procedimiento interno',
  Mantenimiento: 'procedimiento interno',
  Hardware: 'inventario de equipos',
  'Medios extraíbles': 'requiere revisar los equipos uno por uno',
  'Uso de equipos': 'política de uso, no configuración',
  'Propiedad intelectual': 'es una cuestión legal, no técnica',
  'Redes sociales': 'las cuentas sociales no se pueden sondear',
  Responsabilidad: 'definición de roles',
  Inventario: 'requiere el documento, no una sonda',
  Legal: 'es una cuestión legal',
  'Marco legal': 'es una cuestión legal',
  Documento: 'calidad del manual, no del sistema',
});

/**
 * Une las correspondencias del paquete con las de la entidad.
 *
 * POR QUÉ. La tabla de arriba está escrita sobre el catálogo de spaudit del
 * colegio. Si el sistema sirve para cualquier entidad —y dice servirlo—, cada
 * entidad trae su propio manual con sus propias áreas, y una tabla fija las
 * deja a todas en `desconocida`: el cruce no devuelve nada y el informe acusa a
 * la tabla de estar vieja, cuando lo cierto es que es de otra entidad.
 *
 * Lo de la entidad va en `mapa` del archivo de configuración. Se fusiona por
 * clave: una categoría que la entidad redeclara pisa la del paquete, y una que
 * no dice se hereda. Nada se borra, para que cambiar de entidad no haga
 * desaparecer lo que el paquete ya sabía.
 */
export function construirMapa({familias = {}, noSondeables = {}} = {}) {
  return {
    familias: Object.freeze({...FAMILIAS, ...familias}),
    noSondeables: Object.freeze({...NO_SONDEABLES, ...noSondeables}),
  };
}

/** El mapa del paquete, sin nada de ninguna entidad. */
export const MAPA_DEL_PAQUETE = construirMapa();

/**
 * Índice CWE → categorías, por mapa.
 *
 * El `Number` no es cosmético: una clave de texto en el Map y una búsqueda con
 * número no se encuentran nunca, y el síntoma es una tabla que parece vacía sin
 * dar ningún error. Es lo que pasó con el 306.
 */
const POR_CWE = new WeakMap();

function indiceDe(mapa) {
  let indice = mapa ? POR_CWE.get(mapa) : null;
  if (indice) return indice;
  indice = new Map();
  for (const [categoria, cwes] of Object.entries(mapa?.familias ?? {})) {
    for (const cwe of cwes.map(Number)) {
      if (!indice.has(cwe)) indice.set(cwe, []);
      if (!indice.get(cwe).includes(categoria)) indice.get(cwe).push(categoria);
    }
  }
  if (mapa) POR_CWE.set(mapa, indice);
  return indice;
}

/**
 * Categorías que aparecieron en el catálogo y que esta tabla NO conoce.
 *
 * Si esta lista no está vacía, la tabla se quedó vieja: alguien añadió
 * controles y el cruce los está ignorando en silencio. Es el estado que hay
 * que vigilar, y hay una prueba que lo falla.
 */
export function desconocidas(usadas, mapa = MAPA_DEL_PAQUETE) {
  return [...new Set(usadas.filter(Boolean))]
    .filter((c) => !(c in mapa.familias) && !(c in mapa.noSondeables))
    .sort();
}

/** Categorías que existen pero no se pueden sondear. */
export function noSondeables(usadas, mapa = MAPA_DEL_PAQUETE) {
  return [...new Set(usadas.filter(Boolean))]
    .filter((c) => c in mapa.noSondeables)
    .sort();
}

/**
 * ¿Este hallazgo de seguridad puede corroborar a estos controles?
 *
 * @param {{cwe: number[]}} hallazgo
 * @param {Array<{categoria: string}>} controles
 * @param {object} [mapa] correspondencias de la entidad
 */
export function puedeCorroborar(hallazgo, controles, mapa = MAPA_DEL_PAQUETE) {
  const indice = indiceDe(mapa);
  const cwes = hallazgo?.cwe ?? [];
  if (!cwes.length) {
    return {corroborables: [], motivo: 'el hallazgo no trae CWE, no se puede cruzar'};
  }
  const categorias = new Set();
  for (const cwe of cwes) for (const c of indice.get(Number(cwe)) ?? []) categorias.add(c);

  if (!categorias.size) {
    return {corroborables: [], motivo: `ningún CWE de ${cwes.join(', ')} tiene categoría conocida`};
  }
  const corroborables = controles.filter((c) => categorias.has(c.categoria));
  return {
    corroborables,
    motivo: corroborables.length
      ? null
      : `ningún control abierto ni pendiente en ${[...categorias].join(', ')}`,
  };
}

/** Las categorías que un hallazgo sí puede corroborar, para explicitarlo. */
export function categoriasDe(hallazgo, mapa = MAPA_DEL_PAQUETE) {
  const indice = indiceDe(mapa);
  const out = new Set();
  for (const c of hallazgo?.cwe ?? []) for (const k of indice.get(Number(c)) ?? []) out.add(k);
  return [...out];
}