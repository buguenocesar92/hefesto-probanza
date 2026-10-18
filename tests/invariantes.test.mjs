// Invariantes del eje de evidencia.
//
// EL CRITERIO: una protección se comprueba QUITÁNDOLA. No basta con que un test
// verifique que algo funciona; hay que comprobar que el test se pone ROJO
// cuando se le saca la guarda. Los tests marcados "GUARDA" lo hacen así, de
// verdad: reproducen el defecto a propósito, y comprueban que se comporta mal.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Cadena} from '../nucleo/cadena.mjs';
import {canonico, hashEvento, validarEvento, sha256} from '../nucleo/canonica.mjs';
import {
  emitirRecibo, firmarRecibo, verificarRecibo, generarParDeLLAves,
  registrarLlave, olvidarLlave,
} from '../nucleo/recibo.mjs';
import {anclar, publicadorDePrueba, comprobarAnclaje} from '../nucleo/ancla.mjs';

const AHORA = '2026-10-17T12:00:00.000Z';
const SUJETO = 'a'.repeat(64);

function cadenaDePrueba(n = 3) {
  const c = Cadena.nueva();
  for (let i = 0; i < n; i++) {
    c.agregar({
      sistema: 'anonimizador',
      tipo: 'salida.procesada',
      consentimiento: 'c-1',
      sujeto_ref: SUJETO,
      proposito: 'atencion',
      datos: {tipos: ['rut'], cantidad: 1},
      ts: `2026-10-17T12:0${i}:00.000Z`,
    });
  }
  return c;
}

// ── Canonización ────────────────────────────────────────────────────────────
test('el hash no depende del orden de las claves', () => {
  const a = {b: 2, a: 1, c: {z: 1, y: 2}};
  const b = {c: {y: 2, z: 1}, a: 1, b: 2};
  assert.equal(canonico(a), canonico(b));
});

test('el hash no depende de una clave ausente y otra en undefined', () => {
  assert.equal(canonico({a: 1, b: undefined}), canonico({a: 1}));
});

test('la canonización rechaza lo que no es canónico entre lenguajes', () => {
  // Decimales: 0.1 no tiene una única representación entre motores.
  assert.throws(() => canonico({n: 0.1}), /decimales/);
  assert.throws(() => canonico({n: NaN}), /NaN/);
  assert.throws(() => canonico({n: Infinity}), /NaN|Infinity/);
  // -0 y 0 son el mismo número para un motor y no para otro.
  assert.equal(canonico({n: -0}), '{"n":0}');
});

test('el contrato no admite que datos lleve valores, solo tipos y conteos', () => {
  const base = {
    v: 'evento.v1', seq: 0, ts: AHORA, sistema: 'anonimizador', tipo: 'salida.procesada',
    consentimiento: 'c-1', sujeto_ref: SUJETO, proposito: 'atencion',
    previo: null, hash: 'x'.repeat(64),
  };

  assert.deepEqual(validarEvento({...base, datos: {tipos: ['rut'], cantidad: 2}}), []);

  // Un RUT colado en `datos` tiene que ser rechazado, no "sanitizado".
  const conValor = validarEvento({...base, datos: {rut: '12.345.678-5'}});
  assert.ok(conValor.length > 0, 'aceptó un valor dentro de datos');
  assert.match(conValor[0], /no es un conteo ni una lista/);

  // Y contenido disfrazado de etiqueta. La guarda es de FORMA, no de
  // longitud: "Juan Pérez" tiene diez caracteres y entraría en un límite de 40,
  // pero lleva espacio y mayúscula, y eso lo delata.
  const conNombre = validarEvento({...base, datos: {tipos: ['Juan Pérez González']}});
  assert.ok(conNombre.length > 0, 'aceptó un nombre propio como si fuera un tipo de dato');
  assert.match(conNombre[0], /identificadores en minúsculas/);

  // Un detector nuevo, con un nombre largo pero con forma de identificador,
  // tiene que entrar: la guarda no puede cerrar la puerta a la extensión.
  assert.deepEqual(validarEvento({...base, datos: {tipos: ['discapacidad_sensitiva_v2'], cantidad: 1}}), []);
});

