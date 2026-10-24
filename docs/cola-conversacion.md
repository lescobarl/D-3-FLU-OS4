# Cola del módulo CONVERSACIÓN

Protocolo por etapa (en este orden, sin invertir):
**implementar → cablear → fixture verde → borrar lo reemplazado → typecheck/lint → commit → marcar aquí.**

La primera casilla sin marcar es la siguiente. No se re-decide.

| # | Etapa | Estado |
|---|---|---|
| 0 | Congelar comportamiento (casos raros + tramo determinista) | [x] `8ebf297d` |
| 1 | **Tramo**: `[inicio,fin]` desde el segmento VAD, en la fila | [~] `turnWindow` = ventana del TURNO, dato (NO identidad); el segmento por locucion no se mide |
| 2 | **Transcripción**: estado con dos preguntas (revisión / crecimiento) | [x] dos sitios del ingress unificados |
| 3 | **Commit**: una fila por tramo; fuera la segunda puerta | [x] una fila por LOCUCION cerrada por audio (`locutionClosed` emite; medidas abajo) |
| 4 | **Hablantes**: identidad con medida del tramo; un solo escritor de etiqueta | [x] `escribirEtiquetaDeFila` |
| 5 | **Caja**: un solo texto (la caja es la locución abierta) | [x] caja dentro de su locucion; crece con el final |
| 6 | **Playback**: misma tubería, stub determinista | [x] comparabilidad declarada |

## Limitaciones DECLARADAS (no son "cerrado")

### Tramo por locucion (VAD por evento) - IMPLEMENTADO

Dueño: `src/voice/core/tramoDeLocucion.js` (`crearDetectorDeFronteras`, `hayFronteraDeAudio`).
El audio cierra la locucion en cuanto hay `minSilenceMs` (900 ms) de silencio, antes que el
reloj del turno (`srGapCommitMs` 3500). El ingress cierra la locucion ABIERTA en esa
frontera y arranca la siguiente; el TURNO sigue abierto para que el final del ASR de la
misma locucion reemplace la fila (una locucion = una fila).

Evidencia:
- Fixture `tests/conversacionFronteraAudio.test.ts` (6/6): la fila 5 de la sesion 8f3112c2
  (ids 1792789182623 / 1792789202635) se parte en DOS filas; **mutacion** con la frontera
  apagada -> UNA fila (rojo comprobado).
- Playback real (`npm run replay -- --mode playback`, audio + ASR stub): faltan 0.

CERRADO (2026-10-24). Tres causas raiz, una por sintoma:

1. **Caja**: el vaciado del ingress no estaba cableado en el arnes del replay
   (`bindings.vaciarLaCaja` no existia), asi que limpiaba OTRA caja y la medida
   (`publishedLiveRef`) seguia con el texto viejo. Ahora hay UNA sola caja: la misma
   instancia que mide el runner.
2. **Texto de la locucion cerrada**: la fila de la frontera usa `openLine` COMPLETA (el
   display de `readTurnLive` podia devolver la hipotesis parcial del ASR y perdia
   palabras). El final confirmado pendiente del MISMO tramo se une sin perder tokens.
3. **Fila antes de medir**: `locutionClosed` emite su fila por la puerta REAL del commit
   sin cerrar el TURNO (`settlesTurn: false`); el final tardio del ASR la REEMPLAZA
   (nunca abre otra) y un final de otro tramo produce otra fila.
   La congelacion se mide en `playback` con el criterio unico del producto
   (`medirCongelacionCaja`); antes ese modo caia al hueco crudo entre trazas y contaba el
   SILENCIO (una pausa sin voz) como caja congelada.

Medido en la sesion 8f3112c2 (`%TEMP%\flu-recordings\8f3112c2-...`):

| modo | filas | faltan/sobran | boxStall | boxLost | boxShrink | rowShorterThanBox | boxCanonica |
|---|---|---|---|---|---|---|---|
| playback | 13 | 0 / 0 | 0 ms | 0 | 0 | 0 | 2 (informada) |
| events | 13 | 0 / 0 | 0 ms | 0 | 0 | 0 | 2 (informada) |

Guards: `tests/conversacionFronteraArnes.test.ts` (arnes REAL del replay: captura vacia ->
no fila; final tardio del mismo tramo -> 1 fila; final de otro tramo -> 2 filas) y
`tests/conversacionFronteraAudio.test.ts` (misma locucion creciendo NO se parte; la
mutacion apaga la QUIETUD, que es la evidencia real de la frontera).

