// Anclaje externo.
//
// Por qué hace falta, y por qué la cadena sola no alcanza: una cadena con hash
// detecta que alguien EDITÓ un evento. No detecta que alguien reescribió la
// cadena entera y recalculó todos los hashes — porque eso da una cadena
// perfectamente coherente consigo misma. El que la publica fuera es el que
// hace notar la diferencia.
//
// La guarda que importa, y que ya se usa en Gen-Auditor: sólo se ancla una
// cabeza que EXISTE en la cadena. Sin ella, un anchoring de mentira —anclar un
// hash que no corresponde a nada— pasa los mismos controles que uno real, y el
// anclaje deja de probar.
//
// Lo que se ancla no es "la cadena": es (seq, head_hash). Un número y un hash.
// Lo mínimo que después permite probar que esa posición tenía ese contenido.

import {sha256} from './canonica.mjs';

/**
 * Ancla una cabeza. `publicar` es lo que en producción sería el KMS o el
 * almacén WORM; acá es una función, y el punto del diseño es que sea
 * intercambiable.
 *
 * @param {object} cadena
 * @param {function} publicar (cabeza) => {recibo: string, store_ref: string, key_id: string}
 * @returns {object} El anclaje registrado.
 */
export function anclar(cadena, publicar) {
  const cabeza = cadena.anclaActual();
  if (!cabeza) throw new Error('empty_chain: no se puede anclar una cadena vacía');

  // GUARDA. Una cabeza que no existe en la cadena no se ancla, por muchos que
  // sean los argumentos de la publicación.
  const enLaCadena = cadena.eventos.find((e) => e.seq === cabeza.seq);
  if (!enLaCadena) {
    throw new Error('head_not_in_chain: la cabeza que se quiere anclar no existe');
  }
  if (enLaCadena.hash !== cabeza.head_hash) {
    throw new Error('head_not_in_chain: el hash de la cabeza no corresponde a su evento');
  }

  const publicado = publicar({...cabeza});
  if (!publicado || typeof publicado.recibo !== 'string' || publicado.recibo.length < 16) {
    throw new Error('el anclaje necesita un recibo de longitud mínima: sin él no se probó nada');
  }

  const anclaje = {
    seq: cabeza.seq,
    head_hash: cabeza.head_hash,
    total: cabeza.total,
    anclado_en: new Date().toISOString(),
    recibo: publicado.recibo,
    store_ref: publicado.store_ref || 'desconocido',
    key_id: publicado.key_id || 'desconocido',
    // Huella del propio anclaje: permite detectar que el registro de anclajes
    // también fue editado.
    huella: sha256(
      [cabeza.seq, cabeza.head_hash, publicado.recibo, publicado.store_ref, publicado.key_id].join('\u0000'),
    ),
  };

  cadena.registrarAncla(anclaje);
  return {...anclaje};
}

/**
 * Publicador de prueba: no sale de este proceso. En desarrollo sirve para ver
 * la mecánica; **no sirve como evidencia**, y su `store_ref` lo dice.
 */
export function publicadorDePrueba(prefijo = 'prueba') {
  let n = 0;
  return (cabeza) => {
    n++;
    return {
      recibo: sha256(`${prefijo}:${cabeza.seq}:${cabeza.head_hash}:${n}`),
      store_ref: `memoria://${prefijo}/${n}`,
      key_id: 'ninguno',
    };
  };
}

/**
 * Compara la cadena contra lo que se publicó afuera.
 *
 * @returns {{ok:boolean, motivo:string}}
 */
export function comprobarAnclaje(cadena, publicado) {
  if (!publicado) {
    return {ok: false, motivo: 'sin publicación externa: la cadena puede haber sido reescrita entera'};
  }
  const local = cadena.anclas.find((a) => a.seq === publicado.seq);
  if (!local) {
    return {ok: false, motivo: `no hay anclaje local para el seq ${publicado.seq}`};
  }
  if (local.head_hash !== publicado.head_hash) {
    return {
      ok: false,
      motivo: 'la cadena local tiene otra cabeza que la publicada: fue reescrita',
      esperado: publicado.head_hash,
      local: local.head_hash,
    };
  }
  if (local.huella !== sha256(
    [local.seq, local.head_hash, local.recibo, local.store_ref, local.key_id].join('\u0000'),
  )) {
    return {ok: false, motivo: 'el registro de anclajes fue editado'};
  }
  return {ok: true, motivo: `cadena consistente con lo publicado en el seq ${publicado.seq}`};
}