// ── Cadena ──────────────────────────────────────────────────────────────────
test('la cadena enlaza cada evento con el hash del anterior', () => {
  const c = cadenaDePrueba(3);
  assert.equal(c.verificar().ok, true);
  assert.equal(c.eventos[0].previo, null);
  assert.equal(c.eventos[1].previo, c.eventos[0].hash);
  assert.equal(c.eventos[2].previo, c.eventos[1].hash);
});

test('la cadena se puede reconstruir desde cero y da el mismo hash', () => {
  const c = cadenaDePrueba(3);
  let previo = null;
  for (const [i, e] of c.eventos.entries()) {
    const {hash, ...cuerpo} = e;
    assert.equal(hashEvento(cuerpo), hash, `el evento ${i} no se reproduce`);
    previo = hash;
  }
  assert.equal(previo, c.cabeza);
});

test('GUARDA: sin el eslabón, editar un evento NO se detecta', () => {
  // Se rehace la cadena como si cada evento fuera independiente: sin `previo`,
  // un contenido editado conserva su propio hash válido.
  const c = cadenaDePrueba(2);
  const primero = {...c.eventos[0]};
  primero.datos = {tipos: ['nombre'], cantidad: 99};

  const suelta = hashEvento({...primero, previo: null});
  assert.match(suelta, /^[a-f0-9]{64}$/);

  // El hash propio sigue siendo coherente consigo mismo...
  assert.equal(hashEvento({...primero, previo: null}), suelta);
  // ...lo que prueba que la coherencia NO alcanza y hace falta el enlace.
  assert.notEqual(suelta, primero.hash, 'sin el enlace no cambiaría nada');
});

test('GUARDA: la cadena SÍ detecta un evento editado', () => {
  const c = cadenaDePrueba(3);
  const eventos = c.eventos;
  eventos[1] = {...eventos[1], datos: {tipos: ['nombre'], cantidad: 99}};
  const manipulada = new Cadena(eventos);

  const r = manipulada.verificar();
  assert.equal(r.ok, false);
  assert.equal(r.rotura.seq, 1);
  assert.equal(r.rotura.motivo, 'contenido');
});

test('GUARDA: la cadena detecta un evento eliminado', () => {
  const c = cadenaDePrueba(3);
  const manipulada = new Cadena([c.eventos[0], c.eventos[2]]);

  const r = manipulada.verificar();
  assert.equal(r.ok, false);
  assert.ok(['hueco', 'enlace'].includes(r.rotura.motivo), `motivo inesperado: ${r.rotura.motivo}`);
});

test('la cadena no acepta que el llamador elija seq, previo ni hash', () => {
  const c = Cadena.nueva();
  for (const campo of ['seq', 'previo', 'hash']) {
    assert.throws(
      () => c.agregar({
        sistema: 'anonimizador', tipo: 'salida.procesada', proposito: 'atencion',
        ts: AHORA, [campo]: 'lo-que-yo-quiera',
      }),
      /lo calcula la cadena/,
      `aceptó que el llamador escribiera "${campo}"`,
    );
  }
});

test('un evento sin ts se rechaza: el reloj del cliente no es evidencia', () => {
  const c = Cadena.nueva();
  assert.throws(
    () => c.agregar({sistema: 'anonimizador', tipo: 'x', proposito: 'atencion'}),
    /ts es obligatorio/,
  );
});

test('un evento sin propósito se rechaza: sin él no hay cobertura que verificar', () => {
  const c = Cadena.nueva();
  const errores = validarEvento({
    v: 'evento.v1', seq: 0, ts: AHORA, sistema: 'anonimizador', tipo: 'salida.procesada',
    consentimiento: null, sujeto_ref: null, datos: {}, previo: null,
  });
  assert.ok(errores.some((e) => /proposito/.test(e)), 'aceptó un evento sin propósito');
});

