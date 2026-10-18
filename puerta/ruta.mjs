// La puerta, desde la terminal.
//
// Lee el `vulnerabilities.json` que dejó una corrida de Strix, lo mete a la
// cadena de probanza y dice si se puede seguir.
//
//   node puerta/ruta.mjs --reporte strix_runs/mi-corrida/vulnerabilities.json
//   node puerta/ruta.mjs --reporte ... --baseline linea-base.json --umbral critical
//   node puerta/ruta.mjs --config config/mi-entidad.json
//
// El reporte se resuelve por la misma precedencia que el resto del sistema
// (argumento > entorno > archivo de configuración > valor por defecto). Sin
// `--reporte` ni `--config`, la puerta carga el ejemplo del paquete y **lo dice
// en pantalla**: una fuente que no se pidió y se cargó igual es una fuente de la
// que quien lee no sabe nada.
//
// Códigos de salida, iguales a los de `strix --fail-on` para poder encadenar las
// dos herramientas en un mismo paso de CI:
//
//   0  la puerta pasa
//   1  hay hallazgos bloqueantes, o la cadena está rota, o el reporte no se pudo leer
//
// Lo que ESTE script NO hace es correr Strix. Strix es una herramienta aparte,
// con su propio ciclo de vida, su propio presupuesto y su propia llave; que viva
// en el mismo repositorio no lo convierte en parte de la biblioteca. Ver
// README.md, sección "Correr la puerta de punta a punta".

import {readFileSync, writeFileSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {traducir, NOMBRE_NIVEL} from './traductor.mjs';
import {verificarHallazgos, normalizarLineaBase, leerJsonDeTexto, UMBRAL} from './verificador.mjs';
import {cargarConfig, ErrorDeConfig} from '../config/cargar.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(aqui, '..');

const SIN_COLOR = process.argv.includes('--sin-color') || !process.stdout.isTTY;
const c = (codigo, t) => (SIN_COLOR ? t : `\u001b[${codigo}m${t}\u001b[0m`);

function arg(flag, porDefecto = null) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

function uso() {
  console.error([
    'uso: node puerta/ruta.mjs [--reporte <vulnerabilities.json>]',
    '                         [--config <entidad.json>]',
    '                         [--baseline <linea-base.json>]',
    '                         [--umbral critical|high|medium|low|info]',
    '                         [--guardar <cadena.json>] [--sin-color]',
    '',
    'Sin --reporte ni --config, la puerta usa la fuente de seguridad configurada',
    '—el archivo, el entorno o el ejemplo del paquete, en ese orden— y declara',
    'de dónde salió.',
  ].join('\n'));
}

/**
 * `--reporte` y `--strix` son el mismo valor con dos nombres: el primero es el
 * que la puerta ha usado siempre, el segundo es el que el esquema de
 * configuración reconoce. Se traduce antes de cargar para que la precedencia
 * (argumento > entorno > archivo > defecto) se resuelva en un solo lugar y no
 * en dos, que es como un día de estos queda con dos reglas que no se hablan.
 */
function normalizarArgv(argv) {
  const salida = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--reporte' && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      salida.push('--strix', argv[i + 1]);
      i += 1;
      continue;
    }
    salida.push(argv[i]);
  }
  return salida;
}

let config = null;
try {
  config = cargarConfig({argv: normalizarArgv(process.argv.slice(2)), env: process.env, base: BASE});
} catch (e) {
  if (e instanceof ErrorDeConfig) {
    console.error(`\n  ${e.message}\n`);
    process.exit(1);
  }
  throw e;
}

const fuenteSeguridad = config.fuentes.seguridad;

const umbral = String(arg('--umbral', 'high')).toLowerCase();
if (!(umbral in UMBRAL)) {
  console.error(`umbral desconocido: ${umbral} (usa ${Object.keys(UMBRAL).join(', ')})`);
  process.exit(1);
}

const rutaReporte = fuenteSeguridad.ruta;
if (!rutaReporte) { uso(); process.exit(1); }

/**
 * Lee un JSON de disco. La tolerancia al BOM vive en `leerJsonDeTexto`, que sí
 * tiene pruebas; acá solo se junta con la lectura del archivo.
 */
function leerJson(ruta) {
  return leerJsonDeTexto(readFileSync(ruta, 'utf8'));
}

let hallazgos;
try {
  hallazgos = leerJson(resolve(rutaReporte));
} catch (e) {
  // Un reporte que no se puede leer no es "cero hallazgos". Tratarlo como
  // limpio sería la forma más fácil de tener una puerta verde sin haber
  // auditado nada.
  console.error(c(31, `No se pudo leer el reporte: ${e.message}`));
  process.exit(1);
}

let lineaBase = {};
const rutaBase = arg('--baseline');
if (rutaBase) {
  let crudo;
  try {
    crudo = leerJson(resolve(rutaBase));
  } catch (e) {
    console.error(c(31, `No se pudo leer la línea base: ${e.message}`));
    process.exit(1);
  }
  // Se aceptan las dos formas: el sobre que escribe `--guardar` y un sidecar
  // pelado. Ver `normalizarLineaBase` para por qué esto importa tanto.
  try {
    lineaBase = normalizarLineaBase(crudo);
  } catch (e) {
    console.error(c(31, `Línea base inválida: ${e.message}`));
    process.exit(1);
  }
}

