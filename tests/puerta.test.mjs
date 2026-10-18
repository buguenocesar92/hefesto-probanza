// La puerta de seguridad, probada.
//
// Misma regla que el resto del paquete: una protección se comprueba quitándola.
// La última prueba hace exactamente eso, y si al borrar la comprobación la
// suite sigue verde, la comprobación no estaba protegiendo nada.
//
// NOTA SOBRE EL FIXTURE. Está construido leyendo la fuente de Strix instalada
// (1.7.0, `report/state.py`), no de memoria. Eso entró a cuento: una versión
// anterior del fixture usaba timestamps ISO y listas donde Strix escribe otra
// cosa, y los tests pasaban sobre un dato que Strix nunca emite. Un test que
// prueba un formato que el mundo real no produce no prueba nada.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {dirname, resolve, join} from 'node:path';

import {traducir, huellaDe, sitioDe, nivelDe, tiempoDe, NOMBRE_NIVEL} from '../puerta/traductor.mjs';
import {verificarHallazgos, normalizarLineaBase, leerJsonDeTexto} from '../puerta/verificador.mjs';
import {validarEvento} from '../nucleo/canonica.mjs';
import {anclar, publicadorDePrueba, comprobarAnclaje} from '../nucleo/ancla.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(aqui, '../puerta/fixtures/vulnerabilidades-strix.json');

const relojFijo = () => '2026-10-17T13:00:00.000Z';

function reporte() {
  return JSON.parse(readFileSync(FIXTURE, 'utf8'));
}

function correr(lineaBase, umbral = 'high') {
  const datos = reporte();
  const t = traducir(datos, {reloj: relojFijo});
  return {t, v: verificarHallazgos({cadena: t.cadena, sidecar: t.sidecar, lineaBase, umbral})};
}

// ── El tiempo de Strix ──────────────────────────────────────────────────────
test('el formato de tiempo de Strix se convierte a ISO-8601 UTC', () => {
  // `datetime.now(UTC).strftime("%Y-%m-%d %H:%M:%S UTC")` — con espacio donde
  // va la T y " UTC" donde va la Z. Strix no escribe ISO.
  assert.equal(tiempoDe('2026-10-17 12:00:00 UTC'), '2026-10-17T12:00:00.000Z');
  assert.equal(tiempoDe('2026-10-17 23:59:59 UTC'), '2026-10-17T23:59:59.000Z');
  // Y el ISO que ya viene listo se respeta sin tocarlo.
  assert.equal(tiempoDe('2026-10-17T12:00:00.000Z'), '2026-10-17T12:00:00.000Z');
  assert.equal(tiempoDe(new Date('2026-01-02T03:04:05Z')), '2026-01-02T03:04:05.000Z');
});

test('un tiempo ilegible falla fuerte en vez de inventarse', () => {
  // Un `ts` inventado rompe el orden de la cadena en silencio. Un error se ve.
  for (const malo of ['ayer', '', '2026-13-45 99:99:99 UTC', 42, null, undefined]) {
    assert.throws(() => tiempoDe(malo), /timestamp|reloj/,
      `debería rechazar ${JSON.stringify(malo)}`);
  }
});

test('un reporte mínimo entra igual, con los cinco campos que Strix siempre pone', () => {
  // En `report/state.py` solo `id`, `title`, `severity`, `timestamp` y
  // `finding_class` son incondicionales; todo lo demás es `if campo:`. Un
  // reporte real de un hallazgo escueto se ve así.
  const minimo = [{
    id: 'VULN-999',
    title: 'Encabezado ausente',
    severity: 'medium',
    timestamp: '2026-10-17 12:20:00 UTC',
    finding_class: 'dynamic',
  }];

  const t = traducir(minimo, {reloj: relojFijo});
  assert.equal(t.cadena.eventos.length, 1);
  assert.equal(validarEvento(t.cadena.eventos[0]).length, 0);
  assert.equal(t.sidecar[t.resumen.filas[0].huella].cve, null);
  assert.equal(t.sidecar[t.resumen.filas[0].huella].endpoint, null);
});

