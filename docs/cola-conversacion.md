# Cola del módulo CONVERSACIÓN

Protocolo por etapa (en este orden, sin invertir):
**implementar → cablear → fixture verde → borrar lo reemplazado → typecheck/lint → commit → marcar aquí.**

La primera casilla sin marcar es la siguiente. No se re-decide.

| # | Etapa | Estado |
|---|---|---|
| 0 | Congelar comportamiento (casos raros + tramo determinista) | [x] `8ebf297d` |
| 1 | **Tramo**: `[inicio,fin]` desde el segmento VAD, en la fila | [~] `tramoDelTurno` = ventana del TURNO (limitacion L1) |
| 2 | **Transcripción**: estado con dos preguntas (revisión / crecimiento) | [x] dos sitios del ingress unificados |
| 3 | **Commit**: una fila por tramo; fuera la segunda puerta | [~] `mismoTramo` (una fila por TRAMO, no por locucion: L1) |
| 4 | **Hablantes**: identidad con medida del tramo; un solo escritor de etiqueta | [x] `escribirEtiquetaDeFila` |
| 5 | **Caja**: un solo texto (la caja es la locución abierta) | [x] caja dentro de su locucion; crece con el final |
| 6 | **Playback**: misma tubería, stub determinista | [x] comparabilidad declarada |

## Limitaciones DECLARADAS (no son "cerrado")

### L1 - El tramo es la ventana del TURNO, no de la locucion (Etapa 1 parcial)

`tramoDelTurno` devuelve la ventana CON VOZ del turno (`ventanaConVoz` sobre el PCM del
turno). Su unidad es el TURNO. Consecuencia medida (sesion 8f3112c2, fila 5 del replay):
**dos locuciones SIN pausa suficiente comparten tramo y, por tanto, FILA**.

- Caso concreto: ids de fuente 1792789182623 (22 palabras) y 1792789202635 (32) quedaron
  en una sola fila porque la pausa entre ellas (2,44 s) es menor que `srGapCommitMs` (3500)
  y el tramo del turno cubre las dos.
- Lo que SI esta cerrado: mismo tramo = misma fila (no hay filas duplicadas por reemision
  del ASR); distinto tramo = fila distinta.
- Lo que NO esta cerrado: **"una locucion = una fila"**. No se vende como cerrado.
- No se corrige por texto: cortar por `estadoDeLocucion` en cada interino se midio y se
  revirtio (57 filas: Chrome reinicia la hipotesis a media frase). El texto NO es frontera.
- Salida si el dueno no acepta la limitacion: reabrir Etapa 1 con **VAD por evento**
  (tramo por locucion desde el audio), no un parche de texto.

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
