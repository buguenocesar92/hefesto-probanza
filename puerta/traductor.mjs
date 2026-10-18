// Traduce el reporte de Strix a eventos del contrato `evento.v1`.
//
// POR QUÉ ESTO EXISTE. Un panel de seguridad que muestra "3 vulnerabilidades
// altas" se puede editar borrando tres renglones. La cadena de probanza ya sabe
// qué hacer con eso: los eventos van encadenados y el anclaje detecta la
// reescritura. Este módulo es el que deja que un hallazgo de Strix entre a esa
// cadena sin abrirle un boquete.
//
// LA REGLA QUE NO SE ROMPE. El evento lleva la huella, la clase y la
// gravedad. NUNCA el título, ni la descripción, ni el PoC, ni el endpoint. Es la
// misma línea que sostiene todo el ecosistema: la evidencia registra qué pasó,
// nunca el contenido. El detalle vive aparte, en un sidecar indexado por la
// huella, y se puede perder sin que la cadena mienta sobre lo que Midió.
//
// Los nombres de campo salen del código de Strix, no de memoria. El reporte se
// persiste con `finding_class` (`dynamic` | `dependency_cve`), `severity`
// (`critical`..`info`), `cwe`, `cvss`, `confidence`, `fix_effort`, `target`,
// `endpoint` y `timestamp`; ver `strix/tools/reporting/tool.py`.

import {Cadena} from '../nucleo/cadena.mjs';
import {canonico, sha256} from '../nucleo/canonica.mjs';

/**
 * Gravedad de Strix a nivel numérico. El número va de 1 a 5 y sube con la
 * gravedad, porque el verificador ordena por número.
 *
 * `none` no debería aparecer: Strix convierte `none` a `info` al calcular el
 * CVSS. Si aparece, es de un registro viejo y se trata como `info`.
 */
export const NIVEL = Object.freeze({
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
  none: 1,
});

/** De nivel a nombre, para el informe. */
export const NOMBRE_NIVEL = Object.freeze({
  5: 'crítica',
  4: 'alta',
  3: 'media',
  2: 'baja',
  1: 'informativa',
});

const SEVERIDADES = Object.keys(NIVEL);

/**
 * Una gravedad que no se reconoce NO se degrada a `info`.
 *
 * Es la misma regla que aplica el propio Strix en su `--fail-on`: una severidad
 * que no sabe ordenar siempre cuenta, para que la puerta nunca pase sobre un
 * valor que no pudo calificar. Bajar lo desconocido a informativo es la forma
 * más común de que un gate se deje pasar lo que no entendía.
 *
 * @returns {{nivel: number, desconocida: boolean}}
 */
export function nivelDe(severity) {
  const s = String(severity ?? '').trim().toLowerCase();
  if (s in NIVEL) return {nivel: NIVEL[s], desconocida: false};
  return {nivel: 5, desconocida: true};
}

/**
 * Normaliza un texto a la forma que admite el contrato: minúsculas, sin
 * acentos, sin puntuación, separadores en guion bajo.
 *
 * Sirve para dos cosas: dedupear hallazgos que el agente titularizó de dos
 * maneras ("SQL Injection en /api/x" y "SQLi on /api/x"), y derivar una
 * etiqueta corta cuando no hay CWE. Es normalización, noiffs: no intenta
 * entender el título, solo quitarle todo lo que cambia entre corridas.
 */
function normalizar(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
    .replace(/_+$/, '');
}

/**
 * La huella de un hallazgo: lo que lo hace ser *el mismo* hallazgo.
 *
 * Entran la clase, el CWE, el título normalizado, el objetivo y el endpoint.
 * Deliberadamente NO entran el `id` de Strix (cambia en cada corrida), ni el
 * `timestamp`, ni la gravedad.
 *
 * Esto último es una decisión, no un descuido: si la gravedad entrara, subir un
 * hallazgo de media a alta lo convertiría en un hallazgo nuevo y el anterior
 * quedaría "cerrado" sin que nadie lo cerrara. La identidad de un problema no
 * cambia porque se haya entendido mejor.
 *
 * @param {object} h Un hallazgo de `vulnerabilities.json`.
 * @returns {string} 64 hexadecimales.
 */
