# hefesto-probanza

**El eje de evidencia.** Une los consentimientos de ARCOP con las salidas del
anonimizador y responde, envío por envío, si había autorización detrás.

> Un panel de cumplimiento que muestra datos de personas de verdad es
> exactamente lo que este ecosistema existe para evitar. El escenario que viene
> incluido es íntegramente inventado.

---

## El problema

Hoy existen dos sistemas que guardan la mitad de la verdad cada uno:

- **ARCOP** sabe qué autorizó un vecino: para qué, cuándo y hasta cuándo.
- **El anonimizador** sabe qué salió hacia el proveedor: qué datos se taparon,
  de qué tipo y con qué consentimiento declarado.

Pero nadie junta las dos cosas. Y la pregunta que aparece en cualquier
auditoría —*"¿este envío estaba cubierto por un consentimiento vigente?"*— no
tiene respuesta, porque nadie tiene las dos mitades en el mismo lugar.

Peor: la respuesta no es solo difícil, es **carísima de recuperar después**.
Para poder armarla más adelante hay que volver a instrumentar los tres sistemas
con la llave de unión. Por eso este proyecto se diseñó desde el primer día
para que esa llave exista, aunque las otras dos piezas vinieran después.

## Qué hace

```
  ARCOP                 HEFESTO-PROBANZA                    Proveedor
┌──────────┐          ┌────────────────────┐              ┌───────────┐
│consentim.│─────────▶│  cadena de eventos │─────────────▶│  modelo   │
│  su estado│  id      │  + recibos firmados│  texto tapado │  externo  │
│(acciones) │─────────▶│  + verificador     │◀─────────────│           │
└──────────┘  estado   └────────────────────┘  respuesta   └───────────┘
                            │                                       ▲
                            └── panel de cadena de conformidad ──────┘
```

1. **Canoniza y encadena** cada evento. El hash de uno depende del anterior:
   editar cualquiera obliga a recalcular todo lo que viene después.
2. **Emite un recibo firmado** de cada salida, que prueba *qué vio el modelo*
   sin guardar el texto.
3. **Verifica cobertura** contra el registro de ARCOP y devuelve uno de cuatro
   veredictos, cada uno con su motivo.
4. **Ancla la cadena afuera**, que es lo único que detecta una reescritura
   total — la cadena sola solo detecta ediciones.
5. **Exige consentimiento para enviar**: `SalidaAuditada` no deja salir nada
   sin la llave de unión.

## Arrancar

Sin dependencias. Requiere Node 20 o superior.

```bash
npm test          # la suite completa
npm run informe   # el informe completo, en la terminal
npm start         # el panel, en http://127.0.0.1:8788/
```

### Para qué entidad

**No hay ninguna entidad escrita en el código.** A qué apunta el sistema se
decide en la configuración, y todo lo demás —dominio, rutas de los informes,
objetivo de la sonda, fecha del escenario, puerto— sale de ahí.

```bash
npm start -- --config mi-entidad.json        # una entidad concreta
npm run mesa -- --config mi-entidad.json     # la mesa por terminal
npm start -- --config config/entidad.ejemplo.json   # otra entidad, de ejemplo
```

Precedencia: **argumento > variable de entorno > archivo > valor por defecto**, y
el panel muestra de dónde salió cada valor.

Sin configurar nada arranca con los ejemplos del paquete, y **lo dice**: el
origen de cada fuente aparece arriba, y si un archivo está dentro de
`fixtures/` se muestra como ejemplo aunque la configuración lo declare de otro
modo. Un dato que no se declara no es dato, es decoración.

Una ruta configurada que no existe **detiene el sistema**. No vuelve al ejemplo
del paquete: eso sería mostrarle a alguien el informe de otra entidad.

Todo en [`config/README.md`](config/README.md), con el ejemplo completo.

