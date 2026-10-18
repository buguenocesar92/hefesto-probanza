# Límites

Este documento es el que hay que leer antes de usar el sistema para algo. Está
escrito para que un auditor pueda señalar cualquier línea y no tener que
descubrir por su cuenta que era falsa.

La regla del proyecto: **medir sobre suposición**. Todo número va acompañado de
su corpus y de sus límites, y lo que no se verificó se declara acá, no se
esconde.

---

## 1. Lo que NO es

### No es una firma electrónica acreditada

La firma es **Ed25519 sobre un manifiesto**. Eso prueba, criptográficamente, que
el manifiesto no cambió desde que se emitió.

**No prueba:**
- quién es el emisor ante un tercero (no hay identidad ligada a la llave),
- que el emisor estaba autorizado a firmar,
- nada de la Ley 19.800 ni de la Ley 19.627 sobre firma electrónica.

Para cumplir con la normativa chilena hace falta certificado y prestador de
servicios de confianza, que es otra cosa y cuesta plata.

El `kid` identifica la llave para poder rotarla, **no** acredita a nadie.

### No es un pentesting ni una auditoría

Verifica **cobertura de consentimiento sobre salidas registradas**. No busca
vulnerabilidades, no prueba la seguridad de la implementación, no revisa el
código de los otros sistemas.

### No es un sistema de detección de anomalías

Cuatro veredictos y un motivo cada uno. No hay puntaje de riesgo ni patrones de
comportamiento anómalo. Un envío que está `cubierto` puede estar mal usado y el
sistema no lo va a notar, porque cubrirse no es lo mismo que ser legítimo.

### No cumple la Ley 19.628 por sí solo

Tener un registro de evidencia ordenado y verificable es un insumo para
demostrar cumplimiento. El cumplimiento es de la organización, no del software.

### El panel no es un producto de consulta para terceros

Tiene que estar tan controlado en su acceso como cualquier expediente: muestra
motivos, sujetos (en HMAC) y consentimientos.

---

## 2. Lo que NO está verificado

Esto es importante y no hay que suavizarlo.

### Todo corre contra un escenario inventado

El escenario de demostración tiene **datos ficticios**, un reloj simulado y un
publicador de prueba. Ninguna prueba toca:

- **Una base de datos real.** No hay PostgreSQL, ni Supabase, ni Redis.
- **ARCOP real.** El registro de consentimientos del escenario es una estructura
  en memoria con la misma forma que la de ARCOP, no la tabla de ARCOP.
- **Un modelo real.** `ProveedorAuditado` recibe una función. Nunca se llamó a
  OpenAI, Anthropic ni a ningún proveedor.
- **El anonimizador de producción.** La integración importa el núcleo real de
  `hefesto-anonimizador` (no un doble de prueba), pero corre contra una bóveda
  **en memoria**. La bóveda con AES-256-GCM en reposo es la del servicio de
  producción y no se ejercitó desde probanza.

### El paquete PHP no se pudo ejecutar

El paquete `laravel-anonimizacion` **no se ejecutó nunca** en este entorno: no
hay PHP ni Composer disponibles.

La paridad que se declara es **paridad de corpus**, medida replicando los 16
casos del paquete PHP y comparando carácter por carácter. Eso es evidencia de
que el comportamiento coincide en esos casos; no es haber corrido su suite.

### El anclaje externo usa un publicador de prueba

`publicadorDePrueba` escribe en memoria. El código está preparado para un
publicador real (notario, transparencia, un medio externo), pero **no se probó
contra ninguno**. La guarda `head_not_in_chain` está probada contra una
reescritura simulada.

### No hay evaluación de seguridad independiente

Nadie de afuera revisó este código. Las pruebas miden lo que sus autores
decidieron medir.

---

## 3. Los límites del diseño, no del código

### La cadena detecta ediciones, no todo

