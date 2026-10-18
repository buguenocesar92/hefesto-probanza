// Escenario de demostración.
//
// TODO EL CONTENIDO ES INVENTADO. Nombres, RUT, mensajes y fechas: nada de esto
// sale de un registro real. Un panel que muestra datos de personas de verdad es
// exactamente lo que este ecosistema existe para evitar.
//
// El escenario está construido para que el verificador tenga algo que encontrar.
// Un tablero todo en verde no demuestra que el verificador funcione: hay que
// sembrar los cuatro fallos y ver que los detecta.

import {Cadena} from '../nucleo/cadena.mjs';
import {SalidaAuditada} from '../nucleo/salida-auditada.mjs';
import {emitirRecibo, firmarRecibo, verificarRecibo, generarParDeLLAves} from '../nucleo/recibo.mjs';
import {referenciaDeSujeto} from '../nucleo/salida-auditada.mjs';
import {anclar, publicadorDePrueba} from '../nucleo/ancla.mjs';

const KID = 'ed25519:demostracion';

/** Fecha de arranque por defecto. Fija a propósito: dos corridas del escenario
 *  tienen que dar la misma cadena, o los hashes no son reproducibles y los
 *  tests dejan de comprobar nada. Se mueve con `escenario.reloj`. */
export const INICIO_POR_DEFECTO = '2026-05-01T10:00:00.000Z';

/** Identidad de la entidad en el escenario. Entra en el HMAC del sujeto. */
export const TENANT_POR_DEFECTO = 'municipalidad';
export const SAL_POR_DEFECTO = 'sal-de-demostracion';

/** Sujetos: HMAC de personas inventadas, para que el panel no diga quién es.
 *  El tenant y la salen de la configuración: son parte de la identidad de la
 *  entidad, no del escenario. */
function sujetos(tenant, sal) {
  return {
    a: referenciaDeSujeto(tenant, 'vecino-anton', sal),
    b: referenciaDeSujeto(tenant, 'vecina-berta', sal),
    c: referenciaDeSujeto(tenant, 'vecino-carlos', sal),
  };
}

/**
 * Mensajes inventados, uno por lo que se quiere demostrar.
 */
const MENSAJES = [
  // 1. El camino normal: hay consentimiento y todo en orden.
  {quien: 'a', proposito: 'atencion', consent: 'c-atencion',
    texto: 'Buenas tardes, mi RUT es 12.345.678-5 y necesito un certificado deetts.',},

  // 2. Un envío con consentimiento que después se retira: este está ANTES de
  //    la retirada, así que queda cubierto. El paso 9 repite el mismo
  //    consentimiento DESPUÉS, y ahí es revocado.
  {quien: 'b', proposito: 'atencion', consent: 'c-revocable',
    texto: 'Mi teléfono es 9 8765 4321, ¿cuándo me atienden?'},

  // 3. Consentimiento de atención usado para un envío de otro propósito.
  {quien: 'a', proposito: 'prospeccion', consent: 'c-atencion',
    texto: 'Le paso mi correo para un Mailing de feriados: juan@correo.cl'},

  // 4. Consentimiento vencido: se usó después de su fecha.
  {quien: 'c', proposito: 'licencias', consent: 'c-vencido',
    texto: 'Necesito renovar la patente de mi moto, RUT 20.347.878-K.'},

  // 5. Envío sin consentimiento declarado.
  {quien: 'c', proposito: 'atencion', consent: null,
    texto: 'mi correo es carlos@mail.cl y quiero informacion sobre Permissions?'},

  // 6. Consentimiento que el registro no conoce: el evento cita algo fantasma.
  {quien: 'b', proposito: 'atencion', consent: 'c-fantasma',
    texto: 'Mi RUT es 15.678.234-3, favor responder.'},

  // 7. Un veto: la categoría sensible corta antes de salir.
  {quien: 'a', proposito: 'atencion', consent: 'c-atencion',
    texto: 'Necesito la credencial de discapacidad de mi hijo que tiene autismo.'},

  // 8. Texto sin datos: no sale, no hay bóveda, no hay evento.
  {quien: 'c', proposito: 'atencion', consent: 'c-atencion',
    texto: '¿A qué hora abren?'},

  // 9. El caso caro. El consentimiento se retiró en el día 5, y este envío usa
  //    ese mismo consentimiento en el día 9. Hubo autorización, dejó de haberla,
  //    y el sistema siguió mandando igual. Es el hallazgo que más duele en una
  //    auditoría y el más fácil de no ver si nadie junta las dos fuentes.
  {quien: 'b', proposito: 'atencion', consent: 'c-revocable',
    texto: 'Reitero: mi RUT es 11.111.111-1 y mi correo es berta@mail.cl.'},
];

/**
 * Registro de consentimientos. Replica la forma de ARCOP: el estado NO está,
 * se deriva de `consent_actions`.
 *
 * LAS FECHAS SON RELATIVAS AL INICIO, no absolutas. Con fechas fijas, mover el
 * reloj de la entidad dejaba el escenario sin sentido: la retirada caía fuera de
 * la corrida y los nueve envíos salían ya revocados. Una demostración que
 * cambia de comportamiento según el día en que se mira no demuestra nada.
 */