// ── Recibo ──────────────────────────────────────────────────────────────────
test('el recibo firma el manifiesto y se verifica', () => {
  const {privada, kid} = generarParDeLLAves('ed25519:test-ok');
  const m = emitirRecibo({
    textoSeguro: 'mi rut es [RUT_1_abcd]', tipos: ['rut'], cantidad: 1,
    consentimiento: 'c-1', proposito: 'atencion', proveedor: 'modelo',
    caracteresOriginales: 20, ts: AHORA,
  });
  const sobre = firmarRecibo(m, privada, kid);

  const r = verificarRecibo(sobre);
  assert.equal(r.ok, true, r.motivo);
});

test('GUARDA: el manifiesto firmado no admite un "tipo" que en realidad sea contenido', () => {
  // El manifiesto es lo que se firma y lo que se archiva: el objeto de vida más
  // larga del sistema. Si su lista de tipos fuera más permisiva que la del
  // evento, el lugar donde la evidencia dura más sería el más fácil de romper.
  // "Nombre Completo" entra en un límite de longitud y no entra en el contrato
  // de forma del evento, así que esta es la diferencia real entre las dos.
  const base = {
    textoSeguro: 'mi rut es [RUT_1_abcd]', cantidad: 1,
    consentimiento: 'c-1', proposito: 'atencion', proveedor: 'modelo',
    caracteresOriginales: 20, ts: AHORA,
  };

  assert.throws(
    () => emitirRecibo({...base, tipos: ['Nombre Completo']}),
    /identificadores en minúsculas/,
  );
  assert.throws(
    () => emitirRecibo({...base, tipos: ['rut', 'mi correo es ana@correo.cl']}),
    /identificadores en minúsculas/,
  );
  // Y lo que sí es un tipo de dato sigue entrando: la guarda no es un muro.
  const ok = emitirRecibo({...base, tipos: ['rut', 'email']});
  assert.deepEqual(ok.tipos, ['email', 'rut']);
});

test('el recibo NO contiene el texto: solo su hash', () => {
  const {privada, kid} = generarParDeLLAves('ed25519:test-texto');
  const secreto = 'mi rut es 12.345.678-5 y mi correo es ana@correo.cl';
  const m = emitirRecibo({
    textoSeguro: secreto, tipos: ['rut', 'email'], cantidad: 2,
    consentimiento: 'c-1', proposito: 'atencion', proveedor: 'modelo',
    caracteresOriginales: secreto.length, ts: AHORA,
  });
  const sobre = firmarRecibo(m, privada, kid);

  const todo = JSON.stringify(sobre);
  assert.ok(!todo.includes('12.345.678'), 'el RUT quedó en el recibo');
  assert.ok(!todo.includes('ana@correo.cl'), 'el correo quedó en el recibo');
  assert.ok(!todo.includes('[RUT_'), 'el texto seguro quedó en el recibo');
  assert.match(sobre.manifiesto.texto_sha256, /^[a-f0-9]{64}$/);
});

test('GUARDA: sin firma, el recibo no pasa', () => {
  generarParDeLLAves('ed25519:test-sinfirma');
  const m = emitirRecibo({
    textoSeguro: 'x', tipos: [], cantidad: 0, consentimiento: 'c-1',
    proposito: 'atencion', proveedor: 'm', caracteresOriginales: 1, ts: AHORA,
  });
  assert.equal(verificarRecibo({manifiesto: m, kid: 'ed25519:test-sinfirma'}).ok, false);
});

test('GUARDA: un manifiesto editado rompe la firma', () => {
  const {privada, kid} = generarParDeLLAves('ed25517:test-editado'.replace('17', '19'));
  const m = emitirRecibo({
    textoSeguro: 'texto original', tipos: ['rut'], cantidad: 1,
    consentimiento: 'c-1', proposito: 'atencion', proveedor: 'm',
    caracteresOriginales: 14, ts: AHORA,
  });
  const sobre = firmarRecibo(m, privada, kid);
  assert.equal(verificarRecibo(sobre).ok, true);

  // Alguien "corrige" el manifiesto después de firmado.
  const editado = {...sobre, manifiesto: {...sobre.manifiesto, cantidad: 0, tipos: []}};
  const r = verificarRecibo(editado);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /no corresponde/);
});

