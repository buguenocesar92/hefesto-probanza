// ─────────────────────────────────────────────────────────────────────────────
// Configuración. Un solo lugar decide a qué entidad apunta el sistema.
//
// El problema que resuelve: con las rutas escritas en el código, el panel
// servía SIEMPRE el informe del colegio, porque `resolve(aqui, '..', 'mesa',
// 'fixtures', ...)` no es un parámetro, es una constante con forma de ruta.
// Cambiar de entidad exigía editar el servidor.
//
// REGLA que gobierna todo este archivo:
//
//   Un valor que VINO CONFIGURADO y no existe  -> error fuerte, se para.
//   Un valor que VINO POR DEFECTO y no existe  -> la fuente se omite y se DECLARA.
//
// La diferencia es la que separa "apunté mal" de "no hay nada". Un sistema que
// ante un error de configuración se cae de vuelta al fixture del paquete está
// mintiendo con toda naturalidad: muestra un informe real de una entidad
// mientras el usuario cree que está viendo el suyo. Es el mismo fallo que ya
// se corrigió una vez en la línea base de la puerta (`--guardar` escribía el
// sobre y `--baseline` lo leía como sidecar, dando una línea base vacía sin
// error). No se repite aquí.
//
// La procedencia de cada valor viaja con el valor. El panel la muestra, para que
// nadie tenga que adivinar si lo que ve es lo que pidió.
// ─────────────────────────────────────────────────────────────────────────────

import {existsSync, readFileSync} from 'node:fs';
import {dirname, isAbsolute, resolve} from 'node:path';
import {construirMapa} from '../mesa/correspondencias.mjs';

export const PRECEDENCIA = Object.freeze(['argumento', 'entorno', 'archivo', 'defecto']);

const ENV = Object.freeze({
  entidad: 'HEFESTO_ENTIDAD',
  nombre: 'HEFESTO_NOMBRE',
  dominio: 'HEFESTO_DOMINIO',
  spaudit: 'HEFESTO_SPAUDIT',
  strix: 'HEFESTO_STRIX',
  probanza: 'HEFESTO_PROBANZA',
  puerto: 'HEFESTO_PUERTO',
  host: 'HEFESTO_HOST',
  objetivo: 'HEFESTO_OBJETIVO_STRIX',
  desde: 'HEFESTO_DESDE',
  tenant: 'HEFESTO_TENANT',
  sal: 'HEFESTO_SAL',
});

const ARG = Object.freeze({
  entidad: '--config',
  nombre: '--nombre',
  dominio: '--dominio',
  spaudit: '--spaudit',
  strix: '--strix',
  probanza: '--probanza',
  puerto: '--puerto',
  host: '--host',
  objetivo: '--objetivo',
  desde: '--desde',
  tenant: '--tenant',
});

/** Los valores por defecto. Son rutas dentro del paquete, no de una entidad:
 *  apuntan a ejemplos que viajan con el código, y `deduccionDe` lo declara solo.
 *  Que estén aquí no los convierte en datos reales: cambia la etiqueta, no el
 *  hecho. */
export const DEFECTOS = Object.freeze({
  nombre: 'entidad sin nombre',
  dominio: null,
  puerto: 8788,
  // Escucha sólo en local por defecto: el panel muestra expedientes y no
  // debería salir a la red de la máquina sin que alguien lo pida a propósito.
  host: '127.0.0.1',
  objetivo: null,
  desde: null,
  tenant: null,
  // La sal no tiene defecto: sin ella el escenario usa la de demostración, que
  // está escrita en el código y por lo tanto es pública. Para una entidad real
  // tiene que venir del entorno, no de un archivo que se versiona.
  sal: null,
  spaudit: 'mesa/fixtures/spaudit-informe-real.json',
  strix: 'puerta/fixtures/vulnerabilidades-strix.json',
  probanza: null,
});

/** Error de configuración. Se distingue del resto para que la CLI la trate
 *  distinto: no es un fallo del código, es una instrucción mal dada. */
export class ErrorDeConfig extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.name = 'ErrorDeConfig';
    this.esConfig = true;
  }
}

// ── lectura de capas ─────────────────────────────────────────────────────────

function argumentos(argv) {
  const salida = {};
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (typeof t !== 'string' || !t.startsWith('--')) continue;
    const eq = t.indexOf('=');
    if (eq > -1) {
      salida[t.slice(2, eq)] = t.slice(eq + 1);
      continue;
    }
    const siguiente = argv[i + 1];
    if (siguiente && !siguiente.startsWith('--')) {
      salida[t.slice(2)] = siguiente;
      i += 1;
    } else {
      salida[t.slice(2)] = true;
    }
  }
  return salida;
}