```
  HEFESTO PROBANZA · cadena de conformidad

  Cadena      íntegra  (7 eventos)
  Anclaje     verificado
  Externo     la cabeza publicada sigue en la cadena

    7 envíos   3 cubiertos   1 vencido   1 revocado   2 sin cobertura   (43% cubierto)

  SEQ  TS                PROPÓSITO     VEREDICTO     MOTIVO
  ───────────────────────────────────────────────────────────────────────────
  2    2026-05-04 10:00  prospeccion   SIN COBERT.   el consentimiento ampara
                                                      "atencion" y el envío
                                                      dice "prospeccion"
  6    2026-05-10 10:00  atencion      REVOCADO      revocado desde
                                                      2026-05-05T12:00:00.000Z
```

El 43% no es un tablero en rojo para asustar: es el escenario con los cuatro
defectos sembrados a propósito. Un tablero todo verde no demuestra que el
verificador sirva.

## Los cuatro veredictos

No hay un porcentaje que diluya el problema. Hay cuatro respuestas y cada "no"
lleva el motivo, porque un verificador mudo obliga al auditor a repetir el
trabajo.

| Veredicto | Qué significa |
|---|---|
| `cubierto` | existía consentimiento, del mismo sujeto, vigente para ese propósito en ese momento |
| `sin_cobertura` | no había consentimiento, o el cited no existe en el registro, o ampara otro propósito |
| `vencido` | el consentimiento cubría, pero su fecha ya había pasado |
| `revocado` | el vecino retiró el consentimiento y el envío salió igual |

`vetado` es un quinto resultado, pero no es un veredicto de cobertura: es la
categoría sensible cortando antes de salir, y no llega a generar recibo ni
evento de envío.

**El estado de un consentimiento se deriva de `consent_actions`**, igual que en
ARCOP. No hay columna de estado. Un consentido sin columna de estado no puede
mentir: no hay nada que quede desactualizado.

## El contrato de evento

La forma canónica se decide aquí y **no se puede cambiar después**, porque el
hash tiene que dar el mismo resultado en JavaScript, en Python y en el motor de
quien verifique dentro de diez años.

```js
{
  v: "evento.v1",
  seq: 6,                                  // entero >= 0
  ts: "2026-05-10T10:00:00.000Z",          // ISO-8601 UTC, terminado en Z
  sistema: "anonimizador",                 // anonimizador | arcop | gen_auditor
  tipo: "salida.procesada",
  proposito: "atencion",                   // obligatorio: sin él no hay cobertura
  consentimiento: "c-revocable",           // LA llave de unión
  sujeto_ref: "a3f1…",                     // HMAC de 64 hex, nunca el titular
  previo: "1470b95e…",                     // hash del evento anterior, o null
  hash: "9c2d…",
  datos: { tipos: ["rut", "email"], cantidad: 2 }
}
```

Reglas que no son negociables:

- **Hash**: `sha256(previo || "\0" || canónico(evento sin su campo hash))`.
  El separador no puede aparecer en ninguno de los dos operandos, así que la
  concatenación es inequívoca.
- **Canonización**: JSON con claves ordenadas, sin espacios, UTF-8.
- **Sin decimales.** `0.1` no tiene una única representación entre lenguajes.
  Un decimal es señal de evento mal formado, y conviene que se note acá y no en
  una auditoría.
- **`datos` nunca lleva valores.** Solo conteos y listas de identificadores en
  minúsculas (`/^[a-z0-9_]{1,32}$/`). Es la misma línea que sostiene todo el
  ecosistema: la auditoría registra qué pasó, nunca el contenido.

## El recibo

El manifiesto firmado y la firma son **objetos separados**:

```js
{ manifiesto: {...}, kid: "ed25519:2026-a", alg: "ed25519", firma: "base64..." }
```

Para que un tercero verifique sin que esta implementación tenga que reconstruir
qué campos iba a tener la firma. Si el sobre fuera un solo objeto, toda
recomposición sería un lugar donde la verificación puede mentir.

**El texto entra solo como hash.** Cuando alguien dice *"al modelo nunca le llegó
su RUT"*, el recibo lo demuestra; cuando alguien quiere reconstruir qué dijo el
vecino, no puede. Esa asimetría es deliberada: un recibo termina en expedientes
con más permisos que el dato que protege.

### Esto no es una firma electrónica acreditada

