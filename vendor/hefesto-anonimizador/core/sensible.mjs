// Clasificador de categoría sensible (art. 2 letra g de la Ley 21.719:
// salud, situación de discapacidad, origen, creencias).
//
// POR QUÉ ES LA PARTE MÁS IMPORTANTE DEL DISEÑO Y NO LA TOKENIZACIÓN:
// tapar el RUT de "credencial de discapacidad de mi hijo que tiene autismo"
// deja el diagnóstico entero a la vista. El tokenizador cubre lo que tiene
// forma reconocible; la categoría sensible cubre lo que la hace identifica a
// una persona aunque no tenga ni un dígito. Por eso el veto va PRIMERO en
// amordazar(): si hay categoría sensible, el texto no sale, y no se gasta
// trabajo ni se crea una bóveda que después habría que expirar.
//
// ESTO ES UN LÉXICO, NO UN CLASIFICADOR APRENDIDO. Pasa los tres casos del
// corpus y falla en cuanto el texto no dice la palabra exacta. Se declara acá
// para que nadie lo prometa como cobertura. Un despliegue que necesite más
// inyecta su propio clasificador por el mismo contrato.
//
// Un clasificador devuelve la categoría Y la evidencia que la disparó, nunca el
// texto completo: la evidencia es lo que permite auditar por qué se vetó sin
// volver a exponer lo que se quiso proteger.

export const CATEGORIAS = Object.freeze(['salud', 'discapacidad', 'origen', 'creencias']);

// Términos por categoría. Se comparan en minúsculas sin tildes, para que
// "discapacidad" y "discapaciDad" caigan en el mismo término.
const LEXICO = {
  salud: [
    'cancer', 'diabetes', 'hipertension', 'insuficiencia renal', 'trasplante',
    'tratamiento', 'quimioterapia', 'radioterapia', 'cirugia', 'hospital',
    'hospitalizacion', 'diagnosticado', 'diagnostico', 'medicamento',
    'medicamentos', 'enfermedad', 'enfermo', 'urgencia',
    'postrada', 'postrado', 'licencia medica', 'pension',
    'discapacidad', 'sindrome', 'esclerosis', 'alzhaimer', 'depresion',
    'ansiedad', 'disfuncion',
    // "paciente" NO va acá a propósito: aparece en texto administrativo
    // ("la paciente María José Vargas necesita el examen") y vetar eso deja al
    // sistema sin poder atender a nadie. Vetar de más es un modo de falla tan
    // real como la fuga: se mide contra el corpus, no se decide por intuición.
  ],
  discapacidad: [
    'discapacidad', 'discapacitado', 'discapacitada', 'sindrome de down',
    'autismo', 'autista', 'silla de ruedas', 'ciega', 'ciego', 'sordomudo',
    'discapacidad intelectual', 'rehabilitacion', 'teletexto',
  ],
  origen: [
    'inmigrante', 'inmigracion', 'refugiado', 'refugiada', 'nacionalidad',
    'extranjero', 'extranjera', 'indigena', 'mapuche', 'residente legal',
  ],
  creencias: [
    'religion', 'religioso', 'religiosa', 'iglesia', 'pastor', 'congregacion',
    'creencia', 'fe', 'ateo', 'agnostico',
  ],
};

/** Sin tildes y en minúsculas, para comparar sin depender de la acentuación. */
function normalizar(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function indiceDe(normalizado, termino, desde) {
  return normalizado.indexOf(termino, desde);
}

/** ¿El término está en frontera de palabra? "fe" no debe pegar con "fénebú". */
function enFrontera(normalizado, pos, largo) {
  const antes = pos === 0 ? ' ' : normalizado[pos - 1];
  const despues = pos + largo >= normalizado.length ? ' ' : normalizado[pos + largo];
  return !/[a-z0-9]/.test(antes) && !/[a-z0-9]/.test(despues);
}

/** El clasificador por defecto: léxico, con evidencia de qué disparó el veto. */
export function clasificadorPorDefecto(texto) {
  const normalizado = normalizar(texto);

  for (const categoria of CATEGORIAS) {
    const terminos = LEXICO[categoria] || [];
    for (const termino of terminos) {
      const t = normalizar(termino);
      let desde = 0;
      for (;;) {
        const pos = indiceDe(normalizado, t, desde);
        if (pos === -1) break;
        desde = pos + 1;
        if (!enFrontera(normalizado, pos, t.length)) continue;
        return {categoria, evidencia: termino};
      }
    }
  }
  return {categoria: null, evidencia: null};
}

/**
 * Igual que el anterior pero con la forma del contrato del paquete PHP:
 * devuelve la categoría o null. Se usa cuando solo importa el veredicto.
 */
export function categoriaSensibleDe(texto) {
  return clasificadorPorDefecto(texto).categoria;
}

/**
 * Sin clasificador. Existe para que un sistema que NO maneja datos sensibles
 * pueda decirlo de forma explícita en vez de heredar el léxico por descuido.
 */
export const SIN_CLASIFICADOR = Object.freeze({
  categoriaDe: () => null,
});