function leerArchivo(ruta) {
  let crudo;
  try {
    crudo = readFileSync(ruta, 'utf8');
  } catch (e) {
    throw new ErrorDeConfig(
      `No se pudo leer la configuración "${ruta}": ${e.message}`
    );
  }
  // El BOM es, con diferencia, la razón más común de que un JSON no parsee en
  // Windows, y `JSON.parse` lo reporta como un token misterioso en vez de
  // decir qué pasa. `Set-Content -Encoding UTF8` en PowerShell 5.1 y el Bloc de
  // notas lo ponen sin avisar.
  if (crudo.charCodeAt(0) === 0xFEFF) {
    throw new ErrorDeConfig(
      `La configuración "${ruta}" empieza con un BOM (byte EF BB BF).\n` +
      '  Es la causa habitual de esto en Windows: `Set-Content -Encoding UTF8` en\n' +
      '  PowerShell 5.1 y el Bloc de notas lo agregan. Se quita guardando en UTF-8\n' +
      '  sin BOM, que es lo que espera este archivo.'
    );
  }
  try {
    const d = JSON.parse(crudo);
    if (d === null || typeof d !== 'object' || Array.isArray(d)) {
      throw new Error('la raíz no es un objeto');
    }
    return d;
  } catch (e) {
    throw new ErrorDeConfig(
      `La configuración "${ruta}" no es JSON válido: ${e.message}. ` +
      'Un archivo de configuración que no se lee no se ignora en silencio: ' +
      'se dice, porque si se ignorara el panel mostraría el fixture del paquete ' +
      'como si fuera el informe de la entidad que se quiso configurar.'
    );
  }
}

/** El archivo por defecto se busca en dos sitios, y el segundo es el que hace
 *  que el paquete sea portable: uno al lado del código, otro en el directorio
 *  de trabajo. Si está en los dos, gana el del directorio de trabajo. */
export function buscarConfigPorDefecto(base) {
  const candidatos = [
    resolve(base, 'config', 'entidad.json'),
    resolve(process.cwd(), 'hefesto.entidad.json'),
  ];
  for (const c of candidatos) if (existsSync(c)) return c;
  return null;
}

// ── construcción ─────────────────────────────────────────────────────────────

function entero(valor, donde) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0 || n > 65535) {
    throw new ErrorDeConfig(`"${donde}" debe ser un puerto entre 0 y 65535; llegó: ${valor}`);
  }
  return n;
}

/**
 * Deduce el origen de un archivo por dónde está, no por lo que la
 * configuración diga de él.
 *
 * Un informe guardado en `mesa/fixtures/` es un ejemplo del paquete, se llame
 * como se llame. Esto no es desconfianza del que configura: es que el panel
 * muestra "informe real" al lado de una cifra y esa cifra tiene que ser
 * defendible. Un auditor que pregunte "¿esto es una corrida o un ejemplo?" tiene
 * derecho a una respuesta que no dependa de una etiqueta.
 */
function deduccionDe(ruta, base) {
  if (!base) return null;
  const dentro = resolve(base);
  const normal = ruta.split('\\').join('/');
  const raiz = dentro.split('\\').join('/');
  if (!normal.startsWith(raiz)) return null;
  const resto = normal.slice(raiz.length);
  if (resto.includes('/fixtures/')) return 'fixture del paquete';
  return null;
}

/**
 * @param {object} opciones
 * @param {string[]} opciones.argv   argumentos de la línea de comandos
 * @param {object} opciones.env     variables de entorno
 * @param {string} opciones.base     raíz del paquete
 * @returns {object} configuración con la procedencia de cada valor
 */
