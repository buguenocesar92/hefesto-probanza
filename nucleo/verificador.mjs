// Verificador de cobertura: la pieza que hoy no existe en ningún lado.
//
// El problema que resuelve. ARCOP registra qué autorizó un vecino. El
// anonimizador registra qué salió hacia el proveedor. Nadie junta las dos
// cosas, así que la pregunta «¿cuáles de estos 14.302 envíos quedaron
// cubiertos por un consentimiento vigente?» no tiene respuesta. No es que la
// respuesta sea difícil: es que la llave no viaja.
//
// Qué hace: toma la cadena de eventos y el registro de consents, y para cada
// envío dice una de cuatro cosas. Cada respuesta lleva su motivo, porque un
// verificador que dice "no" sin decir por qué obliga al auditor a repetir el
// trabajo a mano.
//
//   cubierto       — hay consentimiento, vigente, del propósito correcto
//   sin_cobertura  — no hay consentimiento que lo ampare
//   vencido        — el consentimiento existía pero expiró antes del envío
//   revocado       — se retiró o restringió ANTES del envío
//
// Ese último es el que importa. Un consentimiento retirado que  igual permitió
// salidas durante un mes es exactamente el hallazgo que un auditor busca, y es
// el más caro de ignorar.

export const VERSION_POLITICA = 'politica.v1';

/** Los cuatro veredictos. */
export const Veredicto = Object.freeze({
  Cubierto: 'cubierto',
  SinCobertura: 'sin_cobertura',
  Vencido: 'vencido',
  Revocado: 'revocado',
});

/**
 * Estado efectivo de un consentimiento en una fecha dada.
 *
 * El registro de ARCOP es append-only y NO tiene columna de estado: el estado
 * se deriva de `consent_actions`. Esto replica exactamente esa regla, para que
 * la cobertura no dependa de que alguien mantenga un campo que puede mentir.
 *
 * @param {object} consent {id, granted_at, expires_at, proposito, subject_ref}
 * @param {Array}  acciones [{action:'withdrawn'|'restricted', occurred_at}]
 * @param {Date}   en
 */
export function estadoDe(consent, acciones, en) {
  const cuando = new Date(en);

  if (consent.expires_at && cuando >= new Date(consent.expires_at)) {
    return {vigente: false, motivo: 'vencido', desde: consent.expires_at};
  }

  // La última acción que ocurrió ANTES del envío es la que manda. Una retirada
  // posterior noyvence lo que ya pasó: el hecho ocurrió y la evidencia dice
  // que ocurrió.
  const previas = acciones
    .filter((a) => a.consent_id === consent.id && new Date(a.occurred_at) <= cuando)
    .sort((a, b) => new Date(a.occurred_at) - new Date(a.occurred_at));

  if (previas.length === 0) {
    return {vigente: true, motivo: 'otorgado', desde: consent.granted_at};
  }

  const ultima = previas[previas.length - 1];
  if (ultima.action === 'withdrawn') {
    return {vigente: false, motivo: 'revocado', desde: ultima.occurred_at, accion: ultima};
  }
  if (ultima.action === 'restricted') {
    // SEMÁNTICA DE `scope`: es la lista de lo que SIGUE PERMITIDO, no de lo
    // que se prohíbe. Restringir significa reducir el alcance, así que leerlo
    // al revés —"si el propósito no está en la lista de prohibidos, pasa"— es
    // el error que hace que una restricción no restringa nada.
    //
    // `null`, `undefined` y `'todo'` significan "sin restricción adicional":
    // el consentimiento sigue vigente tal cual.
    const alcance = ultima.scope;
    if (alcance === null || alcance === undefined || alcance === 'todo') {
      return {vigente: true, motivo: 'restringido', desde: ultima.occurred_at, accion: ultima};
    }
    if (Array.isArray(alcance) && !alcance.includes(consent.proposito)) {
      return {
        vigente: false, motivo: 'revocado', desde: ultima.occurred_at, accion: ultima,
        detalle: `restringido a [${alcance.join(', ')}], y "${consent.proposito}" quedó fuera`,
      };
    }
    return {vigente: true, motivo: 'restringido', desde: ultima.occurred_at, accion: ultima};
  }

  return {vigente: true, motivo: 'otorgado', desde: consent.granted_at};
}

