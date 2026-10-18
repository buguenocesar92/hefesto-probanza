# Configuración

Acá se decide **a qué entidad apunta el sistema**. No hay ninguna entidad
escrita en el código: el servidor y la CLI leen de acá.

## La regla que gobierna todo

> Un valor que **vino configurado** y no existe → el sistema se para y lo dice.
> Un valor que **vino por defecto** y no existe → la fuente se omite y se declara.

La diferencia es la que separa "apunté mal" de "no hay nada". Un sistema que
ante una errata en la ruta se cae de vuelta al informe del paquete está
mostrando los datos de otra entidad con total naturalidad, y eso es el mismo
fallo que ya se corrigió una vez en la línea base de la puerta.

Probado: `node mesa/ruta.mjs --spaudit "C:\no\este.json"` → sale con código 1 y
el motivo. No sigue, no rellena, no avisa y continúa.

## Precedencia

De más fuerte a más débil:

```
argumento  >  variable de entorno  >  archivo de configuración  >  valor por defecto
```

El panel y la CLI muestran **de dónde salió cada valor**. Un tablero que dice
"36% de cobertura" sin decir contra qué lo midió no sirve para que nadie lo
discuta.

## El archivo

```json
{
  "entidad":   { "nombre": "Consultora Ejemplo SpA", "dominio": "ejemplo.cl" },
  "servidor":  { "puerto": 8788, "host": "127.0.0.1",
                 "objetivo_strix": "https://app.ejemplo.cl" },
  "escenario": { "desde": "2026-10-02T09:00:00.000Z", "tenant": "consultora-ejemplo" },
  "mapa": {
    "familias":       { "Perímetro": [22, 78, 89, 284, 16, 200, 400, 522, 611, 693, 918] },
    "no_sondeables":  { "Continuidad": "depende de un documento aprobado que no se puede leer desde acá",
                       "Personal":    "requiere acceso al expediente de cada persona" }
  },
  "fuentes": {
    "conformidad": { "ruta": "mesa/fixtures/entidad-ejemplo/informe-conformidad.json",
                     "origen": "corrida real sobre ejemplo.cl",
                     "nota": "qué es esto y de cuándo" },
    "seguridad":   { "ruta": "mesa/fixtures/entidad-ejemplo/reporte-seguridad.json",
                     "origen": "corrida real sobre app.ejemplo.cl" }
  }
}
```

Todos los campos son opcionales. Lo que no se pone queda en valor por defecto, y
el valor por defecto se declara como tal en pantalla.

### Una clave mal escrita se dice, no se ignora

Las claves se revisan **antes de usar nada** del archivo. Si se escribe
`"dominio"` en vez de `"entidad": {"dominio": ...}`, el sistema para y lo dice:

```
ErrorDeConfig: "entidadz" no es una clave de la raíz.
  Se aceptan: entidad, servidor, escenario, mapa, fuentes.
  ¿Quisiste decir "entidad"?
  No se ignora: una clave mal escrita deja el valor en su defecto sin avisar,
  y el panel arrancaría mostrando datos que no son los que se pidieron.
```

La alternativa —ignorar la clave desconocida— es el peor modo de fallo posible en
un archivo de configuración: silencioso, y con la apariencia de que todo funcionó.
Es el mismo fallo que este proyecto lleva combatiendo en todas partes.

`_nota` se acepta en **cualquier** sección, includedonde no aporta nada: es para
que el archivo se explique solo.

Si el JSON trae BOM —que es lo que pone `Set-Content -Encoding UTF8` de
PowerShell 5.1 y el Bloc de notas— el error lo dice por su nombre en vez de
reportar un token misterioso de `JSON.parse`.

### `mapa`: las categorías también son de la entidad

La tabla de correspondencias del paquete está escrita sobre el catálogo del
colegio. Una entidad con su propio manual trae sus propias áreas, y con la tabla
fija el cruce no devuelve nada y además acusa a la tabla de estar vieja.

