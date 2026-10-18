// El cruce: qué dicen las tres fuentes, y dónde se contradicen.
//
// LA PREGUNTA QUE SOLO EXISTE CON LAS TRES JUNTAS. spaudit lee el manual y los
// documentos; Strix sondea el sistema en vivo. Uno afirma desde el papel y el
// otro desde la realidad. Cuando los dos se apuntan a lo mismo, eso es más
// fuerte que cualquiera de los dos por separado.
//
// POR QUÉ NO "N CONTROLES CORROBORADOS". La primera versión de este cruce
// emparejaba un hallazgo con todos los controles de su categoría y contaba
// cuántos quedaban "corroborados". Con los datos reales dio **27 controles
// corroborados por un solo hallazgo**: un CWE-306, que es el más común que
// existe, no habla de veintisiete controles de un colegio. El número era
// cierto y no significaba nada. Inflar un indicador es peor que no tenerlo.
//
// EL MODELO QUE SÍ SIRVE. Un hallazgo no corrobora controles uno por uno:
// señala una ÁREA que quedó sin comprobar, y dice cuántos controles hay ahí y
// cuántos de ellos tenían un verificador que nadie ejecutó. Eso sí se puede
// actuar. Y en sentido inverso, un control marcado CUMPLE en un área que una
// sonda encuentracon problemas es una una contradicción, que es la señal más fuerte que
// puede aparecer en todo este cruce.

import {puedeCorroborar, desconocidas, noSondeables, MAPA_DEL_PAQUETE} from './correspondencias.mjs';

export const CRUCE = Object.freeze({
  CONTRADICCION: 'contradiccion',
  ALCANZADO: 'alcanzado',
  FUERA_DE_ALCANCE: 'fuera_de_alcance',
});

/**
 * Cruza conformidad contra seguridad.
 *
 * @param {object} p
 * @param {Array} p.conformidad   Hallazgos de spaudit (NO_CUMPLE / PARCIAL).
 * @param {Array} p.seguridad     Hallazgos de Strix.
 * @param {Array} p.sinVerificar  Controles de spaudit sin evidencia.
 * @param {Array} p.cumplidos     Controles que spaudit dio por buenos.
 * @param {object} p.mapa         Correspondencias de la entidad, sobre las del paquete.
 * @returns {object} Zonas alcanzadas por sonda, contradicciones y lo demás.
 */