// ── El contrato ─────────────────────────────────────────────────────────────
test('cada hallazgo entra a la cadena como evento válido', () => {
  const {t} = correr();
  assert.equal(t.cadena.eventos.length, reporte().length);

  for (const e of t.cadena.eventos) {
    const errores = validarEvento(e);
    assert.equal(errores.length, 0, errores.join('; '));
    assert.equal(e.sistema, 'seguridad');
    assert.equal(e.tipo, 'hallazgo.detectado');
    assert.equal(e.datos.cantidad, 1);
    // Dos huellas: la estricta del registro y la del sitio. Ver `sitioDe`.
    assert.equal(e.datos.huellas.length, 2);
    assert.match(e.datos.huellas[0], /^[a-f0-9]{64}$/);
    assert.match(e.datos.huellas[1], /^[a-f0-9]{64}$/);
    assert.notEqual(e.datos.huellas[0], e.datos.huellas[1]);
    // El `ts` que sale de la cadena es siempre ISO, venga de donde venga.
    assert.match(e.ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.000Z$/);
  }
});

test('GUARDA: la cadena del hallazgo no lleva ni una palabra del hallazgo', () => {
  const datos = reporte();
  const t = traducir(datos, {reloj: relojFijo});
  // El canónico es lo que realmente se firma y encadena. Si algo del detalle
  // se coló, aparece aquí.
  const texto = JSON.stringify(t.cadena.eventos);

  for (const h of datos) {
    assert.ok(!texto.includes(h.title), `el título "${h.title}" se coló en la cadena`);
    assert.ok(!texto.includes(h.id), `el id "${h.id}" se coló en la cadena`);
    // Solo los campos que existen: comparar contra el `null` del propio
    // evento compararía contra una coincidencia y la prueba no probaría nada.
    for (const campo of ['endpoint', 'cve', 'description', 'remediation_steps', 'evidence']) {
      if (h[campo]) {
        assert.ok(!texto.includes(String(h[campo]).slice(0, 30)),
          `${campo} se coló en la cadena`);
      }
    }
  }
  // Y el sidecar tampoco está dentro de la cadena, porque va aparte.
  assert.ok(!texto.includes('VULN-00'));
});

test('la huella no depende del id ni de la hora: es la identidad del problema', () => {
  const [original] = reporte();
  const misma = {...original, id: 'VULN-999', timestamp: '2026-10-17 23:59:59 UTC'};
  assert.equal(huellaDe(original), huellaDe(misma));

  // Subir la gravedad no crea un problema nuevo: es el mismo problema,
  // entendido mejor.
  assert.equal(huellaDe(original), huellaDe({...original, severity: 'low'}));

  // Distinto endpoint sí es otro hallazgo.
  assert.notEqual(huellaDe(original), huellaDe({...original, endpoint: '/otra-ruta'}));
});

test('el mismo reporte produce siempre la misma cadena', () => {
  const a = correr().t;
  const b = correr().t;
  assert.equal(a.resumen.huella_del_conjunto, b.resumen.huella_del_conjunto);
  assert.deepEqual(a.cadena.eventos.map((e) => e.hash), b.cadena.eventos.map((e) => e.hash));
});

test('la gravedad se ordena de más grave a menos', () => {
  const {t} = correr();
  const niveles = t.cadena.eventos.map((e) => e.datos.severidad);
  assert.deepEqual(niveles, [...niveles].sort((a, b) => b - a));
  assert.equal(t.resumen.por_nivel[5], 1);   // una crítica
  assert.equal(t.resumen.por_nivel[4], 2);   // dos altas
  assert.equal(t.resumen.por_nivel[3], 1);   // una media
  assert.equal(t.resumen.por_nivel[2], 1);   // una baja
});

// ── La puerta ───────────────────────────────────────────────────────────────
test('una corrida nueva con una crítica no pasa', () => {
  const {v} = correr();
  assert.equal(v.pasa, false);
  assert.ok(v.nuevos.some((h) => h.nivel === 5));
  assert.equal(v.resumen.nuevos, reporte().length);
  // La comercial viene ordenada por gravedad y cada línea dice por qué.
  assert.equal(v.comercial[0].nivel, 5);
  assert.match(v.comercial[0].motivo, /nuevo, gravedad crítica/);
});

