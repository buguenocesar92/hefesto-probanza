// Higiene del repositorio.
//
// Estas no son pruebas de comportamiento: son pruebas de que el código fuente
// es legible por las herramientas. Parecen tontas hasta que pasan lo que
// pasó.
//
// EL INCIDENTE. Al escribir un espacio entre comillas simples, el byte sale como
// NUL en vez de espacio. El archivo sigue siendo JavaScript válido y Node lo
// ejecuta sin quejarse — pero `grep`, `ripgrep`, los diffs y casi cualquier
// editor lo tratan como binario. O sea: el módulo desaparecía de las búsquedas
// sin dar ningún error. Pasó dos veces en este paquete y en las dos, un archivo
// del núcleo quedó invisible para cualquier auditoría de código.
//
// Un fallo que no da error y que esconde código de la vista es peor que un
// fallo ruidoso. Por eso vive en la suite: si vuelve a pasar, se ve.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve, relative, sep} from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..');

const EXTENSIONES = ['.mjs', '.js', '.json', '.md', '.css', '.html'];
const IGNORAR = new Set(['node_modules', '.git', 'strix_runs', 'dist', 'coverage']);

function archivos(dir = raiz) {
  const salida = [];
  for (const entrada of readdirSync(dir, {withFileTypes: true})) {
    if (IGNORAR.has(entrada.name)) continue;
    const ruta = resolve(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...archivos(ruta));
    else if (EXTENSIONES.some((e) => entrada.name.endsWith(e))) salida.push(ruta);
  }
  return salida.sort();
}

test('ningún archivo de texto tiene bytes NUL', () => {
  const culpables = [];
  for (const f of archivos()) {
    const nulos = readFileSync(f).filter((b) => b === 0).length;
    if (nulos) culpables.push(`${relative(raiz, f)} (${nulos})`);
  }
  assert.equal(culpables.length, 0,
    `NUL en ${culpables.join(', ')} — el archivo será tratado como binario por grep y los diffs`);
});

test('el árbol tiene archivos que revisar', () => {
  // Si el recorrido fallara y devolviera cero, la prueba de arriba daría verde
  // por vacuidad. Una guarda que no mira nada no es una guarda.
  const total = archivos().length;
  assert.ok(total > 20, `solo encontró ${total} archivos: el recorrido está roto`);
  assert.ok(archivos().some((f) => f.endsWith(sep + 'traductor.mjs')), 'faltan los módulos del núcleo');
});

test('ningún archivo versionado trae un byte de BOM', () => {
  // El BOM es lo que rompe `JSON.parse` cuando alguien edita una línea base con
  // el Bloc de notas o con PowerShell 5.1.
  const conBom = archivos()
    .filter((f) => readFileSync(f)[0] === 0xEF && readFileSync(f)[1] === 0xBB)
    .map((f) => relative(raiz, f));
  assert.equal(conBom.length, 0, `BOM en ${conBom.join(', ')}`);
});
// ── El núcleo vendorizado ────────────────────────────────────────────────────
//
// `vendor/hefesto-anonimizador/core/` es una COPIA byte a byte del núcleo real,
// no un doble de prueba. Existe porque el import directo cruzaba al
// repositorio vecino, que no viaja en el paquete: el ZIP se entregaba y al
// descomprimirlo en otra máquina `npm test` moría con ERR_MODULE_NOT_FOUND.
//
// El riesgo de una copia no es que falle —fallaría ruidosamente—, es que siga
// funcionando con código que ya no es el de producción. Eso es silencioso. Por
// eso el manifiesto sella los hashes.

import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';

const VENDOR = resolve(raiz, 'vendor', 'hefesto-anonimizador', 'core');
const MANIFIESTO = resolve(raiz, 'vendor', 'hefesto-anonimizador', 'manifest.json');
const ORIGEN_VECINO = resolve(raiz, '..', 'hefesto-anonimizador', 'core');

function sha256(ruta) {
  return createHash('sha256').update(readFileSync(ruta)).digest('hex');
}

test('el núcleo vendorizado existe completo', () => {
  assert.ok(existsSync(MANIFIESTO), 'falta vendor/hefesto-anonimizador/manifest.json');
  const manifiesto = JSON.parse(readFileSync(MANIFIESTO, 'utf8'));
  const sellados = Object.keys(manifiesto.archivos);
  assert.ok(sellados.length >= 3, `el manifiesto solo sella ${sellados.length} archivos`);
  // Se recorre el manifiesto, no el directorio: el núcleo tiene subcarpetas
  // (`detectores/`) y una lista plana las habría dejado fuera sin avisar.
  for (const nombre of sellados) {
    const ruta = resolve(VENDOR, ...nombre.split('/'));
    assert.ok(existsSync(ruta), `falta vendor/hefesto-anonimizador/core/${nombre}`);
  }
});

test('nadie editó el núcleo vendorizado a mano', () => {
  const manifiesto = JSON.parse(readFileSync(MANIFIESTO, 'utf8'));
  const distintos = [];
  for (const [nombre, esperado] of Object.entries(manifiesto.archivos)) {
    const real = sha256(resolve(VENDOR, nombre));
    if (real !== esperado) distintos.push(`${nombre}: ${real.slice(0, 12)} != ${esperado.slice(0, 12)}`);
  }
  assert.equal(distintos.length, 0,
    `el núcleo vendorizado cambió sin regenerarlo (${distintos.join(', ')}). ` +
    'Se regenera con: node tools/vendorizar.mjs');
});

test('la copia vendorizada es el mismo código que el del anonimizador', (t) => {
  // Sólo se puede comprobar con el repositorio vecino presente. En una
  // instalación suelta, el manifiesto de arriba es lo único que queda, y por
  // eso existe.
  if (!existsSync(ORIGEN_VECINO)) {
    t.skip('hefesto-anonimizador no está a un nivel de arriba: sólo queda el manifiesto');
    return;
  }
  const manifiesto = JSON.parse(readFileSync(MANIFIESTO, 'utf8'));
  const desfasados = [];
  for (const [nombre, esperado] of Object.entries(manifiesto.archivos)) {
    const rutaOrigen = resolve(ORIGEN_VECINO, ...nombre.split('/'));
    if (!existsSync(rutaOrigen)) {
      desfasados.push(`${nombre}: ya no existe en el origen`);
    } else if (sha256(rutaOrigen) !== esperado) {
      desfasados.push(`${nombre}: el anonimizador cambió y la copia quedó atrás`);
    }
  }
  assert.equal(desfasados.length, 0,
    `${desfasados.join('; ')} — node tools/vendorizar.mjs`);
});

test('el paquete no importa nada de fuera de su carpeta', () => {
  // El fallo que motivó vendorizar. Un import que suba con `../..` sale del
  // paquete y funciona sólo en el workspace donde se escribió.
  const salientes = [];
  for (const f of archivos()) {
    if (!f.endsWith('.mjs')) continue;
    const texto = readFileSync(f, 'utf8');
    for (const m of texto.matchAll(/from\s+['"](\.\.\/[^'"]*)['"]/g)) {
      const destino = resolve(dirname(f), m[1]);
      if (!existsSync(destino)) salientes.push(`${relative(raiz, f)} → ${m[1]}`);
    }
  }
  assert.equal(salientes.length, 0,
    `imports que salen del paquete y sólo existen en este workspace: ${salientes.join(', ')}`);
});