// La bóveda: el mapeo marcador → valor real. Contiene datos personales.
//
// TRES VÍAS POR LAS QUE UN OBJETO SE IMPRIME EN NODE —string interpolation,
// util.inspect, JSON.stringify— quedan neutralizadas a propósito, igual que en
// el paquete PHP. No por paranoia: la bóveda es lo único que este sistema
// guarda con el dato dentro, y un `console.log(boveda)` en la línea de un
// error basta para volcar el RUT de un vecino al log de la aplicación.
//
// El cifrado NO es un extra de esta capa: vive en el repositorio, porque es el
// store el que escribe en disco (Redis hace snapshots). Un .rdb filtrado tiene
// que ser ciphertext. Ver `BovedaEnMemoria` y `BovedaEnArchivo`.

import {createCipheriv, createDecipheriv, randomBytes, timingSafeEqual} from 'node:crypto';
import * as fs from 'node:fs';
import {BovedaId} from './valores.mjs';

const VERSION = 'v1';
const IV = 12;   // 96 bits, el tamaño que recomienda NIST para GCM.
const TAG = 16;

/**
 * @param {string|null} consumidor Dueño de la bóveda. Null cuando se usa como
 *   librería sin la API: ahí no hay consumidor que comprobar.
 */
export class Boveda {
  constructor(consumidor = null) {
    this.consumidor = consumidor;
    this.mapa = new Map();
  }

  agregar(marcador, valor) { this.mapa.set(marcador, valor); }

  /** @returns {string|null} null si el marcador no está, para que restaurar lo borre. */
  resolver(marcador) {
    return this.mapa.has(marcador) ? this.mapa.get(marcador) : null;
  }

  marcadores() { return [...this.mapa.keys()]; }

  /**
   * ¿Puede este consumidor restaurar? Sin dueño registrado (uso como librería)
   * no hay nada que comprobar.
   */
  perteneceA(consumidor) {
    return this.consumidor === null || this.consumidor === consumidor;
  }

  /**
   * Las tres vías de impresión. Un cliente que meta esto en un log o en una
   * respuesta de error se lleva un conteo, nunca el dato.
   */
  toString() { return `[Boveda: ${this.mapa.size} entradas ocultas]`; }
  toJSON() { return {entradas_ocultas: this.mapa.size}; }
  [Symbol.for('nodejs.util.inspect.custom')]() { return this.toString(); }

  /** Forma serializable para el cifrado. Solo la usan los repositorios. */
  aObjeto() { return {consumidor: this.consumidor, mapa: Object.fromEntries(this.mapa)}; }

  static desdeObjeto(datos) {
    const b = new Boveda(datos.consumidor ?? null);
    for (const [k, v] of Object.entries(datos.mapa || {})) b.mapa.set(k, v);
    return b;
  }
}

/** Cifra el contenido de la bóveda con AES-256-GCM. */
export function cifrar(boveda, clave) {
  const iv = randomBytes(IV);
  const cifrador = createCipheriv('aes-256-gcm', clave, iv);
  const claro = Buffer.from(JSON.stringify(boveda.aObjeto()), 'utf8');
  const cifrado = Buffer.concat([cifrador.update(claro), cifrador.final()]);
  return Buffer.concat([Buffer.from(VERSION), iv, cifrador.getAuthTag(), cifrado]);
}

/** Revierte `cifrar`. Lanza si la clave no es la correcta o si alguien editó el archivo. */
export function descifrar(paquete, clave) {
  if (paquete.subarray(0, 2).toString() !== VERSION) {
    throw new Error('Formato de bóveda desconocido');
  }
  let cursor = 2;
  const iv = paquete.subarray(cursor, (cursor += IV));
  const tag = paquete.subarray(cursor, (cursor += TAG));
  const cuerpo = paquete.subarray(cursor);

  const descifrador = createDecipheriv('aes-256-gcm', clave, iv);
  descifrador.setAuthTag(tag);
  const claro = Buffer.concat([descifrador.update(cuerpo), descifrador.final()]);
  return Boveda.desdeObjeto(JSON.parse(claro.toString('utf8')));
}

/** Compara dos claves sin filtrar por temporización. */
export function clavesIguales(a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b) || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// ── Errores de dominio ───────────────────────────────────────────────────────
export class BovedaExpirada extends Error {
  constructor(id) { super('La bóveda expiró o nunca existió'); this.codigo = 'boveda_expirada'; this.id = id; }
}
export class BovedaAjena extends Error {
  constructor() { super('Bóveda ajena'); this.codigo = 'boveda_ajena'; }
}
export class BovedaNoDisponible extends Error {
  constructor(causa) { super('La bóveda no está disponible'); this.codigo = 'boveda_no_disponible'; this.causa = causa; }
}

/**
 * Base común: traduce cualquier fallo del store a BovedaNoDisponible SIN
 * encadenar la excepción original.
 *
 * Es lo mismo que hace el paquete PHP y por el mismo motivo: el trace de una
 * excepción incluye los argumentos de cada llamada, y el primer argumento de
 * amordazar() es el texto completo del ciudadano. Si la excepción cruda se
 * propaga tal cual, el día que el store se cae el mensaje entero con el RUT
 * sin tapar termina en el log —justo lo que esta biblioteca existe para evitar.
 * Del error original se conserva solo el mensaje.
 */