La cadena detecta que alguien **editó** un evento. Detecta la reescritura total
solo si el anclaje externo está funcionando. Si el anclaje no está
configurado, el sistema lo declara — pero eso es una declaración, no una
protección.

### El HMAC del sujeto depende de la sal

`referenciaDeSujeto(tenant, titular, sal)` produce un HMAC. Si dos instalaciones
comparten sal, los sujetos son correlacionables entre ellas. La sal no está en
el repositorio, por supuesto, pero su rotación **no invalida** las correlations
anteriores: hay que decidirlo explícitamente.

### El "43% cubierto" del escenario no significa nada fuera del escenario

Es un número sobre nueve mensajes inventados, con cuatro defectos sembrados a
propósito. **No es una medición de ningún sistema real.** Si alguien cita esa
cifra fuera de este repositorio, está citando un número sobre datos de mentira.

### El límite de tiempo de la evidencia no está resuelto

Un recibo de hace tres años ¿sigue siendo exigible? ¿Hay un plazo de
conservación? La cadena no tiene una política de retención y **no borra nada
por edad**. Eso es correcto para evidencia legal y probablemente incorrecto para
cumplimiento de datos personales. No está decidido.

### Concurrencia

`Cadena` está pensada para un escritor. `agregar` calcula el hash a partir del
último evento en memoria. **Dos escritores simultáneos sobre la misma cadena en
el mismo proceso** no están resueltos y no hay prueba de que lo esté. La
cadena real va a necesita una base de datos con una restricción de unicidad
sobre `(previo)`.

### Lo que un tercero tiene que rehacer

La canonización son diez líneas en cualquier lenguaje. Aun así, para verificar
una cadena de diez años más tarde **hay que reimplementarla**. Este repositorio
tiene el JavaScript; no tiene el Python ni el Go, y la forma canónica es lo
único que hay que reproducir exactamente.

---

## 5. La puerta de seguridad: qué está verificado y qué no

### Verificado

- Docker Desktop 4.95.0 instalado y el motor responde (ServerVersion 29.8.2).
- Strix 1.7.0 instalado y su CLI responde (`strix --version`).
- La imagen `ghcr.io/usestrix/strix-sandbox:1.3.0` baja y queda lista.
- Strix detecta Docker por PATH y, sin modelo, falla con `STRIX_LLM is not set`
  y **código de salida 1**. El contrato de códigos de salida es el documentado.
- **El formato del reporte, leído de la fuente instalada de Strix 1.7.0**
  (`report/state.py`, `report/writer.py`), no de GitHub ni de memoria:
  - `vulnerabilities.json` es un **array plano** (`json.dumps` de la lista, sin
    envolver).
  - `timestamp` **no es ISO-8601**: es `strftime("%Y-%m-%d %H:%M:%S UTC")`, o
    sea `"2026-10-17 12:00:00 UTC"`, con espacio donde va la `T` y `" UTC"`
    donde va la `Z`, y resolución de segundos.
  - `remediation_steps` es un **string**, no una lista.
  - Solo `id`, `title`, `severity`, `timestamp` y `finding_class` son
    incondicionales; todo lo demás es `if campo:`.
  - `severity` ∈ {`critical`, `high`, `medium`, `low`, `info`}.
- La puerta completa, probada contra un fixture construido con esas formas y
  contra la CLI real (`--guardar`, `--baseline`, exit 1).
- Las guardas comprobadas quitándolas (ver `npm run guarda`).

### Bugs que esto destapó

Escribí el primer fixture leyendo GitHub y los tests pasaron. **Pasaron porque
el fixture estaba mal.** Cuando se leyó la fuente instalada aparecieron tres
cosas que habrían roto la puerta en la primera corrida real:

1. **El timestamp.** El parser caía en `new Date()`, que en V8 acepta el formato
   de Strix por cortesía del motor. No por especificación. Se parsea a mano, con
   validación de rangos: `"2026-13-45 99:99:99 UTC"` tiene la forma exacta y no
   es una fecha.