/**
 * @param {object} evento  Evento de tipo `salida.procesada`.
 * @param {Array}  consents
 * @param {Array}  acciones
 * @returns {{veredicto:string, motivo:string, consentimiento:string|null}}
 */
export function verificarCobertura(evento, consents, acciones) {
  if (!evento.consentimiento) {
    return {
      veredicto: Veredicto.SinCobertura,
      motivo: 'el envío no declara qué consentimiento lo ampara',
      consentimiento: null,
    };
  }

  const consent = consents.find((c) => c.id === evento.consentimiento);
  if (!consent) {
    return {
      veredicto: Veredicto.SinCobertura,
      motivo: `el evento cita el consentimiento ${evento.consentimiento} y no está en el registro`,
      consentimiento: evento.consentimiento,
    };
  }

  // El propósito del evento tiene que ser el que el consentimiento ampara. Es
  // la regla más obvia y la que más se rompe en la práctica: un consentimiento
  // para "atención al vecino" cubriendo un envío de "prospeción".
  if (consent.proposito !== evento.proposito) {
    return {
      veredicto: Veredicto.SinCobertura,
      motivo: `el consentimiento ampara "${consent.proposito}" y el envío dice "${evento.proposito}"`,
      consentimiento: consent.id,
    };
  }

  // El sujeto del evento tiene que ser el del consentimiento. Sin esto, el
  // consentimiento de Juan Pérez cubriría el envío de María González.
  if (consent.subject_ref && evento.sujeto_ref && consent.subject_ref !== evento.sujeto_ref) {
    return {
      veredicto: Veredicto.SinCobertura,
      motivo: 'el consentimiento es de otra persona: los sujetos no coinciden',
      consentimiento: consent.id,
    };
  }

  const estado = estadoDe(consent, acciones, evento.ts);
  if (!estado.vigente) {
    return {veredicto: estado.motivo === 'vencido' ? Veredicto.Vencido : Veredicto.Revocado,
      motivo: `${estado.motivo} desde ${estado.desde}`, consentimiento: consent.id};
  }

  return {
    veredicto: Veredicto.Cubierto,
    motivo: estado.motivo === 'restringido'
      ? `otorgado, con una restricción vigente desde ${estado.desde}`
      : `vigente desde ${consent.granted_at}`,
    consentimiento: consent.id,
  };
}

/**
 * Verifica toda la cadena y devuelve el informe completo.
 *
 * Un número agregado no sirve para auditar: lo que se necesita son las filas.
 * El resumen va incluido porque un tablero lo necesita, pero el detalle es la
 * parte que se lee.
 */
export function verificarTodo(cadena, {consents = [], acciones = []} = {}) {
  const integridad = cadena.verificar();
  const ancla = cadena.anclas[0] || null;
  const anclaje = cadena.verificarAncla(ancla);

  const fila = [];
  for (const e of cadena.eventos) {
    if (!e.tipo.startsWith('salida.')) continue;
    fila.push({seq: e.seq, ts: e.ts, ...verificarCobertura(e, consents, acciones), evento: e});
  }

  const conteo = {
    total: fila.length,
    cubierto: fila.filter((f) => f.veredicto === Veredicto.Cubierto).length,
    sin_cobertura: fila.filter((f) => f.veredicto === Veredicto.SinCobertura).length,
    vencido: fila.filter((f) => f.veredicto === Veredicto.Vencido).length,
    revocado: fila.filter((f) => f.veredicto === Veredicto.Revocado).length,
  };

  // El denominador honesto: los envíos sin cobertura son los que importan, y
  // el porcentaje se calcula sobre lo que realmente se envió, no sobre lo que
  // el sistema creepyó que podía enviar.
  const pctCubierto = conteo.total ? Math.round((conteo.cubierto / conteo.total) * 100) : 0;

  return {
    integridad,
    anclaje,
    conteo: {...conteo, pct_cubierto: pctCubierto},
    filas: fila,
    // Lo que hay que mirar primero: el orden es por gravedad, no por fecha.
    // Un envío revocado es peor que uno sin cobertura, porque hubo un
    // consentimiento y alguien lo dejó de lado.
    accionable: [...fila]
      .filter((f) => f.veredicto !== Veredicto.Cubierto)
      .sort((a, b) => {
        const peso = {revocado: 0, vencido: 1, sin_cobertura: 2, cubierto: 3};
        return peso[a.veredicto] - peso[b.veredicto] || a.seq - b.seq;
      }),
  };
}