export function cargarConfig({argv = [], env = {}, base} = {}) {
  const args = argumentos(argv);

  const rutaConfig = args.config || args.entidad || env[ENV.entidad] || buscarConfigPorDefecto(base);

  let archivo = {};
  let archivoDe = null;
  if (rutaConfig) {
    if (!existsSync(rutaConfig)) {
      // Pedir un archivo que no existe es un error. Si el archivo se buscó solo
      // y no estaba, no hay nada que reportar: es el estado normal.
      const pedido = args.config || args.entidad || env[ENV.entidad];
      if (pedido) {
        throw new ErrorDeConfig(`No existe el archivo de configuración "${rutaConfig}".`);
      }
    } else {
      // Primero se lee, después se revisa. Al revés se revisa un objeto vacío
      // y la revisión pasa siempre: la protección existe pero no protege nada,
      // que es la forma más difícil de detectar de un fallo de orden.
      archivo = leerArchivo(rutaConfig);
      revisarEsquema(archivo, rutaConfig);
      archivoDe = rutaConfig;
    }
  }

  /** Resuelve un valor por precedencia y devuelve {valor, de}. */
  function resolver(clave, archivoValor = undefined) {
    const deArgs = args[ARG[clave]?.slice(2)];
    if (deArgs !== undefined && deArgs !== true) {
      return {valor: deArgs, de: `argumento ${ARG[clave]}`};
    }
    if (env[ENV[clave]] !== undefined && env[ENV[clave]] !== '') {
      return {valor: env[ENV[clave]], de: `entorno ${ENV[clave]}`};
    }
    if (archivoValor !== undefined) return {valor: archivoValor, de: `archivo ${archivoDe}`};
    return {valor: DEFECTOS[clave], de: 'defecto'};
  }

  const ent = archivo.entidad ?? {};
  const fue = archivo.fuentes ?? {};
  const srv = archivo.servidor ?? {};
  const esc = archivo.escenario ?? {};
  const mapaArchivo = archivo.mapa ?? {};

  const nombre = resolver('nombre', ent.nombre);
  const dominio = resolver('dominio', ent.dominio);
  const puerto = resolver('puerto', srv.puerto);
  const host = resolver('host', srv.host);
  const objetivo = resolver('objetivo', srv.objetivo_strix ?? srv.objetivo);
  const desde = resolver('desde', esc.desde ?? esc.reloj);
  const tenant = resolver('tenant', esc.tenant);
  const sal = resolver('sal', esc.sal);

  const spaudit = resolver('spaudit', fue.conformidad?.ruta);
  const strix = resolver('strix', fue.seguridad?.ruta);
  const probanza = resolver('probanza', fue.probanza?.ruta);

  const raizArchivo = raizDeResolucion(archivoDe, base);

  return {
    entidad: {
      nombre: nombre.valor,
      dominio: dominio.valor,
      _de_nombre: nombre.de,
      _de_dominio: dominio.de,
    },
    servidor: {
      puerto: puerto.valor === 'defecto' ? DEFECTOS.puerto : entero(puerto.valor, 'servidor.puerto'),
      host: host.valor === 'defecto' ? DEFECTOS.host : String(host.valor),
      _de_puerto: puerto.de,
      _de_host: host.de,
    },
    strix: {
      objetivo: objetivo.valor === 'defecto' ? null : objetivo.valor,
      _de_objetivo: objetivo.de,
    },
    escenario: {
      desde: desde.valor === 'defecto' ? null : desde.valor,
      tenant: tenant.valor === 'defecto' ? null : tenant.valor,
      sal: sal.valor === 'defecto' ? null : sal.valor,
      _de_desde: desde.de,
      _de_tenant: tenant.de,
      _de_sal: sal.de,
    },
    fuentes: {
      conformidad: fuente(spaudit, fue.conformidad, 'informe de spaudit', base, raizArchivo),
      seguridad: fuente(strix, fue.seguridad, 'reporte de Strix', base, raizArchivo),
      probanza: fuente(probanza, fue.probanza, 'cadena de probanza', base, raizArchivo),
    },
    // El mapa de la entidad vive aparte del resto porque lo consume la mesa, no
    // el servidor: son las correspondencias entre el manual de la entidad y las
    // familias de CWE que puede sondear.
    mapa: {
      familias: mapaArchivo.familias ?? {},
      no_sondeables: mapaArchivo.no_sondeables ?? {},
      _de: archivoDe ? `archivo ${archivoDe}` : 'defecto',
      _categorias_propias: Object.keys(mapaArchivo.familias ?? {}).length
        + Object.keys(mapaArchivo.no_sondeables ?? {}).length,
    },
    config: {
      ruta: archivoDe,
      solicitada: rutaConfig,
      _de: archivoDe ? 'archivo' : (rutaConfig ? 'buscada, no encontrada' : 'sin archivo'),
    },
  };
}