2. **La línea base.** `--guardar` escribe el sobre completo y `--baseline` lo
   leía como si fuera el sidecar pelado. No daba error: **parecía una línea base
   vacía**, así que la corrida entera salía como "nueva" y la deduplicación
   dejaba de hacer su trabajo sin delatarlo.
3. **El BOM.** Cualquier archivo tocado en Windows lo trae (`Set-Content
   -Encoding UTF8` en PowerShell 5.1, el Bloc de notas) y `JSON.parse` revienta.
4. **El título en la huella.** Este es el importante, porque rompía la función
   principal y **ningún test lo detectaba**: la puerta seguía bloqueando, así
   que todo se veía bien. Cuatro títulos plausibles del mismo bug dan cuatro
   huellas distintas. Resuelto con dos identidades, registro y sitio; ver
   `docs/ARQUITECTURA.md` §15.

### Lo que no te puedo prometer sobre la deduplicación

Que sea infalible, porque **Strix es no determinista** y la clave por sitio tiene
una fusión conocida: dos hallazgos distintos con el mismo CWE, método y endpoint
se leen como uno. La puerta no los funde en silencio, los declara como choque y
los lista, pero **el informe puede mostrar menos sitios de los que hay
problemas** cuando Strix encuentra dos cosas distintas en el mismo endpoint con
el mismo CWE. Es raro, y es el precio de que el "sigue abierto" sirva de algo
entre corridas.

### Verificado contra una corrida real, no contra un fixture

Esta era la línea más incómoda de este documento: *"la puerta no se corrió
nunca contra un reporte real de Strix"*. Ya no aplica.

**Cómo se comprobó.** Se construyó una aplicación deliberadamente vulnerable
con seis hoyos conocidos, comprobados a mano uno por uno antes de que Strix la
viera: IDOR, inyección SQL explotable con `UNION SELECT`, token de sesión que
acepta cualquier cosa que empiece con `token`, path traversal, cabeceras de
seguridad ausentes y credenciales en un `.js` servido al público.

**Esa app NO viaja en el paquete**, y es a propósito: una aplicación
vulnerable dentro de un entregable de ciberseguridad es un riesgo, no un
activo. Se tiró después de la corrida. Lo que sí queda es el `vulnerabilities.json`
que produjo, que es el dato que importa.

Contra esa app corrió **Strix 1.7.0 con `anthropic/MiniMax-M2.7`**: 12,3 minutos,
14,0M tokens de entrada (96% cacheados), 45,1K de salida, **cero bloqueos de
filtro de seguridad**.

**Lo que encontró: 2 de los 6.** SQL injection en `/buscar?q=` (**crítica**,
CVSS 9.4) e IDOR en `/mis-pedidos` (**media**, CVSS 5.3). Los otros cuatro los
mencionó en el resumen pero no los archivó como hallazgos.

Y el reporte real —`vulnerabilities.json`, 6,9 KB— **entró a la puerta por
primera vez**: 2 eventos, cadena íntegra, la crítica bloquea, salida 1. Segunda
corrida con esa línea base: **0 nuevos, 2 persistentes, sigue sin pasar**. Ese
detalle es el que importa: cerrar un hallazgo no lo saca de la cadena.

### Lo que el reporte real cambió y el fixture escondía

El `vulnerabilities.json` del fixture se construyó **leyendo el código de
Strix**, no mirando una salida. Correrlo de verdad mostró una diferencia:

- **`cwe` viene vacío.** Ninguno de los dos hallazgos declaró CWE, aunque el
  fixture los traía (`CWE-1427`, `CWE-22`, `CWE-1395`). El código lo maneja
  bien —la cadena registra `tipos: ["dynamic"]` y no inventa una familia, y el
  sidecar guarda `cwe: null`—, pero la consecuencia es real: **sin CWE la mesa
  no puede cruzar el hallazgo con las categorías de spaudit**, y lo reporta
  como "2 hallazgos fuera del catálogo" en vez de mapearlos. Menos cobertura
  declarada, no cobertura inventada.