Es Ed25519 sobre un manifiesto. Prueba, criptográficamente, que el manifiesto no
cambió desde que se emitió. **No** prueba quién es el emisor ante un tercero ni
cumple la Ley 19.800. Para eso hace falta certificado y prestador de servicios de
confianza. Ver [`docs/LIMITES.md`](docs/LIMITES.md).

## Cómo se comprueba una protección

Una protección que no se puede ver fallar no es una protección. Los tests
marcados `GUARDA` **reproducen el defecto a propósito** y confirman que se
comportan mal; si al borrar la guarda el test sigue verde, la guarda no
protegía nada.

```bash
# Debilita una guarda a propósito, confirma que la suite se pone roja,
# y deja el archivo exactamente como estaba.
node tools/comprobar-guarda.mjs nucleo/recibo.mjs "<texto bueno>" "<texto flojo>"
```

```
guarda DEBILITADA  →  ℹ pass 56  ℹ fail 1
archivo restaurado
guarda RESTAURADA  →  ℹ pass 57  ℹ fail 0
```

Durante el desarrollo, esto encontró — entre otros — que `validarEvento` tenía
la salida temprana invertida, así que **toda la validación era un no-op** salvo
el chequeo de tipo.

## El núcleo vendorizado

`vendor/hefesto-anonimizador/core/` es una **copia byte a byte** del núcleo real
del anonimizador, con los hashes sellados en `vendor/hefesto-anonimizador/manifest.json`.

No es un doble de prueba: es el mismo código que corre en producción. Existe por
un fallo concreto. El import cruzaba al repositorio vecino:

```js
import {Anonimizador} from '../../hefesto-anonimizador/core/anonimizador.mjs';
```

Eso funciona dentro del workspace y **sólo** dentro del workspace. El paquete se
comprimía, se entregaba, y al descomprimirlo en otra máquina `npm test` moría con
`ERR_MODULE_NOT_FOUND`. Un paquete de evidencia que no arranca al abrirlo no
demuestra nada, y eso no se había notado porque la prueba de humo siempre corría
sobre la copia de trabajo.

Ahora el ZIP se descomprime en limpio, se corre `npm test` y da verde. Un test
comprueba además que ningún import salga de la carpeta del paquete.

Si cambia el anonimizador:

```bash
node tools/vendorizar.mjs   # copia y vuelve a sellar
```

Mientras el repositorio vecino esté presente, un test compara los dos hashes y
falla si la copia quedó atrás. En una instalación suelta ese test se salta y sólo
queda el manifiesto, que es justo para lo que sirve.

## La puerta de seguridad

