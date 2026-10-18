// El motor. `amordazar()` y `restaurar()`.
//
// El invariante del sistema: ningún texto sale hacia un proveedor externo sin
// pasar por amordazar(), y ninguna respuesta vuelve al ciudadano sin pasar por
// restaurar(). Eso no depende de la disciplina de quien programa, depende de
// que la garantía esté en la base de la librería.
//
// Equivalencia con muni-graneros/laravel-anonimizacion (mismo algoritmo):
//   - el veto va PRIMERO, antes de tokenizar y antes de tocar el store
//   - los marcadores se numeran de adelante hacia atrás y se REEMPLAZAN al revés
//   - sin hallazgos no se crea bóveda
//   - al restaurar, un marcador que no está en la bóveda se elimina, nunca se
//     deja crudo

import {randomBytes} from 'node:crypto';
import {Boveda, BovedaAjena, BovedaExpirada, BovedaNoDisponible} from './boveda.mjs';
import {BovedaId, Hallazgo, Resultado, Veredicto} from './valores.mjs';
import {DetectorEmail, DetectorFolio, DetectorRut, DetectorTelefono} from './detectores/estructurados.mjs';
import {DetectorDireccion, DetectorNombre} from './detectores/contextuales.mjs';
import {SIN_CLASIFICADOR} from './sensible.mjs';

// El patrón que restaur() reconoce. Cualquier cosa con esta forma que venga del
// usuario se desactiva antes de detectar (ver neutralizarMarcadores).
const RE_MARCADOR = /\[[A-Z]+_\d+_[a-f0-9]{4}\]/gu;
// Forma más laxa: lo que el usuario puede escribir para inyectar un marcador
// falso, con o sin el sufijo de nonce.
const RE_MARCADOR_SUPLANTE = /\[([A-Z]+_\d+(?:_[a-f0-9]+)?)\]/gu;

export class Anonimizador {
  /**
   * @param {object} opciones
   * @param {Array}  opciones.detectores   Lista de detectores. Por defecto los seis.
   * @param {object} opciones.boveda       Repositorio (BovedaEnMemoria / BovedaEnDisco / Redis).
   * @param {object} opciones.clasificador Implementación de categoriaDe(texto).
   * @param {object} opciones.auditoria    Implementación de registrar(evento, datos).
   * @param {string} opciones.patronFolio  Regex de folio de la instalación.
   */
  constructor({detectores, boveda, clasificador = SIN_CLASIFICADOR, auditoria} = {}) {
    this.boveda = boveda;
    this.clasificador = clasificador;
    this.auditoria = auditoria || {registrar() {}};

    this.detectores = detectores || [
      new DetectorRut(),
      new DetectorTelefono(),
      new DetectorEmail(),
      new DetectorFolio(''),
    ];
  }

  /**
   * Los seis detectores del núcleo completo, con el patrón de folio de la
   * instalación. Se separa del default a propósito: una instalación que no
   * configure folio NO debe empezar a tokenizar palabras que se le parezca.
   */
  static detectoresPorDefecto({patronFolio = '', incluirContextuales = true} = {}) {
    const base = [
      new DetectorRut(),
      new DetectorTelefono(),
      new DetectorEmail(),
      new DetectorFolio(patronFolio),
    ];
    if (incluirContextuales) {
      base.push(new DetectorNombre(), new DetectorDireccion());
    }
    return base;
  }

  /** Solo clasifica: no tokeniza, no crea bóveda, no escribe en el store. */
  categoriaSensibleDe(texto) {
    return this.clasificador.categoriaDe(texto);
  }

  /**
   * Modo seco: dice QUÉ detectaría, con posición, sin tokenizar ni escribir.
   *
   * Es lo que consume el panel de comprobación: para poder señalar un hallazgo
   * en el texto hay que saber dónde empieza, y esa información no existe una vez
   * que el texto ya fue reemplazado por marcadores. No crea bóveda ni toca el
   * store, así que puede usarse contra texto real sin dejar rastro.
   *
   * @returns {{categoria: string|null, hayDatos: boolean, tramos: Array}}
   */
  analizar(texto) {
    const categoria = this.clasificador.categoriaDe(texto);
    if (categoria !== null && categoria !== undefined) {
      return {categoria, hayDatos: false, tramos: []};
    }

    const limpio = this.neutralizarMarcadores(texto);

    let hallazgos = [];
    for (const detector of this.detectores) {
      hallazgos.push(...detector.detectar(limpio));
    }
    hallazgos.sort((a, b) => a.inicio - b.inicio);
    hallazgos = this.descartarSolapados(hallazgos);

    return {
      categoria: null,
      hayDatos: hallazgos.length > 0,
      tramos: hallazgos.map((h) => ({
        tipo: h.tipo,
        inicio: h.inicio,
        largo: h.largo,
        valor: h.valor,
      })),
    };
  }

