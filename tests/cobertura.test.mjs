// Verificador de cobertura: los cuatro veredictos y las guardas que los sostienen.
//
// Aquí está la prueba que de verdad importa: qué hace el verificador cuando se
// le SACA una guarda. Un test que sólo dice "con la guarda funciona" no sabe si
// la guarda es la que funciona.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Cadena} from '../nucleo/cadena.mjs';
import {estadoDe, verificarCobertura, verificarTodo, Veredicto} from '../nucleo/verificador.mjs';

const SUJETO_A = 'a'.repeat(64);
const SUJETO_B = 'b'.repeat(64);

const CONSENT = {
  id: 'c-1',
  proposito: 'atencion',
  subject_ref: SUJETO_A,
  granted_at: '2026-01-01T00:00:00.000Z',
  expires_at: null,
};

function salida({consentimiento = 'c-1', proposito = 'atencion', sujeto = SUJETO_A, ts = '2026-06-01T12:00:00.000Z'} = {}) {
  return {
    v: 'evento.v1', seq: 0, ts,
    sistema: 'anonimizador', tipo: 'salida.procesada',
    consentimiento, sujeto_ref: sujeto, proposito,
    datos: {tipos: ['rut'], cantidad: 1},
    previo: null, hash: 'x'.repeat(64),
  };
}

// ── Los cuatro veredictos ───────────────────────────────────────────────────
test('cubierto: hay consentimiento vigente del propósito correcto', () => {
  const r = verificarCobertura(salida(), [CONSENT], []);
  assert.equal(r.veredicto, Veredicto.Cubierto);
});

test('sin_cobertura: el envío no declara consentimiento', () => {
  const r = verificarCobertura(salida({consentimiento: null}), [CONSENT], []);
  assert.equal(r.veredicto, Veredicto.SinCobertura);
  assert.match(r.motivo, /no declara/);
});

test('sin_cobertura: el evento cita un consentimiento que no existe', () => {
  const r = verificarCobertura(salida({consentimiento: 'inventado'}), [CONSENT], []);
  assert.equal(r.veredicto, Veredicto.SinCobertura);
  assert.match(r.motivo, /no está en el registro/);
});

test('vencido: el consentimiento expiró antes del envío', () => {
  const vencido = {...CONSENT, expires_at: '2026-03-01T00:00:00.000Z'};
  const r = verificarCobertura(salida({ts: '2026-06-01T12:00:00.000Z'}), [vencido], []);
  assert.equal(r.veredicto, Veredicto.Vencido);
});

test('revocado: se retiró ANTES del envío', () => {
  const acciones = [{consent_id: 'c-1', action: 'withdrawn', occurred_at: '2026-05-01T00:00:00.000Z', scope: null}];
  const r = verificarCobertura(salida({ts: '2026-06-01T12:00:00.000Z'}), [CONSENT], acciones);
  assert.equal(r.veredicto, Veredicto.Revocado);
});

test('una retirada POSTERIOR al envío no lo invalida: el hecho ocurrió', () => {
  const acciones = [{consent_id: 'c-1', action: 'withdrawn', occurred_at: '2026-07-01T00:00:00.000Z', scope: null}];
  const r = verificarCobertura(salida({ts: '2026-06-01T12:00:00.000Z'}), [CONSENT], acciones);
  assert.equal(r.veredicto, Veredicto.Cubierto,
    'invalidó retroactivamente un envío que ocurrió antes de la retirada');
});

// ── La retirada parcial ─────────────────────────────────────────────────────
// `scope` es lo que SIGUE PERMITIDO. Restringir reduce el alcance, así que
// una lista que no incluye el propósito del envío lo corta.
test('una restricción acotada deja pasar lo que la lista todavía nombra', () => {
  const acciones = [{
    consent_id: 'c-1', action: 'restricted',
    occurred_at: '2026-05-01T00:00:00.000Z',
    scope: ['atencion', 'licencias'],
  }];
  const r = verificarCobertura(salida({ts: '2026-06-01T12:00:00.000Z', proposito: 'atencion'}), [CONSENT], acciones);
  assert.equal(r.veredicto, Veredicto.Cubierto);
  assert.match(r.motivo, /restricción vigente/);
});