/**
 * Contra qué se resuelven las rutas relativas.
 *
 * Antes se usaba `process.cwd()`, y eso hace que el mismo archivo de
 * configuración funcione en un directorio y no en otro: el panel servía los
 * datos correctos corriendo desde la raíz del paquete y se caía de vuelta al
 * defecto desde `C:\`. Un archivo de configuración que depende de dónde lo
 * abriste no es configuración.
 *
 * Ahora la base depende de DÓNDE vino cada ruta, no de dónde se está parado:
 *   · del archivo de configuración, dentro del paquete → el paquete
 *   · del archivo de configuración, fuera del paquete → la carpeta de al lado
 *   · de un argumento o una variable de entorno → el directorio de trabajo
 *   · del valor por defecto → el paquete, porque sus rutas son del paquete
 *
 * Un archivo de configuración que depende del directorio desde donde lo
 * abriste no es configuración: el panel servía los datos correctos corriendo
 * desde la raíz del paquete y se caía de vuelta al defecto desde `C:\`.
 */
function raizDeResolucion(archivoDe, base) {
  if (!archivoDe) return null;
  const dentro = resolve(base ?? '');
  const abs = resolve(archivoDe);
  return abs.startsWith(dentro) ? dentro : dirname(abs);
}

/**
 * Decide qué hacer con una fuente.
 *
 * Configurada y ausente -> se para. Eso es casi siempre una errata en la
 * configuración, y seguir sin ella convertiría "apunté mal" en "no hay nada",
 * que es justo el fallo que este archivo existe para impedir.
 */
function fuente(resuelto, delArchivo, etiqueta, base, raizArchivo) {
  const bruto = resuelto.valor;
  const deDefecto = resuelto.de === 'defecto';

  if (bruto === undefined || bruto === null || bruto === '' || bruto === true) {
    return {ruta: null, presente: false, estado: 'sin configurar', de: resuelto.de, etiqueta};
  }

  // Cada ruta se resuelve contra la base que corresponde a dónde salió, no
  // contra una sola global.
  const raiz = resuelto.de.startsWith('archivo')
    ? (raizArchivo ?? process.cwd())
    : (deDefecto ? (base ?? process.cwd()) : process.cwd());

  const ruta = isAbsolute(bruto) ? bruto : resolve(raiz, bruto);

  if (existsSync(ruta)) {
    const declarado = delArchivo?.origen ?? null;
    const deducido = deduccionDe(ruta, base);
    return {
      ruta,
      presente: true,
      estado: 'cargada',
      de: resuelto.de,
      etiqueta,
      // El código no confía en la etiqueta. Si el archivo cae dentro de
      // `fixtures/`, es un ejemplo del paquete aunque la configuración diga que
      // es una corrida real, y se dice así. Una etiqueta que el sistema no
      // puede verificar es una etiqueta que el usuario se está creyendo.
      origen: deducido ?? declarado ?? 'sin declarar',
      origen_declarado: declarado,
      contradice: Boolean(declarado && deducido && declarado !== deducido),
      nota: delArchivo?.nota ?? null,
    };
  }

  if (deDefecto) {
    return {ruta: null, presente: false, estado: 'no encontrada', de: resuelto.de, etiqueta, pedida: ruta};
  }

  throw new ErrorDeConfig(
    `La fuente «${etiqueta}» está configurada en "${ruta}" (vía ${resuelto.de}) pero ese archivo no existe.\n` +
    '  No se sigue con la fuente siguiente ni se vuelve a un valor por defecto: un informe que se\n' +
    '  rellena solo es un informe de otra entidad.'
  );
}

/**
 * Los argumentos del escenario, ya resueltos.
 *
 * Se devuelven sólo los que tienen valor: pasar `undefined` no es lo mismo que
 * no pasar nada cuando el destino tiene un valor por defecto, y esta función
 * existe para que esa diferencia no dependa de que quien llama lo recuerde.
 */
export function escenarioDemo(config) {
  const salida = {};
  if (config.escenario.desde) salida.desde = config.escenario.desde;
  if (config.escenario.tenant) salida.tenant = config.escenario.tenant;
  if (config.escenario.sal) salida.sal = config.escenario.sal;
  return salida;
}

/**
 * Las claves que se aceptan, por sección.
 *
 * POR QUÉ EXISTE. Sin esto, escribir `"dominio": "x.cl"` en vez de
 * `"entidad": {"dominio": "x.cl"}` no da ningún error: la clave desconocida se
 * ignora, el dominio queda en valor por defecto y el panel arranca mostrando la
 * entidad sin nombre. Es el peor modo de fallo posible en un archivo de
 * configuración —silencioso y con aspecto de que todo funcionó— y es
 * exactamente el que este proyecto lleva combatiendo en todas partes.
 *
 * `_nota` está permitida en cualquier sección: es para que el archivo se
 * explique solo.
 */