function consents(ancla, vecinos) {
  const dia = (n) => new Date(ancla.getTime() + n * 86_400_000).toISOString();
  return [
    {
      id: 'c-atencion', proposito: 'atencion', sujeto: vecinos.a,
      granted_at: dia(-100), expires_at: null,
    },
    {
      id: 'c-revocable', proposito: 'atencion', sujeto: vecinos.b,
      granted_at: dia(-60), expires_at: null,
    },
    {
      id: 'c-vencido', proposito: 'licencias', sujeto: vecinos.c,
      granted_at: dia(-200), expires_at: dia(-1),
    },
  ];
}

function acciones(ancla) {
  const dia = (n) => new Date(ancla.getTime() + n * 86_400_000).toISOString();
  return [
    // La retirada de `c-revocable`, en el día 4. Los envíos anteriores quedan
    // cubiertos; el del día 8, no. El día 4 cae dentro de la corrida de nueve
    // mensajes, que es lo que hace demostrable el caso.
    {consent_id: 'c-revocable', action: 'withdrawn', occurred_at: dia(4),
      motivo: 'el vecino pidió no recibir más respuestas automáticas'},
  ];
}

/**
 * Construye el escenario completo: cadena, recibos, consents y anclaje.
 *
 * @param {object} opciones
 * @param {string|null} opciones.desde    Fecha ISO de inicio. Sin esto arranca en
 *   la fecha fija de la demostración, y eso es lo que hace que dos corridas den
 *   exactamente la misma cadena y por eso los hashes son reproducibles.
 * @param {string} opciones.tenant      Identificador de la entidad. Entra en el
 *   HMAC del sujeto, así que dos entidades con el mismo tenant y la misma sal
 *   producen las mismas referencias: eso es una decisión, no un accidente.
 * @param {string} opciones.sal         Sal del HMAC de sujetos.
 *
 * La fecha puede moverse por configuración. Antes estaba escrita aquí, y un
 * panel de otra entidad mostraba envíos de mayo junto a informes de octubre:
 * dos tiempos que no conviven en la misma pantalla.
 */
export function construirEscenario({
  desde = INICIO_POR_DEFECTO,
  tenant = TENANT_POR_DEFECTO,
  sal = SAL_POR_DEFECTO,
} = {}) {
  const {privada} = generarParDeLLAves(KID);
  const cadena = Cadena.nueva();

  const arranque = new Date(desde ?? INICIO_POR_DEFECTO);
  if (Number.isNaN(arranque.getTime())) {
    throw new Error(
      `escenario.reloj no es una fecha ISO válida: "${desde}". ` +
      'Con una fecha inválida el escenario arrancaría en una fecha inventada, ' +
      'que es justo lo que la configuración sirve para evitar.'
    );
  }
  let reloj = arranque;
  const recibos = [];
  const pasos = [];

  const vecinos = sujetos(tenant, sal);

  const salida = new SalidaAuditada({
    cadena,
    firmar: (manifiesto) => firmarRecibo(manifiesto, privada, KID),
    // Sujeto variable por mensaje: el decorador se construye por salida.
    proposito: 'atencion',
    reloj: () => reloj,
  });

  for (const paso of MENSAJES) {
    reloj = new Date(reloj.getTime() + 86_400_000); // un día simulado entre pasos

    const uno = new SalidaAuditada({
      cadena,
      firmar: (manifiesto) => firmarRecibo(manifiesto, privada, KID),
      sujeto: () => vecinos[paso.quien],
      proposito: paso.proposito,
      reloj: () => reloj,
    });

    let resultado, recibo = null;
    try {
      ({resultado, recibo} = uno.amordazar(paso.texto, {consentimiento: paso.consent}));
    } catch (e) {
      pasos.push({texto: paso.texto, error: e.message, ts: reloj.toISOString()});
      continue;
    }

    if (recibo) recibos.push(recibo);

    pasos.push({
      texto: paso.texto,
      proposito: paso.proposito,
      consentimiento: paso.consent,
      veredicto: resultado.veredicto,
      categoria: resultado.categoria,
      tipos: resultado.tipos,
      texto_seguro: resultado.textoSeguro,
      ts: reloj.toISOString(),
    });
  }

  // La cadena se ancla: sin ancla externa, el verificador declara que toda la
  // cadena es reescribible, y el panel lo dice.
  const anclaje = anclar(cadena, publicadorDePrueba('demostracion'));

  return {
    cadena,
    recibos,
    anclaje,
    pasos,
    vecinos,
    consents: consents(arranque, vecinos).map((c) => ({
      id: c.id, proposito: c.proposito, subject_ref: c.sujeto,
      granted_at: c.granted_at, expires_at: c.expires_at,
    })),
    acciones: acciones(arranque),
    kid: KID,
  };
}

/** Los valores por defecto de la demostración, para quien los necesite. */
export const VECINOS = sujetos(TENANT_POR_DEFECTO, SAL_POR_DEFECTO);
export const CONSENTS = consents(new Date(INICIO_POR_DEFECTO), VECINOS);
export const ACCIONES = acciones(new Date(INICIO_POR_DEFECTO));
export {sujetos, consents, acciones, verificarRecibo, emitirRecibo};