test('un hallazgo ya conocido que sigue abierto SIGUE bloqueando', () => {
  // Esto es lo que la puerta vino a arreglar. El naive miraría solo los nuevos
  // y daría el segundo reporte por limpio.
  const base = correr().t.sidecar;
  const segunda = correr(base);

  assert.equal(segunda.v.resumen.nuevos, 0, 'no hay hallazgos nuevos');
  assert.equal(segunda.v.resumen.persistentes, reporte().length);
  assert.equal(segunda.v.pasa, false, 'y la puerta sigue cerrada');
  assert.match(segunda.v.comercial[0].motivo, /ya estaba abierto/);
});

test('lo que se arregló aparece como cerrado, no como nuevo', () => {
  const {t: primera} = correr();
  const segunda = traducir(reporte().filter((h) => h.id !== 'VULN-001'), {reloj: relojFijo});
  const v = verificarHallazgos({
    cadena: segunda.cadena, sidecar: segunda.sidecar, lineaBase: primera.sidecar,
  });

  assert.equal(v.resumen.cerrados, 1);
  assert.equal(v.resumen.nuevos, 0);
  assert.equal(v.pasa, false, 'quedan altas abiertas');
});

test('con el umbral en "critical", solo bloquean las críticas', () => {
  const {v} = correr({}, 'critical');
  assert.equal(v.bloqueantes.length, 1);
  assert.equal(v.bloqueantes[0].nivel, 5);
});

test('una gravedad que Strix no reconoce bloquea en vez de degradarse', () => {
  const {nivel, desconocida} = nivelDe('catastrófico');
  assert.equal(desconocida, true);
  assert.equal(nivel, 5, 'nivel máximo, no "informativa"');

  const conRaro = traducir([{...reporte()[0], severity: 'catastrófico'}], {reloj: relojFijo});
  const v = verificarHallazgos({
    cadena: conRaro.cadena, sidecar: conRaro.sidecar, umbral: 'critical',
  });
  assert.equal(v.pasa, false, 'no se puede pasar por encima de lo que no se entiende');
  assert.match(v.comercial[0].motivo, /no reconocida/);
});

test('si todo lo abierto está bajo el umbral, la puerta pasa', () => {
  const datos = reporte().filter((h) => h.severity === 'medium' || h.severity === 'low');
  const t = traducir(datos, {reloj: relojFijo});
  const v = verificarHallazgos({cadena: t.cadena, sidecar: t.sidecar, umbral: 'high'});
  assert.equal(v.pasa, true);
  assert.equal(v.resumen.total, 2);
  assert.equal(v.resumen.bloqueantes, 0);
  assert.equal(v.integridad.ok, true);
});

test('sacar el hallazgo más grave se detecta, aunque se rehaga la cadena entera', () => {
  // El movimiento que un gate tiene que notar: borrar el crítico y recalcular
  // todos los hashes. Por dentro la cadena queda coherente; la que lo caza es
  // el anclaje.
  const completa = correr().t;
  const publica = anclar(completa.cadena, publicadorDePrueba());
  assert.equal(comprobarAnclaje(completa.cadena, publica).ok, true);

  const recortada = traducir(
    reporte().filter((h) => h.severity !== 'critical'),
    {reloj: relojFijo},
  );
  assert.equal(recortada.cadena.verificar().ok, true, 'la cadena recortada es coherente');

  const ext = comprobarAnclaje(recortada.cadena, publica);
  assert.equal(ext.ok, false, 'el anclaje tiene que delatar la amputación');
  assert.match(ext.motivo, /anclaje local|no aparece|anclada/i);

  const v = verificarHallazgos({
    cadena: recortada.cadena, sidecar: recortada.sidecar, umbral: 'high',
  });
  assert.equal(v.pasa, false);
});