- **Un `cwe` de puros espacios daba una huella distinta a un `cwe` ausente.**
  Consecuencia práctica: un hallazgo sin CWE habría sido reportado como *nuevo*
  cada vez que Strix alternara entre `''` y el campo omitido, sin que nadie
  hubiera tocado nada. Corregido con `.trim()` en `huellaDe` y `sitioDe`;
  comprobado quitándolo, cae 1 prueba.

Ambos casos tienen ahora prueba de regresión contra el reporte real, que está
en `puerta/fixtures/vulnerabilidades-strix-real.json`.

### Sobre correr Strix de verdad

Strix deja escribir y editar en el directorio que se le monta, en vivo:

> "A local directory is mounted into the sandbox live and writable, so the agent
> edits your real files (`.git` excepted). Commit or stash first."

**No se le apunta al repositorio.** En esta integración Strix apunta a la URL
del panel, y `--target ./ruta` queda como práctica cercana pero opcional.

Tres cosas que sólo aparecen cuando corre:

- **`--max-budget` no frena nada con MiniMax.** LiteLLM no conoce el precio de
  estos modelos, el contador queda en `cost=-` y el tope nunca se evalúa. Strix
  incluso lo muestra: `Cost $0.0000`. El freno real son los turnos
  (`--max-turns`).
- **Bug de sandbox en Windows**:
  `WorkspaceArchiveWriteError: failed to write archive for path: \workspace\.tool-output`.
  El sandbox no logra volcar la salida de las herramientas y el agente muere.
- **Dentro del contenedor, `localhost` es el contenedor.** Para apuntar a una
  app del host hay que usar `http://host.docker.internal:<puerto>`.

### Cosas que la puerta no hace

- **No distingue un hallazgo real de un falso positivo del agente.** Un LLM
  reporta; no verifica. La confianza que trae (`certain`, `high`, `medium`,
  `low`) es la del modelo, y no hay calibration medida.
- **No cubre lo que Strix no cubre.** Strix es un pentest de aplicación web. No
  revisa el código de tus dependencias transitivas más allá del `dependency_cve`,
  ni la configuración del servidor, ni los controles de acceso.
- **No sustituye una auditoría.** Una puerta que no ha encontrado nada quiere
  decir "no encontramos nada", no "no hay nada".
- **La línea base es el mecanismo, no la garantía.** La primera corrida marca
  todo como nuevo; el valor aparece desde la segunda. Sin una línea base
  guardada y versionada, la deduplicación no hace nada.

---

## 6. La mesa de evidencia

### Verificado contra datos reales

- El informe de spaudit que se incluye es una **corrida real de 147 controles**,
  copiado tal cual. Los tests de `tests/mesa.test.mjs` corren contra él.
- Las tres cadenas se encadenan sin perder un hallazgo: 4 + 3 + 5 = 12.
- La continuidad entre corridas reconoce los 12 como ya vistos.
- El panel renderiza la mesa y la API pesa 20 KB.
- **spaudit se ejecutó de verdad**, dos veces, y hay un segundo informe real en
  `mesa/fixtures/spaudit-con-evidencia.json`: 147 controles, con evidencia
  recolectada por el script de PowerShell sobre un equipo Windows.
  - Sin evidencia: **0 de 32 controles verificables** evaluados, 144 sin verificar.
  - Con evidencia recolectada: **5 de 32**, 2 hallazgos `NO_CUMPLE` y 2 `PARCIAL`.
  - Ese es el circuito completo, probado de punta a punta: recolectar, auditar,
    leer el informe, encadenar.
- El recolector de PowerShell se parseó con el parser de PowerShell
  (`[System.Management.Automation.Language.Parser]::ParseFile`) y se ejecutó
  con `-ExecutionPolicy Bypass` **solo por proceso**, sin tocar la política del
  sistema. Genera 12 archivos en UTF-8, que es justo lo que spaudit lee
  primero (`utf-8-sig`).