test('una restricción que deja fuera el propósito SÍ lo corta', () => {
  const acciones = [{
    consent_id: 'c-1', action: 'restricted',
    occurred_at: '2026-05-01T00:00:00.000Z',
    scope: ['licencias'],
  }];
  const r = verificarCobertura(salida({ts: '2026-06-01T12:00:00.000Z', proposito: 'atencion'}), [CONSENT], acciones);
  assert.equal(r.veredicto, Veredicto.Revocado);
});

test('GUARDA: leída al revés, la restricción no restringiría nada', () => {
  // El error real: interpretar `scope` como la lista de lo PROHIBIDO. Con esa
  // lectura, retirar consentimientos para prospección no impediría ni un solo
  // envío de prospección, y el verificador daría verde.
  const scope = ['licencias'];
  const proposito = 'atencion';

  const leidoAlReves = !scope.includes(proposito); // "no está en la lista de prohibidos → pasa"
  const leidoBien = scope.includes(proposito);     // "está en lo que sigue permitido → pasa"

  assert.equal(leidoAlReves, true, 'la lectura al revés deja pasar el envío');
  assert.equal(leidoBien, false, 'la lectura correcta lo corta');
});

test('el estado se deriva de las acciones, no de una columna de estado', () => {
  // Es la regla de ARCOP: `consents` es de solo anexado y no tiene columna de
  // estado. Si alguien metiera una, el estado real y el declarado divergirían.
  const acciones = [{consent_id: 'c-1', action: 'withdrawn', occurred_at: '2026-05-01T00:00:00.000Z'}];
  assert.equal(estadoDe(CONSENT, [], '2026-06-01T00:00:00.000Z').vigente, true);
  assert.equal(estadoDe(CONSENT, acciones, '2026-06-01T00:00:00.000Z').vigente, false);
  assert.equal(CONSENT.estado, undefined, 'el consentimiento trae un estado propio: no debería');
});

// ── Las guardas, comprobadas quitándolas ────────────────────────────────────

test('GUARDA: sin la comprobación de propósito, un consentimiento de atención ampara una prospección', () => {
  // Se reproduce el verificador SIN la guarda de propósito.
  const sinGuardaDeProposito = (evento, consents) => {
    const c = consents.find((x) => x.id === evento.consentimiento);
    if (!c) return Veredicto.SinCobertura;
    return Veredicto.Cubierto; // ← la guarda que falta
  };

  const evento = salida({proposito: 'prospeccion'});
  assert.equal(sinGuardaDeProposito(evento, [CONSENT]), Veredicto.Cubierto,
    'el defecto NO se reproduce: el test no probaría nada');
  assert.equal(verificarCobertura(evento, [CONSENT], []).veredicto, Veredicto.SinCobertura,
    'con la guarda, se corta');
});

test('GUARDA: sin la comprobación de sujeto, el consentimiento de uno ampara el envío de otro', () => {
  const sinGuardaDeSujeto = (evento, consents) => {
    const c = consents.find((x) => x.id === evento.consentimiento);
    if (!c) return Veredicto.SinCobertura;
    if (c.proposito !== evento.proposito) return Veredicto.SinCobertura;
    return Veredicto.Cubierto; // ← falta "y los sujetos coinciden"
  };

  const evento = salida({sujeto: SUJETO_B}); // el consentimiento es de A
  assert.equal(sinGuardaDeSujeto(evento, [CONSENT]), Veredicto.Cubierto,
    'el defecto NO se reproduce: el test no probaría nada');

  const r = verificarCobertura(evento, [CONSENT], []);
  assert.equal(r.veredicto, Veredicto.SinCobertura);
  assert.match(r.motivo, /otra persona/);
});

test('GUARDA: sin mirar las acciones, una retirada pasa inadvertida', () => {
  const sinGuardaDeAcciones = (evento, consents) => {
    const c = consents.find((x) => x.id === evento.consentimiento);
    return c ? Veredicto.Cubierto : Veredicto.SinCobertura; // ← no mira acciones
  };

  const acciones = [{consent_id: 'c-1', action: 'withdrawn', occurred_at: '2026-05-01T00:00:00.000Z'}];
  const evento = salida({ts: '2026-06-01T12:00:00.000Z'});

  assert.equal(sinGuardaDeAcciones(evento, [CONSENT], acciones), Veredicto.Cubierto,
    'el defecto NO se reproduce: el test no probaría nada');
  assert.equal(verificarCobertura(evento, [CONSENT], acciones).veredicto, Veredicto.Revocado);
});

