# Arquitectura

Documento de decisiones que **no** son obvias leyendo el código. Lo evidente ya
está en el código; lo difícil de reconstruir en dos años va aquí.

---

## 1. La llave de unión es `consent_id` + `sujeto_ref`, y es obligatoria

Es la decisión de la que depende todo lo demás.

El evento de salida y el registro de consentimiento viven en sistemas distintos.
Para juntarlos hace falta un identificador que viaje en ambos lados. Ese par es
la llave.

`SalidaAuditada.amordazar` lanza `consentimiento_obligatorio` sin ella. No es una
advertencia: es un corte.

**Por qué no es negociable.** Sin esa llave no hay cobertura verificable, y
recuperarla después exige volver a instrumentar ARCOP, el anonimizador y el
verificador al mismo tiempo, con los datos ya circulando. El costo de decidirlo
hoy es una excepción. El costo de no decidirlo es una reescritura con producción
en medio. Todo lo demás en este proyecto es barato comparado con esto.

El sujeto viaja como **HMAC de 64 hex**, nunca como el titular. Así el evento
sigue siendo correlacionable (las salidas del mismo vecino se agrupan) sin
contener el dato que existe para proteger.

## 2. Canonización estricta antes que cualquier funcionalidad

```js
sha256( previo || "\0" || canónico(evento sin su campo hash) )
```

Se decidió primero, y antes de que existiera nada más, porque es lo único que
no se puede corregir más adelante. Un hash mal definido es un hash que hay que
rehacer, y rehacerlo invalida toda la evidencia acumulada.

Lo que queda prohibido en el contrato, y por qué:

- **El orden de un `Map` de JavaScript.** No está definido por la
  especificación: dos motores pueden dar dos resultados para el mismo código.
- **Los decimales.** `0.1` no tiene una única representación entre lenguajes.
  La cadena de evidencia no los necesita, así que un decimal es señal de evento
  mal formado.
- **La fecha en formato local.** El tiempo viaja como ISO-8601 UTC en texto.

## 3. El recibo firma el hash del texto, nunca el texto

Cuando alguien dice *"al modelo nunca le llegó su RUT"*, el recibo lo demuestra.
Cuando alguien con acceso a la evidencia quiere reconstruir qué dijo el vecino,
no puede. Esa asimetría es deliberada.

La razón práctica: **un recibo termina en expedientes con más permisos que el
dato que protege.** Un RUT es un identificador con vida administrativa; un
expediente de cumplimiento se copia, se archiva, se manda a un auditor externo
y a veces se publica. El recibo tiene que poder vivir ahí sin arrastrar nada.

Como los marcadores del anonimizador llevan un nonce por mensaje, dos salidas
distintas dan hashes distintos aunque el contenido visible sea el mismo: que es
justo lo que hace el recibo útil como prueba de que una salida concreta ocurrió.

## 4. Manifiesto y firma son objetos separados

```js
{ manifiesto: {...}, kid, alg, firma }
```

No un objeto único con la firma adentro. Un auditor recibe los dos y comprueba
la firma sobre la forma canónica del manifiesto, **sin que esta implementación
tenga que reconstruir qué campos iba a tener la firma**.

Si el sobre fuera un solo objeto, toda recomposición — serializar,firmar,
volver a parsear — sería un lugar donde la verificación puede mentir. La
separación elimina esa clase entera de errores.

`kid` no es adorno: sin identificador de llave no hay rotación posible sin
ambigüedad sobre qué llave firmó qué.

## 5. Cuatro veredictos, no un porcentaje

Un porcentaje obliga a una pregunta que nadie sabe responder: ¿43% de
cobertura es bueno o malo? Y un número agregado esconde el motivo, que es lo
único accionable.

Cada "no" lleva su motivo explícito:

- `sin cobertura` → *"el consentimiento ampara 'atencion' y el envío dice
  'prospeccion'"*