export function cruzar({
  conformidad = [],
  seguridad = [],
  sinVerificar = [],
  cumplidos = [],
  mapa = MAPA_DEL_PAQUETE,
} = {}) {
  // Los cumplidos cuentan para el total y para el cruce con la sonda, pero NO
  // son zonas oscuras: nadie tiene que resolver un control que ya está bien.
  const todos = [...conformidad, ...sinVerificar, ...cumplidos];
  const conZona = [...conformidad, ...sinVerificar];
  const declarados = [...conformidad, ...cumplidos];
  const porCategoria = new Map();
  for (const c of conZona) {
    const k = c.categoria;
    if (!k) continue;
    if (!porCategoria.has(k)) porCategoria.set(k, []);
    porCategoria.get(k).push(c);
  }

  // Qué áreas toca cada hallazgo, por familia de CWE.
  const alcances = seguridad.map((h) => {
    const {corroborables} = puedeCorroborar(h, todos, mapa);
    return {
      hallazgo: h,
      categorias: [...new Set(corroborables.map((c) => c.categoria))].sort(),
    };
  });

  const tocadas = new Set(alcances.flatMap((a) => a.categorias));

  // Zonas: áreas que una sonda puede tocar, con lo que hay en cada una.
  const zonas = [...tocadas].sort().map((categoria) => {
    const controles = porCategoria.get(categoria) ?? [];
    const sinEvidencia = controles.filter((c) => c.estado === 'NO VERIFICADO');
    return {
      categoria,
      controles: controles.length,
      abiertos: controles.filter((c) => c.estado !== 'NO VERIFICADO').length,
      sin_verificar: sinEvidencia.length,
      // Los que tienen un verificador escrito y nadie ejecutó. Son los que un
      // escaneo puede resolver sin intervención humana.
      resolubles: sinEvidencia.filter((c) => c.automatizable).length,
      ids: controles.filter((c) => c.estado === 'NO VERIFICADO' && c.automatizable)
        .map((c) => c.id),
    };
  });

  // Contradicciones: el manual dice que cumple, la sonda dice que hay problema.
  // Es la señal más fuerte del cruce y la que menos se ve.
  const contradicciones = [];
  for (const c of declarados) {
    if (!c.categoria || !tocadas.has(c.categoria)) continue;
    // Una contradicción POR CONTROL, no una por cada par control×hallazgo.
    // Con 4 controles de Web y 3 hallazgos de la sonda, contar los pares da 12
    // líneas y se lee como "12 problemas" cuando en realidad hay 4 controles en
    // disputa. Inflar un indicador es peor que no tenerlo: el que lo lee se
    // queda con el número y no con lo que el número significa.
    const enDisputa = alcances.filter((a) => a.categorias.includes(c.categoria));
    if (!enDisputa.length) continue;
    contradicciones.push({
      control: c.id,
      categoria: c.categoria,
      estado_declarado: c.estado,
      hallazgos: enDisputa.map((a) => a.hallazgo.id),
      n_hallazgos: enDisputa.length,
      motivo: `el manual lo declara ${c.estado} y una sonda independiente encontró ${enDisputa.length} problema(s) en la misma área`,
    });
  }

  const usados = todos.map((c) => c.categoria).filter(Boolean);
  const sinMapear = desconocidas(usados, mapa);
  const noVerificables = noSondeables(usados, mapa);

  const resolubles = zonas.reduce((n, z) => n + z.resolubles, 0);

  return {
    zonas,
    contradicciones,
    hallazgosPorArea: alcances,
    // Hallazgos que hablan de un área que el catálogo no cubre. No es un
    // defecto del cruce: puede ser que la sonda encontró algo que el manual no
    // contempla, que es información valiosa pero de otro tipo.
    fueraDeAlcance: alcances
      .filter((a) => !a.categorias.length)
      .map((a) => ({
        id: a.hallazgo.id,
        titulo: a.hallazgo.titulo,
        cwe: a.hallazgo.cwe,
        motivo: 'el hallazgo no corresponde a ninguna categoría del catálogo de spaudit',
      })),
    resumen: {
      controles: todos.length,
      abiertos: conformidad.length,
      sin_verificar: sinVerificar.length,
      hallazgos_seguridad: seguridad.length,
      areas_alcanzadas: zonas.length,
      /** El número que de verdad informa: cuánto sube la cobertura si se corre. */
      controles_resolubles_por_sonda: resolubles,
      /** Cuánto es la cobertura hoy y cuánto sería con esas corridas. */
      cobertura_actual_pct: porcentaje(todos.length - sinVerificar.length, todos.length),
      cobertura_con_sondas_pct: porcentaje(todos.length - sinVerificar.length + resolubles, todos.length),
      contradicciones: contradicciones.length,
      fuera_de_alcance: alcances.filter((a) => !a.categorias.length).length,
      // Lo que hay que vigilar: si esto crece, la tabla quedó vieja.
      categorias_desconocidas: sinMapear,
      // No es un defecto: son áreas que nadie puede comprobar por sonda.
      categorias_no_sondeables: noVerificables,
    },
  };
}

function porcentaje(n, total) {
  return total ? Math.round((n / total) * 100) : 0;
}

/**
 * Lo que el manual exige, nadie lo ha comprobado, y una sonda lo resolvería.
 *
 * Es la lista más accionable del cruce. La alternativa —omitirla— convierte en
 * invisibles los controles que nadie está mirando, y lo invisible en un
 * informe de cumplimiento se lee como "todo bien".
 */
export function zonasOscuras(cruce) {
  return cruce.zonas
    .flatMap((z) => z.ids.map((id) => ({id, categoria: z.categoria})))
    .map((x) => ({
      ...x,
      motivo: 'el manual exige el control, hay un verificador escrito y nadie lo ejecutó',
    }));
}