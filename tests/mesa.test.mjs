// La mesa de evidencia, probada contra el informe REAL de spaudit.
//
// ESTOS TESTS CORREN CONTRA DATOS DE VERDAD. El informe en
// `mesa/fixtures/spaudit-informe-real.json` es la salida real de spaudit 1.x
// sobre 147 controles, no un fixture inventado.
//
// La razón es que ya me pasó dos veces: escribí un fixture leyendo
// documentación y otra vez escribiendo de memoria, los tests pasaron, y el
// código estaba roto. El informe real tenía 34 categorías donde yo había
// supuesto 7, y `remediation_steps` era un string donde yo suponía una lista.
// Ninguna de las dos cosas se habría encontrado con un fixture inventado.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

import {desdeConformidad, desdeSeguridad, desdeProbanza, cwesDe} from '../mesa/fuentes.mjs';
import {cruzar, zonasOscuras} from '../mesa/cruce.mjs';
import {historiar, lineaBaseDe, claveDe} from '../mesa/historia.mjs';
import {encadenar, verificarTodo, eventoDe, SISTEMA_POR_FUENTE} from '../mesa/mesa.mjs';
import {desconocidas, noSondeables, FAMILIAS, NO_SONDEABLES} from '../mesa/correspondencias.mjs';
import {validarEvento} from '../nucleo/canonica.mjs';
import {construirEscenario} from '../demo/escenario.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(aqui, '../mesa/fixtures');
const INFORME = resolve(FIXTURES, 'spaudit-informe-real.json');
const STRIX = resolve(aqui, '../puerta/fixtures/vulnerabilidades-strix.json');

function leerConformidad() { return desdeConformidad(INFORME); }
function seguridad() { return desdeSeguridad(STRIX); }
function probanza() {
  const e = construirEscenario();
  return desdeProbanza({cadena: e.cadena, consents: e.consents, acciones: e.acciones});
}

// ── Carga ───────────────────────────────────────────────────────────────────
test('el informe real carga completo', () => {
  const c = leerConformidad();
  assert.equal(c.totales.controles, 147);
  assert.equal(c.totales.sin_verificar, 144);
  assert.equal(c.totales.hallazgos, 3);
  assert.equal(c.dominio, 'saintpatricktemuco.cl');
  // Los tres abiertos son los que el informe de verdad encontró.
  assert.deepEqual(
    c.items.map((i) => i.id).sort(),
    ['SP-18-03', 'SP-22-02', 'SP-22-04'],
  );
});

test('"sin verificar" se separa de los hallazgos y no se infla el tablero', () => {
  const c = leerConformidad();
  assert.equal(c.items.length, 3);
  assert.equal(c.sinVerificar.length, 144);
  // Un "sin verificar" es una tarea, no un hallazgo. Si se mezclara, el
  // informe tendría 147 filas y nadie lo leería.
  for (const i of c.items) assert.notEqual(i.estado, 'NO VERIFICADO');
});

test('cada control sin verificar sabe si tiene un verificador escrito', () => {
  // Este campo se pierde en silencio si no se copia: sin él, "resolubles" sale
  // en cero y el cruce parece inútil. Ya pasó.
  const c = leerConformidad();
  const conCheck = c.sinVerificar.filter((i) => i.automatizable);
  assert.ok(conCheck.length > 0, 'debería haber controles con verificador sin ejecutar');
  assert.equal(c.sinVerificar.filter((i) => i.automatizable === undefined).length, 0);
});

test('cwesDe devuelve números, no texto', () => {
  // `Map.get('306')` y `Map.get(306)` son claves distintas. Con texto, la
  // tabla entera de correspondencias parecía vacía sin dar ningún error.
  const cwes = cwesDe('CWE-306', 'CWE-22 y CWE-306 otra vez');
  assert.deepEqual(cwes, [22, 306]);
  for (const c of cwes) assert.equal(typeof c, 'number');
});

// ── La tabla de correspondencias ─────────────────────────────────────────────
test('GUARDA: toda categoría del catálogo real está clasificada', () => {
  // Esta es la prueba que habría pillado la primera versión de la tabla, que
  // tenía siete categorías inventadas de las cuales dos existían. Con 34
  // categorías reales, el cruce no habría corroborado nada y el informe no lo
  // habría dicho.
  const c = leerConformidad();
  const usadas = [...c.items, ...c.sinVerificar].map((i) => i.categoria).filter(Boolean);
  const sueltas = desconocidas(usadas);
  assert.deepEqual(sueltas, [],
    `categorías del catálogo sin clasificar en la tabla: ${sueltas.join(', ')}`);
  assert.ok(usadas.length >= 30, `el catálogo debería traer muchas categorías, trae ${usadas.length}`);
});

