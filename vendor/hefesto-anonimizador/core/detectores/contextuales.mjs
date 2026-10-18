// Detección contextual de nombres propios y direcciones.
//
// POR QUÉ NO ES UN REGEX DE "DOS MAYÚSCULAS SEGUIDAS":
// "La reunión fue en 2026", "El decreto 1234-5" y "Quiero saber el horario"
// tienen dos mayúsculas seguidas y ninguna es un nombre. Un detector así
// inundaría el texto de marcadores y —peor que el ruido— haría creer que hay
// protección donde no la hay.
//
// El diseño exige un ANCLAJE: una palabra que introduce un nombre, o una que
// introduce una calle. Sin ancla no hay hallazgo. Eso recorta los falsos
// positivos de raíz, a costa de no cubrir "Juan Pérez me llamó", que sí es un
// nombre pero no tiene ancla. El recorte es deliberado y está medido.
//
// LÍMITE HONESTO: esto está basado en reglas, no es un modelo de NER. Para texto
// que venga de un vecino la tasa es buena; para texto libre de redes sociales
// no lo es. El veto por categoría sensible sigue siendo la garantía real de
// este diseño, no estos detectores. Ver docs/LIMITES.md.

import {Hallazgo} from '../valores.mjs';

// Palabras que empiezan en mayúscula por estar al inicio de una frase y NO son
// nombres. Sin esta lista, "La reunión" se leería como alguien llamado
// "La Reunión".
export const NO_ES_NOMBRE = new Set([
  'la', 'las', 'los', 'el', 'un', 'una', 'unos', 'unas', 'lo',
  'quiero', 'necesito', 'solicito', 'vengo', 'tengo', 'hay', 'es', 'son',
  'está', 'estan', 'están', 'por', 'para', 'segun', 'según', 'cuando', 'cuándo',
  'donde', 'dónde', 'como', 'cómo', 'quien', 'quién', 'este', 'esta', 'esto',
  'ese', 'esa', 'aqui', 'aquí', 'ayer', 'hoy', 'mañana', 'buenos', 'buenas',
  'gracias', 'favor', 'urgente', 'reclamo', 'reclamación', 'reclamacion',
  'consulta', 'duda', 'pregunta', 'sugerencia', 'felicitacion', 'felicitación',
  'denuncia', 'solicitud', 'peticion', 'petición', 'carta', 'mi', 'su',
  'nuestro', 'nuestra', 'de', 'del', 'en', 'con', 'y', 'o', 'u', 'a', 'al',
  'que', 'qué', 'me', 'te', 'se', 'nos', 'habita', 'habitamos', 'trabajo',
  'trabaja', 'vivo', 'vive', 'vivimos', 'fono', 'fonos', 'telefono', 'teléfono',
  'celular', 'movil', 'móvil', 'correo', 'email', 'mail', 'domicilio',
  'direccion', 'dirección', 'casa', 'oficina', 'horario', 'atencion', 'atención',
  'plazo', 'documento', 'expediente', 'folio', 'boleta', 'decreto', 'ley',
  'articulo', 'artículo', 'monto', 'total', 'reunion', 'reunión', 'hora', 'dia',
  'día', 'mes', 'año', 'rut', 'run', 'numero', 'número', 'nombre', 'apellido',
]);

// Conectores que cortan un nombre propio: "Rosa Muñoz de calle X" se llama
// Rosa Muñoz, no "Rosa Muñoz de".
const CORTAN_NOMBRE = new Set(['de', 'del', 'la', 'el', 'y']);

/** Anclas que introducen un nombre de persona. */
export const ANCLA_NOMBRE = [
  'soy', 'mi nombre es', 'me llamo', 'mi nombre', 'habla', 'hablan', 'habló',
  'atendió', 'atendio', 'consulta de', 'consulta del', 'escribió', 'escribio',
  'remitente', 'titular', 'solicitante', 'paciente', 'interesado', 'vecina',
  'vecino', 'senor', 'señor', 'senora', 'señora', 'don', 'doña', 'dona', 'sr',
  'sra', 'srta', 'madre', 'padre', 'hijo', 'hija', 'esposa', 'esposo',
  'abuela', 'abuelo', 'tutor', 'representante', 'apoderado',
];

