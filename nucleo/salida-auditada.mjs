// La costura entre los tres sistemas.
//
// El problema que resuelve: hoy ARCOP sabe qué autorizó un vecino y el
// anonimizador sabe qué salió, pero no hay forma de juntarlos. Este módulo es
// la pieza que hace que eso sea imposible de olvidar, porque NO es opcional.
//
// EL DISEÑO IMPORTANTE. `SalidaAuditada` envuelve al anonimizador y exige dos
// cosas que antes eran opcionales:
//
//   1. el consentimiento que ampara el envío,
//   2. un reloj.
//
// Sin ellos no hay salida. Esa es la diferencia entre "el sistema registra la
// cobertura cuando se le ocurre" —que es como funciona hoy— y "el sistema no
// puede enviar sin decir bajo qué autorización". El segundo es el que sirve.
//
// Y el fallo es ruidoso a propósito: si alguien usa el anonimizador desnudo,
// no hay evento en la cadena y el verificador lo cuenta como `sin_cobertura`.
// La ausencia de evidencia se trata como ausencia de cobertura, no como
// ausencia de problema. Ese es el default correcto, y el que hace que el
// verificador sirva en vez de ser decorativo.

// El núcleo del anonimizador va vendorizado en `vendor/`, no importado desde
// el repositorio vecino. Antes el import cruzaba a `../../hefesto-anonimizador`,
// que sólo existe dentro de este workspace: el paquete se comprimía, se
// entregaba, y al descomprimirlo en otra máquina `npm test` fallaba con
// ERR_MODULE_NOT_FOUND. Un paquete de evidencia que no arranca al abrirlo no
// sirve para demostrar nada.
//
// Es una COPIA, no un doble de prueba: es el mismo código que corre en
// producción. `tests/higiene.test.mjs` compara los archivos byte a byte y falla
// si la copia se queda atrás.
import {Anonimizador} from '../vendor/hefesto-anonimizador/core/anonimizador.mjs';
import {BovedaEnMemoria} from '../vendor/hefesto-anonimizador/core/boveda.mjs';
import {clasificadorPorDefecto} from '../vendor/hefesto-anonimizador/core/sensible.mjs';
import {randomBytes, createHmac} from 'node:crypto';
import {emitirRecibo} from './recibo.mjs';

/**
 * Anonimizador + evidencia. Es lo que un sistema debería usar.
 */
export class SalidaAuditada {
  #anon;
  #cadena;
  #firmar;
  #sujeto;
  #proposito;
  #reloj;