### El segundo informe no es el colegio

`spaudit-con-evidencia.json` dice `dominio: saintpatricktemuco.cl` **porque el
dominio viene del manual, no de la evidencia**. La evidencia es de otra máquina.

Es una trampa real del propio motor, no de este repositorio: **un informe de
spaudit lleva el dominio configurado y no lleva de dónde salió la evidencia**.
Si ese archivo llegara a un tercero, se leería como un informe del colegio con
dos controles críticos incumplidos, y sería de otro equipo.

Por eso los dos informes están separados, con nombres que dicen qué son, y por
eso el fixture que usa el panel es el del colegio. Si se mezclan, el tablero
muestra hallazgos que nadie del colegio tiene.

### Lo que la mesa NO es

- **No es una auditoría.** Junta lo que tres herramientas ya dijeron. No
  comprueba nada por sí misma.
- **La corroboración no es una demostración.** Es coincidencia de familia de
  CWE entre dos herramientas. Dos pueden fallar en el mismo lugar por la misma
  razón equivocada. El informe dice CORROBORADO y no CONFIRMADO por eso.
- **El mapa de correspondencias es un juicio, no una verdad.** Alguien decidió
  que un traversal de rutas (CWE-22) corresponde al área "Web". Nadie revisó
  esa decisión con el colegio. Está en un archivo de datos justamente para que
  sea revisable, y cambiarla no toca el motor.
- **El número de cobertura es del informe, no de la auditoría completa.**
  `2% → 6%` con el reporte de Strix del paquete, que es un **fixture
  inventado**. Con una corrida real contra el sitio del colegio el alcance
  sería otro, y probablemente mayor: las áreas Web y Correo son justamente las
  que tienen hallazgos.
- **La sonda que se cruza no corrió nunca.** El reporte de Strix que se cruza
  en el panel y en la CLI es el fixture del paquete, no una corrida real.

### Por qué los controles del colegio cambian con la evidencia de otra máquina

El informe del colegio dice 3 `NO_CUMPLE` y 144 sin verificar. El informe con
evidencia de una máquina cualquiera dice 2 `NO_CUMPLE`, 2 `PARCIAL`, 1 `CUMPLE`
y 142 sin verificar.

Los 3 del colegio no desaparecen: son `SP-18-03` (DNS/SPF), `SP-22-02` y
`SP-22-04` (Web), y salen de comprobaciones **en vivo**, que `--sin-vivo`
desactiva. Correr el recolector en un equipo y auditar sin red no puede
reproducirlos, y no es que se hayan arreglado: es que nadie los miró.

Eso también explica por qué la mesa liste **8 accionables** en vez de 6 con el
segundo informe: los dos controles web del colegio volvieron a la cola de
"verificador escrito que nadie ejecutó", que es exactamente donde están.

### La contradicción que muestra el panel

El panel muestra 2 contradicciones: `SP-22-02` y `SP-22-04`, controles de
seguridad web que el manual declara incumplidos, en un área que el reporte de
Strix también señala.

Eso es coherente **porque el fixture de Strix fue escrito imitando los mismos
hallazgos del manual**. No es evidencia de nada: es el mismo dato contado dos
veces. Una corroboración de verdad necesita dos métodos que no se copiaron.

---

## 7. La línea que este proyecto no cruza

Este sistema registra que algo salió. **No lo evita.**

La diferencia importa: un panel con 2 de 7 envíos sin cobertura es un sistema
que ya dejó salir datos de dos personas. El panel no evita eso, lo hace
visible después.

La prevención vive en otro lugar: en que `SalidaAuditada` **no deje salir**
sin consentimiento, y en que la bóveda no disponible **corte** la llamada en
lugar de mandar el texto sin tapar. Ese es el mecanismo que evita la fuga. El
panel es el que permite demostrar, más tarde, que el mecanismo funcionó.