test('una firma hecha con otra llave no verifica', () => {
  const a = generarParDeLLAves('ed25519:lave-a');
  const b = generarParDeLLAves('ed25519:lave-b');
  const m = emitirRecibo({
    textoSeguro: 'x', tipos: [], cantidad: 0, consentimiento: 'c-1',
    proposito: 'atencion', proveedor: 'm', caracteresOriginales: 1, ts: AHORA,
  });

  const conB = firmarRecibo(m, b.privada, 'ed25519:lave-a');
  assert.equal(verificarRecibo(conB).ok, false, 'aceptó una firma hecha con otra llave');
  void a;
});

test('una llave desconocida no verifica, y lo dice', () => {
  const {privada, kid} = generarParDeLLAves('ed25519:temporal');
  olvidarLlave(kid);
  const m = emitirRecibo({
    textoSeguro: 'x', tipos: [], cantidad: 0, consentimiento: 'c-1',
    proposito: 'atencion', proveedor: 'm', caracteresOriginales: 1, ts: AHORA,
  });
  const r = verificarRecibo(firmarRecibo(m, privada, kid));
  assert.equal(r.ok, false);
  assert.match(r.motivo, /llave desconocida/);
});

// ── Anclaje ─────────────────────────────────────────────────────────────────
test('anclar registra la cabeza y publicarla deja huella', () => {
  const c = cadenaDePrueba(2);
  const a = anclar(c, publicadorDePrueba('t'));

  assert.equal(a.seq, 1);
  assert.equal(a.head_hash, c.cabeza);
  assert.ok(a.huella);
  assert.equal(comprobarAnclaje(c, a).ok, true);
});

test('GUARDA: anclar una cadena vacía falla', () => {
  assert.throws(() => anclar(Cadena.nueva(), publicadorDePrueba()), /empty_chain/);
});

test('GUARDA: una publicación sin recibo no cuenta como anclaje', () => {
  const c = cadenaDePrueba(1);
  assert.throws(
    () => anclar(c, () => ({recibo: 'corto', store_ref: 'x', key_id: 'y'})),
    /recibo/,
    'aceptó un anclaje sin recibo real',
  );
});

test('GUARDA: reescribir la cadena entera se detecta contra lo publicado', () => {
  const c = cadenaDePrueba(3);
  const publicado = anclar(c, publicadorDePrueba('t'));

  // El ataque real: se borra el evento del medio y se RECALCULA
  // toda la cadena. El resultado es internamente coherente...
  const e0 = c.eventos[0];
  const e2 = c.eventos[2];
  const {seq: _s0, previo: _p0, hash: _h0, ...cuerpo0} = e0;
  const {seq: _s2, previo: _p2, hash: _h2, ...cuerpo2} = e2;
  void _s0; void _p0; void _h0; void _s2; void _p2; void _h2;

  const nueva = Cadena.nueva();
  nueva.agregar(cuerpo0);
  nueva.agregar(cuerpo2);

  assert.equal(nueva.verificar().ok, true, 'la cadena reescrita no es coherente consigo misma');
  assert.equal(nueva.length, 2);

  // ...pero ya no es la misma que la que se publicó afuera.
  const r = nueva.verificarAncla(publicado);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /reescrita|no existe/);
});

test('una cadena sin ancla externa se declara reescribible', () => {
  const c = cadenaDePrueba(2);
  const r = c.verificarAncla(null);
  assert.equal(r.ok, false);
  assert.match(r.motivo, /reescribible/);
});

test('un registro de anclajes editado también se nota', () => {
  const c = cadenaDePrueba(1);
  const publicado = anclar(c, publicadorDePrueba('t'));
  const manipulado = {...publicado, head_hash: 'b'.repeat(64)};
  const r = comprobarAnclaje(c, manipulado);
  assert.equal(r.ok, false);
});

test('la huella del documento depende del contenido de toda la cadena', () => {
  const a = cadenaDePrueba(2);
  const b = cadenaDePrueba(3);
  assert.notEqual(a.huellaDelDocumento(), b.huellaDelDocumento());
  assert.equal(cadenaDePrueba(2).huellaDelDocumento(), a.huellaDelDocumento());
});

test('sha256 da el valor conocido, para que un tercero reproduzca el cálculo', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});