/** Tipos de vía. Casi toda dirección trae una de estas palabras. */
export const ANCLA_VIA = [
  'calle', 'calleje', 'callejón', 'avenida', 'av', 'avda', 'psje', 'pasaje',
  'pje', 'camino', 'ruta', 'población', 'poblacion', 'villa', 'block',
  'bloque', 'departamento', 'depto', 'dpto', 'lote', 'mirador', 'parque',
  'plaza', 'urbanización', 'urbanizacion', 'camino vecinal',
];

// Gacetero de calles Chilean. No es exhaustivo. Un nombre de calle desconocido
// se cubre igual por la palabra de vía ("calle X"), así que el gacetero solo
// agrega recall, nunca resta precisión.
export const CALLE_CONOCIDA = [
  "o'higgins", 'ohiggins', 'bulnes', 'general toro', 'independencia', 'lautaro',
  'valparaíso', 'valparaiso', 'ahumada', 'almirante latorre', 'ismael riquelme',
  'isabel riquelme', 'ercilla', 'san martín', 'san martin', 'caupolicán',
  'caupolican', 'cochrane', 'santa maría', 'santa maria', 'compañía de jesús',
  'compania de jesus', 'miraflores', 'sarmiento', 'almirante montt', 'catamarca',
  'cóndor', 'condor', 'los aromos', 'las lilas', 'los olivos', 'loserce',
  'peumo', 'canelo', 'tehuelche', 'darke', 'esmeralda', 'concha', 'freire',
  'obispo', 'pueyrredón', 'pueyrredon', 'marcoleta', 'de thorn', 'arturo prat',
  'arturo gonzález', 'diego portales', 'pedro montt', 'graneros',
];

