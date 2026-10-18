// Correr la suite completa.
//
// Existe porque `npm test` llevaba la lista de archivos escrita a mano, y esa
// lista es una promesa que nadie verifica: cuando se agregó `puerta.test.mjs`
// y `higiene.test.mjs`, `npm test` siguió corriendo las tres primeras y
// reportando verde. Un test que no corre no falla; simplemente no está.
//
// Acá no hay lista. Se descubren los archivos, se corre todo lo que haya, y si
// no aparece ninguno el comando falla en vez de dar un verde vacío.

import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve, dirname} from 'node:path';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const suite = readdirSync(resolve(raiz, 'tests'))
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => `tests/${f}`);

if (suite.length === 0) {
  console.error('No encontré pruebas en tests/. No se corre nada.');
  process.exit(2);
}

const r = spawnSync(process.execPath, ['--test', ...suite], {cwd: raiz, stdio: 'inherit'});

// Si Node se fallsó, `status` es null y sin esto el script terminaría con 0.
process.exit(r.status ?? 1);