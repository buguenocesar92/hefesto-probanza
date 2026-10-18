// Servidor del panel. node:http y nada más.
//
// La vista completa es el producto: los números solos no sirven para auditar,
// lo que sirve son las filas. Por eso `/api/informe` devuelve el detalle entero
// y el resumen, y el panel muestra el detalle.

import {createServer} from 'node:http';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {resolve, sep, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {construirEscenario} from '../demo/escenario.mjs';
import {verificarTodo} from '../nucleo/verificador.mjs';
import {verificarRecibo} from '../nucleo/recibo.mjs';
import {comprobarAnclaje} from '../nucleo/ancla.mjs';
import {desdeConformidad, desdeSeguridad, desdeProbanza} from '../mesa/fuentes.mjs';
import {cruzar, zonasOscuras} from '../mesa/cruce.mjs';
import {historiar} from '../mesa/historia.mjs';
import {encadenar, verificarTodo as verificarTodoMesa} from '../mesa/mesa.mjs';
import {cargarConfig, ErrorDeConfig, escenarioDemo, mapaDe, resumenDe} from '../config/cargar.mjs';

const aqui = dirname(import.meta.url);
function dirname(url) { return resolve(fileURLToPath(url), '..'); }
const BASE = resolve(aqui, '..');

// ── Configuración ────────────────────────────────────────────────────────────
//
// Se carga una vez, al arrancar, y si está mal el proceso no levanta. Un panel
// que parte con una ruta que no existe y después se cae al fixture del paquete
// está mostrando el informe de otra entidad sin decirlo, y eso es peor que no
// arrancar.
let config = null;
try {
  config = cargarConfig({argv: process.argv.slice(2), env: process.env, base: BASE});
} catch (e) {
  if (e instanceof ErrorDeConfig) {
    process.stderr.write(`\n  Configuración inválida.\n\n  ${e.message}\n\n`);
    process.exit(1);
  }
  throw e;
}

const TIPOS = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8'};

function responder(res, codigo, cuerpo) {
  res.writeHead(codigo, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(cuerpo));
}

/** El informe completo. No hay modo "resumen": el detalle es el producto. */
/**
 * La mesa: los tres orígenes juntos.
 *
 * Las dos fuentes externas salen de la configuración. Cada una puede faltar, y
 * cuando falta la mesa se construye con lo que hay y el panel lo dice; lo que
 * no hace es rellenarla con el fixture del paquete sin decirlo.
 */
function mesaCompleta() {
  const e = construirEscenario(escenarioDemo(config));
  const probanza = desdeProbanza({
    cadena: e.cadena, consents: e.consents, acciones: e.acciones,
  });

  const conf = leerFuente('conformidad', desdeConformidad);
  const seg = leerFuente('seguridad', desdeSeguridad);

  const conformidad = conf.datos ?? desdeConformidadVacio();
  const seguridad = seg.datos ?? desdeSeguridadVacia();

  const cruce = cruzar({
    conformidad: conformidad.items,
    seguridad: seguridad.items,
    sinVerificar: conformidad.sinVerificar,
    cumplidos: conformidad.cumplidos,
    mapa: mapaDe(config),
  });

  const todos = [...probanza.items, ...conformidad.items, ...seguridad.items];
  const {cadenas, errores} = encadenar(todos);
  const integridad = verificarTodoMesa(cadenas);
  const corrida = historiar({ahora: todos});

  return {
    // El detalle de los controles sin verificar pesa cientos de KB y el tablero
    // no lo usa: sólo necesita el conteo y los que sí son accionables, que van
    // aparte en `zonas_oscuras`. Mandar todo para que el navegador lo tire es la
    // forma más simple de hacer lento un panel que no tiene por qué serlo.
    //
    // Y se declara el ORIGEN de cada fuente, con la procedencia de la ruta. El
    // origen lo deduce el código por dónde está el archivo, no la etiqueta que
    // escribió quien configuró: si un informe está guardado en `fixtures/`, es
    // un ejemplo del paquete aunque la configuración diga que es una corrida.
    // Sin eso, las contradicciones del panel se leen como corroboración
    // independiente y no lo son.
    config: {
      entidad: config.entidad,
      archivo: config.config.ruta,
      strix_objetivo: config.strix.objetivo,
      desde: config.escenario.desde,
      tenant: config.escenario.tenant,
      reloj_de: config.escenario._de_desde,
    },
    fuentes: {
      probanza: {
        ...slim(probanza),
        origen: 'escenario de demostración',
        ruta: null,
        de: 'demostración',
      },
      conformidad: fuenteEnPantalla(slim(conformidad), {
        ...(conformidad.sinVerificar ? {sin_verificar: conformidad.sinVerificar.length} : {}),
        ...describe(conf, 'informe real', 'escenario sin datos externos'),
      }),
      seguridad: fuenteEnPantalla(slim(seguridad),
        describe(seg, 'fixture inventado', 'escenario sin datos externos')),
    },
    cruce,
    abierta: corrida.filas.map((f) => ({
      clave: f.clave, fuente: f.fuente, id: f.id, nivel: f.nivel,
      titulo: f.titulo, motivo: f.motivo, estado: f.estado,
      primero: f.primera_vez, nuevo: !f.visto_antes,
    })),
    cadenas: integridad,
    errores,
    zonas_oscuras: zonasOscuras(cruce),
  };
}

/** Une lo que dice la configuración con lo que se deduce de la ruta. */
function describe(leida, porDefecto, cuandoFalta) {
  const f = leida.config;
  if (!f) return {origen: cuandoFalta, ruta: null, de: 'sin configurar'};
  return {
    origen: f.origen ?? porDefecto,
    origen_declarado: f.origen_declarado ?? null,
    contradice: Boolean(f.contradice),
    nota: f.nota,
    ruta: f.ruta,
    de: f.de,
    etiqueta: f.etiqueta,
  };
}

function fuenteEnPantalla(base, extra) {
  return {...base, ...extra};
}

/** Una fuente vacía tiene la misma forma que una llena. Que no exista no puede
 *  cambiar el contrato de lo que el panel dibuja. */
function desdeConformidadVacio() {
  return {fuente: 'conformidad', generacion: null, dominio: null, items: [], sinVerificar: [], cumplidos: [], totales: {controles: 0, hallazgos: 0, sin_verificar: 0, cumplidos: 0}};
}

function desdeSeguridadVacia() {
  return {fuente: 'seguridad', generacion: null, dominio: null, items: [], totales: {controles: 0, hallazgos: 0}};
}

/** Una fuente sin la lista larga de pendientes. */
function slim(fuente) {
  return {
    fuente: fuente.fuente,
    generacion: fuente.generacion ?? null,
    dominio: fuente.dominio ?? null,
    totales: fuente.totales,
    items: fuente.items,
  };
}

// Las rutas salen de la configuración, no del código. Antes vivían aquí como
// constantes con forma de ruta, y por eso cambiar de entidad exigía editar el
// servidor. Ahora el servidor no sabe qué entidad se está mirando: sólo qué
// rutas le pasaron y de dónde salieron.
function configDeFuente(nombre) {
  return config.fuentes[nombre];
}

/**
 * Lee una fuente externa, o devuelve vacío si no está configurada.
 *
 * Que falte no es un error: se puede correr la mesa con una sola fuente. Lo que
 * no se puede es dejar de avisar, porque "no hay informe" y "estás viendo el
 * informe del paquete" tienen que verse distinto en pantalla.
 */
function leerFuente(nombre, lector) {
  const f = configDeFuente(nombre);
  if (!f || !f.presente) return {vacio: true, config: f ?? null};
  try {
    return {vacio: false, datos: lector(f.ruta), config: f};
  } catch (e) {
    throw new ErrorDeConfig(`No se pudo leer la ${f.etiqueta} en "${f.ruta}": ${e.message}`);
  }
}

function informeCompleto() {
  const e = construirEscenario(escenarioDemo(config));
  const i = verificarTodo(e.cadena, {consents: e.consents, acciones: e.acciones});

  const pasos = new Map(e.pasos.map((p) => [p.ts, p]));
  const recibos = new Map(e.recibos.map((r) => [r.manifiesto.ts, r]));

  const filas = i.filas.map((f) => {
    const paso = pasos.get(f.evento.ts) || null;
    const sobre = recibos.get(f.evento.ts) || null;
    return {
      seq: f.seq,
      ts: f.evento.ts,
      veredicto: f.veredicto,
      motivo: f.motivo,
      consentimiento: f.consentimiento,
      proposito: f.evento.proposito,
      tipos: f.evento.datos.tipos || [],
      texto: paso ? paso.texto : null,
      texto_seguro: paso ? paso.texto_seguro : null,
      recibo: sobre ? {
        id: sobre.manifiesto.id,
        texto_sha256: sobre.manifiesto.texto_sha256,
        caracteres_enviados: sobre.manifiesto.caracteres_enviados,
        caracteres_originales: sobre.manifiesto.caracteres_originales,
        kid: sobre.kid,
        verificacion: verificarRecibo(sobre),
      } : null,
    };
  });

  const vetadas = e.pasos.filter((p) => p.veredicto === 'vetado');

  return {
    conteo: i.conteo,
    integridad: i.integridad,
    anclaje: i.anclaje,
    anclaje_local: e.anclaje,
    comprobacion_externa: comprobarAnclaje(e.cadena, e.anclaje),
    filas,
    accionable: i.accionable.map((f) => f.seq),
    vetadas: vetadas.map((p) => ({ts: p.ts, texto: p.texto, categoria: p.categoria})),
    consents: e.consents.map((c) => ({
      id: c.id, proposito: c.proposito, granted_at: c.granted_at, expires_at: c.expires_at,
      // El sujeto se muestra truncado: es un HMAC, pero no hace falta darlo
      // entero en una pantalla que va a terminar en una presentación.
      sujeto: c.subject_ref.slice(0, 12) + '…',
    })),
    acciones: e.acciones,
    kid: e.kid,
    total_pasos: e.pasos.length,
  };
}

const servidor = createServer((req, res) => {
  const url = new URL(req.url, 'http://local');

  if (url.pathname === '/api/informe') {
    return responder(res, 200, informeCompleto());
  }

  if (url.pathname === '/api/mesa') {
    return responder(res, 200, mesaCompleta());
  }

  if (url.pathname === '/api/recibos') {
    const e = construirEscenario(escenarioDemo(config));
    return responder(res, 200, {
      kid: e.kid,
      recibos: e.recibos.map((r) => ({
        manifiesto: r.manifiesto,
        kid: r.kid,
        alg: r.alg,
        // La firma sí se entrega: para poder verificarla de verdad.
        firma: r.firma,
        verificacion: verificarRecibo(r),
      })),
    });
  }

  if (url.pathname === '/api/rechazar-consentimiento') {
    // Recibe el escenario sin ninguna acción: es la contraprueba de que la
    // retirada es lo que produce el veredicto `revocado` y no algo fijo.
    const e = construirEscenario(escenarioDemo(config));
    const i = verificarTodo(e.cadena, {consents: e.consents, acciones: []});
    return responder(res, 200, {
      conteo: i.conteo,
      accionable: i.accionable.map((f) => ({seq: f.seq, veredicto: f.veredicto, motivo: f.motivo})),
    });
  }

  // Archivos estáticos del panel.
  const ruta = decodeURIComponent(url.pathname) === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const raiz = resolve(aqui, '..', 'panel');
  const destino = resolve(raiz, '.' + ruta);
  if (!destino.startsWith(raiz + sep) || !existsSync(destino) || !statSync(destino).isFile()) {
    res.writeHead(404, {'Content-Type': 'text/plain; charset=utf-8'});
    return res.end('no encontrado');
  }
  res.writeHead(200, {
    'Content-Type': TIPOS[extname(destino)] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(readFileSync(destino));
});

const {puerto, host} = config.servidor;
if (host !== '127.0.0.1' && host !== 'localhost') {
  process.stdout.write(
    `  ATENCIÓN: escuchando en ${host}, no sólo en local. El panel muestra\n` +
    '  expedientes y medio Rollitos HMAC: cualquiera que llegue al puerto lo ve.\n' +
    '  Si fue a propósito, siga. Si no, deje `--host 127.0.0.1`.\n\n'
  );
}

servidor.listen(puerto, host, () => {
  process.stdout.write(
    `hefesto-probanza · panel en http://${host}:${puerto}/\n\n` +
    `${resumenDe(config)}\n\n`
  );
  for (const [nombre, f] of Object.entries(config.fuentes)) {
    if (f.presente && f.contradice) {
      process.stdout.write(
        `  ${nombre}: la configuración lo declara "${f.origen_declarado}" pero el\n` +
        `  archivo está dentro del paquete, así que se muestra como "${f.origen}".\n\n`
      );
    }
  }
  if (Object.values(config.fuentes).some((f) => !f.presente)) {
    process.stdout.write(
      '  Hay fuentes sin configurar. La mesa se arma con las que haya y el\n' +
      '  panel lo dice al lado de cada una; no se rellena con datos de ejemplo.\n\n'
    );
  }
  process.stdout.write('  escenario: datos inventados, sin conexiones reales.\n\n');
});