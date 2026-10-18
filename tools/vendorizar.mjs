// Regenera `vendor/hefesto-anonimizador/` y su manifiesto de hashes.
//
// Por qué existe una copia y no un import: el import cruzaba al repositorio
// vecino, que no viaja en el paquete. Al descomprimir el ZIP en otra máquina,
// `npm test` moría con ERR_MODULE_NOT_FOUND. Un paquete de evidencia que no
// arranca al abrirlo no demuestra nada.
//
// Por qué un manifiesto: una copia puede quedar vieja sin que nadie se entere,
// y el riesgo no es que falle (fallaría ruidosamente), es que siga funcionando
// con un código que ya no es el que corre en producción. Eso sí es silencioso.
//
//   node tools/vendorizar.mjs

import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {dirname, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..');
const ORIGEN = resolve(raiz, '..', 'hefesto-anonimizador', 'core');
const DESTINO = resolve(raiz, 'vendor', 'hefesto-anonimizador', 'core');
const MANIFIESTO = resolve(raiz, 'vendor', 'hefesto-anonimizador', 'manifest.json');

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Lista recursiva. El núcleo tiene subcarpetas (`detectores/`) y se copian
 *  enteras: copiar sólo el nivel superior rompe con ERR_MODULE_NOT_FOUND. */
function recorrer(dir, base = dir) {
  const salida = [];
  for (const entrada of readdirSync(dir, {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
    const ruta = resolve(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...recorrer(ruta, base));
    else if (entrada.name.endsWith('.mjs')) salida.push(relative(base, ruta).split(sep).join('/'));
  }
  return salida;
}

if (!existsSync(ORIGEN)) {
  console.error(`No se encuentra el origen: ${ORIGEN}`);
  console.error('vendor/ sirve para que el paquete sea autocontenido; regenerarlo');
  console.error('necesita el repositorio vecino a un nivel de arriba.');
  process.exit(1);
}

mkdirSync(DESTINO, {recursive: true});
const archivos = recorrer(ORIGEN);
const sellado = {};

for (const nombre of archivos) {
  const buf = readFileSync(resolve(ORIGEN, ...nombre.split('/')));
  const destinoArchivo = resolve(DESTINO, ...nombre.split('/'));
  mkdirSync(dirname(destinoArchivo), {recursive: true});
  writeFileSync(destinoArchivo, buf);
  sellado[nombre] = sha256(buf);
  console.log(`  copiado  ${nombre.padEnd(38)} ${sellado[nombre].slice(0, 16)}…`);
}

const manifiesto = {
  origen: 'hefesto-anonimizador/core',
  nota: 'Copia byte a byte. Regenerar con: node tools/vendorizar.mjs',
  archivos: sellado,
};
writeFileSync(MANIFIESTO, JSON.stringify(manifiesto, null, 2) + '\n', 'utf8');

console.log('');
console.log(`  ${archivos.length} archivos vendorizados y sellados.`);