test('el evento de seguridad declara una gravedad dentro de rango', () => {
  const conFuera = traducir([reporte()[0]], {reloj: relojFijo});
  const evento = conFuera.cadena.eventos[0];
  assert.ok(evento.datos.severidad >= 1 && evento.datos.severidad <= 5);

  // Y el contrato no acepta una gravedad fuera de rango, ni aunque el
  // traductor se equivoque.
  assert.ok(validarEvento({...evento, datos: {...evento.datos, severidad: 9}}).length > 0);
  assert.ok(validarEvento({...evento, datos: {...evento.datos, severidad: 0}}).length > 0);
});

test('NOMBRE_NIVEL cubre lo que el verificador puede emitir', () => {
  for (const n of [1, 2, 3, 4, 5]) assert.equal(typeof NOMBRE_NIVEL[n], 'string');
});

test('un reporte que no es una lista se rechaza con un mensaje claro', () => {
  assert.throws(() => traducir({vulnerabilities: []}), /lista de hallazgos/);
});

// ── La línea base ───────────────────────────────────────────────────────────
test('GUARDA: el mismo hallazgo con otro título NO aparece como nuevo', () => {
  // Este test existe porque la puerta falló en esto. La huella estricta
  // incluía el título, y un agente LLM reescribe el título en cada corrida:
  // el mismo traversal salía como "nuevo" y el anterior como "cerrado", para
  // siempre. La puerta seguía bloqueando —la parte que importa no se rompió—
  // pero la señal era ruido puro.
  const base = {
    id: 'VULN-002',
    severity: 'high',
    finding_class: 'dynamic',
    cwe: 'CWE-22',
    target: 'http://127.0.0.1:8788',
    endpoint: '/panel/index.html',
    method: 'GET',
    timestamp: '2026-10-17 12:04:00 UTC',
  };
  const titulos = [
    'Traversal de rutas al servir archivos estaticos',
    'Path traversal in static file serving',
    'Directory traversal via /panel/index.html',
    'Se puede leer un archivo fuera del directorio servido',
  ];

  const primera = traducir([{...base, title: titulos[0]}], {reloj: relojFijo});

  for (const t of titulos.slice(1)) {
    const otra = traducir([{...base, title: t}], {reloj: relojFijo});
    const v = verificarHallazgos({
      cadena: otra.cadena, sidecar: otra.sidecar,
      lineaBase: primera.sidecar, umbral: 'high',
    });
    assert.equal(v.resumen.nuevos, 0, `"${t}" salió como nuevo`);
    assert.equal(v.resumen.persistentes, 1);
    assert.equal(v.resumen.cerrados, 0, `"${t}" cerró un sitio que sigue abierto`);
    assert.equal(v.pasa, false, 'y sigue bloqueando, que es lo que importa');
  }
});

test('cuando la clave por sitio funde hallazgos, la puerta lo dice', () => {
  // El otro lado del trade-off, medido: la clave por sitio no separa tres
  // inyecciones SQL distintas sobre el mismo endpoint. Fusionarlas en
  // silencio sería mentir; la puerta las declara como choque.
  const base = {
    id: 'VULN-S', severity: 'high', finding_class: 'dynamic', cwe: 'CWE-89',
    target: 'http://127.0.0.1:8788', endpoint: '/login', method: 'POST',
    timestamp: '2026-10-17 12:04:00 UTC',
  };
  const t = traducir([
    {...base, id: 'A', title: 'SQL injection en login'},
    {...base, id: 'B', title: 'SQLi en el campo usuario del login'},
    {...base, id: 'C', title: 'Inyeccion SQL permite leer otras tablas'},
  ], {reloj: relojFijo});

  const v = verificarHallazgos({cadena: t.cadena, sidecar: t.sidecar, umbral: 'high'});
  assert.equal(v.resumen.choques, 1, 'el sitio compartido tiene que quedar declarado');
  assert.equal(v.choques[0].titulos.length, 3);
  assert.match(v.choques[0].motivo, /no los separa/);
  // Y la gravedad no se pierde por el hecho de que colisionen.
  assert.equal(v.bloqueantes.length, 3);
});

