// Integración: los tres sistemas, juntos.
//
// El anonimizador es REAL — se importa del proyecto vecino, no es un doble de
// prueba. Si el motor cambia un comportamiento, esta suite se entera.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Cadena} from '../nucleo/cadena.mjs';
import {SalidaAuditada, ProveedorAuditado, referenciaDeSujeto} from '../nucleo/salida-auditada.mjs';
import {emitirRecibo, firmarRecibo, verificarRecibo, generarParDeLLAves} from '../nucleo/recibo.mjs';
import {verificarTodo, Veredicto} from '../nucleo/verificador.mjs';
import {anclar, publicadorDePrueba} from '../nucleo/ancla.mjs';
import {construirEscenario} from '../demo/escenario.mjs';

const RUT = '12.345.678-5';

function montar({kid = 'ed25519:2026-a'} = {}) {
  const {privada} = generarParDeLLAves(kid);
  const cadena = Cadena.nueva();
  let ahora = new Date('2026-06-01T09:00:00.000Z');

  const salida = new SalidaAuditada({
    cadena,
    // El recibo se firma en el mismo lugar donde se arma, y con la llave real.
    firmar: (manifiesto) => firmarRecibo(manifiesto, privada, kid),
    sujeto: () => referenciaDeSujeto('municipalidad', 'vecino-123', 'sal-de-prueba'),
    proposito: 'atencion',
    reloj: () => ahora,
  });

  return {
    cadena, salida, kid,
    avanzar: (ms) => { ahora = new Date(ahora.getTime() + ms); },
    ahora: () => ahora,
  };
}

const CONSENT = {
  id: 'c-1',
  proposito: 'atencion',
  subject_ref: referenciaDeSujeto('municipalidad', 'vecino-123', 'sal-de-prueba'),
  granted_at: '2026-01-01T00:00:00.000Z',
  expires_at: null,
};

// ── El camino feliz ─────────────────────────────────────────────────────────
test('una salida auditada deja evento Y recibo, y el verificador la da por cubierta', () => {
  const m = montar();

  const {resultado, recibo, evento} = m.salida.amordazar(`mi rut es ${RUT}`, {consentimiento: 'c-1'});

  assert.equal(resultado.veredicto, 'permitido');
  assert.ok(!resultado.textoSeguro.includes(RUT));
  assert.ok(evento.hash, 'el evento no tiene hash');
  assert.equal(evento.consentimiento, 'c-1');
  assert.equal(verificarRecibo(recibo).ok, true);

  const informe = verificarTodo(m.cadena, {consents: [CONSENT], acciones: []});
  assert.equal(informe.conteo.total, 1);
  assert.equal(informe.conteo.cubierto, 1);
  assert.equal(informe.conteo.pct_cubierto, 100);
  assert.deepEqual(informe.accionable, []);
});

test('el evento NO lleva el texto ni el recibo: la cadena se puede publicar sola', () => {
  const m = montar();
  m.salida.amordazar(`mi rut es ${RUT} y mi correo es ana@correo.cl`, {consentimiento: 'c-1'});

  const todaLaCadena = JSON.stringify(m.cadena.eventos);
  assert.ok(!todaLaCadena.includes(RUT), 'el RUT quedó en la cadena');
  assert.ok(!todaLaCadena.includes('ana@correo.cl'), 'el correo quedó en la cadena');
  assert.ok(!todaLaCadena.includes('[RUT_'), 'el texto seguro quedó en la cadena');
  // El evento lleva los TIPOS, que es lo único que hace falta para auditar.
  // En orden de aparición, no alfabético: el orden dice qué se tapó primero.
  assert.ok(todaLaCadena.includes('"tipos":["rut","email"]'), todaLaCadena);
});

// ── Lo que no puede pasar ───────────────────────────────────────────────────
test('una salida sin consentimiento NO sale: el permiso es la puerta', () => {
  const m = montar();
  assert.throws(
    () => m.salida.amordazar('mi rut es ' + RUT, {}),
    /consentimiento_obligatorio/,
    'dejó salir un texto sin consentimiento declarado',
  );
  assert.equal(m.cadena.length, 0, 'dejó un evento sin consentimiento');
});