Confundir las dos cosas —dar por buena la cadena y creer que eso previene— sería
entender mal la mitad del sistema.
---

## 8. El bug que convirtió ignorancia en incumplimiento

Este se encontró corriendo las cosas, no leyendo. Se documenta aparte porque es
el más importante de los que aparecieron, y porque **arreglado en spaudit
funciona; las copias viejas de la evidencia, no**.

### Qué pasaba

El recolector de PowerShell escribía el mismo literal para tres hechos que no
son el mismo:

```
HKLM:\...\LAPS :: ConfigureLAPSRootKey = <no definido o sin permiso>
```

Ese texto significaba cualquiera de estas tres cosas:

| Realidad | Excepción de PowerShell | Lo que spaudit reportaba |
|---|---|---|
| La clave **no existe** | `ItemNotFoundException` / `PSArgumentException` | `NO_CUMPLE` — correcto |
| El acceso fue **denegado** | `SecurityException` | `NO_CUMPLE` — **inventado** |
| Defender no devolvió el valor | `null` / `N/A: Must be an administrator` | `NO_CUMPLE` — **inventado** |

El verificador tenía el regex `NO_DEFINIDO` que ya incluía `sin permiso` y
`N/?A:`, y aun así devolvía `NO_CUMPLE` con el texto "que la clave NO exista es
justamente el incumplimiento".

### Por qué es grave

El script **avisa** por consola cuando no corre como administrador y sigue
funcionando. Ese es el camino que iba a seguir el colegio: correr el
recolector en los equipos con un usuario normal, entregar la evidencia, y
recibir dos controles críticos marcados como incumplidos que nadie comprobó.

Un hallazgo inventado en un informe de cumplimiento es peor que un hueco: un
hueco se ve; un hallazgo falso se discute, se defiende y termina en una reunión.

### Cómo quedó

- El recolector escribe `<no definido>`, `<sin permiso de lectura>` y
  `<no informado>` por separado, según el tipo de excepción.
- `texto_presente` y `config_valores` devuelven `NO VERIFICADO` cuando el valor
  se encontró pero no se pudo leer, y `NO_CUMPLE` solo cuando hay evidencia de
  que la clave **no está**.
- Los archivos recolectados con la versión vieja **no cambian de
  comportamiento**: `<no defined o sin permiso>` sigue cayendo en la rama de
  "no existe". Es deliberado; cambiarlo habría reescrito la historia de
  informes ya entregados.

### Cómo se comprobó

- 10 casos contra el verificador real, con evidencia escrita a mano:
  `python _revisar/probar_marcadores.py`.
- La guarda **neutralizada**: los 2 casos de "no se pudo leer" vuelven a dar
  `NO_CUMPLE`. Sin ese paso, la separación de marcadores podría no proteger
  nada: `python _revisar/comprobar_guarda_marcadores.py`.
- El efecto sobre el informe, de verdad: `SP-20-04` (Defender, medios
  extraíbles) **desapareció** de la lista de hallazgos y pasó a `NO VERIFICADO`.
  Los dos que quedan, `SP-13-11` (LAPS) y `SP-13-12` (firma SMB), se
  comprobaron contra el registro con `Get-ItemProperty` y **no existen**.

### El conjunto vacío: cerrado, y abrió un bug peor

Este se encontró **corriendo el recolector de verdad** en una máquina, no
leyéndolo. El recolector no escribía el archivo si el conjunto estaba vacío: en
un equipo sin recursos compartidos, `comparticiones.csv` no se creaba y el
informe decía "Falta el archivo", que suena a que nadie miró.

Ahora escribe la cabecera aunque no haya filas, y el control dice `PARCIAL` con
las columnas correctas y cero filas.

Eso destapó dos cosas que estaban escondidas **precisamente porque el archivo
no existía**:

1. **`SP-12-01` apuntaba al archivo equivocado.** Exigía las columnas
   `Nombre, Ruta, Acceso`, que sólo tiene `permisos_comparticiones.csv`, pero
   leía `comparticiones.csv`, que trae `Name, Path, Description`. Con el
   archivo ausente nadie lo notaba. Corregido: la cobertura verificable de esa
   máquina pasó de **4/32 a 5/32** y el control dejó de ser inacordable.

2. **`csv_sin_filas` tenía el filtro invertido.** Filtraba por
   `_booleano(...) == esperado`, o sea conservaba las filas que estaban como
   deben y descartaba las que estaban mal. El efecto era el inverso del que
   dice el control: una cuenta **Guest habilitada** pasaba como `CUMPLE`, y una
   Guest correctamente deshabilitada se reportaba como incumplimiento. Dos
   controles de identidad con `CUMPLE` y el problema presente. Ahora la fila es
   incumplimiento cuando su booleano es **distinto** del esperado, y un valor
   que no se puede interpretar sale `NO VERIFICADO`, no veredicto.

El segundo no lo encontró nadie leyendo: apareció al escribir el caso de
prueba obvio y ver que fallaba. Un control que nunca se ejecutó no es un
control, es una afirmación.

### Cómo se comprobó

- **Los 33 marcadores del registro, uno por uno**, contra una consulta
  independiente que el recolector no hizo. 33/33 ciertos. Contraprueba: marcando
  como `<no definido>` una clave que sí existe, el verificador lo detecta y
  sale con código 1.
- **15 casos de marcador** contra el verificador real. Contraprueba: revirtiendo
  el filtro invertido de `csv_sin_filas` caen **dos** casos, uno en cada
  dirección.
- **Auditoría completa con la evidencia de esta máquina**: 147 controles,
  2 `NO_CUMPLE`, 2 `PARCIAL`, 1 `CUMPLE`, 142 sin verificar, 5/32 verificables.
  **Ninguno de los 5 hallazgos se apoya en un marcador de ignorancia**: los
  cuatro primeros son valores reales leídos del registro, y el quinto es un
  `PARCIAL` por cero filas de permisos.
- **Idempotencia**: dos corridas dan los mismos 14 archivos byte a byte, salvo
  `servicios.csv`, donde cambiaron exactamente dos líneas porque un servicio
  arrancó y otro paró entre las dos. Eso es el equipo, no el script.

### Lo que sigue sin cerrarse

- **La consola muestra los acentos rotos** cuando el código de página no es
  UTF-8 (`recolecciÃ³n`). Los **archivos** están bien —se escriben en UTF-8 sin
  BOM—; sólo la salida de consola. Con `chcp 65001` no aparece.
- **Falta correrlo como administrador.** Esta máquina no lo permite, así que
  BitLocker, `auditpol` completo y Active Directory nunca se recolectaron con
  privilegios. El camino está cableado y el mensaje lo dice, pero no se ejecutó.
- **No se corrió en el controlador de dominio.** `usuarios_ad.csv` y
  `grupos_ad.csv` nunca se produjeron, así que `SP-13-01` y `SP-13-02` —los
  dos controles del filtro invertido— **no se han comprobado contra un dominio
  real**. El fix está probado con evidencia escrita a mano, no con un AD.
### El núcleo vendorizado es una copia, y eso es un riesgo

`vendor/hefesto-anonimizador/core/` es una **copia byte a byte** del núcleo real,
con hashes sellados. Existe porque el import cruzaba al repositorio vecino, que
no viaja en el paquete: el ZIP se entregaba y al descomprimirlo en otra máquina
`npm test` moría con `ERR_MODULE_NOT_FOUND`. El paquete no arrancaba al abrirlo y
no se había notado porque siempre se probaba sobre la copia de trabajo.

El riesgo de una copia no es que falle —fallaría ruidosamente—, es que **siga
funcionando con código que ya no es el de producción**. Eso sí es silencioso.

- Con el repositorio vecino presente, un test compara los hashes de los dos
  lados y falla si la copia quedó atrás.
