// El informe, en una terminal.
//
// El panel es la vista; esto es la misma información para cuando se necesita
// pegarla en un ticket, guardarla en un archivo o correrla en un pipeline sin
// navegador. Deliberadamente no es un modo "resumen": trae las filas, que es
// donde está el trabajo. Un número agregado sirve para motivation; no sirve para
// responder "¿cuál de estos envíos no tenía autorización?".

import {construirEscenario} from '../demo/escenario.mjs';
import {verificarTodo} from '../nucleo/verificador.mjs';
import {verificarRecibo} from '../nucleo/recibo.mjs';
import {comprobarAnclaje} from '../nucleo/ancla.mjs';
import {cargarConfig, ErrorDeConfig, escenarioDemo} from '../config/cargar.mjs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const ETIQUETA = {
  cubierto: 'CUBIERTO    ',
  revocado: 'REVOCADO    ',
  vencido: 'VENCIDO     ',
  sin_cobertura: 'SIN COBERT.',
};

const SIN_COLOR = process.argv.includes('--sin-color') || !process.stdout.isTTY;
const color = (codigo, t) => (SIN_COLOR ? t : `\u001b[${codigo}m${t}\u001b[0m`);

function linea(t) { console.log(t); }

/** Uma columna con ancho fijo; los valores se cortan, no se rompen. */
function columna(texto, ancho) {
  const t = String(texto);
  return t.length > ancho ? t.slice(0, Math.max(0, ancho - 1)) + '…' : t.padEnd(ancho);
}

/** "1 revocados" se lee mal; el informe va a terminar pegado en un ticket. */
function plural(n, singular, plural_) {
  return `${n} ${n === 1 ? singular : plural_}`;
}

/**
 * El informe, en texto.
 *
 * @param {object|null} config  configuración de la entidad. Sin ella corre el
 *   escenario tal como está, con su fecha y su tenant por defecto; con ella,
 *   el escenario se mueve entero a lo que la entidad pidió. Es el mismo
 *   contrato que usa el servidor, y por diseño: dos informes del mismo sistema
 *   que se mueven con reglas distintas son dos sistemas.
 */
export function informeTexto(config = null) {
  const e = construirEscenario(config ? escenarioDemo(config) : {});
  const i = verificarTodo(e.cadena, {consents: e.consents, acciones: e.acciones});
  const pasos = new Map(e.pasos.map((p) => [p.ts, p]));

  const s = [];
  s.push('');
  s.push('  HEFESTO PROBANZA · cadena de conformidad');
  if (config) {
    s.push(`  entidad  ${config.entidad.nombre}${config.entidad.dominio ? ` · ${config.entidad.dominio}` : ''}  [${config.entidad._de_nombre}]`);
    if (config.escenario.desde) s.push(`  reloj    ${config.escenario.desde}  [${config.escenario._de_desde}]`);
  }
  s.push('  escenario íntegramente inventado · sin conexiones reales');
  s.push('');

  // ── Integridad ────────────────────────────────────────────────────────────
  s.push(`  Cadena      ${i.integridad.ok ? color(32, 'íntegra') : color(31, `ROTA EN ${i.integridad.posicion}: ${i.integridad.motivo}`)}  (${e.cadena.eventos.length} eventos)`);
  s.push(`  Anclaje     ${i.anclaje.ok ? color(32, 'verificado') : color(31, i.anclaje.motivo)}`);
  const ext = comprobarAnclaje(e.cadena, e.anclaje);
  s.push(`  Externo     ${ext.ok ? color(32, 'la cabeza publicada sigue en la cadena') : color(31, `no coincide: ${ext.motivo}`)}`);
  s.push('');

  // ── Conteo ────────────────────────────────────────────────────────────────
  const c = i.conteo;
  s.push(`  ${String(c.total).padStart(3)} envíos   ` +
    `${color(32, plural(c.cubierto, 'cubierto', 'cubiertos'))}   ` +
    `${color(33, plural(c.vencido, 'vencido', 'vencidos'))}   ` +
    `${color(31, plural(c.revocado, 'revocado', 'revocados'))}   ` +
    `${color(31, plural(c.sin_cobertura, 'sin cobertura', 'sin cobertura'))}   ` +
    `(${c.pct_cubierto}% cubierto)`);
  s.push('');

  // ── Filas ─────────────────────────────────────────────────────────────────
  s.push('  ' + 'SEQ'.padEnd(5) + 'TS'.padEnd(18) + 'PROPÓSITO'.padEnd(14) + 'VEREDICTO'.padEnd(14) + 'MOTIVO');
  s.push('  ' + '─'.repeat(96));
  for (const f of i.filas) {
    const v = f.veredicto;
    const colorV = v === 'cubierto' ? 32 : v === 'sin_cobertura' ? 31 : 33;
    const paso = pasos.get(f.evento.ts);
    s.push('  ' + columna(String(f.seq), 5) +
      columna(f.evento.ts.replace('T', ' ').slice(0, 16), 18) +
      columna(f.evento.proposito, 14) +
      columna(color(colorV, ETIQUETA[v] || v), 14 + (SIN_COLOR ? 0 : 9)) +
      f.motivo +
      (paso ? '' : '  [sin escenario asociado]'));
  }
  s.push('');

  // ── Recibos ───────────────────────────────────────────────────────────────
  const recibos = e.recibos.map((r) => ({id: r.manifiesto.id.slice(0, 8), v: verificarRecibo(r)}));
  const buenos = recibos.filter((r) => r.v.ok).length;
  s.push(`  Recibos     ${buenos}/${recibos.length} con firma válida  (llave ${e.kid})`);
  for (const r of recibos) {
    if (!r.v.ok) s.push(`              ${color(31, `${r.id}  ${r.v.motivo}`)}`);
  }
  s.push('');

  const accionables = i.accionable.length;
  s.push(accionables === 0
    ? color(32, '  Sin envíos accionables.')
    : color(31, `  ${plural(accionables, 'envío accionable', 'envíos accionables')}: revocados, vencidos o sin cobertura.`));
  s.push('');

  return s.join('\n');
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` ||
    process.argv[1]?.endsWith('informe.mjs')) {
  // La última CLI que quedaba fuera de la configuración. Se carga acá y no en
  // el cuerpo de la función para que importar el módulo no lea disco: el
  // servidor lo importa y trae su propia configuración.
  const raiz = resolve(fileURLToPath(import.meta.url), '../..');
  try {
    const config = cargarConfig({argv: process.argv.slice(2), env: process.env, base: raiz});
    process.stdout.write(informeTexto(config) + '\n');
  } catch (e) {
    if (e instanceof ErrorDeConfig) {
      process.stderr.write(`\n  ${e.message}\n\n`);
      process.exit(1);
    }
    throw e;
  }
}