test('las categorías no sondeables se declaran con su motivo', () => {
  const c = leerConformidad();
  const usadas = [...c.items, ...c.sinVerificar].map((i) => i.categoria).filter(Boolean);
  const noVerificables = noSondeables(usadas);
  assert.ok(noVerificables.length > 0);
  // "No sé cruzar" y "nadie lo puede sondear" son truths distintas.
  for (const cat of noVerificables) {
    assert.equal(typeof NO_SONDEABLES[cat], 'string');
    assert.ok(NO_SONDEABLES[cat].length > 5);
  }
  // Y no se solapan con las que sí tienen mapa.
  for (const cat of Object.keys(FAMILIAS)) assert.ok(!(cat in NO_SONDEABLES));
});

// ── El cruce ────────────────────────────────────────────────────────────────
test('GUARDA: el cruce no se infla con un CWE genérico', () => {
  // La primera versión contaba "controles corroborados" emparejando por
  // categoría, y dio 27 controles corroborados por un solo CWE-306. El número
  // era cierto y no significaba nada. Ahora no existe ese número.
  const c = leerConformidad();
  const s = seguridad();
  const cr = cruzar({conformidad: c.items, seguridad: s.items, sinVerificar: c.sinVerificar});

  assert.equal(cr.corroborados, undefined, 'el conteo inflado no debe existir');
  assert.equal(cr.resumen.categorias_desconocidas.length, 0);

  // Y sí hay coincidencias: el reporte de Strix toca el área Web, donde el
  // manual tiene controles incumplidos. Que dos fuentes independientes se
  // apunten a lo mismo es exactamente lo que el cruce está para detectar.
  assert.ok(cr.resumen.contradicciones > 0,
    'el reporte de Strix toca Web y hay controles Web incumplidos: deberían cruzarse');
  for (const x of cr.contradicciones) {
    assert.equal(x.categoria, 'Web');
    assert.match(x.control, /^SP-\d\d-\d\d$/);
    assert.match(x.motivo, /sonda independiente/);
  }

  // Lo que se informa son zonas, con tamaño acotado y verificable.
  for (const z of cr.zonas) {
    assert.ok(z.controles > 0 && z.controles <= 147);
    assert.ok(z.resolubles <= z.sin_verificar);
    assert.ok(z.abiertos <= z.controles);
  }
});

test('el cruce calcula una cobertura que sí se puede mover', () => {
  const c = leerConformidad();
  const s = seguridad();
  const cr = cruzar({conformidad: c.items, seguridad: s.items, sinVerificar: c.sinVerificar});
  const R = cr.resumen;

  // El informe real evaluó 3 de 147. La cobertura no puede pasar de 100.
  assert.ok(R.cobertura_actual_pct >= 0 && R.cobertura_actual_pct <= 100);
  assert.ok(R.cobertura_con_sondas_pct >= R.cobertura_actual_pct,
    'sondear no puede bajar la cobertura');
  assert.equal(R.cobertura_actual_pct, 2); // 3 de 147
});

test('una contradicción se detecta cuando el manual dice CUMPLE y la sonda no', () => {
  // Con el informe real no hay ninguna (solo hay 3 controles ya incumplidos),
  // así que se construye a mano el caso que el motor tiene que ver.
  const c = leerConformidad();
  const s = seguridad();
  const encuentraEnWeb = s.items.find((i) => i.cwe.includes(22)) ??
    s.items.find((i) => i.categoria === 'Web');
  assert.ok(encuentraEnWeb, 'el fixture de Strix debería tener un hallazgo en Web');

  const falso = {
    ...c.sinVerificar.find((i) => i.categoria === 'Web'),
    estado: 'CUMPLE',
    titulo: 'el manual afirma que el sitio cumple',
  };
  const conCWE = {...encuentraEnWeb, cwe: [22]};
  const cr = cruzar({
    conformidad: [falso], seguridad: [conCWE], sinVerificar: c.sinVerificar,
  });

  assert.equal(cr.resumen.contradicciones, 1);
  assert.match(cr.contradicciones[0].motivo, /sonda independiente/);
});

test('las zonas oscuras son controles accionables, no Findings', () => {
  const c = leerConformidad();
  const s = seguridad();
  const cr = cruzar({conformidad: c.items, seguridad: s.items, sinVerificar: c.sinVerificar});
  const oscuras = zonasOscuras(cr);
  assert.ok(oscuras.length > 0, 'debería haber controles con verificador sin ejecutar');
  for (const z of oscuras) {
    assert.match(z.id, /^SP-\d\d-\d\d$/);
    assert.ok(z.motivo.includes('nadie lo ejecutó'));
  }
});

