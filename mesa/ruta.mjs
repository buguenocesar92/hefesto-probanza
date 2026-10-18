// La mesa de evidencia, desde la terminal.
//
// Junta las tres fuentes —consentimientos, seguridad y conformidad— y responde
// lo que ninguna puede responder sola: qué está abierto, desde cuándo, y qué
// se está confirmando desde dos métodos independientes.
//
//   node mesa/ruta.mjs --spaudit salida/informe-auditoria.json \
//                       --strix strix_runs/corrida/vulnerabilities.json \
//                       --guardar linea-base.json
//
// Códigos de salida:
//
//   0  la mesa pasa
//   1  hay hallazgos de nivel alto o crítico, una cadena rota, o contradicciones
//   2  no se pasó ninguna fuente externa, así que no hay nada que cruzar
//
// Lo que NO hace es correr Strix ni spaudit. Son herramientas con su propio
// ciclo de vida y su propia evidencia; esta las lee.

import {writeFileSync, readFileSync, existsSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

import {desdeConformidad, desdeSeguridad, desdeProbanza} from './fuentes.mjs';
import {cruzar, zonasOscuras} from './cruce.mjs';
import {historiar, lineaBaseDe} from './historia.mjs';
import {encadenar, verificarTodo, huellaDe} from './mesa.mjs';
import {anclar, publicadorDePrueba} from '../nucleo/ancla.mjs';
import {leerJsonDeTexto} from '../puerta/verificador.mjs';
import {construirEscenario} from '../demo/escenario.mjs';
import {cargarConfig, ErrorDeConfig, escenarioDemo, mapaDe, resumenDe} from '../config/cargar.mjs';

const aqui = dirname(fileURLToPath(import.meta.url));
const BASE = resolve(aqui, '..');

const SIN_COLOR = process.argv.includes('--sin-color') || !process.stdout.isTTY;
const pintar = (codigo, t) => (SIN_COLOR ? t : `\u001b[${codigo}m${t}\u001b[0m`);

function arg(flag, porDefecto = null) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : porDefecto;
}

function abandonar(mensaje) {
  console.error(pintar(31, mensaje));
  process.exit(1);
}

// ── Carga ───────────────────────────────────────────────────────────────────
//
// Las rutas salen de `config/cargar.mjs`, que resuelve por precedencia
// (argumento > entorno > archivo > defecto). Esta función ya no tiene rutas
// escritas: si no se configura nada, usa los ejemplos del paquete y lo dice,
// porque una fuente que no se pidió y se cargó igual es una fuente que el que
// lee no sabe de dónde salió.
let config = null;
try {
  config = cargarConfig({argv: process.argv.slice(2), env: process.env, base: BASE});
} catch (e) {
  if (e instanceof ErrorDeConfig) {
    console.error(`\n  ${e.message}\n`);
    process.exit(1);
  }
  throw e;
}

const fuentes = {};

for (const [nombre, f] of Object.entries(config.fuentes)) {
  if (nombre === 'probanza') continue; // la de abajo, con el escenario
  if (!f.presente) continue;
  const lector = nombre === 'conformidad' ? desdeConformidad : desdeSeguridad;
  try {
    fuentes[nombre] = lector(f.ruta);
  } catch (e) {
    abandonar(`No se pudo leer ${f.etiqueta} (${f.ruta}): ${e.message}`);
  }
}

const escenario = construirEscenario(escenarioDemo(config));
fuentes.probanza = desdeProbanza({
  cadena: escenario.cadena,
  consents: escenario.consents,
  acciones: escenario.acciones,
});

if (Object.keys(fuentes).length < 2) {
  console.error('Hace falta al menos una fuente externa: --spaudit, --strix o un archivo de configuración.');
  console.error('Sin ellas la mesa solo refleja el escenario de demostración.');
  process.exit(2);
}

// ── Línea base ──────────────────────────────────────────────────────────────
let lineaBase = {};
const rutaBase = arg('--baseline');
if (rutaBase) {
  if (!existsSync(rutaBase)) abandonar(`No existe la línea base: ${rutaBase}`);
  let crudo;
  try {
    crudo = leerJsonDeTexto(readFileSync(rutaBase, 'utf8'));
  } catch (e) {
    abandonar(`No se pudo leer la línea base: ${e.message}`);
  }
  // Se acepta el sobre completo o el mapa pelado, por la misma razón que en la
  // puerta: leer mal la forma no da error, da una línea base vacía.
  lineaBase = crudo?.linea_base ?? crudo ?? {};
}

// ── Cruce ───────────────────────────────────────────────────────────────────
const cruce = cruzar({
  conformidad: fuentes.conformidad?.items ?? [],
  seguridad: fuentes.seguridad?.items ?? [],
  sinVerificar: fuentes.conformidad?.sinVerificar ?? [],
  cumplidos: fuentes.conformidad?.cumplidos ?? [],
  mapa: mapaDe(config),
});

// ── Encadenar e historiar ───────────────────────────────────────────────────
const todos = [
  ...fuentes.probanza.items,
  ...(fuentes.conformidad?.items ?? []),
  ...(fuentes.seguridad?.items ?? []),
];

const {cadenas, errores} = encadenar(todos);
const integridad = verificarTodo(cadenas);
const corrida = historiar({ahora: todos, lineaBase});