export function huellaDe(h) {
  const partes = [
    String(h?.finding_class ?? 'dynamic'),
    // `.trim()` porque un `cwe` de puros espacios no dice nada y no puede
    // convertir el mismo hallazgo en otro: la corrida de MiniMax vino con
    // `cwe: ''` y con el campo ausente, y los dos tienen que dar la misma
    // huella o la línea base reportaría como "nuevo" algo que nadie tocó.
    String(h?.cwe ?? '').trim(),
    normalizar(h?.title),
    String(h?.target ?? ''),
    String(h?.endpoint ?? ''),
  ];
  return sha256(partes.join('\u0000'));
}

/**
 * Convierte el tiempo de Strix a ISO-8601 UTC terminado en Z.
 *
 * El formato de Strix NO es ISO-8601. `strix/report/state.py` lo arma con
 * `datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")`, o sea
 * `"2026-10-17 12:00:00 UTC"`: espacio donde va la `T` y `" UTC"` donde va la
 * `Z`, y con resolución de segundos.
 *
 * Ese texto lo acepta `new Date()` en V8, pero por cortesía del motor y no por
 * especificación. Un parser que depende de la buena voluntad del runtime se
 * rompe el día que Node lo endurezca, y se rompe en producción, no en un test.
 * Por eso se parsea a mano y el `new Date()` queda solo como último recurso.
 *
 * Falla fuerte si no puede. Un `ts` inventado sería peor que un error: la
 * cadena ordena por tiempo, y un tiempo falso rompe el orden en silencio.
 */
export function tiempoDe(ts) {
  // El reloj de respaldo entrega un Date; no hace falta volverlo a parsear.
  if (ts instanceof Date) {
    if (Number.isNaN(ts.getTime())) throw new Error('el reloj entregó una fecha inválida');
    return ts.toISOString();
  }
  if (typeof ts !== 'string' || ts.length === 0) {
    throw new Error(`el hallazgo no trae timestamp: ${JSON.stringify(ts)}`);
  }

  // El formato de Strix.
  const strix = ts.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) UTC$/);
  if (strix) {
    const [, a, m, d, hh, mm, ss] = strix.map(Number);
    // La forma no alcanza: "2026-13-45 99:99:99 UTC" tiene la forma exacta y
    // no es una fecha. Sin esto entraría un ISO imposible al contrato y el
    // error aparecería más lejos, con menos contexto de dónde salió.
    const ok = m >= 1 && m <= 12 && d >= 1 && d <= 31 &&
      hh <= 23 && mm <= 59 && ss <= 59;
    if (!ok) throw new Error(`timestamp fuera de rango: ${JSON.stringify(ts)}`);
    const p = (n) => String(n).padStart(2, '0');
    return `${a}-${p(m)}-${p(d)}T${p(hh)}:${p(mm)}:${p(ss)}.000Z`;
  }

  // ISO-8601 que ya viene listo.
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(ts)) return ts;

  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`timestamp ilegible: ${JSON.stringify(ts)}`);
  }
  return d.toISOString();
}

/**
 * Las etiquetas que van en `datos.tipos`. Deben cumplir `/^[a-z0-9_]{1,32}$/`.
 *
 * La clase del hallazgo siempre; el CWE cuando existe. No hay campo "categoría"
 * en el reporte de Strix, y inventar una sería mentir sobre el dato: lo que sí
 * existe y es estable es la clase y el CWE.
 */
function tiposDe(h) {
  const tipos = [normalizar(h?.finding_class) || 'dynamic'];
  const cwe = String(h?.cwe ?? '').match(/CWE-(\d+)/i);
  if (cwe) tipos.push(`cwe_${cwe[1]}`);
  return [...new Set(tipos)].filter(Boolean).slice(0, 4);
}