export const CLAVES = Object.freeze({
  entidad: ['nombre', 'dominio'],
  servidor: ['puerto', 'host', 'objetivo_strix', 'objetivo'],
  escenario: ['desde', 'reloj', 'tenant', 'sal'],
  mapa: ['familias', 'no_sondeables'],
  fuentes: {
    conformidad: ['ruta', 'origen', 'nota'],
    seguridad: ['ruta', 'origen', 'nota'],
    probanza: ['ruta', 'origen', 'nota'],
  },
});

/** La más parecida por letras comunes, para sugerir en el mensaje de error. */
function sugerencia(clave, validas) {
  const normalizar = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const objetivo = normalizar(clave);
  let mejor = null;
  let mejorPuntaje = 0;
  for (const v of validas) {
    const n = normalizar(v);
    let comunes = 0;
    for (let i = 0; i < Math.min(n.length, objetivo.length); i += 1) {
      if (n[i] === objetivo[i]) comunes += 1;
      else break;
    }
    const puntaje = comunes / Math.max(n.length, objetivo.length);
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = v; }
  }
  return mejorPuntaje >= 0.6 ? mejor : null;
}

function revisarClaves(objeto, validas, donde) {
  if (objeto === null || objeto === undefined) return;
  if (typeof objeto !== 'object' || Array.isArray(objeto)) {
    throw new ErrorDeConfig(`"${donde}" tiene que ser un objeto con claves como ${validas.join(', ')}.`);
  }
  for (const clave of Object.keys(objeto)) {
    if (clave === '_nota' || validas.includes(clave)) continue;
    const sugerir = sugerencia(clave, validas);
    throw new ErrorDeConfig(
      `"${clave}" no es una clave de ${donde}.\n` +
      `  Se aceptan: ${validas.join(', ')}.` +
      (sugerir ? `\n  ¿Quisiste decir "${sugerir}"?` : '') +
      '\n  No se ignora: una clave mal escrita deja el valor en su defecto sin avisar,\n' +
      '  y el panel arrancaría mostrando datos que no son los que se pidieron.'
    );
  }
}

/** Revisa el archivo entero contra el esquema, antes de usar nada de él. */
function revisarEsquema(archivo, donde) {
  const secciones = Object.keys(CLAVES);
  for (const clave of Object.keys(archivo)) {
    if (clave === '_nota' || !secciones.includes(clave)) {
      revisarClaves({[clave]: null}, secciones, 'la raíz');
      continue;
    }
    // `fuentes` es un objeto de subsecciones; el resto son listas de claves.
    // Comprobar con `typeof === 'string'` en vez de con `Array.isArray` hace que
    // `Object.keys(['nombre','dominio'])` devuelva ['0','1'] y el mensaje de
    // error ofrezca "se aceptan: 0, 1".
    const validas = CLAVES[clave];
    if (Array.isArray(validas)) {
      revisarClaves(archivo[clave], validas, clave);
      continue;
    }
    revisarClaves(archivo[clave], Object.keys(validas), clave);
    for (const [fuente, suyas] of Object.entries(archivo[clave] ?? {})) {
      revisarClaves(suyas, validas[fuente] ?? [], `${clave}.${fuente}`);
    }
  }
  return donde;
}

/**
 * El mapa de correspondencias que la mesa debe usar.
 *
 * Se construye acá y no en el consumidor para que haya un solo lugar donde se
 * fusionan las del paquete con las de la entidad. Si cada quien armara el suyo,
 * uno se olvidaría del paquete y el otro no.
 */
export function mapaDe(config) {
  return construirMapa({
    familias: config.mapa.familias,
    noSondeables: config.mapa.no_sondeables,
  });
}

/** Una línea por fuente, para la CLI y para el panel. */
export function resumenDe(config) {
  const lineas = [
    `entidad   ${config.entidad.nombre}${config.entidad.dominio ? ` · ${config.entidad.dominio}` : ''}  (${config.entidad._de_nombre})`,
    `config    ${config.config.ruta ?? 'ninguno'}`,
  ];
  for (const [nombre, f] of Object.entries(config.fuentes)) {
    lineas.push(`${nombre.padEnd(11)} ${f.estado.padEnd(16)} ${f.ruta ?? '—'}  [${f.de}]`);
  }
  return lineas.join('\n');
}