- `revocado` → *"revocado desde 2026-05-05T12:00:00.000Z"*

Un verificador mudo no es peor que no tener verificador: es peor, porque obliga
al auditor a repetir el trabajo y lo hace con menos información.

**El orden importa.** `verificarTodo` ordena por gravedad: revocado, vencido,
sin cobertura, y los cubiertos al final. Un tablero donde el problema está
arriba es un tablero que se lee.

## 6. El estado del consentimiento se deriva de `consent_actions`

No hay columna `estado` en la tabla de consentimientos, exactamente igual que en
ARCOP.

Una columna de estado es un caché que se desactualiza. El día que alguien
retira un consentimiento y el sistema escribe `estado = 'revocado'` pero no
toca la fila que otro flujo leyó hace un segundo, ahí aparece el envío que no
debía haber salido. Derivar de las acciones elimina esa clase de bug por
construcción: no hay nada que pueda quedar viejo.

Cuesta una consulta más. Es el precio correcto.

## 7. `scope` es lo que sigue permitido, no lo prohibido

Una restricción sobre un consentimiento declara `scope` como **la lista de lo
que queda permitido**. La versión contraria —declarar lo prohibido— obliga a
mantener sincronizada una lista de excepciones que crece con cada uso nuevo, y
un olvido es una fuga silenciosa.

Con "lo permitido", el olvido se ve: lo que no está en la lista, no está
permitido.

## 8. El anclaje externo es lo que detecta la reescritura total

La cadena detecta **ediciones**: si cambias un evento, todos los hashes
siguientes dejan de cuadrar.

La cadena **no** detecta que borres tres eventos y recalcules todo lo que
queda. Para eso está `ancla`: publica la cabeza afuera, y `comprobarAnclaje`
detecta el desajuste con dos guardas:

- `empty_chain` — la cadena local está vacía pero había un anclaje.
- `head_not_in_chain` — la cabeza publicada no aparece en la cadena local.

Sin ancla externa, el verificador declara que toda la cadena es reescribible, y
el panel lo dice en voz alta. Un sistema que no puede probar que no lo han
reescrito debería decirlo, no dejarlo implícito.

## 9. La ausencia de evidencia es ausencia de cobertura

Si el anonimizador se usa **desnudo**, sin `SalidaAuditada`, no hay evento en
la cadena. El verificador lo cuenta como `sin_cobertura`.

El otro default —"si no hay evidencia, no hay problema"— convierte al
verificador en decorativo: es exactamente el caso que pasa cuando el sistema
está mal configurado, que es cuando más lo necesitas. La ausencia de evidencia
es el peor caso, no el mejor.

## 10. Sin bóveda no hay salida, recibo ni evento

`SalidaAuditada` resuelve la decisión en **un solo lugar**. `amordazar` y
`preguntar` no pueden discrepar porque consultan la misma decisión.

Un sistema que tiene la bóveda caída tiene una tentación muy fuerte: mandar el
texto sin tapar y avisar después. La tentación es racional —el vecino está
esperando una respuesta— y por eso tiene que estar cerrada por arquitectura, no
por disciplina.

`ProveedorAuditado` es el refuerzo: el decorador **no llama al proveedor** en
ese caso. No es que avise y mande igual; es que no hay llamada.

## 11. No mezclar los productos en un monolito

ARCOP, el anonimizador y probanza son tres productos con ciclos de vida
distintos. Lo que comparten es **un contrato**, no un despliegue.

La alternativa —un solo sistema colgado de los otros— parece más simple y
termina siendo tres despliegues por cada cambio de una sola pieza.

## 12. En la cadena va la huella, y el detalle va aparte

Un hallazgo de Strix entra a la cadena con la huella, la clase y la gravedad. El
título, la descripción, el PoC, el endpoint y el CWE van a un sidecar aparte,
indexado por esa huella.