  /**
   * @param {string} texto
   * @param {string|null} consumidor Quién amordaza. Queda grabado como dueño de
   *   la bóveda: nadie más va a poder restaurarla, aunque tenga permiso general
   *   de /restaurar.
   */
  amordazar(texto, consumidor = null) {
    // ── El veto va PRIMERO ──
    // Si el texto trae categoría sensible no sale, y no se gasta trabajo ni se
    // crea una bóveda que después habría que expirar.
    const categoria = this.clasificador.categoriaDe(texto);

    if (categoria !== null && categoria !== undefined) {
      this.auditoria.registrar('pii.vetado', {categoria});
      return Resultado.vetado(categoria);
    }

    const limpio = this.neutralizarMarcadores(texto);

    const hallazgos = [];
    for (const detector of this.detectores) {
      hallazgos.push(...detector.detectar(limpio));
    }

    // Se numera de adelante hacia atrás para que [RUT_1] sea el primero que
    // aparece en el texto, pero se REEMPLAZA de atrás hacia adelante: al revés,
    // cada sustitución correría la posición de las siguientes.
    hallazgos.sort((a, b) => a.inicio - b.inicio);

    const aceptados = this.descartarSolapados(hallazgos);

    const nonce = randomBytes(2).toString('hex');
    const boveda = new Boveda(consumidor);
    const numeros = new Map();
    const tipos = [];
    const marcadores = [];

    for (let i = 0; i < aceptados.length; i++) {
      const h = aceptados[i];
      const n = (numeros.get(h.tipo) || 0) + 1;
      numeros.set(h.tipo, n);
      marcadores[i] = `[${h.tipo.toUpperCase()}_${n}_${nonce}]`;
      if (!tipos.includes(h.tipo)) tipos.push(h.tipo);
    }

    // Reemplazo de atrás hacia adelante, con los offsets del mismo sistema.
    let salida = limpio;
    for (let i = aceptados.length - 1; i >= 0; i--) {
      const h = aceptados[i];
      boveda.agregar(marcadores[i], h.valor);
      salida = salida.slice(0, h.inicio) + marcadores[i] + salida.slice(h.inicio + h.largo);
    }

    // Sin hallazgos no hay nada que guardar, así que no se crea bóveda. En un
    // chatbot la mayoría de los turnos no trae datos personales, y cada uno
    // pagaría una escritura cifrada para un mapeo vacío.
    let id = null;
    if (aceptados.length > 0) {
      id = BovedaId.nueva();
      this.guardar(id, boveda, aceptados.map((h) => h.valor));
    }

    this.auditoria.registrar('pii.amordazado', {tipos, cantidad: aceptados.length});

    return new Resultado(Veredicto.Permitido, salida, id, tipos);
  }

  /**
   * Reinserta los valores reales.
   *
   * Los marcadores de la respuesta deben ser un SUBCONJUNTO de los de la bóveda:
   * uno que el modelo haya inventado se elimina, nunca se deja crudo ni se
   * intenta adivinar a qué persona apunta.
   *
   * @param {string} respuesta Texto que volvió del proveedor externo.
   * @param {BovedaId|null} id Nulo cuando amordazar() no encontró nada.
   * @param {string|null} consumidor Debe coincidir con el que amordazó.
   */
  restaurar(respuesta, id, consumidor = null) {
    if (id === null || id === undefined) return respuesta;

    const boveda = this.recuperar(id);

    if (!boveda.perteneceA(consumidor)) throw BovedaAjena.crear();

    this.auditoria.registrar('pii.restaurado', {marcadores: boveda.marcadores().length});

    RE_MARCADOR.lastIndex = 0;
    return respuesta.replace(RE_MARCADOR, (m) => {
      const valor = boveda.resolver(m);
      // Un marcador que no está en la bóveda se elimina: no se deja crudo.
      return valor === null ? '' : valor;
    });
  }