`mapa.familias` relaciona una **categoría de la entidad** con los CWE que una
sonda de seguridad puede cubrir. `mapa.no_sondeables` marca las categorías que
**ninguna sonda** va a resolver, con el motivo.

Las dos cosas se suman a lo que el paquete ya sabe, no lo reemplazan: si la
entidad redeclara una categoría, esa gana; todas las demás siguen como estaban.
Una entidad no puede borrar lo que el paquete sabe.

Consecuencia medida sobre el ejemplo: sin el mapa propio, el cruce reportaba
**3 categorías desconocidas**; con él, ninguna, y el número de áreas alcanzadas
y de controles resolubles por sonda sube. El mapa no es cosmético.

### `origen`: la etiqueta no se cree

`origen` es texto libre y lo escribe quien configura. **El código no le cree.**
Si el archivo cae dentro de `fixtures/`, el sistema lo muestra como *fixture del
paquete* aunque la etiqueta diga "corrida real", y además levanta un aviso
diciendo que la etiqueta y el archivo no coinciden.

La razón es que el panel pone ese texto al lado de una cifra, y una cifra con
una etiqueta no verificable no es defendible. Un archivo dentro del paquete es
un ejemplo, se llame como se llame.

## Dónde se resuelven las rutas

Depende de dónde salió cada ruta, no de dónde se esté parado:

| La ruta vino de… | Se resuelve contra… |
|---|---|
| el archivo de configuración, dentro del paquete | el paquete |
| el archivo de configuración, fuera del paquete | la carpeta donde está ese archivo |
| un argumento o una variable de entorno | el directorio de trabajo |
| el valor por defecto | el paquete, porque sus rutas son del paquete |

Un archivo de configuración que depende del directorio desde donde lo abriste no
es configuración. Hay un test que lo comprueba cambiando el directorio de
trabajo a mitad de la ejecución.

## Variables de entorno

| Variable | Qué es |
|---|---|
| `HEFESTO_ENTIDAD` | ruta del archivo de configuración |
| `HEFESTO_NOMBRE` | nombre de la entidad |
| `HEFESTO_DOMINIO` | dominio auditado |
| `HEFESTO_SPAUDIT` | ruta del informe de conformidad |
| `HEFESTO_STRIX` | ruta del reporte de sonda |
| `HEFESTO_PROBANZA` | ruta de la cadena de probanza |
| `HEFESTO_PUERTO` / `HEFESTO_HOST` | dónde escucha el panel |
| `HEFESTO_OBJETIVO_STRIX` | URL objetivo de la sonda |
| `HEFESTO_DESDE` | fecha de arranque del escenario |
| `HEFESTO_TENANT` | identificador de la entidad en el HMAC |
| `HEFESTO_SAL` | sal del HMAC de sujetos. **Va por entorno a propósito:** una sal en un archivo versionado no es una sal. |

## Cómo se usa

Las tres entradas —el panel, la mesa y las dos CLI— leen esta configuración.

```powershell
# Una entidad, todo de ella
node server/index.mjs --config mi-entidad.json

# Cambiar una cosa sin tocar el archivo
$env:HEFESTO_DOMINIO = "otro.cl"
node mesa/ruta.mjs --config mi-entidad.json --sin-color

# Sin configurar nada: los ejemplos del paquete, declarados como ejemplos
node server/index.mjs
```

La puerta de Strix toma el reporte de `fuentes.seguridad`:

```powershell
node puerta/ruta.mjs --config mi-entidad.json
node puerta/ruta.mjs --reporte strix_runs/mi-corrida/vulnerabilities.json   # gana sobre la config
```

El informe de la terminal toma fecha, tenant y sal, y **mueve el escenario
entero**: los consentimientos, las acciones y los siete envíos cambian de fecha
juntos.

```powershell
node cli/informe.mjs --config mi-entidad.json --sin-color
```

Probar que el paquete no está atado a una entidad:

```powershell
node server/index.mjs --config config/entidad.ejemplo.json
```

Cambia el nombre, el dominio, los controles, la cobertura y el reloj. Si algún
día deja de cambiar todo, alguien escribió una ruta en el código.