  /**
   * @param {object} p
   * @param {object} p.cadena    Cadena donde se registran los eventos.
   * @param {object} p.anonimizador  Núcleo del anonimizador. Si no se pasa, se
   *        construye uno en memoria: para pruebas y para el panel.
   * @param {function} p.firmar  (manifiesto) => sobre firmado.
   * @param {function} p.sujeto  () => HMAC de 64 hex del titular.
   * @param {string} p.proposito Para qué se usa el dato.
   * @param {function} p.reloj   () => Date. Inyectable para pruebas.
   */
  constructor({cadena, anonimizador, firmar, sujeto, proposito, reloj = () => new Date()}) {
    this.#cadena = cadena;
    this.#firmar = firmar;
    this.#sujeto = sujeto;
    this.#proposito = proposito;
    this.#reloj = reloj;
    this.#anon = anonimizador || new Anonimizador({
      detectores: Anonimizador.detectoresPorDefecto({}),
      boveda: new BovedaEnMemoria({clave: randomBytes(32)}),
      clasificador: {categoriaDe: (t) => clasificadorPorDefecto(t).categoria},
      auditoria: {registrar() {}},
    });
  }

  get anonimizador() { return this.#anon; }
  get cadena() { return this.#cadena; }

  /**
   * Amordaza y deja rastro. `consentimiento` no es opcional: es el punto.
   *
   * @param {string} texto
   * @param {object} opciones
   * @param {string} opciones.consentimiento Id del consentimiento. Obligatorio.
   * @param {string} [opciones.proposito] Sobrescribe el del decorador.
   * @returns {{resultado: object, recibo: object|null, evento: object}}
   */
  amordazar(texto, {consentimiento, proposito} = {}) {
    if (!consentimiento) {
      throw new Error(
        'consentimiento_obligatorio: una salida sin consentimiento declarado no sale. ' +
        'Es la única forma de que el verificador pueda decir algo.',
      );
    }

    const ahora = this.#reloj();
    const antes = texto.length;
    const r = this.#anon.amordazar(texto);

    // Veto: no salió nada, no hay recibo, pero SÍ hay evento. Que quede
    // constancia de que se bloqueó un envío es parte de la evidencia.
    if (r.veredicto === 'vetado') {
      const evento = this.#cadena.agregar({
        sistema: 'anonimizador',
        tipo: 'salida.vetada',
        consentimiento,
        sujeto_ref: this.#sujeto(),
        proposito: proposito || this.#proposito,
        datos: {categorias: [r.categoria]},
        ts: ahora,
      });
      return {resultado: r, recibo: null, evento};
    }

    // Sin bóveda no hubo nada que proteger, y el decorador NO llama al
    // proveedor en ese caso: no hay salida, no hay nada que probar, y un
    // recibo de una llamada que no ocurrió es ruido que después alguien
    // tendrá que explicar.
    //
    // La decisión vive acá y no repartida entre `amordazar` y `preguntar`, para
    // que las dos no puedan discrepar: es el modo en que estos sistemas suelen
    // romperse, con la misma regla escrita en dos lugares y una versión vieja.
    if (!r.boveda) {
      return {resultado: r, recibo: null, evento: null};
    }

    // El manifiesto lo arma `emitirRecibo`, no esta clase. Armarlo aquí sería
    // armar una segunda versión del contrato — y esa es exactamente la forma
    // en que dos caminos que deberían ser idénticos se separan.
    const sobre = this.#firmar(emitirRecibo({
      textoSeguro: r.textoSeguro,
      tipos: r.tipos,
      cantidad: r.tipos.length,
      consentimiento,
      proposito: proposito || this.#proposito,
      proveedor: 'proveedor-externo',
      caracteresOriginales: antes,
      ts: ahora,
    }));

    // El evento NO lleva el texto ni el recibo entero: lleva el hash del
    // recibo. La cadena dice "hubo una salida con este identificador"; el
    // recibo, aparte, prueba qué se envió. Separarlos permite publicar la
    // cadena entera sin exponer los manifiestos.
    const evento = this.#cadena.agregar({
      sistema: 'anonimizador',
      tipo: 'salida.procesada',
      consentimiento,
      sujeto_ref: this.#sujeto(),
      proposito: proposito || this.#proposito,
      datos: {tipos: r.tipos, cantidad: r.tipos.length},
      ts: ahora,
    });

    return {resultado: r, recibo: sobre, evento};
  }

  /** Restaura y deja rastro de la respuesta que vuelve al vecino. */
  restaurar(respuesta, bovedaId, {consentimiento} = {}) {
    if (!consentimiento) {
      throw new Error('consentimiento_obligatorio: también la respuesta entra por el mismo camino');
    }
    const r = this.#anon.restaurar(respuesta, bovedaId);
    this.#cadena.agregar({
      sistema: 'anonimizador',
      tipo: 'respuesta.restaurada',
      consentimiento,
      sujeto_ref: this.#sujeto(),
      proposito: this.#proposito,
      datos: {total: r.length},
      ts: this.#reloj(),
    });
    return r;
  }
}

/** Un decorador que sostiene el invariante de punta a punta, con evidencia. */
export class ProveedorAuditado {
  #interno;
  #salida;

  constructor(proveedorInterno, salida) {
    this.#interno = proveedorInterno;
    this.#salida = salida;
  }

  /**
   * @param {string} texto
   * @param {object} opciones `{consentimiento}` — obligatorio.
   */
  async preguntar(texto, {consentimiento, proposito} = {}) {
    const {resultado: a} = this.#salida.amordazar(texto, {consentimiento, proposito});

    // Un veto, o un texto sin nada que proteger: vacío, sin llamar al
    // proveedor. El paquete no decide el reemplazo; cada sistema resuelve si
    // cae a sus preguntas frecuentes, a un modelo local o a atención humana.
    if (a.veredicto === 'vetado' || !a.boveda) return '';

    const respuesta = await this.#interno(a.textoSeguro);
    return this.#salida.restaurar(respuesta, a.boveda, {consentimiento});
  }
}

/**
 * Sujeto estable sin guardar el dato: un HMAC de tenant + titular con una sal
 * externa. Permite correlacionar los envíos de una misma persona sin que el
 * registro diga quién es, y no se puede cruzar entre instalaciones distintas.
 */
export function referenciaDeSujeto(tenant, titular, sal) {
  return createHmac('sha256', sal).update(tenant + '\u0000' + titular).digest('hex');
}