Strix es un agente de pentest ([Apache-2.0](https://github.com/usestrix/strix),
29 categorías incluyendo `llm_prompt_injection`, `agentic_system_security` y
`semantic_confusion`). Vive **fuera** de esta biblioteca, como una herramienta
propia con su ciclo de vida, su presupuesto y su llave. Lo que hay aquí es lo
que Strix no trae.

```bash
strix -t http://127.0.0.1:8788 -m standard --fail-on high
node puerta/ruta.mjs --reporte strix_runs/mi-corrida/vulnerabilities.json
```

Cada hallazgo entra a la cadena de probanza como un evento más. El evento lleva
la **huella**, la clase y la gravedad. Nunca el título, ni la descripción, ni el
PoC, ni el endpoint. El detalle vive en un sidecar aparte, indexado por la
huella, y se puede perder sin que la cadena mienta sobre lo que vio.

### El problema que resuelve

Los escáneres se leen una vez y después se archivan. La segunda corrida dice "0
nuevos" y todo el mundo entiende que no hay nada que hacer, aunque siga abierto
un crítico del mes pasado. **Acá es al revés:**

- Un hallazgo **nuevo** por encima del umbral bloquea, con su motivo.
- Un hallazgo **que sigue abierto** también bloquea, y además se reporta aparte.
- Un hallazgo **que se arregló** aparece como cerrado, no como nuevo.
- Un hallazgo con **gravedad no reconocida** bloquea. Un gate que se deja pasar
  lo que no entendió no es un gate.

```bash
node puerta/ruta.mjs --reporte strix_runs/mi-corrida/vulnerabilities.json \
                     --baseline linea-base.json --umbral high
```

Códigos de salida, iguales a los de `strix --fail-on` para poder encadenar las
dos en un mismo paso: `0` la puerta pasa, `1` hay bloqueantes o la cadena está
rota, y también `1` si el reporte no se pudo leer — porque un reporte ilegible
no es "cero hallazgos".

### La puerta también lee la configuración

El reporte se resuelve con la misma precedencia del resto del sistema:
`--reporte` > `$env:HEFESTO_STRIX` > `fuentes.seguridad.ruta` del archivo de
entidad > el ejemplo del paquete.

```bash
node puerta/ruta.mjs --config config/entidad.ejemplo.json
```

`--reporte` es alias de `--strix`: son el mismo valor con dos nombres, y se
traduce antes de cargar para que la precedencia se resuelva en un solo lugar.

Y la puerta **declara** en pantalla de dónde salió el reporte, con la entidad
activa al lado:

```
  entidad  Consultora Ejemplo SpA · ejemplo.cl
  reporte  …\mesa\fixtures\entidad-ejemplo\reporte-seguridad.json
           cargada · archivo config/entidad.ejemplo.json
           origen: fixture del paquete (deducido de la ruta)
           La configuración lo declara «corrida real sobre app.ejemplo.cl», pero el archivo
           está dentro del paquete. Manda el archivo, no la etiqueta.
```

Sin `--reporte` ni `--config` carga el ejemplo del paquete y lo dice. Una fuente
que no se pidió y aparece sin avisar es un informe de otra entidad.

### Sobre borrar hallazgos

Sacar el crítico del reporte y recalcular todos los hashes deja una cadena
perfectamente coherente consigo misma. Por eso la puerta también se ancla:
el anclaje detecta la amputación aunque la cadena cuadre.

### Correr la puerta de punta a punta

Strix necesita Docker en el PATH y un modelo. En Windows:

```powershell
# 1. Docker (una sola vez, si no está en el PATH de tu shell)
$env:PATH += ";C:\Program Files\Docker\Docker\resources\bin"

# 2. El modelo. NO pongas la llave en el repositorio ni en este archivo:
#    la pones en tu sesión, y de ahí Strix la lee.
$env:STRIX_LLM    = "anthropic/MiniMax-M2.7"
$env:LLM_API_BASE = "https://api.minimax.io/anthropic"
$env:LLM_API_KEY  = "<tu-api-key>"

# 3. La corrida.
strix -t http://127.0.0.1:8788 -m standard --max-turns 60 --fail-on high

# 4. La puerta sobre lo que dejó
node puerta/ruta.mjs --reporte strix_runs/<tu-corrida>/vulnerabilities.json
```

#### La ruta con MiniMax es `anthropic/`, no `minimax/`

**Strix no tiene proveedor `minimax`.** Cero coincidencias en el paquete
instalado. Hay que entrar por una de las dos rutas compatibles que MiniMax
publica:

| `STRIX_LLM` | `LLM_API_BASE` |
|---|---|
| `anthropic/MiniMax-M2.7` | `https://api.minimax.io/anthropic` |
| `openai/MiniMax-M2.7` | `https://api.minimax.io/v1` |

La primera es la que MiniMax recomienda y la que está verificada acá. La segunda
es el plan B si la primera no responde.

Modelos que aceptan estas rutas: `MiniMax-M3`, `MiniMax-M2.7`, `MiniMax-M2.5`.
`MiniMax-M3.1-Flash-Preview` está restringido a M Plan y MiniMax Code, así que
normalmente no responde con una API key común.

#### `--max-budget` NO frena nada con MiniMax

LiteLLM no conoce el precio de estos modelos, así que el contador queda en `cost=-`
y el tope **nunca se evalúa**:

```
strix.report.usage: LiteLLM cost estimate unavailable for model anthropic/MiniMax-M2.7
```

Poner `--max-budget 5` da la impresión de un tope y no lo es. **El freno real
son los turnos**: `--max-turns`. Un 60 por agente es razonable; con 20, una
corrida real se corta a mitad de camino.

#### Bugs de Strix en Windows que no son culpa del modelo

- `WorkspaceArchiveWriteError: failed to write archive for path: \workspace\.tool-output`.
  El sandbox no logra volcar la salida de las herramientas al workspace
  montado, y el agente muere. No tiene arreglo desde acá.
- Si escaneás una app local, el objetivo desde el contenedor es
  `http://host.docker.internal:<puerto>`, no `127.0.0.1`: dentro del contenedor,
  `localhost` es el propio contenedor.

Si prefieres una suscripción en vez de una API key, Strix trae su propio login
(`strix auth login chatgpt`) y no necesita nada de esto.

## La mesa de evidencia

Tres herramientas que miran tres cosas distintas y que no se hablan:

| Fuente | Pregunta | Se lee de |
|---|---|---|
| **probanza** | ¿este envío salía con consentimiento vigente? | la cadena de eventos |
| **seguridad** | ¿este sistema tiene esta vulnerabilidad? | `vulnerabilities.json` de Strix |
| **conformidad** | ¿este procedimiento del manual se está cumpliendo? | `informe-auditoria.json` de spaudit |

```bash
npm run mesa -- --spaudit salida/informe-auditoria.json \
                 --strix strix_runs/corrida/vulnerabilities.json
```

Hay **dos informes reales** en `mesa/fixtures/`, y no son intercambiables:

- `spaudit-informe-real.json` — el del colegio, sin evidencia de equipos.
  Es el que usa el panel. 144 sin verificar, 3 `NO_CUMPLE` de comprobaciones en
  vivo.
- `spaudit-con-evidencia.json` — 147 controles con evidencia recolectada por el
  script de PowerShell sobre un equipo Windows cualquiera. 5 controles
  evaluados. **Su dominio dice `saintpatricktemuco.cl` porque el dominio viene
  del manual, no de la evidencia**: es el mismo pie de foto con datos de otra
  máquina, y por eso está separado y con el nombre que dice qué es.

El segundo existe porque es el único informe que trae controles `CUMPLE` y
`PARCIAL`, y un lector que nunca se prueba contra eso se rompe el día que
aparece.

Cada fuente va en **su propia cadena**. Lo que se cruza no son los hechos sino
el **área**: una sonda que encuentra cabeceras de seguridad ausentes y un manual
que dice "implementar sistemas de seguridad" sin concretarlo se están apuntando
a lo mismo, y eso es información que ninguna de las dos produce sola.

```
conformidad   147 revisados · 3 abiertos · 144 sin verificar
seguridad     5 revisados · 5 abiertos
probanza      7 revisados · 4 abiertos

  cobertura hoy 2%  ->  6% si se corre lo que ya está escrito
  6 control(es) con verificador escrito que nadie ejecutó
  2 contradicciones: el manual lo declara y la sonda lo confirma
```

### Lo que la mesa dice y lo que no

- **Corroborado** es la palabra más fuerte del informe, y aun así no es
  "confirmado": la correspondencia es por familia de CWE, no una demostración.
- Un hallazgo de seguridad que nadie corrobora **no es buena noticia**, es una
  pregunta abierta.
- Una **contradicción** —el manual declara `CUMPLE` y una sonda independiente
  encuentra un problema en la misma área— es la señal más fuerte que puede
  aparecer acá.
- `2% → 6%` es la cobertura real del informe de ejemplo. El 94% restante no es
  un fallo del análisis: es falta de evidencia, y eso es otra cosa.

### El mapa de correspondencias es un archivo de datos

`mesa/correspondencias.mjs` dice qué área del manual puede corroborar qué CWE.
Está en un archivo aparte, y a propósito: si la regla estuviera en el código,
nadie la revisaría. Hay **tres estados y no uno**:

- **con mapa**: la sonda puede llegar a comprobarlo;
- **no sondeable**: existe, pero nadie lo comprueba desde afuera (una puerta, un
  documento, una conversación);
- **desconocida**: la tabla quedó vieja. Si esta lista no está vacía, hay una
  prueba que falla.

## Estructura

```
nucleo/        contrato, cadena, recibo, verificador, anclaje
  canonica.mjs        forma canónica y hash
  cadena.mjs          cadena append-only
  recibo.mjs          manifiesto + firma Ed25519
  verificador.mjs     los cuatro veredictos
  ancla.mjs           anclaje externo
  salida-auditada.mjs la costura con el anonimizador
  index.mjs           superficie pública
mesa/          las tres fuentes juntas
  fuentes.mjs         normaliza spaudit, Strix y probanza
  correspondencias.mjs qué área del manual cruza con qué CWE (datos)
  cruce.mjs           zonas, contradicciones, cobertura movible
  historia.mjs        nuevo / sigue abierto / cerrado
  mesa.mjs            encadena cada fuente en la suya
  ruta.mjs            la CLI
  fixtures/           dos informes REALES de spaudit, 147 controles cada uno
puerta/        la puerta de seguridad (traduce el reporte de Strix)
  traductor.mjs       hallazgos → eventos encadenados
  verificador.mjs     qué está abierto, qué es nuevo, qué se cerró
  ruta.mjs            la CLI, con los códigos de salida de Strix
  fixtures/           reporte de ejemplo, íntegramente inventado
config/         a qué entidad apunta el sistema, y de dónde sale cada valor
demo/          escenario de demostración, todo inventado
server/        API y estáticos del panel
panel/         la vista, sin build step
cli/           el informe en terminal
tests/         101 pruebas: invariantes (27), cobertura (17), integración (13),
               puerta (23), mesa (18), higiene (3)
tools/         probador de la suite, comprobador de guardas, medidor de
               cobertura y vendorizador (desarrollo)
vendor/        copia sellada del núcleo de hefesto-anonimizador
docs/          arquitectura y límites
```

`npm test` no tiene una lista de archivos escrita a mano: descubre
`tests/*.test.mjs` y corre todo lo que encuentre. Una lista fija es una promesa
que nadie verifica, y ya dio verde dos veces sin haber corrido los archivos
nuevos.

> El fixture de `puerta/fixtures/` se construyó **leyendo la fuente de Strix
> 1.7.0 instalada en la máquina**, no de memoria ni de la documentación. Esa
> diferencia salió cara: el primer fixture usaba timestamps ISO y listas donde
> Strix escribe otra cosa, y los tests pasaban sobre un dato que Strix nunca
> emite. Ver [`docs/LIMITES.md`](docs/LIMITES.md).

## Cómo se integra

```js
import {
  Cadena, SalidaAuditada, ProveedorAuditado,
  generarParDeLLAves, firmarRecibo, registrarLlave, verificarTodo, anclar,
} from 'hefesto-probanza';

const {privada, publica} = generarParDeLLAves('ed25519:2026-a');
registrarLlave('ed25519:2026-a', publica);   // la pública sí se publica

const cadena = Cadena.nueva();
const salida = new SalidaAuditada({
  cadena,
  firmar: (manifiesto) => firmarRecibo(manifiesto, privada, 'ed25519:2026-a'),
  proposito: 'atencion',
});

const proveedor = new ProveedorAuditado(llamarAlModelo, salida);
await proveedor.preguntar(mensajeDelVecino, {consentimiento: 'c-123'});
```

Sin consentimiento, no hay salida. La llamada al proveedor no ocurre.

## Documentación

- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — las piezas y las decisiones que
  detrás no son obvias.
- [`docs/LIMITES.md`](docs/LIMITES.md) — lo que **no** prueba, y lo que no está
  hecho. Léelo antes de usarlo para algo.

## Estado

101/101 pruebas. Panel verificado en navegador. La puerta de seguridad probada
contra la CLI real y contra la fuente instalada de Strix 1.7.0. La mesa probada
contra un **informe real de spaudit** de 147 controles.

El escenario de probanza es íntegramente inventado. El informe de conformidad
del fixture es una corrida real sobre una organización real, y así lo dice el
pie del panel. Lo que **no** está verificado está declarado en
[`docs/LIMITES.md`](docs/LIMITES.md), no escondido.