/**
 * LA SITIO: dónde está el problema, sin importar cómo lo titule el agente.
 *
 * Existe porque la huella estricta no sobrevive a un agente que reescribe el
 * título en cada corrida. Medido: cuatro títulos plausibles del mismo traversal
 * dan cuatro huellas distintas. Con eso, la deduplicación se convierte en
 * ruido — el mismo bug aparece como "nuevo" y el anterior como "cerrado", en
 * cada corrida y para siempre.
 *
 * Y tiene el defecto opuesto, que también está medido: **colisiona**. Tres
 * inyecciones SQL distintas sobre el mismo endpoint comparten CWE y método, y
 * esta clave las funde en una. Es el trade-off honesto de quitar el título: se
 * pierde precisión a cambio de continuidad.
 *
 * Por eso no se elige. Las dos claves viajan en `datos.huellas` y la puerta
 * matchea por sitio, pero **dice cuándo hubo choque**. Un sitio conocido con
 * varios registros nuevos se reporta como tal, no como un hallazgo fusionado en
 * silencio.
 *
 * @param {object} h
 * @returns {string} 64 hexadecimales.
 */
export function sitioDe(h) {
  const partes = [
    String(h?.finding_class ?? 'dynamic'),
    String(h?.cwe ?? '').trim(),
    String(h?.method ?? ''),
    String(h?.endpoint ?? ''),
  ];
  return sha256(partes.join('\u0000'));
}

/**
 * Traduce el reporte completo.
 *
 * @param {Array<object>} hallazgos Contenido de `vulnerabilities.json`.
 * @param {object} [op]
 * @param {function} [op.reloj] Devuelve la fecha que se usa si el hallazgo no
 *        trae timestamp. Por defecto, ahora.
 * @returns {{cadena: Cadena, sidecar: object, resumen: object}}
 */
export function traducir(hallazgos, {reloj = () => new Date()} = {}) {
  if (!Array.isArray(hallazgos)) {
    throw new Error('se esperaba una lista de hallazgos (vulnerabilities.json)');
  }

  const cadena = Cadena.nueva();
  const sidecar = {};
  const filas = [];

  // Orden estable y reproducible: la misma entrada da siempre la misma cadena,
  // y por lo tanto los mismos hashes. Si dos corridas den distinto hash sin que
  // cambien los hallazgos, el hash dejó de ser evidencia de algo.
  const ordenados = [...hallazgos].sort((a, b) => {
    const na = nivelDe(a?.severity).nivel;
    const nb = nivelDe(b?.severity).nivel;
    if (na !== nb) return nb - na;                    // más grave primero
    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  });

  for (const h of ordenados) {
    const {nivel, desconocida} = nivelDe(h?.severity);
    const huella = huellaDe(h);
    const sitio = sitioDe(h);

    const ts = h?.timestamp ? tiempoDe(h.timestamp) : tiempoDe(reloj());
    const evento = cadena.agregar({
      sistema: 'seguridad',
      tipo: 'hallazgo.detectado',
      proposito: 'superficie',
      consentimiento: null,
      sujeto_ref: null,
      datos: {
        tipos: tiposDe(h),
        huellas: [huella, sitio],
        cantidad: 1,
        severidad: nivel,
      },
      ts,
    });

    // El sidecar es el único lugar donde vive el detalle, y existe para que
    // perderlo no cambie lo que la cadena afirma.
    sidecar[huella] = {
      id: h?.id ?? null,
      sitio,
      titulo: h?.title ?? null,
      gravedad: h?.severity ?? null,
      gravedad_desconocida: desconocida,
      cvss: h?.cvss ?? null,
      confianza: h?.confidence ?? null,
      esfuerzo_de_correccion: h?.fix_effort ?? null,
      cve: h?.cve ?? null,
      cwe: h?.cwe ?? null,
      objetivo: h?.target ?? null,
      endpoint: h?.endpoint ?? null,
      metodo: h?.method ?? null,
      clase: h?.finding_class ?? 'dynamic',
      agente: h?.agent_name ?? null,
      capturado: ts,
    };

    filas.push({huella, sitio, nivel, desconocida, evento: evento.seq, titulo: h?.title ?? null});
  }

  return {
    cadena,
    sidecar,
    resumen: {
      total: filas.length,
      por_nivel: filas.reduce((acc, f) => {
        acc[f.nivel] = (acc[f.nivel] || 0) + 1;
        return acc;
      }, {}),
      gravedad_desconocida: filas.filter((f) => f.desconocida).length,
      filas,
      // Huella del conjunto: dos corridas con los mismos hallazgos dan el mismo
      // valor. Es lo que permite decir "no cambió nada" sin diffear textos.
      huella_del_conjunto: sha256(canonico(filas.map((f) => [f.huella, f.nivel]))),
    },
  };
}