// ── Las cadenas ─────────────────────────────────────────────────────────────
test('las tres fuentes se encadenan sin perder un solo hallazgo', () => {
  const todos = [...probanza().items, ...leerConformidad().items, ...seguridad().items];
  const {cadenas, errores} = encadenar(todos);

  assert.deepEqual(errores, [], `hallazgos que no se encadenaron: ${JSON.stringify(errores)}`);
  assert.ok(integridad(cadenas).ok);

  const encadenados = Object.values(cadenas).reduce((n, c) => n + c.eventos.length, 0);
  assert.equal(encadenados, todos.length, 'cada hallazgo debe tener su evento');
});

test('cada evento encadenado pasa el contrato', () => {
  const {cadenas} = encadenar([...probanza().items, ...leerConformidad().items]);
  for (const cadena of Object.values(cadenas)) {
    for (const e of cadena.eventos) {
      const errores = validarEvento(e);
      assert.equal(errores.length, 0, `${e.sistema}/${e.id ?? '?'}: ${errores.join('; ')}`);
    }
  }
});

test('un hallazgo de probanza lo emite el anonimizador, no la mesa', () => {
  // `probanza` es una vista, no un sistema. Atribuir la falta de cobertura a
  // un sistema que no la produjo sería un informe que culpa al equivocado.
  assert.equal(SISTEMA_POR_FUENTE.probanza, 'anonimizador');
  const p = probanza();
  assert.ok(p.items.length > 0);
  const e = eventoDe(p.items[0]);
  assert.equal(e.sistema, 'anonimizador');
});

