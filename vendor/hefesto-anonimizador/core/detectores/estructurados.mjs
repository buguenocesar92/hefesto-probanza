// Detectores de datos con forma reconocible. Contrato único:
//
//   tipo() -> string
//   detectar(texto) -> Hallazgo[]
//
// `detectar` devuelve hallazgos ordenados por `inicio`. El motor se encarga de
// descartar los solapados, así que un detector NO tiene que coordinarse con
// otro: puede solaparse sin miedo.
//
// Equivalencia con muni-graneros/laravel-anonimizacion: el patrón, el dígito
// verificador y el criterio de falso positivo son los mismos, carácter por
// carácter. Lo que se agrega es el soporte de texto Unicode, que en JS es
// nativo y en PCRE hay que pedir con /u.

import {Hallazgo} from '../valores.mjs';

// ── RUT ──────────────────────────────────────────────────────────────────────
// El guión es opcional: la gente lo tipea corrido tanto en el formato con
// puntos ("12.345.6785") como en el plano ("123456785"). El único filtro
// contra falsos positivos es el dígito verificador, no el separador: un
// número con forma de RUT pero DV inválido es un monto o un folio, no una
// persona, y tokenizarlo sería un falso positivo.
const RE_RUT = /\b(\d{1,2}(?:\.\d{3}){2}|\d{7,8})-?([\dkK])\b/gu;

function digitoVerificador(cuerpo) {
  let suma = 0;
  let multiplicador = 2;
  // De derecha a izquierda, con el ciclo 2..7.
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * multiplicador;
    multiplicador = multiplicador === 7 ? 2 : multiplicador + 1;
  }
  const resto = 11 - (suma % 11);
  if (resto === 11) return '0';
  if (resto === 10) return 'K';
  return String(resto);
}

export class DetectorRut {
  tipo() { return 'rut'; }

  detectar(texto) {
    const hallazgos = [];
    RE_RUT.lastIndex = 0;
    let m;
    while ((m = RE_RUT.exec(texto)) !== null) {
      const valor = m[0];
      const cuerpo = m[1].replace(/\./g, '');
      const dv = m[2].toUpperCase();
      if (digitoVerificador(cuerpo) !== dv) continue;
      // `m.index` es el índice en unidades UTF-16, y `valor.length` también.
      // Los dos del mismo sistema: por eso el reemplazo no se corre.
      hallazgos.push(new Hallazgo(this.tipo(), m.index, valor.length, valor));
    }
    return hallazgos;
  }
}

// ── Teléfono ─────────────────────────────────────────────────────────────────
// Teléfono chileno, móvil y fijo.
//
// Los bordes son lookarounds de dígito y no \b: entre el "56" y el "9" de
// "+56912345678" no hay frontera de palabra, así que \b nunca coincidiría.
//
// Nueve dígitos después del +56:
//   - Móvil:            9 + 8 dígitos.
//   - Fijo de Santiago: 2 + 8 dígitos.
//   - Fijo de región:   código de dos dígitos (32-72) + 7 dígitos.
//
// Los fijos faltaban, y el público de una municipalidad incluye a mucha gente
// que deja el de la casa; en una comuna chica eso identifica un domicilio con
// bastante precisión.
//
// Los separadores se admiten entre CUALQUIER par de dígitos y no en posiciones
// fijas: la misma persona escribe "72 2 471000", "722471000" y "72-2471000", y
// un patrón con separadores en sitios fijos deja pasar dos de las tres.
//
// El móvil va PRIMERO en la alternancia: los motores se quedan con la primera
// rama que coincide, y las tres empiezan igual tras el prefijo.
const RE_TELEFONO =
  /(?<!\d)(?:\+?56[\s-]?)?(?:9(?:[\s-]?\d){8}|2(?:[\s-]?\d){8}|[3-7]\d(?:[\s-]?\d){7})(?!\d)/gu;

export class DetectorTelefono {
  tipo() { return 'telefono'; }

  detectar(texto) {
    const hallazgos = [];
    RE_TELEFONO.lastIndex = 0;
    let m;
    while ((m = RE_TELEFONO.exec(texto)) !== null) {
      hallazgos.push(new Hallazgo(this.tipo(), m.index, m[0].length, m[0]));
    }
    return hallazgos;
  }
}

// ── Correo ───────────────────────────────────────────────────────────────────
// Pragmático a propósito: el RFC completo acepta cosas que nadie escribe, y el
// patrón se vuelve imposible de auditar.
const RE_EMAIL = /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/gu;

export class DetectorEmail {
  tipo() { return 'email'; }

  detectar(texto) {
    const hallazgos = [];
    RE_EMAIL.lastIndex = 0;
    let m;
    while ((m = RE_EMAIL.exec(texto)) !== null) {
      hallazgos.push(new Hallazgo(this.tipo(), m.index, m[0].length, m[0]));
    }
    return hallazgos;
  }
}

// ── Folio ────────────────────────────────────────────────────────────────────
// El formato del número de seguimiento lo define cada instalación, no el
// núcleo. Vacío = sin folios, y no es un error: el paquete PHP tampoco falla.
export class DetectorFolio {
  constructor(patron) { this.patron = patron || ''; }

  tipo() { return 'folio'; }

  detectar(texto) {
    if (this.patron === '') return [];
    let re;
    try {
      re = new RegExp(this.patron, 'gu');
    } catch {
      // Un patrón roto de la instalación no puede tirar abajo la anonimización
      // completa: se apaga este detector y el resto sigue funcionando. Fallar
      // abierto acá significaría enviar el texto SIN tapar, que es el peor
      // resultado posible para una biblioteca cuyo propósito es tapar.
      re = null;
    }
    if (!re) return [];

    const hallazgos = [];
    let m;
    while ((m = re.exec(texto)) !== null) {
      // Una captura vacía con el patrón global nunca avanza y cuelga el
      // proceso. Un folio es algo: si no matcheó nada, se sale.
      if (m[0] === '') { re.lastIndex++; continue; }
      hallazgos.push(new Hallazgo(this.tipo(), m.index, m[0].length, m[0]));
    }
    return hallazgos;
  }
}