test('la línea base se acepta como sobre o como sidecar pelado', () => {
  const {t} = correr();
  const sidecar = t.sidecar;
  const sobre = {v: 'cadena_hallazgos.v1', eventos: t.cadena.eventos, sidecar};

  const desdeSobre = normalizarLineaBase(sobre);
  const desdeSidecar = normalizarLineaBase(sidecar);
  assert.deepEqual(desdeSobre, desdeSidecar);

  // Y lo importante: con cualquiera de las dos, nada sale "nuevo".
  for (const base of [desdeSobre, desdeSidecar]) {
    const v = verificarHallazgos({cadena: t.cadena, sidecar, lineaBase: base, umbral: 'high'});
    assert.equal(v.resumen.nuevos, 0, 'todo debería reconocerse como ya visto');
    assert.equal(v.resumen.persistentes, reporte().length);
  }
});

test('una línea base que no es un sidecar se rechaza en vez de parecer vacía', () => {
  // El modo de falla que esto evita: un sobre mal leído parece una línea base
  // vacía, y una línea base vacía hace que TODO salga "nuevo" sin delatar nada.
  assert.throws(() => normalizarLineaBase(null), /forma de un sidecar/);
  assert.throws(() => normalizarLineaBase([]), /forma de un sidecar/);
  assert.throws(() => normalizarLineaBase('hola'), /forma de un sidecar/);
  assert.throws(() => normalizarLineaBase({sidecar: 'no soy un objeto'}), /forma de un sidecar/);
});

test('los archivos con BOM se leen', () => {
  // PowerShell 5.1 y el Bloc de notas lo agregan al guardar. Sin tolerarlo, una
  // línea base editada a mano revienta con un error que no dice nada.
  const {t} = correr();
  const conBom = '\uFEFF' + JSON.stringify(t.sidecar);
  assert.deepEqual(Object.keys(leerJsonDeTexto(conBom)), Object.keys(t.sidecar));
  assert.throws(() => JSON.parse(conBom), 'sin quitar el BOM, revienta');
});

// ── El reporte que Strix escribió de verdad ─────────────────────────────────
//
// El fixture de arriba se construyó LEYENDO la fuente de Strix, no una salida
// observada. Estos casos usan el `vulnerabilities.json` que produjo una corrida
// real de Strix 1.7.0 con la API de MiniMax, y que está en
// `puerta/fixtures/vulnerabilidades-strix-real.json`.
//
// Lo que cambió al ver la salida de verdad, y que el fixture escrito a mano
// escondía: **`cwe` viene vacío**. Un escáner real no siempre lo emite, y el
// traductor tiene que sobrevivir a eso sin inventar un CWE.
const REAL = resolve(aqui, '../puerta/fixtures/vulnerabilidades-strix-real.json');

test('el reporte real de Strix entra a la cadena con su gravedad real', () => {
  const datos = JSON.parse(readFileSync(REAL, 'utf8'));
  assert.equal(datos.length, 2, 'la corrida archivar dos vulnerabilidades');

  const t = traducir(datos, {reloj: relojFijo});
  assert.equal(t.cadena.eventos.length, 2);
  const porNivel = t.resumen.por_nivel;
  assert.equal(porNivel[5], 1, 'una crítica: la inyección SQL');
  assert.equal(porNivel[3], 1, 'una media: el IDOR');

  const v = verificarHallazgos({cadena: t.cadena, sidecar: t.sidecar, umbral: 'high'});
  assert.equal(v.pasa, false);
  assert.equal(v.comercial.length, 1, 'sólo la crítica bloquea con umbral high');
});

test('un hallazgo sin CWE no inventa uno: queda vacío y declarado', () => {
  // Este es el hueco que el fixture escrito a mano no podía mostrar.
  const datos = JSON.parse(readFileSync(REAL, 'utf8'));
  assert.equal(datos.every((d) => !d.cwe), true,
    'esta corrida vino sin CWE en ninguno de los dos hallazgos');

  const t = traducir(datos, {reloj: relojFijo});

  // En la cadena no hay campo CWE, y eso es lo correcto: la cadena lleva el
  // TIPO del hallazgo, nunca su contenido. Lo que no puede pasar es que se
  // invente una familia.
  for (const b of t.cadena.eventos) {
    assert.equal(b.datos.tipos.filter((x) => x.startsWith('cwe_')).length, 0,
      'sin CWE declarado, no hay tipo cwe_* en la cadena');
    assert.equal(b.cwe, undefined, 'la cadena no lleva el campo, y no lo inventa');
    assert.deepEqual(validarEvento(b), [],
      'un evento sin CWE sigue siendo válido: la lista de errores va vacía');
  }

  // El sidecar, que es donde vive el detalle, dice `null` y no inventa nada.
  for (const s of Object.values(t.sidecar)) {
    assert.equal(s.cwe, null);
  }

  const v = verificarHallazgos({cadena: t.cadena, sidecar: t.sidecar, umbral: 'high'});
  assert.equal(v.integridad.ok, true);
});