export class RepositorioBase {
  constructor({clave}) {
    if (!clave || clave.length !== 32) {
      throw new Error('La bóveda exige una clave de 32 bytes (ANONIMIZADOR_CLAVE_BOVEDA)');
    }
    this.clave = Buffer.isBuffer(clave) ? clave : Buffer.from(clave, 'hex');
    if (this.clave.length !== 32) {
      throw new Error('La clave de la bóveda debe tener 32 bytes');
    }
  }

  guardar(id, boveda) { throw new Error('no implementado'); }
  recuperar(id) { throw new Error('no implementado'); }
}

/**
 * Bóveda en memoria con TTL real. Para tests y para el panel.
 *
 * El TTL se implementa de verdad, no de mentira: una bóveda en memoria sin
 * expirar escondería exactamente el fallo que el store de array esconde en el
 * paquete PHP —que es la razón de ser del `test:redis` obligatorio.
 */
export class BovedaEnMemoria extends RepositorioBase {
  constructor({clave, ttl = 900, reloj = () => Date.now()} = {}) {
    super({clave});
    this.ttl = ttl * 1000;
    this.reloj = reloj;
    this.datos = new Map();
  }

  guardar(id, boveda) {
    try {
      this.datos.set(id.valor, {cifrado: cifrar(boveda, this.clave), vence: this.reloj() + this.ttl});
    } catch (e) {
      throw new BovedaNoDisponible(e.message);
    }
  }

  recuperar(id) {
    const fila = this.datos.get(id.valor);
    if (!fila) throw new BovedaExpirada(id.valor);
    if (this.reloj() > fila.vence) {
      this.datos.delete(id.valor);
      throw new BovedaExpirada(id.valor);
    }
    try {
      return descifrar(fila.cifrado, this.clave);
    } catch (e) {
      throw new BovedaNoDisponible(e.message);
    }
  }

  /** Para el panel y las pruebas: cuántas bóvedas vivas hay ahora. */
  contar() { return this.datos.size; }

  /** El panel necesita ver los marcadores SIN ver los valores. */
  inspeccionar(id) {
    const fila = this.datos.get(id.valor);
    if (!fila) return null;
    return {
      entradas: descifrar(fila.cifrado, this.clave).marcadores(),
      venceEnMs: Math.max(0, fila.vence - this.reloj()),
      cifrada: true,
    };
  }
}

/**
 * Bóveda en disco, para correr sin Redis. Un archivo por bóveda, cifrado.
 *
 * NO es para producción: cada archivo es una operación de sistema completa y un
 * volumen compartido entre procesos noCoordina bien. Está para que el panel y
 * las pruebas de integración funcionen en una máquina sin Redis. Para producción
 * el store tiene que ser Redis en una base separada, con requirepass y sin
 * puerto publicado — ver docs/LIMITES.md.
 */
export class BovedaEnDisco extends RepositorioBase {
  constructor({clave, dir, ttl = 900, reloj = () => Date.now()} = {}) {
    super({clave});
    this.dir = dir;
    this.ttl = ttl * 1000;
    this.reloj = reloj;
  }

  ruta(id) {
    // El id ya viene validado como 32 hex, pero el nombre de archivo se
    // construye igual: un id con "/" en el store de otro motor no debe poder
    // escribir fuera del directorio.
    if (!BovedaId.esValido(id.valor)) throw new BovedaExpirada(String(id.valor));
    return `${this.dir}/${id.valor}.bov`;
  }

  guardar(id, boveda) {
    try {
      this.escribir(this.ruta(id), cifrar(boveda, this.clave));
    } catch (e) {
      if (e instanceof BovedaExpirada) throw e;
      throw new BovedaNoDisponible(e.message);
    }
  }

  recuperar(id) {
    let bruto;
    try {
      bruto = this.leer(this.ruta(id));
    } catch (e) {
      if (e instanceof BovedaExpirada) throw e;
      throw new BovedaNoDisponible(e.message);
    }
    // El vencimiento va en los metadatos del archivo, no dentro del ciphertext.
    if (this.reloj() > bruto.vence) {
      this.borrar(this.ruta(id));
      throw new BovedaExpirada(id.valor);
    }
    try {
      return descifrar(bruto.cifrado, this.clave);
    } catch (e) {
      throw new BovedaNoDisponible(e.message);
    }
  }

  escribir(ruta, cifrado) {
    const cabecera = Buffer.alloc(8);
    cabecera.writeBigUInt64BE(BigInt(this.reloj() + this.ttl));
    // El archivo se escribe entero y recién después se renombra: si el proceso
    // muere a mitad, queda el anterior y no un archivo truncado que la
    // próxima lectura interpreta como dato corrupto.
    const temporal = `${ruta}.tmp`;
    fs.mkdirSync(this.dir, {recursive: true});
    fs.writeFileSync(temporal, Buffer.concat([cabecera, cifrado]));
    fs.renameSync(temporal, ruta);
  }

  leer(ruta) {
    if (!fs.existsSync(ruta)) throw new BovedaExpirada(ruta);
    const bruto = fs.readFileSync(ruta);
    return {vence: Number(bruto.subarray(0, 8).readBigUInt64BE(0)), cifrado: bruto.subarray(8)};
  }

  borrar(ruta) {
    try { fs.unlinkSync(ruta); } catch { /* ya no estaba: no importa */ }
  }
}