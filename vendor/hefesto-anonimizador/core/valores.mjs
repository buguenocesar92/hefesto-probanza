// Tipos de valor del núcleo. Son el contrato que comparten todas las
// implementaciones: los nombres de campo de la respuesta HTTP salen de acá.
//
// Equivalencia con el paquete PHP (muni-graneros/laravel-anonimizacion):
//   Hallazgo  -> Hallazgo {tipo, inicio, largo, valor}
//   Veredicto -> enum Veredicto: Permitido|Vetado
//   Resultado -> Resultado {veredicto, textoSeguro, boveda, tipos, categoria}
//   BovedaId  -> BovedaId {valor}
//   Boveda    -> Boveda
//
// IMPORTANTE SOBRE OFFSETS: PHP mide en BYTES (`PREG_OFFSET_CAPTURE` y
// `strlen`). JavaScript mide en UNIDADES UTF-16. Ambos son internamente
// consistentes —detectan y reemplazan con la misma unidad—, así que el texto
// de salida es idéntico siempre que no se mezclen las dos. Mezclarlas
// corrompe el texto en cuanto aparece un acento: es el error más caro que
// puede tener esta biblioteca, y por eso `Hallazgo` guarda inicio y largo en
// la MISMA unidad que usa quien los produjo.

import {randomBytes} from 'node:crypto';

/** Un tramo del texto original que hay que reemplazar por un marcador. */
export class Hallazgo {
  /**
   * @param {string} tipo  Etiqueta del tipo de dato: 'rut', 'telefono', 'email'...
   * @param {number} inicio Offset del primer carácter, en unidades UTF-16.
   * @param {number} largo  Cantidad de unidades UTF-16 que ocupa.
   * @param {string} valor Texto original. NUNCA se registra ni se expone.
   */
  constructor(tipo, inicio, largo, valor) {
    this.tipo = tipo;
    this.inicio = inicio;
    this.largo = largo;
    this.valor = valor;
  }
}

export const Veredicto = Object.freeze({
  Permitido: 'permitido',
  Vetado: 'vetado',
});

export class BovedaId {
  constructor(valor) { this.valor = valor; }

  /** 16 bytes aleatorios en hex = 32 hexadecimales, igual que el paquete PHP. */
  static nueva() { return new BovedaId(randomBytes(16).toString('hex')); }

  /** Valida el formato antes de tocar la bóveda: 32 hex, ni más ni menos. */
  static esValido(valor) { return typeof valor === 'string' && /^[a-f0-9]{32}$/.test(valor); }

  toString() { return this.valor; }

  /** El id de bóveda no es dato personal, se puede imprimir tal cual. */
  toJSON() { return {valor: this.valor}; }
}

/**
 * Respuesta de amordazar().
 *
 * `boveda` es null cuando el texto no traía datos personales: no se escribe una
 * bóveda vacía por cada mensaje. En un chatbot la mayoría de los turnos no trae
 * nada, y cada uno pagaría una escritura cifrada para un mapeo vacío.
 */
export class Resultado {
  /**
   * @param {string} veredicto Uno de Veredicto.
   * @param {string} textoSeguro Texto con los marcadores en su lugar.
   * @param {BovedaId|null} boveda
   * @param {string[]} tipos Tipos distintos detectados, en orden de aparición.
   * @param {string|null} categoria Categoría sensible que disparó el veto.
   */
  constructor(veredicto, textoSeguro, boveda, tipos, categoria = null) {
    this.veredicto = veredicto;
    this.textoSeguro = textoSeguro;
    this.boveda = boveda;
    this.tipos = tipos;
    this.categoria = categoria;
  }

  static vetado(categoria) { return new Resultado(Veredicto.Vetado, '', null, [], categoria); }

  /**
   * Lo que sale por la respuesta HTTP.
   *
   * `boveda_id` en snake_case porque es un contrato de red, no un objeto de PHP
   * que alguien vaya a tipar. El marcador se expone porque el texto seguro lo
   * contiene: ocultarlo no añadiría nada y rompería al consumidor.
   */
  aJson() {
    return {
      veredicto: this.veredicto,
      categoria: this.categoria,
      texto_seguro: this.textoSeguro,
      boveda_id: this.boveda ? this.boveda.valor : null,
      tipos: this.tipos,
    };
  }
}