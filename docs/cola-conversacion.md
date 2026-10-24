# Cola del módulo CONVERSACIÓN

Protocolo por etapa (en este orden, sin invertir):
**implementar → cablear → fixture verde → borrar lo reemplazado → typecheck/lint → commit → marcar aquí.**

La primera casilla sin marcar es la siguiente. No se re-decide.

| # | Etapa | Estado |
|---|---|---|
| 0 | Congelar comportamiento (casos raros + tramo determinista) | [x] `8ebf297d` |
| 1 | **Tramo**: `[inicio,fin]` por locución desde el segmento VAD, en la fila | [x] `tramoDelTurno` |
| 2 | **Transcripción**: estado con dos preguntas (revisión / crecimiento) | [x] dos sitios del ingress unificados |
| 3 | **Commit**: una fila por tramo; fuera la segunda puerta | [x] `mismoTramo` en el escritor |
| 4 | **Hablantes**: identidad con medida del tramo; un solo escritor de etiqueta | [x] `escribirEtiquetaDeFila` |
| 5 | **Caja**: un solo texto (la caja es la locución abierta) | [ ] |
| 6 | **Playback**: misma tubería, stub determinista | [ ] |

## Reglas de la etapa en curso (1)

- El tramo sale del **segmento VAD** (`tramosDeAudio` / `createVoiceSegmenter`), no de restar contadores.
- `tramoValido` (fin > inicio) viaja en la fila; un tramo inválido se cuenta, no se silencia.
- Al terminar: se borra el cálculo por contadores (`audioStartSample/audioEndSample` como fuente) y queda el segmento como única fuente.

## Fuera del módulo (no se toca)

Panel, comandos, avatar, imágenes, agenda.