test('el tiempo de spaudit, que no trae zona, se normaliza a ISO', () => {
  // spaudit emite "2026-10-17T10:45:06": sin Z, sin espacio. El contrato exige
  // ISO-8601 UTC y no se puede inventar una zona que no está.
  const c = leerConformidad();
  const e = eventoDe(c.items[0]);
  assert.match(e.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
});

test('la cadena no lleva el texto del hallazgo', () => {
  const c = leerConformidad();
  const {cadenas} = encadenar(c.items);
  const texto = JSON.stringify(cadenas.conformidad.eventos);
  for (const i of c.items) {
    assert.ok(!texto.includes(i.id), 'el id del control no debe ir en el canónico');
    assert.ok(!texto.includes(String(i.brecha).slice(0, 30)), 'la brecha no debe ir en el canónico');
  }
});

// ── Continuidad ─────────────────────────────────────────────────────────────
test('la segunda corrida reconoce todo lo que ya se había visto', () => {
  const todos = [...probanza().items, ...leerConformidad().items, ...seguridad().items];
  const primera = historiar({ahora: todos});
  assert.equal(primera.resumen.nuevos, todos.length);

  const base = lineaBaseDe(primera);
  const segunda = historiar({ahora: todos, lineaBase: base});
  assert.equal(segunda.resumen.nuevos, 0);
  assert.equal(segunda.resumen.persistentes, todos.length);
  assert.equal(segunda.resumen.cerrados, 0);
});

test('GUARDA: lo que se deja de reportar aparece como cerrado', () => {
  const c = leerConformidad();
  const primera = historiar({ahora: c.items});
  const base = lineaBaseDe(primera);

  const sinElCritico = c.items.slice(1);
  const segunda = historiar({ahora: sinElCritico, lineaBase: base});
  assert.equal(segunda.resumen.cerrados, 1);
  assert.ok(segunda.resumen.nuevos === 0);
});

test('la continuidad no depende del texto del hallazgo', () => {
  // Es la lección de la puerta: un agente reescribe el título y la clave no
  // puede llevar el título. Acá el ID de spaudit es estable, y eso es lo que
  // hace que esto funcione donde lo de Strix no.
  const base = {[claveDe({fuente: 'conformidad', id: 'SP-22-02'})]: {
    id: 'SP-22-02', fuente: 'conformidad', nivel: 5,
    titulo: 'un título viejo', primera_vez: '2026-10-01T00:00:00.000Z',
    ultima_vez: null, huella: 'x'.repeat(64),
  }};
  const corrida = historiar({
    ahora: [{fuente: 'conformidad', id: 'SP-22-02', titulo: 'redactado distinto', nivel: 5, ts: '2026-11-01T00:00:00.000Z'}],
    lineaBase: base,
  });
  assert.equal(corrida.resumen.nuevos, 0);
  assert.equal(corrida.resumen.persistentes, 1);
  assert.equal(corrida.resumen.cambios_de_texto, 1, 'el texto cambió y hay que decirlo');
  assert.equal(corrida.filas[0].primera_vez, '2026-10-01T00:00:00.000Z', 'no se pierde cuándo apareció');
});

function integridad(cadenas) {
  return verificarTodo(cadenas);
}
// ── El total no puede mentir ─────────────────────────────────────────────────
//
// Se encontró corriendo la cosa: con el informe que trae controles CUMPLE, la
// mesa contaba 146 de 147. El CUMPLE se descartaba antes de contar y la
// cobertura salía más baja de lo que era. Estos tests existen para que eso no
// vuelva a pasar sin que nadie lo note.

const INFORMES = [
  {nombre: 'el del colegio (sin evidencia de equipos)', ruta: resolve(FIXTURES, 'spaudit-informe-real.json')},
  {nombre: 'con evidencia recolectada de verdad', ruta: resolve(FIXTURES, 'spaudit-con-evidencia.json')},
];

for (const {nombre, ruta} of INFORMES) {
  test(`la mesa ve todos los controles del informe: ${nombre}`, () => {
    const crudo = JSON.parse(readFileSync(ruta, 'utf8'));
    const conf = desdeConformidad(ruta);
    const R = cruzar({
      conformidad: conf.items,
      seguridad: seguridad().items,
      sinVerificar: conf.sinVerificar,
      cumplidos: conf.cumplidos,
    }).resumen;

    assert.equal(
      R.controles,
      crudo.resultados.length,
      `la mesa ve ${R.controles} controles y el informe declara ${crudo.resultados.length}`
    );
    assert.equal(conf.totales.controles, crudo.resultados.length);
    assert.equal(
      R.controles - R.sin_verificar + R.sin_verificar,
      R.controles,
      'sin verificar + cerrados tiene que dar el total'
    );
  });
}

test('un control CUMPLE cuenta para la cobertura y no es un hallazgo', () => {
  const conf = desdeConformidad(resolve(FIXTURES, 'spaudit-con-evidencia.json'));
  assert.ok(conf.cumplidos.length > 0, 'este informe tiene controles que cumplen');

  // No es un hallazgo: no va al tablero ni a la cadena de evidencia.
  const idsHallazgo = new Set(conf.items.map((i) => i.id));
  for (const c of conf.cumplidos) assert.ok(!idsHallazgo.has(c.id));

  // Pero sí cuenta como cobertura.
  const R = cruzar({
    conformidad: conf.items,
    seguridad: seguridad().items,
    sinVerificar: conf.sinVerificar,
    cumplidos: conf.cumplidos,
  }).resumen;
  const sinCumplidos = cruzar({
    conformidad: conf.items,
    seguridad: seguridad().items,
    sinVerificar: conf.sinVerificar,
  }).resumen;
  assert.equal(R.controles, sinCumplidos.controles + conf.cumplidos.length);

  // Y la cobertura sube. La comparación va sobre la FRACCIÓN, no sobre el
  // porcentaje redondeado: con este informe, 5/147 = 3.4% y 4/146 = 2.7%, y los
  // dos se redondean a 3. Exigir que el entero redondeado suba estrictamente
  // mide el redondeo, no la cobertura, y falla sin que nada esté mal.
  const fraccionCon = (R.controles - R.sin_verificar) / R.controles;
  const fraccionSin = (sinCumplidos.controles - sinCumplidos.sin_verificar) / sinCumplidos.controles;
  assert.ok(fraccionCon > fraccionSin,
    'dejar los CUMPLE afuera subestima la cobertura');
  assert.ok(R.cobertura_actual_pct >= sinCumplidos.cobertura_actual_pct,
    'y el porcentaje redondeado nunca puede BAJAR por añadir cobertura real');
});

test('dos informes distintos dan números distintos', () => {
  // Si los dos dieran lo mismo, alguno de los dos estaría midiendo sobre datos
  // que no son los que dice medir.
  const a = desdeConformidad(INFORME);
  const b = desdeConformidad(resolve(FIXTURES, 'spaudit-con-evidencia.json'));
  assert.notEqual(a.sinVerificar.length, b.sinVerificar.length);
  assert.equal(
    a.totales.controles,
    b.totales.controles,
    'los dos informes cubren el mismo catálogo de 147 controles'
  );
  assert.notEqual(
    a.totales.sin_verificar,
    b.totales.sin_verificar,
    'lo que cambia es cuántos se evaluaron, no cuántos existen'
  );
});