test('un texto vetado deja evento, pero no recibo ni bóveda', () => {
  const m = montar();
  const {resultado, recibo, evento} = m.salida.amordazar(
    'mi hijo tiene autismo y necesito la credencial', {consentimiento: 'c-1'});

  assert.equal(resultado.veredicto, 'vetado');
  assert.equal(recibo, null, 'emitió un recibo de algo que no salió');
  assert.equal(evento.tipo, 'salida.vetada');
  assert.equal(m.cadena.length, 1, 'un bloqueo tiene que quedar registrado');
});

test('un texto sin datos NO crea bóveda ni recibo, pero tampoco evento de salida', () => {
  const m = montar();
  const {resultado, recibo} = m.salida.amordazar('quiero saber el horario', {consentimiento: 'c-1'});

  assert.equal(resultado.boveda, null);
  assert.equal(recibo, null);
  // No hubo salida, así que no hay nada que probar. Registrar un envío que no
  // ocurrió infla el conteo y lo vuelve menos útil.
  assert.equal(m.cadena.length, 0);
});

// ── El escenario que hoy no se puede detectar ───────────────────────────────
test('GUARDA: con el anonimizador DESNUDO, el envío queda sin cobertura', () => {
  const m = montar();
  // Así es como funciona hoy: sin consentimiento, sin evento, sin recibo.
  m.salida.anonimizador.amordazar(`mi rut es ${RUT}`);

  assert.equal(m.cadena.length, 0, 'el motor desnudo no debería dejar rastro');

  const informe = verificarTodo(m.cadena, {consents: [CONSENT], acciones: []});
  assert.equal(informe.conteo.total, 0);
  // La ausencia de evidencia NO es cobertura. Por eso el total es 0 y no
  // "100% cubierto": si alguien mirara sólo el porcentaje de los eventos que
  // sí se registraron, vería un tablero verde sobre un sistema que no registra.
  assert.notEqual(informe.conteo.pct_cubierto, 100);
});

test('una retirada del consentimiento se refleja en el verificador sin tocar la cadena', () => {
  const m = montar();

  m.salida.amordazar(`mi rut es ${RUT}`, {consentimiento: 'c-1'});
  m.avanzar(3600 * 1000);
  m.salida.amordazar(`mi rut es ${RUT}`, {consentimiento: 'c-1'});

  // Entre los dos envíos se retira el consentimiento. La cadena no cambia: los
  // hechos ocurrieron. Lo que cambia es si estaban cubiertos, y eso lo decide
  // la fecha de la retirada, que es lo correcto.
  const retirada = {consent_id: 'c-1', action: 'withdrawn', occurred_at: '2026-06-01T09:30:00.000Z'};

  const antes = verificarTodo(m.cadena, {consents: [CONSENT], acciones: []});
  assert.equal(antes.conteo.cubierto, 2);

  const despues = verificarTodo(m.cadena, {consents: [CONSENT], acciones: [retirada]});
  assert.equal(despues.conteo.cubierto, 1, 'la retirada no surtió efecto');
  assert.equal(despues.conteo.revocado, 1);
  assert.equal(despues.accionable[0].seq, 1, 'la fila accionable es la segunda');
});

// ── El decorador completo ───────────────────────────────────────────────────
test('el decorador auditado no deja pasar nada al proveedor sin tapar', async () => {
  const m = montar();
  const vistos = [];

  const proveedor = new ProveedorAuditado(async (texto) => {
    vistos.push(texto);
    const marca = texto.match(/\[[A-Z]+_\d+_[a-f0-9]{4}\]/);
    return `Su RUT es ${marca ? marca[0] : 'lo que sea'}.`;
  }, m.salida);

  const salida = await proveedor.preguntar(`mi rut es ${RUT}`, {consentimiento: 'c-1'});

  assert.equal(vistos.length, 1);
  assert.ok(!vistos[0].includes(RUT), 'el RUT llegó al proveedor');
  assert.ok(salida.includes(RUT), 'el vecino no recibió su dato de vuelta');

  // Y quedó rastro de las dos mitades del viaje.
  const tipos = m.cadena.eventos.map((e) => e.tipo);
  assert.ok(tipos.includes('salida.procesada'));
  assert.ok(tipos.includes('respuesta.restaurada'));
});