**Ventana del turno vs identidad de fila (2026-10-24, opcion 2).** El campo de la fila se
llamaba `tramo` y ademas era IDENTIDAD: dos locuciones del mismo turno comparten la ventana
y se fundian en una fila. Se retiro la identidad y el campo se renombro a `turnWindow`
(`bridge.ts`, `conversationTurnRow.ts`, payload del hook y `App.tsx`): es un DATO de la
fila, no la locucion. La identidad de fila es `turnId`; la separacion de locuciones la pone
la frontera de audio. Guard: `tests/conversacionEtapa3UnaFilaPorTramo.test.ts` (dos
locuciones, MISMA `turnWindow` -> DOS filas; mutacion con la identidad por ventana -> rojo;
guard de fuente que prohibe `mismoTramo`/`e?.tramo`/`tramoDeEntrada` en el escritor).

Sigue en pie la limitacion L1 de la **medicion** (Etapa 1), en dos piezas medidas:

1. `tramoDelTurno` mide la ventana del TURNO, no el segmento de cada locucion. Ya NO afecta
   a la identidad ni al numero de filas.
2. **La firma de voz / etiqueta se mide UNA vez por dictado, no por locucion**: el aviso de
   identidad se pide una sola vez (`preflightScheduledForTurnRef`) y la locucion 2 hereda la
   medida de la 1. Medido con el arnes real: 2 locuciones -> **1 medida**. Fijado con
   `it.fails` en `tests/conversacionFronteraArnes.test.ts` ("L1: cada locucion pide SU medida
   de voz"): el gate queda verde y ese test se pone ROJO cuando exista la medida por
   locucion (entonces se pasa a `it`). Con dos medidas sembradas, el commit SI produce dos
   etiquetas (test hermano en el mismo archivo): lo que falta es la MEDIDA, no la escritura.
   **Diarizacion NO cerrada.**

## Defectos A y B (decision del dueno 2026-10-23)

Regla unica:

- **Mismo tramo** -> se UNEN las variantes conservando TODAS las palabras, con alineacion y
  sin duplicar una repeticion exacta (`unirVariantesDelMismoTramo`, transcriptIngress).
- **Distinto tramo** -> nunca se unen: se cierra la anterior y se abre la nueva.
- **Sin tramo/frontera** -> NO MEDIBLE: no se pegan locuciones ni se elige una variante que
  pierda un token. Una canonica solo vale si no pierde palabras del mismo tramo.

### B - CERRADO (fixture + mutacion)

Un mismo evento del motor trae VARIAS hipotesis del mismo audio. Medido en 8f3112c2,
evento t=1792789332116 (seq 819): tres finales, dos con "esto" y uno con la cola
"escucha". Antes se quedaba una sola y la fila perdia "esto".

- Dueno: `unirVariantesDelMismoTramo` (alineacion por subsecuencia comun, grafia intacta).
- Solo se aplica a los finales del MISMO evento (mismo tramo). Una cola ajena de mas de 3
  palabras NO se une: esa frontera la decide el tramo.
- Guard: `tests/conversacionDefectosABGuard.test.ts` (mutacion: la variante sin "esto"
  nunca puede ganar sola).
- Medido en replay 8f3112c2: la fila final lleva "esto" Y "escucha"; 13 filas, faltan 0,
  sobran 0, boxLost/boxShrink/rowShorterThanBox/boxDuplicated 0.

### A - limitacion L1 (no es bug nuevo ni variante; no se maquilla)

La fila 5 del replay pegaba DOS locuciones (fuente: ids 1792789182623 de 22 palabras y
1792789202635 de 32). Son dos locuciones distintas para el dueno unico
(`estadoDeLocucion(...).locucionNueva === true`) y la caja ya NO adopta la ajena
(`resolverEmisionDeLaCaja` -> bloqueado); lo que queda pegado viene de la LINEA VIVA, que
acumula el interino siguiente sin evidencia de frontera (2,44 s de silencio, por debajo de
`srGapCommitMs` 3500).

Separarlas exige un **tramo por evento** (VAD sobre el audio de cada locucion), que hoy no
se calcula: el tramo de la fila es la ventana del TURNO y cubre las dos. Por eso A queda
como **limitacion L1 declarada** (arriba), no "arreglado" uniendo ni partiendo por texto.
Intento medido y revertido: cortar por `estadoDeLocucion` en cada interino produjo 57
filas (Chrome reinicia la hipotesis a media frase) -> el texto NO es frontera.
- Guard de lo demostrable: `tests/conversacionDefectosABGuard.test.ts` (la caja no pega la
  locucion ajena; la misma locucion creciendo SI entra: mutacion).

## Reglas de la etapa en curso (1)

- El tramo sale del **segmento VAD** (`tramosDeAudio` / `createVoiceSegmenter`), no de restar contadores.
- `tramoValido` (fin > inicio) viaja en la fila; un tramo inválido se cuenta, no se silencia.
- Al terminar: se borra el cálculo por contadores (`audioStartSample/audioEndSample` como fuente) y queda el segmento como única fuente.

## Fuera del módulo (no se toca)

Panel, comandos, avatar, imágenes, agenda.
