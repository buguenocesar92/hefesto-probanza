// Comprobador de guardas.
//
// ÚNICO USO: desarrollo. Debilitar una guarda a propósito, confirmar que la
// suite se pone roja y dejar el archivo exactamente como estaba.
//
//   node tools/comprobar-guarda.mjs <archivo> <texto-bueno> <texto-malo>
//
// No forma parte del producto y `npm test` no lo corre. Vive en tools/ para que
// nadie lo confunda con la biblioteca: el día que este script se ejecute solo,
// es porque se perdió la diferencia entre probar y comprobar.

import {readFileSync, writeFileSync, readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';

const aqui = dirname(fileURLToPath(import.meta.url));
const raiz = resolve(aqui, '..');
const node = process.execPath;

// Los archivos se descubren, no se listan.
//
// Una lista fija ya dio un falso verde: se agregó `puerta.test.mjs` y el
// comprobador siguió reportando "sin fallos" con la guarda rota, porque nunca
// lo había corrido. Una herramienta que puede dar verde sin mirar lo que dice
// no sirve para probar nada, así que ahora corre todo lo que haya.
const SUITE = readdirSync(resolve(raiz, 'tests'))
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => `tests/${f}`);

if (SUITE.length === 0) {
  console.error('No encontré pruebas en tests/. No se corre nada.');
  process.exit(2);
}

const [archivo, bueno, malo] = process.argv.slice(2);

if (!archivo || !bueno || !malo) {
  console.error('uso: node tools/comprobar-guarda.mjs <archivo> <texto-bueno> <texto-malo>');
  process.exit(2);
}

const ruta = resolve(raiz, archivo);
const original = readFileSync(ruta, 'utf8');

if (!original.includes(bueno)) {
  console.error(`No encontré el texto a debilitar en ${archivo}. No se toca nada.`);
  process.exit(2);
}

const correr = () => spawnSync(node, ['--test', ...SUITE], {cwd: raiz, encoding: 'utf8'});
const resumen = (r) => (r.stdout + r.stderr)
  .split('\n')
  .filter((l) => /^ℹ (pass|fail)/.test(l))
  .join('  ') || '(sin salida — ¿la suite corrió?)';

let salida = 0;
try {
  writeFileSync(ruta, original.replace(bueno, malo), 'utf8');
  const rojo = correr();
  console.log(`guarda DEBILITADA  →  ${resumen(rojo)}`);
} finally {
  // El archivo vuelve a su estado original pase lo que pase: si una corrida
  // lanza una excepción, quedarse con la versión floja sería peor que no
  // haber hecho la prueba.
  writeFileSync(ruta, original, 'utf8');
  console.log('archivo restaurado');
}

const verde = correr();
console.log(`guarda RESTAURADA  →  ${resumen(verde)}`);
process.exit(salida);