  /**
   * Traduce cualquier fallo del store a BovedaNoDisponible SIN encadenar la
   * excepción original.
   *
   * Es lo mismo que hace el paquete PHP y por el mismo motivo: el trace de una
   * excepción incluye los argumentos de cada llamada, y el primer argumento de
   * amordazar() es el texto completo del ciudadano. Si la excepción cruda se
   * propaga tal cual, el día que el store se cae el mensaje entero con el RUT
   * sin tapar termina en el log —justo lo que esta biblioteca existe para evitar.
   *
   * Y se va un paso más allá que el paquete PHP: tampoco se copia el mensaje
   * del error del store sin limpiarlo. Un cliente de Redis que avisa "READONLY
   * writing…" no trae datos del vecino, pero un wrapper que incluye el payload
   * en su mensaje sí. Como el motor sabe qué valores estaban protegidos, los
   * borra del mensaje antes de guardarlo. Ver `limpiar`.
   */
  guardar(id, boveda, secretos = []) {
    try {
      this.boveda.guardar(id, boveda);
    } catch (e) {
      if (e instanceof BovedaNoDisponible) {
        e.causa = limpiar(e.causa, secretos);
        throw e;
      }
      // Sin encadenar: ver arriba.
      throw new BovedaNoDisponible(limpiar(e.message, secretos));
    }
  }

  recuperar(id, secretos = []) {
    try {
      return this.boveda.recuperar(id);
    } catch (e) {
      // Las de este paquete se dejan pasar: sus mensajes solo llevan el id de
      // bóveda, que no es dato personal, y el consumidor necesita poder
      // distinguir "expiró" de "se cayó el store".
      if (e instanceof BovedaExpirada) throw e;
      if (e instanceof BovedaNoDisponible) {
        e.causa = limpiar(e.causa, secretos);
        throw e;
      }
      throw new BovedaNoDisponible(limpiar(e.message, secretos));
    }
  }

  /**
   * Descarta hallazgos cuyo rango se solapa con uno ya aceptado: dos detectores
   * pueden marcar el mismo tramo (un teléfono detectado DENTRO de un correo,
   * o una dirección que el gacetero y la palabra de vía tapan los dos).
   * Reemplazar ambos por separado corrompe el texto porque los offsets se
   * calcularon sobre el string original.
   *
   * Requiere que `hallazgos` venga ordenado por inicio ascendente. Cuando dos
   * empiezan igual, se queda con el más largo.
   */
  descartarSolapados(hallazgos) {
    const aceptados = [];
    let ultimo = null;
    let finAceptado = -1;

    for (const h of hallazgos) {
      const fin = h.inicio + h.largo;

      if (ultimo !== null && h.inicio < finAceptado) {
        // Se solapa con el último aceptado. Si empieza igual pero cubre más,
        // reemplaza al anterior; si no, se descarta.
        if (h.inicio === ultimo.inicio && h.largo > ultimo.largo) {
          aceptados.pop();
          aceptados.push(h);
          finAceptado = fin;
        }
        continue;
      }

      aceptados.push(h);
      ultimo = h;
      finAceptado = fin;
    }

    return aceptados;
  }

  /**
   * Cualquier cosa con forma de marcador que venga del usuario se desactiva
   * cambiando los corchetes por paréntesis: el mensaje se sigue entendiendo y
   * deja de poder inyectar entradas falsas al mapeo.
   */
  neutralizarMarcadores(texto) {
    return texto.replace(RE_MARCADOR_SUPLANTE, '($1)');
  }
}

// BovedaAjena en PHP es una clase con método estático de fábrica; en JS se
// adjunta a la clase para no romper el `throw BovedaAjena.crear()` de arriba.
BovedaAjena.crear = () => new BovedaAjena();

/**
 * Borra de un mensaje de error todo valor que el motor sabe que estaba
 * protegiendo. Es la última barrera antes de que un dato llegue a un log: el
 * error del store es el camino por el que un RUT escapa cuando Redis se cae,
 * y ese camino no puede depender de que cada cliente de store sea discreto.
 */
function limpiar(mensaje, secretos) {
  if (typeof mensaje !== 'string') return mensaje;
  let salida = mensaje;
  for (const secreto of secretos || []) {
    if (!secreto || secreto.length < 3) continue;
    salida = salida.split(secreto).join('[PI REDACTADO]');
  }
  return salida;
}

export {BovedaId, Hallazgo, Resultado, Veredicto, Boveda, BovedaAjena, BovedaExpirada, BovedaNoDisponible};