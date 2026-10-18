// La configuración: que nada esté atado a una entidad.
//
// Estos tests no miran comportamiento del negocio. Mueven el punto de partida
// y comprueban que se mueva TODO, o que se pare en voz alta. La razón es que el
// defecto que se corrige aquí era silencioso: el servidor servía el informe del
// colegio porque la ruta estaba escrita en el código, y no había forma de
// enterarse salvo abrir el fuente.
//
// La regla que se comprueba aquí es la del proyecto aplicada a la
// configuración: un valor que se pidió y no existe es un error; un valor por
// defecto que no existe se declara. Lo segundo es ausente, lo primero es un
// error, y confundirlos es mostrarle a alguien el informe de otra entidad.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {dirname} from 'node:path';

import {cargarConfig, ErrorDeConfig, escenarioDemo, mapaDe, DEFECTOS} from '../config/cargar.mjs';
import {construirEscenario} from '../demo/escenario.mjs';
import {informeTexto} from '../cli/informe.mjs';
import {desdeConformidad, desdeSeguridad} from '../mesa/fuentes.mjs';
import {cruzar} from '../mesa/cruce.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(aqui, '..');
const EJEMPLO = resolve(BASE, 'config', 'entidad.ejemplo.json');

function temporal() {
  return mkdtempSync(join(tmpdir(), 'hefesto-config-'));
}

function escribirConfig(dir, contenido) {
  const ruta = join(dir, 'entidad.json');
  writeFileSync(ruta, JSON.stringify(contenido, null, 2), 'utf8');
  return ruta;
}

// Una entidad sin `mapa`, para comprobar que el del paquete basta cuando la
// entidad no trae categorías propias.
const EJEMPLO_SIN_MAPA = resolve(BASE, 'config', 'entidad.minima.json');

// ── Precedencia ──────────────────────────────────────────────────────────────