// ── Salida ──────────────────────────────────────────────────────────────────
const L = [];
L.push('');
L.push('  HEFESTO PROBANZA · mesa de evidencia');
// La entidad y de dónde salió cada ruta, antes que cualquier cifra. Una mesa
// que muestra cobertura sin decir contra qué la midió no sirve para que nadie
// la discuta.
L.push(`  entidad: ${config.entidad.nombre}${config.entidad.dominio ? ` · ${config.entidad.dominio}` : ''}`);
for (const [nombre, f] of Object.entries(config.fuentes)) {
  if (nombre === 'probanza' || !f.presente) continue;
  L.push(`    ${nombre}: ${f.origen} · ${f.ruta}`);
}
if (fuentes.conformidad) {
  L.push(`  conformidad: ${fuentes.conformidad.dominio ?? '?'} · generado ${fuentes.conformidad.generacion ?? '?'}`);
}
L.push('');

for (const [nombre, fuente] of Object.entries(fuentes)) {
  const t = fuente.totales;
  const partes = [`${t.controles} revisados`, `${t.hallazgos} abiertos`];
  if (t.sin_verificar) partes.push(`${t.sin_verificar} sin verificar`);
  L.push(`  ${nombre.padEnd(13)} ${partes.join(' · ')}`);
}
L.push('');

L.push('  CADENAS');
for (const [nombre, r] of Object.entries(integridad.porFuente)) {
  L.push(`    ${nombre.padEnd(13)} ${r.ok ? pintar(32, `íntegra (${r.total} eventos)`) : pintar(31, `ROTA: ${r.motivo}`)}`);
}
if (errores.length) {
  L.push(pintar(31, `    ${errores.length} hallazgo(s) NO se pudieron encadenar:`));
  for (const e of errores.slice(0, 5)) L.push(pintar(31, `      ${e.id}: ${e.motivo}`));
}
L.push('');

if (fuentes.conformidad && fuentes.seguridad) {
  const R = cruce.resumen;
  L.push('  CRUCE entre el manual y la sonda');
  L.push(`    cobertura hoy ${R.cobertura_actual_pct}%  ->  ${R.cobertura_con_sondas_pct}% si se corre lo que ya está escrito`);
  L.push(`    ${R.controles_resolubles_por_sonda} control(es) con verificador escrito que nadie ejecutó`);
  L.push(`    ${R.areas_alcanzadas} área(s) alcanzadas · ${R.fuera_de_alcance} hallazgo(s) fuera del catálogo`);

  for (const x of cruce.contradicciones) {
    L.push(pintar(31, `    CONTRADICCIÓN ${x.control}: ${x.motivo}`));
  }
  if (R.categorias_desconocidas.length) {
    L.push(pintar(33, `    La tabla de correspondencias no conoce: ${R.categorias_desconocidas.join(', ')}`));
  }
  const oscuras = zonasOscuras(cruce);
  if (oscuras.length) {
    L.push(pintar(33, `    Accionables de una (${oscuras.length}): ${oscuras.slice(0, 10).map((z) => z.id).join(', ')}`));
  }
  L.push('');
}

L.push(`  ABIERTO  ${corrida.resumen.total} · ${corrida.resumen.nuevos} nuevo(s) · ${corrida.resumen.persistentes} ya visto(s)`);
for (const f of corrida.filas.slice(0, 20)) {
  L.push(`    [${f.nivel}] ${f.clave.padEnd(30)} ${(f.titulo ?? '').slice(0, 58)}`);
  L.push(`         ${(f.motivo ?? '').slice(0, 96)}`);
}
if (corrida.filas.length > 20) L.push(`    … y ${corrida.filas.length - 20} más`);
L.push('');

const rutaGuardar = arg('--guardar');
if (rutaGuardar) {
  const publica = publicadorDePrueba();
  const anclajes = {};
  for (const [nombre, cadena] of Object.entries(cadenas)) anclajes[nombre] = anclar(cadena, publica);
  writeFileSync(resolve(rutaGuardar), JSON.stringify({
    v: 'mesa.v1',
    generado: new Date().toISOString(),
    huella: huellaDe(cadenas),
    linea_base: lineaBaseDe(corrida),
    cadenas: Object.fromEntries(Object.entries(cadenas).map(([k, v]) => [k, v.eventos])),
    anclajes,
    detalle: todos,
  }, null, 2), 'utf8');
  L.push(pintar(32, `  Guardado en ${rutaGuardar}`));
  L.push('');
}

const bloqueantes = corrida.filas.filter((f) => f.nivel >= 4);
const falla = bloqueantes.length > 0 || !integridad.ok || cruce.resumen.contradicciones > 0;

if (falla) {
  const razones = [];
  if (bloqueantes.length) razones.push(`${bloqueantes.length} hallazgo(s) de nivel alto o crítico`);
  if (!integridad.ok) razones.push('cadena rota');
  if (cruce.resumen.contradicciones) razones.push(`${cruce.resumen.contradicciones} contradicción(es)`);
  L.push(pintar(31, `  NO PASA. ${razones.join(', ')}.`));
} else {
  L.push(pintar(32, '  PASA.'));
}
L.push('');

process.stdout.write(L.join('\n'));
process.exit(falla ? 1 : 0);