- En una instalación suelta ese test se salta y queda sólo el manifiesto, que es
  exactamente lo que lo detecta en ese escenario.

Mientras esa cadena no esté automatizada en CI, la comprobación depende de que
alguien corra la suite. El manifiesto protege frente a una edición manual; no
protege frente a que el anonimizador cambie y nadie recuerde regenerarlo.
---

## 9. La configuración dice qué entidad es, no si los datos son ciertos

Ahora nada está atado a una entidad: dominio, rutas, objetivo de la sonda, fecha
del escenario y puerto salen de `config/`. Eso arregla un problema que era
silencioso —el panel servía siempre el informe del colegio porque la ruta estaba
escrita en el código— pero introduce otro, que conviene decir.

### Lo que la configuración NO verifica

Una entidad se declara a sí misma. Poner en `entidad.ejemplo.json`
`"origen": "corrida real"` no convierte el archivo en una corrida real, y el
sistema no lo puede comprobar.

Lo único que sí comprueba es **dónde está el archivo**: si cae dentro de
`fixtures/`, lo muestra como ejemplo y levanta un aviso si la etiqueta decía otra
cosa. Eso evita el caso grave —un informe del colegio etiquetado con datos de
otra máquina— pero no el caso de un informe real guardado en la ruta equivocada.

### Qué queda fuera de la parametrización

- **La colección de datos.** Configurar dónde está el informe no lo produce.
  spaudit y Strix hay que correrlos; el panel los lee, no los ejecuta.
- **El escenario de probanza sigue siendo inventado.** Se puede mover la fecha,
  el tenant y la sal, pero los nueve mensajes, los tres consentimiento y el
  defecto de la retirada son del paquete. Configurar `tenant` cambia el HMAC de
  los sujetos; no convierte la demostración en un registro real.
- **La sal por defecto está en el código.** `sal-de-demostracion` es pública, y
  por eso la sal real entra por entorno. Con la de por defecto, los sujetos del
  escenario son calculables por cualquiera, que es lo correcto para datos
  inventados y lo contrario para datos reales.
- **Configurar no es verificar.** El esquema rechaza una clave mal escrita, y el
  código deduce el origen de cada archivo de dónde está, no de lo que la
  configuración diga de él. Pero ninguna de las dos cosas comprueba que el
  archivo *contenido* sea el que dice ser: un informe real guardado en la ruta
  equivocada, fuera de `fixtures/`, pasa todas las comprobaciones. Lo único que
  distingue un ejemplo de una corrida es dónde está el archivo.

### Lo que la parametrización sí cubrió, y costó

Se cerró lo que faltaba y conviene dejarlo escrito para que no se reabra:

- **El esquema.** Las claves se revisan antes de usar nada del archivo. Una
  clave mal escrita **para** y nombra la lista de las válidas, con la sugerencia
  más cercana. Sin esto el fallo era silencioso: la clave se ignoraba, el valor
  quedaba en su defecto y el panel arrancaba mostrando datos que nadie pidió.
  Comprobado quitándolo: **18 pruebas se caen.**
- **El mapa de correspondencias.** Es de la entidad y se suma al del paquete; la
  entidad no puede borrar lo que el paquete sabe.
- **La puerta de Strix.** `puerta/ruta.mjs` tenía sus propios `--reporte` y
  `--strix` y no leía la configuración: era la última parte del sistema que
  seguía apuntando a una sola entidad. Ahora `--reporte` es alias de `--strix`
  y todo pasa por la misma precedencia, y **declara en pantalla** de qué fuente
  salió el reporte. Comprobado quitando la normalización: **6 pruebas se caen.**

Lo que la parametrización **no** tocó, a propósito: la correlación entre
categorías y CWE sigue teniendo una tabla por defecto en el paquete, escrita
sobre el catálogo de una entidad concreta. La configuración la puede ampliar
para otra entidad, no la puede reemplazar desde cero sin editar el código.