test('con CWE declarado, la cadena sí registra el tipo', () => {
  // La otra mitad: el CWE es parte de la identidad del hallazgo y va en el
  // tipo del evento, para que el cruce con el manual pueda usarlo.
  const datos = JSON.parse(readFileSync(REAL, 'utf8')).map((d) => ({...d, cwe: 'CWE-639'}));
  const t = traducir(datos, {reloj: relojFijo});
  assert.deepEqual(t.cadena.eventos[0].datos.tipos, ['dynamic', 'cwe_639']);
});

test('CWE ausente, vacío o nulo dan la MISMA huella', () => {
  // Lo que de verdad importa acá. Si `undefined` y `null` dieran huellas
  // distintas, un hallazgo sin CWE sería "otro hallazgo" cada vez que Strix
  // cambiara el `cwe` de ausente a vacío, y la línea base lo reportaría como
  // nuevo sin que nadie hubiera tocado nada.
  const base = {
    id: 'vuln-1', severity: 'high', finding_class: 'dynamic',
    title: 'IDOR en /mis-pedidos', target: 'http://x', endpoint: '/mis-pedidos',
    timestamp: '2026-10-17 12:00:00 UTC',
  };
  const h1 = huellaDe({...base});
  const h2 = huellaDe({...base, cwe: null});
  const h3 = huellaDe({...base, cwe: ''});
  const h4 = huellaDe({...base, cwe: '   '});
  assert.equal(h1, h2);
  assert.equal(h1, h3);
  assert.equal(h1, h4);

  // Y con CWE real, la huella SÍ cambia: el CWE es parte de la identidad.
  assert.notEqual(h1, huellaDe({...base, cwe: 'CWE-639'}));

  // Lo mismo para la clave por sitio.
  assert.equal(sitioDe({...base}), sitioDe({...base, cwe: null}));
  assert.notEqual(sitioDe({...base}), sitioDe({...base, cwe: 'CWE-639'}));
});

test('los dos hallazgos comparten sitio y eso se declara, no se funden en silencio', () => {
  // Sin CWE, la clave por sitio no los separa. Decirlo es mejor que contarlos
  // como dos hallazgos independientes en sitios distintos.
  const datos = JSON.parse(readFileSync(REAL, 'utf8'));
  const t = traducir(datos, {reloj: relojFijo});
  const v = verificarHallazgos({cadena: t.cadena, sidecar: t.sidecar, umbral: 'high'});
  assert.equal(v.choques.length, 1, 'el choque queda declarado');
  assert.equal(v.choques[0].titulos.length, 2);
});

test('el reporte real es reproducible: la misma entrada da la misma cadena', () => {
  const datos = JSON.parse(readFileSync(REAL, 'utf8'));
  const a = traducir(datos, {reloj: relojFijo}).cadena;
  const b = traducir(JSON.parse(readFileSync(REAL, 'utf8')), {reloj: relojFijo}).cadena;
  assert.equal(huellaDe(a), huellaDe(b));
});

test('lo que ya estaba abierto en el reporte real sigue bloqueando', () => {
  // Sin esto, "cerrar" un hallazgo lo sacaría de la cadena y la puerta pasaría sin
  // que nadie arreglara nada.
  const datos = JSON.parse(readFileSync(REAL, 'utf8'));
  const t = traducir(datos, {reloj: relojFijo});
  const lineaBase = t.sidecar;

  const primera = verificarHallazgos({cadena: t.cadena, sidecar: t.sidecar, umbral: 'high'});
  assert.equal(primera.resumen.nuevos, 2);

  const segunda = verificarHallazgos({
    cadena: t.cadena, sidecar: t.sidecar, lineaBase, umbral: 'high',
  });
  assert.equal(segunda.resumen.nuevos, 0, 'nada nuevo');
  assert.equal(segunda.resumen.persistentes, 2, 'pero los dos siguen abiertos');
  assert.equal(segunda.pasa, false, 'y la puerta sigue sin pasar');
});