test('el argumento gana al entorno, el entorno gana al archivo y el archivo gana al defecto', () => {
  const dir = temporal();
  try {
    const ruta = escribirConfig(dir, {entidad: {nombre: 'del-archivo', dominio: 'del-archivo.cl'}});
    const base = {base: BASE, env: {}};

    assert.equal(cargarConfig({...base, argv: [], env: {}}).entidad.nombre, DEFECTOS.nombre);

    assert.equal(
      cargarConfig({...base, argv: ['--config', ruta], env: {}}).entidad.nombre,
      'del-archivo'
    );
    assert.equal(
      cargarConfig({...base, argv: ['--config', ruta], env: {HEFESTO_NOMBRE: 'del-entorno'}}).entidad.nombre,
      'del-entorno'
    );
    assert.equal(
      cargarConfig({
        ...base,
        argv: ['--config', ruta, '--nombre', 'del-argumento'],
        env: {HEFESTO_NOMBRE: 'del-entorno'},
      }).entidad.nombre,
      'del-argumento'
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('la precedencia se declara: cada valor sabe de dónde salió', () => {
  const dir = temporal();
  try {
    const ruta = escribirConfig(dir, {entidad: {nombre: 'del-archivo'}});
    const c = cargarConfig({base: BASE, argv: ['--config', ruta], env: {HEFESTO_DOMINIO: 'x.cl'}});
    assert.match(c.entidad._de_nombre, /archivo/);
    assert.match(c.entidad._de_dominio, /entorno/);
    assert.match(c.servidor._de_puerto, /defecto/);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('--clave=valor funciona igual que --clave valor', () => {
  const c = cargarConfig({base: BASE, argv: ['--dominio=igual.cl'], env: {}});
  assert.equal(c.entidad.dominio, 'igual.cl');
});

// ── Fallar fuerte ────────────────────────────────────────────────────────────

test('una ruta CONFIGURADA que no existe detiene el sistema', () => {
  // Esta es la prueba que da sentido a todo lo demás. Sin ella, un typo en la
  // ruta deja el panel sirviendo el informe del paquete y nadie se entera.
  assert.throws(
    () => cargarConfig({base: BASE, argv: ['--spaudit', join(tmpdir(), 'no-existe.json')], env: {}}),
    (e) => {
      assert.ok(e instanceof ErrorDeConfig);
      assert.match(e.message, /no existe/);
      // El mensaje tiene que decir de dónde salió la ruta: "está mal" sin
      // "por dónde se puso mal" no sirve para arreglarlo.
      assert.match(e.message, /--spaudit/);
      return true;
    }
  );
});

test('una ruta por DEFECTO que no existe no es error: se declara ausente', () => {
  const dir = temporal();
  try {
    // Se aísla del paquete: sin fixtures, el valor por defecto tampoco está.
    const c = cargarConfig({base: dir, argv: [], env: {}});
    assert.equal(c.fuentes.conformidad.presente, false);
    assert.equal(c.fuentes.conformidad.de, 'defecto');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('un archivo de configuración que se pidió y no está es error', () => {
  assert.throws(
    () => cargarConfig({base: BASE, argv: ['--config', join(tmpdir(), 'no-este.json')], env: {}}),
    (e) => e instanceof ErrorDeConfig && /No existe el archivo/.test(e.message)
  );
});

test('una configuración que no es JSON válido se dice, no se ignora', () => {
  const dir = temporal();
  try {
    const ruta = join(dir, 'entidad.json');
    writeFileSync(ruta, '{ esto no es json', 'utf8');
    assert.throws(
      () => cargarConfig({base: BASE, argv: ['--config', ruta], env: {}}),
      (e) => e instanceof ErrorDeConfig && /no es JSON válido/.test(e.message)
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('un puerto que no es puerto se dice con el nombre del campo', () => {
  assert.throws(
    () => cargarConfig({base: BASE, argv: ['--puerto', 'mil'], env: {}}),
    (e) => e instanceof ErrorDeConfig && /servidor\.puerto/.test(e.message)
  );
});

// ── El origen se deduce del archivo, no de la etiqueta ───────────────────────

test('un archivo dentro de fixtures/ se declara ejemplo aunque la configuración diga "real"', () => {
  // La etiqueta la escribe quien configura, y quien configura se puede equivocar
  // —o mentir. El código sabe dónde está el archivo, y eso no se puede firmar.
  const c = cargarConfig({base: BASE, argv: ['--config', EJEMPLO], env: {}});
  assert.equal(c.fuentes.conformidad.origen, 'fixture del paquete');
  assert.equal(c.fuentes.conformidad.origen_declarado, 'corrida real sobre ejemplo.cl');
  assert.equal(c.fuentes.conformidad.contradice, true,
    'la contradicción entre etiqueta y archivo tiene que quedar registrada');
});

test('un archivo fuera del paquete conserva lo que declara la configuración', () => {
  const dir = temporal();
  try {
    mkdirSync(join(dir, 'informes'), {recursive: true});
    const ruta = join(dir, 'informes', 'informe.json');
    writeFileSync(ruta, JSON.stringify({resultados: []}), 'utf8');
    const c = cargarConfig({
      base: BASE,
      argv: ['--config', escribirConfig(dir, {
        fuentes: {conformidad: {ruta, origen: 'corrida real'}},
      })],
      env: {},
    });
    assert.equal(c.fuentes.conformidad.origen, 'corrida real');
    assert.equal(c.fuentes.conformidad.contradice, false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

// ── Cambiar de entidad cambia todo ────────────────────────────────────────────

test('apuntar a otra entidad cambia dominio, controles y cobertura', () => {
  // La prueba de que el sistema no está atado. Si mañana alguien deja una ruta
  // escrita en el código, esta falla.
  const colegio = cargarConfig({base: BASE, argv: [], env: {}});
  const ejemplo = cargarConfig({base: BASE, argv: ['--config', EJEMPLO], env: {}});

  assert.equal(nombreDe(colegio), 'entidad sin nombre');
  assert.equal(ejemplo.entidad.nombre, 'Consultora Ejemplo SpA');
  assert.notEqual(colegio.fuentes.conformidad.ruta, ejemplo.fuentes.conformidad.ruta);

  const a = desdeConformidad(colegio.fuentes.conformidad.ruta);
  const b = desdeConformidad(ejemplo.fuentes.conformidad.ruta);
  assert.equal(a.dominio, 'saintpatricktemuco.cl');
  assert.equal(b.dominio, 'ejemplo.cl');
  assert.equal(a.totales.controles, 147);
  assert.equal(b.totales.controles, 11);
  assert.notEqual(a.totales.sin_verificar, b.totales.sin_verificar);

  const ca = cruzar({
    conformidad: a.items,
    seguridad: desdeSeguridad(colegio.fuentes.seguridad.ruta).items,
    sinVerificar: a.sinVerificar,
    cumplidos: a.cumplidos,
  }).resumen;
  const cb = cruzar({
    conformidad: b.items,
    seguridad: desdeSeguridad(ejemplo.fuentes.seguridad.ruta).items,
    sinVerificar: b.sinVerificar,
    cumplidos: b.cumplidos,
  }).resumen;
  assert.notEqual(ca.cobertura_actual_pct, cb.cobertura_actual_pct);
});

test('la configuración no depende del directorio desde donde se corra', () => {
  // El defecto que destapó este archivo: las rutas se resolvían contra el
  // directorio de trabajo, así que el mismo archivo de configuración servía
  // datos corriendo desde la raíz y se caía al defecto desde `C:\`.
  const desdeRaiz = cargarConfig({base: BASE, argv: ['--config', EJEMPLO], env: {}});
  const antes = process.cwd();
  try {
    process.chdir(tmpdir());
    const desdeOtro = cargarConfig({base: BASE, argv: ['--config', EJEMPLO], env: {}});
    assert.equal(desdeOtro.fuentes.conformidad.ruta, desdeRaiz.fuentes.conformidad.ruta);
    assert.equal(desdeOtro.fuentes.conformidad.presente, true);
  } finally {
    process.chdir(antes);
  }
});

function nombreDe(config) { return config.entidad.nombre; }

// ── El escenario se mueve entero ─────────────────────────────────────────────

test('cambiar la fecha mueve TODOS los envíos, no deja fechas atrás', () => {
  const antes = construirEscenario({desde: '2026-05-01T10:00:00.000Z'});
  const despues = construirEscenario({desde: '2026-11-15T08:30:00.000Z'});

  const ts = (e) => e.pasos.map((p) => p.ts);
  assert.equal(ts(antes).length, ts(despues).length);
  assert.ok(ts(despues).every((t, i) => t !== ts(antes)[i]),
    'mover la fecha tiene que mover cada envío');

  // Y las fechas de consentimiento también se mueven, o el escenario deja de
  // significar lo mismo: la retirada caería fuera de la corrida.
  const antesConsents = antes.consents.map((x) => x.granted_at);
  const despuesConsents = despues.consents.map((x) => x.granted_at);
  assert.deepEqual(despuesConsents.length, antesConsents.length);
  for (let i = 0; i < despuesConsents.length; i += 1) {
    assert.notEqual(despuesConsents[i], antesConsents[i],
      `el consentimiento ${i} se quedó en la fecha vieja ${despuesConsents[i]}`);
  }
});

test('el escenario conserva su significado en cualquier fecha', () => {
  // Con fechas absolutas, mover el reloj dejaba los nueve envíos ya revocados y
  // el caso caro —el que más duele en una auditoría— desaparecía sin avisar.
  for (const desde of ['2026-05-01T10:00:00.000Z', '2026-11-15T08:30:00.000Z', '2027-01-03T22:00:00.000Z']) {
    const e = construirEscenario({desde});
    const conRetirada = e.consents.find((c) => c.id === 'c-revocable');
    assert.ok(conRetirada, 'el consentimiento revocable tiene que existir');
    const retiro = e.acciones.find((a) => a.consent_id === 'c-revocable').occurred_at;
    const primero = e.pasos[0].ts;
    const ultimo = e.pasos[e.pasos.length - 1].ts;
    assert.ok(primero < retiro && retiro < ultimo,
      `con inicio ${desde} la retirada (${retiro}) quedó fuera de la corrida`);
  }
});

test('una fecha inválida se dice en vez de arrancar en una fecha inventada', () => {
  assert.throws(
    () => construirEscenario({desde: 'no-es-una-fecha'}),
    /no es una fecha ISO válida/
  );
});

test('cambiar el tenant cambia el HMAC del sujeto', () => {
  const a = construirEscenario({tenant: 'municipalidad'});
  const b = construirEscenario({tenant: 'consultora-ejemplo'});
  assert.notEqual(a.consents[0].subject_ref, b.consents[0].subject_ref);
  assert.notEqual(a.vecinos.a, b.vecinos.a);
});

test('escenarioDemo sólo devuelve lo que tiene valor', () => {
  const dir = temporal();
  try {
    const ruta = escribirConfig(dir, {escenario: {desde: '2026-03-01T00:00:00.000Z'}});
    const vacio = escenarioDemo(cargarConfig({base: BASE, argv: ['--config', ruta], env: {}}));
    assert.deepEqual(vacio, {desde: '2026-03-01T00:00:00.000Z'},
      'pasar undefined no es lo mismo que no pasar nada cuando hay valor por defecto');
    assert.deepEqual(escenarioDemo(cargarConfig({base: BASE, argv: [], env: {}})), {});
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

function cologne(config) { return config.entidad.nombre; }
// ── El mapa de correspondencias también es de la entidad ─────────────────────
//
// La tabla del paquete está escrita sobre el catálogo del colegio. Una entidad
// con su propio manual trae sus propias áreas, y con la tabla fija el cruce no
// devuelve nada y el informe acusa a la tabla de estar vieja. Estas pruebas
// existían para que, el día que alguien vuelva a atar el mapa al colegio,
// fallen.

test('sin mapa de entidad se usa el del paquete', () => {
  const c = cargarConfig({base: BASE, argv: ['--config', EJEMPLO_SIN_MAPA], env: {}});
  const mapa = mapaDe(c);
  assert.equal(mapa.familias.Web !== undefined, true);
  assert.deepEqual(c.mapa._categorias_propias, 0);
});

test('el mapa de la entidad se suma al del paquete, no lo reemplaza', () => {
  const c = cargarConfig({base: BASE, argv: ['--config', EJEMPLO], env: {}});
  const mapa = mapaDe(c);

  // Lo del paquete sigue ahí...
  assert.ok(mapa.familias.Web, 'la entidad no puede borrar lo que el paquete sabe');
  assert.ok(mapa.familias.Correo);
  assert.equal(mapa.noSondeables.Legal, 'es una cuestión legal');

  // ...y lo de la entidad también.
  assert.deepEqual(mapa.familias['Perímetro'], [22, 78, 89, 284, 16, 200, 400, 522, 611, 693, 918]);
  assert.match(mapa.noSondeables.Continuidad, /documento aprobado/);
  assert.equal(c.mapa._categorias_propias, 3);
});

test('una categoría que la entidad redeclara pisa la del paquete', () => {
  const dir = temporal();
  try {
    const ruta = escribirConfig(dir, {
      mapa: {familias: {Web: [999]}},
    });
    const mapa = mapaDe(cargarConfig({base: BASE, argv: ['--config', ruta], env: {}}));
    assert.deepEqual(mapa.familias.Web, [999]);
    assert.ok(mapa.familias.Correo, 'lo demás no se toca');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('con el mapa de la entidad, su catálogo deja de tener categorías desconocidas', () => {
  // El número que importa: sin el mapa, el informe del ejemplo acusaba a la
  // tabla de no conocer tres de sus siete categorías.
  const conf = desdeConformidad(resolve(BASE, 'mesa', 'fixtures', 'entidad-ejemplo', 'informe-conformidad.json'));
  const usadas = conf.items.map((i) => i.categoria).filter(Boolean);
  const seg = desdeSeguridad(resolve(BASE, 'mesa', 'fixtures', 'entidad-ejemplo', 'reporte-seguridad.json'));

  const sinMapa = cruzar({
    conformidad: conf.items, seguridad: seg.items,
    sinVerificar: conf.sinVerificar, cumplidos: conf.cumplidos,
  }).resumen;
  const conMapa = cruzar({
    conformidad: conf.items, seguridad: seg.items,
    sinVerificar: conf.sinVerificar, cumplidos: conf.cumplidos,
    mapa: mapaDe(cargarConfig({base: BASE, argv: ['--config', EJEMPLO], env: {}})),
  }).resumen;

  assert.equal(sinMapa.categorias_desconocidas.length, 3,
    'sin mapa de entidad, tres categorías quedan fuera');
  assert.deepEqual(conMapa.categorias_desconocidas, [],
    'con el mapa de la entidad, ninguna');

  // Y el cruce tiene que encontrar más, no menos.
  assert.ok(conMapa.areas_alcanzadas > sinMapa.areas_alcanzadas);
  assert.ok(conMapa.controles_resolubles_por_sonda > sinMapa.controles_resolubles_por_sonda);
});

// ── El esquema: una clave mal escrita se dice, no se ignora ──────────────────
//
// Este bloque existe por un bug real. La revisión de esquema comparaba con
// `typeof seccion === 'string'`, así que para `entidad` —cuyas claves válidas
// son una lista— caía en `Object.keys(['nombre','dominio'])`, que devuelve
// `['0','1']`. El mensaje de error ofrecía "se aceptan: 0, 1" y, peor, la
// revisión no detectaba nada. Estos tests cierran las dos cosas: que el error
// sea útil y que el archivo se revise de verdad.

test('una clave mal escrita en la raíz se dice, con la lista de secciones', () => {
  const dir = temporal();
  try {
    const ruta = escribirConfig(dir, {entidadz: {nombre: 'x.cl'}});
    assert.throws(
      () => cargarConfig({base: BASE, argv: ['--config', ruta], env: {}}),
      (e) => {
        assert.ok(e instanceof ErrorDeConfig);
        assert.match(e.message, /"entidadz" no es una clave de la raíz/);
        assert.match(e.message, /Se aceptan: entidad, servidor, escenario, mapa, fuentes/);
        assert.match(e.message, /Quisiste decir "entidad"/);
        // La regresión exacta que se corrigió: los índices del array en vez de
        // los nombres de las claves.
        assert.doesNotMatch(e.message, /0, 1/,
          'el mensajecreteoffería índices del array en vez de nombres de clave');
        return true;
      }
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('una clave mal escrita dentro de una sección también se dice', () => {
  const dir = temporal();
  try {
    const ruta = escribirConfig(dir, {entidad: {nombre: 'x', dominios: 'x.cl'}});
    assert.throws(
      () => cargarConfig({base: BASE, argv: ['--config', ruta], env: {}}),
      (e) => {
        assert.match(e.message, /"dominios" no es una clave de entidad/);
        assert.match(e.message, /Se aceptan: nombre, dominio/);
        assert.match(e.message, /Quisiste decir "dominio"/);
        return true;
      }
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('una fuente que no existe entre las tres se nombra', () => {
  const dir = temporal();
  try {
    const ruta = escribirConfig(dir, {fuentes: {inventario: {ruta: 'x.json'}}});
    assert.throws(
      () => cargarConfig({base: BASE, argv: ['--config', ruta], env: {}}),
      (e) => {
        assert.match(e.message, /"inventario" no es una clave de fuentes/);
        assert.match(e.message, /Se aceptan: conformidad, seguridad, probanza/);
        return true;
      }
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('una clave mal escrita dentro de una fuente también se dice', () => {
  const dir = temporal();
  try {
    const ruta = escribirConfig(dir, {fuentes: {conformidad: {rutas: 'x.json'}}});
    assert.throws(
      () => cargarConfig({base: BASE, argv: ['--config', ruta], env: {}}),
      (e) => {
        assert.match(e.message, /"rutas" no es una clave de fuentes\.conformidad/);
        assert.match(e.message, /Se aceptan: ruta, origen, nota/);
        return true;
      }
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('_nota se acepta en cualquier parte: es para que el archivo se explique solo', () => {
  const dir = temporal();
  try {
    const ruta = escribirConfig(dir, {
      _nota: 'esto lo escribe alguien, no el código',
      entidad: {nombre: 'X SpA', dominio: 'x.cl', _nota: 'nombre legal completo'},
      mapa: {_nota: 'las áreas de esta entidad, no las del colegio'},
      // Ruta absoluta a propósito: la relativa se resolvería contra la carpeta
      // de este archivo temporal, que no tiene `mesa/fixtures` dentro. Y esa
      // es justo la regla —una ruta se resuelve desde donde salió— que otro
      // test ya comprueba; acá no es lo que se está probando.
      fuentes: {
        conformidad: {
          ruta: resolve(BASE, 'mesa', 'fixtures', 'spaudit-informe-real.json'),
          _nota: 'el del colegio, del día que se corrió',
        },
      },
    });
    const c = cargarConfig({base: BASE, argv: ['--config', ruta], env: {}});
    assert.equal(c.entidad.nombre, 'X SpA');
    assert.equal(c.fuentes.conformidad.estado, 'cargada');
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('una sección que no es un objeto se dice con el tipo que se esperaba', () => {
  const dir = temporal();
  try {
    const ruta = escribirConfig(dir, {escenario: '2026-01-01'});
    assert.throws(
      () => cargarConfig({base: BASE, argv: ['--config', ruta], env: {}}),
      (e) => {
        assert.match(e.message, /"escenario" tiene que ser un objeto con claves como/);
        assert.match(e.message, /desde, reloj, tenant, sal/);
        return true;
      }
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('un JSON con BOM se dice por su nombre, no como un token misterioso', () => {
  const dir = temporal();
  try {
    const ruta = join(dir, 'entidad.json');
    // BOM + JSON válido: parsea en cualquier parte salvo que se quite antes.
    writeFileSync(ruta, '\uFEFF' + JSON.stringify({entidad: {nombre: 'X', dominio: 'x.cl'}}), 'utf8');
    assert.throws(
      () => cargarConfig({base: BASE, argv: ['--config', ruta], env: {}}),
      (e) => {
        assert.match(e.message, /empieza con un BOM \(byte EF BB BF\)/);
        assert.match(e.message, /PowerShell 5\.1/);
        return true;
      }
    );
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('los dos archivos de ejemplo del paquete pasan el esquema', () => {
  // Si el ejemplo oficial no lo pasara, el paquete estarías documenting algo
  // que no funciona: el peor tipo de doc.
  for (const ruta of [EJEMPLO, EJEMPLO_SIN_MAPA]) {
    const c = cargarConfig({base: BASE, argv: ['--config', ruta], env: {}});
    assert.ok(c.entidad.nombre && c.entidad.dominio, `${ruta} tiene que cargar entera`);
    assert.ok(c.entidad._de_nombre.includes(ruta),
      'y tiene que decir de dónde salió cada valor');
  }
});

test('el informe de la terminal también se mueve con la entidad', () => {
  // `cli/informe.mjs` era la última CLI que llamaba `construirEscenario()` sin
  // argumentos: el panel y la mesa seguían a la entidad, y esta no. Dos
  // informes del mismo sistema con reglas distintas son dos sistemas.
  //
  // Se corre como proceso y no llamando a la función porque lo que se quiere
  // comprobar es lo que alguien ve: el módulo recibe la configuración en el
  // punto de entrada, no dentro, para que importarlo no lea disco.
  const correr = (...args) => {
    const r = spawnSync(process.execPath, [resolve(BASE, 'cli', 'informe.mjs'), '--sin-color', ...args], {
      encoding: 'utf8', cwd: BASE, env: {},
    });
    return r.stdout;
  };

  const conConfig = correr('--config', 'config/entidad.ejemplo.json');
  const sinConfig = correr();

  assert.match(conConfig, /entidad {2}Consultora Ejemplo SpA · ejemplo\.cl/);
  assert.match(conConfig, /reloj {4}2026-10-02T09:00:00\.000Z/);
  // Sin configurar nada, `cargarConfig` igual entrega una configuración con el
  // nombre por defecto, y eso también se declara.
  assert.match(sinConfig, /entidad {2}entidad sin nombre {2}\[defecto\]/);

  // Y lo que importa: las fechas del escenario se movieron con ella.
  assert.match(conConfig, /2026-10-03 09:00/);
  assert.match(sinConfig, /2026-05-02 10:00/);
  assert.doesNotMatch(conConfig, /2026-05-02/,
    'si alguna fecha se queda en la del paquete, el escenario no se movió entero');

  // Importado como módulo, sin configuración, sigue sirviendo: el escenario por
  // defecto es lo que espera cualquiera que lo use como biblioteca.
  assert.match(informeTexto(), /HEFESTO PROBANZA · cadena de conformidad/);
});