test('GUARDA: sin mirar la expiración, un consentimiento vencido pasa inadvertido', () => {
  const vencido = {...CONSENT, expires_at: '2026-03-01T00:00:00.000Z'};
  const sinGuardaDeVencimiento = (evento, consents) => {
    const c = consents.find((x) => x.id === evento.consentimiento);
    return c ? Veredicto.Cubierto : Veredicto.SinCobertura; // ← no mira expires_at
  };

  const evento = salida({ts: '2026-06-01T12:00:00.000Z'});
  assert.equal(sinGuardaDeVencimiento(evento, [vencido], []), Veredicto.Cubierto,
    'el defecto NO se reproduce: el test no probaría nada');
  assert.equal(verificarCobertura(evento, [vencido], []).veredicto, Veredicto.Vencido);
});

// ── El informe completo ─────────────────────────────────────────────────────
test('el informe ordena lo accionable por gravedad, no por fecha', () => {
  const c = Cadena.nueva();
  const casos = [
    {consentimiento: null, ts: '2026-06-01T12:00:00.000Z'},
    {consentimiento: 'c-1', ts: '2026-06-02T12:00:00.000Z'},
  ];
  for (const k of casos) {
    c.agregar({sistema: 'anonimizador', tipo: 'salida.procesada', ...k,
      sujeto_ref: SUJETO_A, proposito: 'atencion',
      datos: {tipos: ['rut'], cantidad: 1}, ts: k.ts});
  }

  const acciones = [{consent_id: 'c-1', action: 'withdrawn', occurred_at: '2026-06-01T06:00:00.000Z'}];
  const informe = verificarTodo(c, {consents: [CONSENT], acciones});

  assert.equal(informe.conteo.total, 2);
  assert.equal(informe.conteo.revocado, 1);
  assert.equal(informe.conteo.sin_cobertura, 1);
  assert.equal(informe.conteo.cubierto, 0);
  // Un revocado es más grave que un sin cobertura: hubo consentimiento y
  // alguien lo dejó de lado.
  assert.equal(informe.accionable[0].veredicto, Veredicto.Revocado);
  assert.equal(informe.accionable[1].veredicto, Veredicto.SinCobertura);
});

test('el informe reporta la cadena como no anclable cuando no hay ancla', () => {
  const c = Cadena.nueva();
  c.agregar({sistema: 'anonimizador', tipo: 'salida.procesada', consentimiento: 'c-1',
    sujeto_ref: SUJETO_A, proposito: 'atencion', datos: {}, ts: '2026-06-01T12:00:00.000Z'});

  const informe = verificarTodo(c, {consents: [CONSENT], acciones: []});
  assert.equal(informe.integridad.ok, true);
  assert.equal(informe.anclaje.ok, false);
  assert.match(informe.anclaje.motivo, /reescribible/);
});

test('el porcentaje se calcula sobre lo que se envió, no sobre lo permitido', () => {
  const c = Cadena.nueva();
  for (const consent of [null, 'c-1', 'c-1', 'fantasma']) {
    c.agregar({sistema: 'anonimizador', tipo: 'salida.procesada', consentimiento: consent,
      sujeto_ref: SUJETO_A, proposito: 'atencion', datos: {},
      ts: '2026-06-01T12:00:00.000Z'});
  }

  const informe = verificarTodo(c, {consents: [CONSENT], acciones: []});
  assert.equal(informe.conteo.total, 4);
  assert.equal(informe.conteo.cubierto, 2);
  assert.equal(informe.conteo.pct_cubierto, 50);
  // 2 de 4. Un sistema que solo mirara "de los consentimientos registrados,
  // cuántos se usaron bien" daría 100% y se vigilaría.
  assert.equal(informe.conteo.sin_cobertura, 2);
});