// Una palabra capitalizada "de verdad": admite acentos y apóstrofos, que es lo
// que hace que "O'Higgins" y "Pérez" entren como una sola palabra.
const RE_PALABRA_PROPIA = /[A-ZÁÉÍÓÚÑ][a-záéíóúñü']{0,29}/y;

// Número de calle, con el complemento opcional (depto, piso, block).
const RE_NUMERO = /^\s*,?\s*(?:n[°ºo]\s*)?\d{1,5}\s*(?:,?\s*(?:depto?|departamento|dp|piso|block|bloque)\.?\s*\d{0,4})?/i;

/** ¿El carácter en `i` corta palabra (o es el fin del texto)? */
function esFrontera(texto, i) {
  if (i >= texto.length) return true;
  return !/[a-záéíóúñ]/i.test(texto[i]);
}

/**
 * Recorre desde `desde` un segmento de palabras capitalizadas y devuelve
 * {inicio, fin}, o null si no llega al mínimo.
 *
 * `permitirArticulo` deja pasar un "Los/Las" inicial, porque en una calle el
 * artículo es parte del nombre: "Los Aromos 234" es una dirección, no un
 * artículo seguido del nombre de una calle cualquiera.
 *
 * ENTRE palabras solo se admite espacio en blanco. Una coma corta el segmento:
 * si no lo hiciera, "Pedro González, RUT 15.678.234-3" produciría un marcador
 * llamado NOMBRE que además contiene la palabra RUT, y el texto quedaría con
 * el RUT a medias.
 */
function segmentoPropio(texto, desde, opciones = {}) {
  const {maximo = 3, minimo = 2, permitirArticulo = false} = opciones;

  // Salta lo que anteceda a la primera palabra: comas, dos puntos...
  let cursor = desde;
  while (cursor < texto.length && /[\s,;:¡!¿?]/.test(texto[cursor])) cursor++;

  let inicio = cursor;
  let fin = cursor;
  let palabras = 0;

  for (;;) {
    if (palabras >= maximo) break;

    if (palabras > 0) {
      let j = fin;
      while (j < texto.length && /\s/.test(texto[j])) j++;
      // Sin espacio de por medio no hay palabra siguiente: se acabó el segmento.
      if (j === fin) break;
      cursor = j;
    }

    RE_PALABRA_PROPIA.lastIndex = cursor;
    const m = RE_PALABRA_PROPIA.exec(texto);
    if (!m || m.index !== cursor) break;

    const palabra = m[0].toLowerCase();
    const articulo = permitirArticulo && /^(los|las|el|la)$/.test(palabra);

    if (!articulo && NO_ES_NOMBRE.has(palabra)) break;
    if (palabras > 0 && CORTAN_NOMBRE.has(palabra)) break;

    if (palabras === 0) inicio = cursor;
    fin = m.index + m[0].length;
    palabras++;
  }

  return palabras >= minimo ? {inicio, fin} : null;
}

/** Índice de la primera aparición de `aguja` a partir de `desde`, o -1. */
function indiceDe(minus, aguja, desde) {
  return minus.indexOf(aguja, desde);
}

export class DetectorNombre {
  constructor(anclas = ANCLA_NOMBRE) { this.anclas = anclas; }

  tipo() { return 'nombre'; }

  detectar(texto) {
    const hallazgos = [];
    const minus = texto.toLowerCase();

    for (const ancla of this.anclas) {
      let desde = 0;
      for (;;) {
        const pos = indiceDe(minus, ancla, desde);
        if (pos === -1) break;
        desde = pos + ancla.length;

        // El ancla tiene que terminar en frontera de palabra: "senor" dentro de
        // "senores" no es el mismo ancla.
        if (!esFrontera(texto, desde)) continue;

        // Puede haber artículo de por medio: "del señor Pérez".
        const articulo = /^[\s,]*(?:de\s+la|del\s+la|de\s+la|del\s+la|de|del)\s+/i
          .exec(texto.slice(desde));
        const cursor = articulo ? desde + articulo[0].length : desde;

        const seg = segmentoPropio(texto, cursor, {maximo: 3, minimo: 2});
        if (!seg) continue;

        const valor = texto.slice(seg.inicio, seg.fin);
        hallazgos.push(new Hallazgo(this.tipo(), seg.inicio, valor.length, valor));
      }
    }
    return hallazgos;
  }
}

export class DetectorDireccion {
  constructor({vias = ANCLA_VIA, gacetero = CALLE_CONOCIDA} = {}) {
    this.vias = vias;
    this.gacetero = gacetero.map((c) => c.toLowerCase());
  }

  tipo() { return 'direccion'; }

  detectar(texto) {
    const hallazgos = [];
    const minus = texto.toLowerCase();

    // ── 1) Palabra de vía: "calle Bernardo O'Higgins 1450" ──
    for (const via of this.vias) {
      let desde = 0;
      for (;;) {
        const pos = indiceDe(minus, via, desde);
        if (pos === -1) break;
        desde = pos + via.length;
        if (!esFrontera(texto, desde)) continue;
        // "av" dentro de "avenida" ya se cubre por orden: se exige frontera
        // antes y después de la palabra de vía.
        if (pos > 0 && /[a-záéíóúñ]/i.test(texto[pos - 1])) continue;

        // Una calle puede ser de UNA sola palabra ("Apoquindo"), así que acá el
        // mínimo es 1. La fuerza la aporta el ancla: sin "avenida" delante, un
        // "Apoquindo" suelto no se marca.
        const seg = segmentoPropio(texto, desde, {maximo: 4, minimo: 1, permitirArticulo: true});
        const punto = seg ? seg.fin : desde;
        const mNum = RE_NUMERO.exec(texto.slice(punto));
        if (!mNum) continue;

        // El marcador cubre también la palabra de vía: dejar "Avenida" suelta
        // al lado del marcador no aporta nada y confunde al que lee el texto.
        const fin = punto + mNum[0].length;
        hallazgos.push(new Hallazgo(this.tipo(), pos, fin - pos, texto.slice(pos, fin)));
      }
    }

    // ── 2) Calle del gacetero sin palabra de vía: "vivo en Los Aromos 234" ──
    //    Solo cuando NO hay ya un hallazgo que la cubra: el solapamiento lo
    //    resuelve el motor, pero medir el doble infla el conteo de la UI.
    for (const calle of this.gacetero) {
      let desde = 0;
      for (;;) {
        const pos = indiceDe(minus, calle, desde);
        if (pos === -1) break;
        desde = pos + calle.length;

        // Debe empezar en frontera de palabra por ambos lados.
        if (pos > 0 && /[a-záéíóúñ]/i.test(texto[pos - 1])) continue;

        const mNum = RE_NUMERO.exec(texto.slice(desde));
        if (!mNum) continue;

        // Retrocede para incluir el artículo que es parte del nombre: "Los Aromos".
        let inicio = pos;
        const previo = /^((?:los|las|el|la|de|del)\s+)$/i.exec(
          texto.slice(Math.max(0, pos - 12), pos).toLowerCase(),
        );
        if (previo) inicio = pos - previo[1].length;

        const largo = (desde + mNum[0].length) - inicio;
        hallazgos.push(new Hallazgo(this.tipo(), inicio, largo, texto.slice(inicio, inicio + largo)));
      }
    }

    return hallazgos;
  }
}