// ── La puerta desde la terminal, y la configuración que le llega ─────────────
//
// `puerta/ruta.mjs` es un script, no una biblioteca: para probarlo hay que
// correrlo. Estas pruebas lo hacen como proceso aparte, que es la única forma
// de comprobar lo que de verdad importa acá — lo que alguien ve en pantalla —
// sin simularlo con una función que devuelve lo que uno quiere que devuelva.

const RAIZ = resolve(aqui, '..');

function correrPuerta(args) {
  const r = spawnSync(process.execPath, [resolve(RAIZ, 'puerta', 'ruta.mjs'), '--sin-color', ...args], {
    encoding: 'utf8',
    cwd: RAIZ,
    env: {...process.env},
  });
  return {salida: `${r.stdout}${r.stderr}`, codigo: r.status};
}

test('la puerta lee la entidad y el reporte de la configuración', () => {
  const {salida} = correrPuerta(['--config', 'config/entidad.ejemplo.json']);
  assert.match(salida, /entidad\s+Consultora Ejemplo SpA · ejemplo\.cl/);
  assert.match(salida, /reporte-seguridad\.json/,
    'sin --reporte, el reporte sale de `fuentes.seguridad`');
  assert.match(salida, /objetivo https:\/\/app\.ejemplo\.cl/);
});

test('sin configurar nada, la puerta declara que usó el ejemplo del paquete', () => {
  // La parte que importa: si no se pide ninguna fuente, el ejemplo del paquete
  // se carga igual — es lo único que hay — pero **se dice**. Una fuente que no
  // se pidió y aparece sin aviso es un informe de otra entidad con el nombre
  // de la de nadie.
  const {salida} = correrPuerta([]);
  assert.match(salida, /vulnerabilidades-strix\.json/);
  assert.match(salida, /cargada · defecto/);
});

test('--reporte gana sobre la configuración, y se ve de dónde salió', () => {
  const {salida} = correrPuerta([
    '--config', 'config/entidad.ejemplo.json',
    '--reporte', 'puerta/fixtures/vulnerabilidades-strix.json',
  ]);
  assert.match(salida, /vulnerabilidades-strix\.json/);
  assert.match(salida, /argumento --strix/,
    'y la precedencia tiene que quedar a la vista, no solo funcionar');
});

test('una ruta que no existe para la puerta, en vez de seguir con otra', () => {
  const {salida, codigo} = correrPuerta(['--reporte', 'no-existe-jamas.json']);
  assert.equal(codigo, 1);
  assert.match(salida, /no existe/);
  assert.doesNotMatch(salida, /PASA/,
    'el modo de falla es pasar por el ejemplo y decir PASA');
});

test('la contradicción entre lo declarado y el archivo se avisa en la puerta también', () => {
  // El ejemplo declara "corrida real sobre app.ejemplo.cl" y el archivo está
  // dentro de `fixtures/`. La puerta tiene que decirlo igual que el panel.
  const {salida} = correrPuerta(['--config', 'config/entidad.ejemplo.json']);
  assert.match(salida, /fixture del paquete/);
  assert.match(salida, /Manda el archivo, no la etiqueta/);
});

test('una clave mal escrita en la configuración para la puerta, sin medio camino', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hefesto-puerta-'));
  try {
    const ruta = join(dir, 'entidad.json');
    writeFileSync(ruta, JSON.stringify({entidad: {nombre: 'X'}, servidor: {puerto: 'no-un-numero'}}), 'utf8');
    const {salida, codigo} = correrPuerta(['--config', ruta]);
    assert.equal(codigo, 1);
    assert.match(salida, /puerto|no es un número|ErrorDeConfig/i);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});