test('el decorador exige consentimiento también para restaurar', async () => {
  const m = montar();
  const {resultado} = m.salida.amordazar(`mi rut es ${RUT}`, {consentimiento: 'c-1'});
  assert.throws(
    () => m.salida.restaurar(resultado.textoSeguro, resultado.boveda, {}),
    /consentimiento_obligatorio/,
  );
});

test('un veto no llama al proveedor', async () => {
  const m = montar();
  let llamo = false;
  const proveedor = new ProveedorAuditado(async () => { llamo = true; return 'x'; }, m.salida);

  const r = await proveedor.preguntar('necesito la credencial de discapacidad de mi hijo', {consentimiento: 'c-1'});

  assert.equal(r, '');
  assert.equal(llamo, false);
});

// ── Anclaje del conjunto ────────────────────────────────────────────────────
test('todo el recorrido queda anclado y verificable desde afuera', () => {
  const m = montar();
  m.salida.amordazar(`mi rut es ${RUT}`, {consentimiento: 'c-1'});
  m.avanzar(1000);
  m.salida.amordazar(`mi correo es ana@correo.cl`, {consentimiento: 'c-1'});

  const publicado = anclar(m.cadena, publicadorDePrueba('municipalidad'));

  const informe = verificarTodo(m.cadena, {consents: [CONSENT], acciones: []});
  assert.equal(informe.integridad.ok, true);
  assert.equal(informe.anclaje.ok, true);
  assert.equal(publicado.total, 2);
});

test('la llave del consentimiento viaja en el evento: esa es la unión', () => {
  const m = montar();
  const {evento} = m.salida.amordazar(`mi rut es ${RUT}`, {consentimiento: 'c-1'});

  assert.equal(evento.consentimiento, 'c-1');
  assert.match(evento.sujeto_ref, /^[a-f0-9]{64}$/);
  // Y el sujeto NO es el titular: es un HMAC que no se puede revertir.
  assert.ok(!evento.sujeto_ref.includes('vecino-123'));
});

// ── Higiene del corpus ──────────────────────────────────────────────────────
// No es una protección contra terceros: es una contra nosotros.
//
// Escribir un RUT de memoria y equivocarse en el dígito verificador es un error
// fácil de cometer y muy fácil de no notar. Peor: si el demo trae un RUT que
// ningún validador chileno acepta, el anonimizador no lo enmascara (correctamente,
// porque el DV es el filtro contra falsos positivos) y el panel muestra datos
// "tapados" que en realidad nunca se taparon. Es decir, el error se paga dos
// veces: como mentira visual y como falsa garantía.
test('todo RUT del escenario tiene dígito verificador válido', () => {
  const {pasos} = construirEscenario();

  // Algoritmo oficial: de derecha a izquierda, pesos 2,3,4,5,6,7 y al llegar a
  // 7 la serie vuelve a 2; luego 11 menos el resto, con 11→'0' y 10→'K'.
  const dvEsperado = (cuerpo) => {
    let suma = 0;
    let peso = 2;
    for (let i = cuerpo.length - 1; i >= 0; i--) {
      suma += Number(cuerpo[i]) * peso;
      peso = peso === 7 ? 2 : peso + 1;
    }
    const resto = 11 - (suma % 11);
    return resto === 11 ? '0' : resto === 10 ? 'K' : String(resto);
  };

  const ruts = new Set();
  for (const paso of pasos) {
    for (const m of String(paso.texto).matchAll(/\b(\d{1,2}\.\d{3}\.\d{3})-(\d|K)\b/gi)) {
      ruts.add(m[0]);
    }
  }

  // Si esto queda en cero, la guarda no está probando nada: un corpus sin RUT
  // pasa el test por vacuidad y parece que protege.
  assert.ok(ruts.size >= 3, `el escenario debería traer varios RUT, trae ${ruts.size}`);

  for (const rut of ruts) {
    const cuerpo = rut.replace(/\./g, '').split('-')[0];
    const dv = rut.split('-')[1].toUpperCase();
    assert.equal(dvEsperado(cuerpo), dv, `${rut} no pasa el módulo 11 chileno`);
  }
});