Es la misma línea que sostiene el recibo firmado —el hash entra, el texto no— y
está por una razón práctica: **el sidecar se puede perder sin que la cadena
mienta sobre lo que vio**. Un panel donde el hallazgo desaparece del detalle
sigue diciendo, en lo encadenado, que ese hallazgo existió con esa gravedad.

El contrato de evento ya lo hacía casi gratis: `datos` admite listas de
identificadores en minúsculas y, con este trabajo, huellas de 64 hex. Ninguna
de las dos formas admite una frase.

## 13. La identidad de un hallazgo no incluye su gravedad

La huella se calcula con la clase, el CWE, el título normalizado, el objetivo y
el endpoint. **No** incluye el `id` de Strix (que cambia cada corrida), ni el
timestamp, ni la gravedad.

Lo último es la decisión que da valor a todo lo demás. Si la gravedad entrara en
la huella, subir un hallazgo de media a alta lo convertiría en un hallazgo
nuevo, y el anterior quedaría "cerrado" sin que nadie lo cerrara. La identidad
de un problema no cambia porque se haya entendido mejor.

Con eso, "sigue abierto" es una pregunta con respuesta, no un supuesto.

## 14. Lo que no se puede calificar bloquea

`nivelDe('catastrófico')` devuelve nivel 5 y `desconocida: true`. No degrada a
`info`.

Es la misma regla que aplica el propio Strix en su `--fail-on`: una severidad
que no sabe ordenar siempre cuenta. Bajar lo desconocido a informativo es la
forma más común de que un gate se deje pasar lo que no entendía — y un gate que
se deja pasar lo que no entendió no es un gate.

## 15. Dos identidades: el registro y el sitio

Esta se decidió porque la puerta falló en esto, y no en teoría.

La huella estricta (clase, CWE, título normalizado, objetivo, endpoint)
identifica un hallazgo con precisión. Pero **un agente LLM reescribe el título
en cada corrida**. Medido: cuatro títulos plausibles del mismo traversal dan
cuatro huellas distintas. Con eso, la deduplicación se convertía en ruido — el
mismo bug salía como "nuevo" y el anterior como "cerrado", en cada corrida y
para siempre.

La puerta seguía bloqueando, que es la parte que de verdad importa. Pero la señal
—que es lo que un equipo lee— era falsa.

Quitar el título arregla eso y rompe otra cosa: **la clave colisiona**. Tres
inyecciones SQL distintas sobre el mismo endpoint comparten CWE, método y
endpoint. Medido: se funden en una.

Así que no se elige. Viajan las dos en `datos.huellas`:

- **la estricta** identifica el registro exacto, y es lo que encadena.
- **la del sitio** (`clase | CWE | método | endpoint`) da continuidad entre
  corridas, y es lo que se compara contra la línea base.

Y el trade-off **se declara en voz alta**: si un sitio conocido trae varios
hallazgos distintos, la puerta no los fusiona en silencio — reporta un choque y
los lista. Un sitio se cierra cuando desaparece entero de la corrida, nunca
porque el registro haya cambiado de título.

La lección general es la del resto del paquete: un supuesto que sostiene la
función principal tiene que medirse contra el comportamiento real del otro
sistema, no contra lo que uno supone que hace.

## 16. Un hallazgo conocido no se cierra por haber aparecido antes

El problema real que ataca la puerta: los escáneres se leen una vez y después se
archivan. La segunda corrida dice "0 nuevos" y todo el mundo entiende que no hay
nada que hacer, aunque siga abierto un crítico del mes pasado.

El ruido de lo conocido tapa lo que sí cambió, y lo que no cambió deja de
importar. Acá el sesgo es el inverso: **un hallazgo que sigue abierto bloquea**,
y el informe separa los nuevos de los persistentes para que la lectura siga
siendo posible.

La contraprueba está en el test `un hallazgo ya conocido que sigue abierto
SIGUE bloqueando`, y la guarda se comprobó quitándola:

```bash
node tools/comprobar-guarda.mjs puerta/verificador.mjs \
  "const bloqueantes = [...nuevos, ...persistentes].filter(grave);" \
  "const bloqueantes = nuevos.filter(grave);"
```

```
guarda DEBILITADA  →  ℹ pass 69  ℹ fail 2
```

## 17. Tres fuentes, tres cadenas, y un cruce que no cuenta controles

spaudit audita controles de una organización, Strix sondea un sistema en vivo, y
probanza verifica que un envío tuviera consentimiento. Los tres se fusionaron
alguna vez en el mismo informe y el resultado fue ilegible.

**Cada fuente va en su propia cadena**, con su propio `sistema`. Lo que se
comparte es la *forma* del hallazgo, no los hechos: un consentimiento revocado y
un puerto abierto no son la misma cosa, y una cadena que mezcla las dos no se
puede leer.

Lo que sí se cruza es el **área**. Una sonda que encuentra cabeceras de
seguridad ausentes y un manual que dice "implementar sistemas de seguridad" sin
concretarlo se están apuntando al mismo lugar.

### Por qué el cruce NO cuenta "controles corroborados"

La primera versión emparejaba cada hallazgo con todos los controles de su área
y contaba cuántos quedaban corroborados. Con el informe real dio **27
controles corroborados por un solo hallazgo**: un CWE-306, que es el más común
que existe, no habla de veintisiete controles de un colegio. El número era
cierto y no significaba nada.

Un indicador que se infla es peor que no tenerlo, porque se lee como evidencia y
no lo es. Lo que quedó son tres cosas que sí se sostienen:

- **Zonas**: áreas que una sonda alcanza, con cuántos controles hay y cuántos
  tienen un verificador escrito que nadie ejecutó.
- **Contradicciones**: el manual declara `CUMPLE` y una sonda independiente
  encuentra un problema en la misma área. Es la señal más fuerte del cruce.
- **Cobertura movible**: `2% → 6%` sobre el informe real. El número que informa
  es el que se puede mover, no el que asusta.

### Por qué el mapa de correspondencias tiene tres estados

Porque "no sé cruzar esto" y "nadie puede cruzar esto" son verdades distintas, y
el informe las mezcla cuando hay una sola categoría de "fuera de alcance". Un
escáner web no comprueba si la puerta del depot tiene cerradura, y decirlo es
información distinta de decirlo "no sé".

El tercer estado —**desconocida**— es el que hay que vigilar: si aparece, la
tabla quedó vieja y hay una prueba que falla. Esa prueba ya existe, y cuando la
escribí la tabla tenía siete categorías inventadas de las cuales dos existían.
Con un fixture inventado no habría salido a la luz nunca.

## 18. Un hallazgo de probanza lo emite el anonimizador

`probanza` no es un sistema: es la vista que cruza los otros. El evento lo
emite `anonimizador`, que es quien realmenteSending salió sin cobertura.

Poner `probanza` en el campo `sistema` sería atribuir la falta a un sistema que
no la produjo — y un informe que culpa al equivocado es peor que uno que no
informa.

---

## Lo que se eligió *contra* lo que se habría hecho

| Tentación | Qué se hizo | Por qué |
|---|---|---|
| Guardar el texto en el recibo para poder auditarlo completo | Solo el hash | Un recibo acaba en más manos que el dato que protege |
| Una columna `estado` en consentimientos | Derivar de `consent_actions` | El caché se desactualiza; las acciones no |
| Un `% de cumplimiento` | Cuatro veredictos con motivo | El número esconde lo único accionable |
| Validar el evento "cuando se pueda" | Estricto, en la entrada | Un evento mal formado ahora es uno por reconstruir en un año |
| Un solo objeto manifiesto+firma | Dos objetos separados | La recomposición se vuelve un lugar donde la verificación puede mentir |
| Silenciar la reescritura de la cadena | Declararla explícitamente | Un sistema que no puede probar que no lo reescribieron debe decirlo |