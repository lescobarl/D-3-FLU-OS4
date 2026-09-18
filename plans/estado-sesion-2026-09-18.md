# Estado de sesión — 2026-09-18

> Documento de estado. Punto de partida para la próxima sesión.

## Contexto

- Rama: `feature/fase-conversacional-acciones` · árbol **limpio** · `tsc -b` **0** · gate del repo **verde**.
- Servidor de desarrollo (background): `bgp_0ad3d7cf5001ijE46Ii0z0DAi1` (`npm run dev --host 0.0.0.0 --port 5173`, persistente).
- **Cómo se leen los logs**: el frontend relaya a `/__flu_client_log` (`src/lib/clientLogRelay.ts`) y el **servidor los imprime en su terminal**. El agente los lee **desde la salida del proceso** (no hace falta que el usuario pegue nada).
- Barrido de ruido: los `[REC] onend/onerror` se silenciaron (spam ~5/s) → el log queda legible.

## ÚNICO pendiente técnico: DIARIZACIÓN (#12)

**Síntoma**: no distingue hablantes — todo cae en el mismo ("Luis"), aun con voces distintas (hija/mujer, TV, el usuario), y **ningún cambio**.

**Banderas de diagnóstico ya puestas** (commit `6f41a9a`) — buscar en el log:
- `VoiceId: signature dim=N empty=bool snap=N sr=N` (o `signature FAILED: …`)
- `SpeakerTrace: activo=… vecLen=… snap=… sr=… clusters=… resolved="…" fallback="…" last="…"`
- `SpeakerTrace: activo=false SIN AUDIO (snap=0) → fallback=…`

**Lectura y fix según lo que salga**:
| Log | Diagnóstico | Fix |
|---|---|---|
| `dim=0` / `empty=true` / `signature FAILED` | El modelo WavLM-SV **no carga** | Cargar/reintentar el modelo; no caer en silencio (hoy el fallback es mudo) |
| `SIN AUDIO (snap=0)` | No le llega audio a la diarización | Alimentar el snapshot al turno |
| `dim=512 empty=false` y `clusters` 0/1 y `resolved` siempre igual | Modelo OK, problema de **política** | Que una voz distinta abra "Hablante 2"; **pin solo si el timbre coincide**; no caer al primario sin match |
| `clusters` sube y `resolved` no | Match contra perfiles descarta | Revisar umbral / `pinRegisteredSpeaker` |

**Para el usuario**: `Ctrl + Shift + R` (build nuevo) → decir "hola hola soy luis" → TV puesta + frases alternando → avisar. El agente lee el log y cierra con test.

## Cerrado en este ciclo (con commit)

| Tema | Commit |
|---|---|
| Panel: un único resolutor (agenda+notas, árbitro determinista) | `9dcc89c`, `c9b3a7c` |
| Etiqueta limpia recordatorio (wake en medio, "que me recuerde", eco) | `29a0fb7` |
| Etiqueta limpia cita ("con"/"es") + fin de respuestas FLU duplicadas (ventana) | `c3c2922` |
| Próximos 10 · paleta fija abajo · menos interlineado · día completo · "baila"→música | `c3713c1` |
| Set de escenarios por objeto (citas/recordatorios/clase/alarma/notas) | `3b24706` |
| Borrado: refresco inmediato + `clearAll` por usuario | `43eda7f` |
| Alarma insiste 3 veces cada 10 s + borrado manual en la campana | `2a2046a` |
| Juego: deja de secuestrar la voz; "sí/continúa" avanzan; salir | `c76d488` |
| Recetas NO se enrutan como documento (se leen completas) | `c9b7153` |
| Simulación de receta/junta/juego | `c4e927d` |
| Gate/pizarrón por usuario real (hooks) | `57c05b2` |
| Auditoría contrato (sin archivos muertos) + dedup por dominio+TEXTO | `64e8bf3` |
| Inyección de valores (34 casos) | `6d84421` |
| Minuta después del onboarding (guard) | `4de2e14` |
| "Ese evento ya existe" → dedup por identidad de acción | `3b3e0c6` |
| Preguntas no disparan agenda ni juego; ganador sin UUID | `176c3ba` |
| Un solo arranque de juego (3 canciones) + ¿quién soy? no repite animal | `c64b913` |
| Banderas de diarización | `6f41a9a` |
| Persistencia NO borra la conversación en vivo ("me borra lo que digo") | `c9a21c5` |
| Silencio del spam de log | `cb4d219` |
| Notas: "limpia las notas" borra todas | `d10acc8` |

## Pendiente de **tu validación en pantalla** (no es trabajo del agente)

- Receta: se lee completa (arreglo de prompt) — confirma pidiéndola de nuevo.
- Visuales: días completos, 10 en Próximos, paleta fija, interlineado, alarma 3×.

## Regla de proceso (importante)

- **Dos agentes en el mismo árbol se pisaron**: el agente en paralelo barrió cambios en `d10acc8`. **Serializar**: un dueño por punto hasta cerrarlo.

## Guards/tests nuevos (referencia)

- Panel/objetos: `panelScenarios`, `injectedValues`, `agendaReminderLabel`, `describeTriggerText`, `resolvedActionIdentity`, `turnMultiItem`, `contractFilesExist`.
- Juegos: `gameCommandsPassThrough`, `loteriaAdvance`, `quienSoyMention`, `reportedScenariosSimulation`.
- Conversación/usuario: `notesUserScope`, `useAgendaScope`, `conversationLiveNotWiped`, `minuteOnboardingGate`, `conversationTurnRowSingleWriter`, `responseGateWindow`.
- Audio: `audioAlertRepeat`.