let t;
try {
  t = traducir(hallazgos);
} catch (e) {
  console.error(c(31, `El reporte no se pudo traducir a la cadena: ${e.message}`));
  process.exit(1);
}

const v = verificarHallazgos({cadena: t.cadena, sidecar: t.sidecar, lineaBase, umbral});

// `--guardar` manda; si no se pasa, se cae a la cadena de probanza que la
// configuración declare, si declara alguna.
const salida = arg('--guardar') || config.fuentes.probanza.ruta;
if (salida) {
  // La cadena va con el sidecar al lado, no adentro. El sidecar es detalle
  // humano; la cadena es la afirmación verificable.
  writeFileSync(resolve(salida), JSON.stringify({
    v: 'cadena_hallazgos.v1',
    politica: `umbral:${umbral}`,
    eventos: t.cadena.eventos,
    huella_del_conjunto: t.resumen.huella_del_conjunto,
    sidecar: t.sidecar,
  }, null, 2), 'utf8');
  console.log(`cadena guardada en ${salida}`);
}

const L = [];
L.push('');
L.push('  HEFESTO PROBANZA · puerta de seguridad');
L.push(`  entidad  ${config.entidad.nombre}${config.entidad.dominio ? ` · ${config.entidad.dominio}` : ''}`);
L.push(`  reporte  ${rutaReporte}`);
L.push(`           ${fuenteSeguridad.estado} · ${fuenteSeguridad.de}`);
if (fuenteSeguridad.origen) {
  // `origen` puede ser el deducido de la ruta o el declarado en el archivo.
  // Solo cuando los dos coinciden el declarado manda, así que el paréntesis
  // dice de cuál de los dos es el que se está mostrando.
  const deducido = Boolean(fuenteSeguridad.contradice) || !fuenteSeguridad.origen_declarado;
  L.push(`           origen: ${fuenteSeguridad.origen} (${deducido ? 'deducido de la ruta' : 'declarado en la configuración'})`);
}
if (fuenteSeguridad.contradice) {
  L.push(c(33, `           La configuración lo declara «${fuenteSeguridad.origen_declarado}», pero el archivo`));
  L.push(c(33, `           está dentro del paquete. Manda el archivo, no la etiqueta.`));
}
if (config.strix.objetivo) {
  L.push(`  objetivo ${config.strix.objetivo}  [${config.strix._de_objetivo}]`);
}
L.push('');
L.push(`  Cadena    ${v.integridad.ok ? c(32, `íntegra (${t.cadena.eventos.length} ${t.cadena.eventos.length === 1 ? 'hallazgo' : 'hallazgos'})`) : c(31, `ROTA: ${v.integridad.motivo}`)}`);
L.push(`  Umbral    ${umbral} (bloquea desde nivel ${UMBRAL[umbral]})`);
L.push('');

const conteo = t.resumen.por_nivel;
for (const nivel of [5, 4, 3, 2, 1]) {
  if (!conteo[nivel]) continue;
  const color = nivel >= 4 ? 31 : nivel === 3 ? 33 : 32;
  L.push(`  ${String(conteo[nivel]).padStart(3)}  ${NOMBRE_NIVEL[nivel]}`);
}
L.push('');
L.push(`  ${v.resumen.nuevos} nuevo(s)   ·   ${v.resumen.persistentes} ya abierto(s)   ·   ${v.resumen.cerrados} cerrado(s)`);
L.push('');

if (v.choques.length) {
  L.push(c(33, '  Sitios con más de un hallazgo (la clave por sitio no los separa):'));
  for (const ch of v.choques) {
    L.push(`    ${ch.motivo}`);
    for (const t of ch.titulos) L.push(`      · ${t}`);
  }
  L.push('');
}

if (v.comercial.length) {
  L.push('  Bloqueantes:');
  for (const b of v.comercial) {
    L.push(`    [${String(b.nivel)}] ${b.titulo ?? '(sin título)'}`);
    L.push(`         ${b.motivo}`);
    if (b.cwe) L.push(`         ${b.cwe}${b.objetivo ? ` · ${b.objetivo}` : ''}`);
    L.push(`         huella ${b.huella.slice(0, 16)}…`);
  }
  L.push('');
}

if (v.pasa) {
  L.push(c(32, `  PASA. Nada abierto por encima de "${umbral}".`));
} else {
  L.push(c(31, `  NO PASA. ${v.resumen.bloqueantes} hallazgo(s) bloqueante(s).`));
  if (v.resumen.gravedad_desconocida > 0) {
    L.push(c(33, `  ${v.resumen.gravedad_desconocida} con gravedad no reconocida: cuenta, por definición.`));
  }
  if (!v.integridad.ok) L.push(c(31, `  Y además la cadena está rota: ${v.integridad.motivo}`));
}
L.push('');

process.stdout.write(L.join('\n'));
process.exit(v.pasa ? 0 : 1);