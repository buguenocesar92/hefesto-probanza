// La cadena. Un solo eslabón por evento, encadenado por hash, y append-only.
//
// Por qué una cadena y no una tabla con timestamps: porque una tabla con
// timestamps se puede reescribir, y el dueño de la base puede reescribir. Una
// cadena con el hash de cada entrada hace que borrar un evento obligue a
// recalcular todos los siguientes, y eso ya no es "editar una fila": es un
// incidente detectable.
//
// Y por qué no alcanza por sí sola — y esto hay que decirlo, porque es la
// diferencia entre una cadena y una promesa: el propietario de la base PUEDE
// reescribir la cadena entera y recalcular los hashes. Por eso existe el
// anclaje externo: una cabeza que se publica fuera puede compararse después.
// La cadena detecta la alteración local; el anclaje detecta la reescritura
// total. Son dos cosas y hace falta la segunda.

import {canonico, hashEvento, validarEvento, VERSION_EVENTO, sha256} from './canonica.mjs';

/** El estado inicial de una cadena: no hay anterior, entonces el hash previo es nulo. */
const VACIA = {previo: null, seq: 0, eventos: []};

export class Cadena {
  #eventos = [];
  #anclas = [];

  constructor(eventos = [], anclas = []) {
    this.#eventos = eventos.map((e) => ({...e}));
    this.#anclas = anclas.map((a) => ({...a}));
  }

  static nueva() { return new Cadena(); }

  get vacia() { return this.#eventos.length === 0; }
  get length() { return this.#eventos.length; }
  get eventos() { return this.#eventos.map((e) => ({...e})); }
  get anclas() { return this.#anclas.map((a) => ({...a})); }

  /** El hash del último evento, o null si la cadena está vacía. */
  get cabeza() { return this.#eventos.length ? this.#eventos[this.#eventos.length - 1].hash : null; }

  /** Copia congelada de la cabeza. Lo que se ancla afuera es esto, no "la cadena". */
  anclaActual() {
    if (this.vacia) return null;
    const ultimo = this.#eventos[this.#eventos.length - 1];
    return {seq: ultimo.seq, head_hash: ultimo.hash, total: this.#eventos.length};
  }

  /**
   * Añade un evento. Es la única forma de escribir en la cadena.
   *
   * @param {object} evento Sin `seq`, `previo` ni `hash`: los pone la cadena. Si
   *   el llamador los trae, se rechaza — no es descuido, es que nadie elige en
   *   qué posición queda su propia evidencia.
   */
  agregar(evento) {
    for (const reservado of ['seq', 'previo', 'hash']) {
      if (evento[reservado] !== undefined) {
        throw new Error(`"${reservado}" lo calcula la cadena, no el llamador`);
      }
    }

    const {sistema, tipo, consentimiento = null, sujeto_ref = null, proposito, datos = {}, ts} = evento;
    if (ts === undefined) {
      throw new Error('ts es obligatorio: una marca de tiempo decidida por el reloj del cliente no sirve como evidencia.');
    }

    const nuevo = {
      v: VERSION_EVENTO,
      seq: this.#eventos.length,
      ts: ts instanceof Date ? ts.toISOString() : ts,
      sistema,
      tipo,
      consentimiento,
      sujeto_ref,
      proposito,
      datos,
      previo: this.cabeza,
    };

    const errores = validarEvento(nuevo);
    if (errores.length) {
      throw new Error('evento inválido:\n  - ' + errores.join('\n  - '));
    }

    nuevo.hash = hashEvento(nuevo);
    this.#eventos.push(Object.freeze(nuevo));
    return {...nuevo};
  }

  /**
   * Verifica la cadena COMPLETA.
   *
   * No devuelve "true/false" y ya: devuelve qué posición se rompió, porque un
   * booleano obliga al auditor a repetir el trabajo a mano para saber qué pasó.
   *
   * @returns {{ok: boolean, total: number, rotura: object|null}}
   */
  verificar() {
    let previo = null;

    for (const [i, e] of this.#eventos.entries()) {
      const problemas = validarEvento(e);
      if (problemas.length) {
        return {ok: false, total: this.#eventos.length, rotura: {seq: e.seq ?? i, motivo: 'forma', detalle: problemas}};
      }

      if (e.seq !== i) {
        return {ok: false, total: this.#eventos.length, rotura: {seq: e.seq, motivo: 'hueco', detalle: [`esperaba seq ${i}, llegó ${e.seq}`]}};
      }

      if ((e.previo || null) !== previo) {
        return {ok: false, total: this.#eventos.length, rotura: {seq: e.seq, motivo: 'enlace', detalle: ['el previo no coincide con el hash del evento anterior']}};
      }

      const recalculado = hashEvento(e);
      if (recalculado !== e.hash) {
        return {ok: false, total: this.#eventos.length, rotura: {seq: e.seq, motivo: 'contenido', detalle: ['el contenido del evento no corresponde a su hash']}};
      }

      previo = e.hash;
    }

    return {ok: true, total: this.#eventos.length, rotura: null};
  }

  /**
   * Verifica que una cabeza anclada siga siendo la cabeza de esta cadena.
   *
   * Esta es la comprobación que detecta la reescritura total: si alguien
   * borró eventos y recalculó la cadena entera, el hash nuevo será coherente
   * consigo mismo pero YA NO coincidirá con el que se publicó afuera.
   */
  verificarAncla(ancla) {
    if (!ancla) return {ok: false, motivo: 'sin ancla: una cadena sin ancla externa es reescribible en su totalidad'};

    const enLaCadena = this.#eventos.find((e) => e.seq === ancla.seq);
    if (!enLaCadena) {
      return {ok: false, motivo: `el ancla apunta al seq ${ancla.seq}, que no existe en esta cadena`};
    }
    if (enLaCadena.hash !== ancla.head_hash) {
      return {
        ok: false,
        motivo: 'el evento anclado tiene otro hash que el publicado: la cadena fue reescrita',
        esperado: ancla.head_hash,
        hallado: enLaCadena.hash,
      };
    }
    return {ok: true, motivo: 'la cabeza anclada sigue siendo la misma'};
  }

  /** Registra un anclaje externo. La guarda real vive en `Anclador`. */
  registrarAncla(ancla) { this.#anclas.push(Object.freeze({...ancla})); }

  /**
   * Reconstruye el hash de un evento tal como lo haría un tercero con el
   * documento completo. Existe para que un auditor externo pueda comprobar sin
   * confiar en esta implementación.
   */
  huellaDelDocumento() { return sha256(this.#eventos.map((e) => e.hash).join('')); }
}

export {canonico, hashEvento, validarEvento, VERSION_EVENTO};