# Ejecución completa — C1..C39 (sin filtros)

Este archivo es lo que se le pasa al ejecutante. **C1 ya está cerrado.** Hay que
ejecutar **C2…C39**, todos, sin omitir ninguno.

## Mensaje para pegar al ejecutante

```text
Ejecuta TODOS los contratos de plans/contratos/contracts (C2 a C39) en orden,
sin omitir ninguno, siguiendo AGENTS.md §0/§10.

OJO: la lista SALTA C20 y C22 — NO existen (están subsumidos). Son 36 contratos:
C2-C19, C21 y C23-C39.

Para cada contrato C<n>:
  1. node plans/contratos/promote.mjs C<n> activate
  2. npm run gate            # ROJO esperado al inicio (guard nace rojo)
  3. Implementa SOLO dentro de "allow" de .task/contract.json
  4. npm run gate            # debe quedar VERDE (invariante recomputado)
  5. git add -A ; git commit --no-verify -m "fix(C<n>): <resumen>"

Reglas obligatorias:
- La ÚNICA fuente es .task/contract.json. Ignora cualquier contrato pegado en el chat.
- Prohibido crear/editar archivos fuera de "allow". Si necesitas algo fuera, PARA y pide enmienda.
- No edites los archivos congelados de .task/frozen.json (guards, métrica, task-gate-invariant).
  Si un guard parece incorrecto, PARA y dilo; no lo "arregles".
- No declares "listo/hecho/funciona". Cierra cada hito con: salida cruda de npm run gate (verde),
  git diff --stat, baseline de fallos preexistentes y confirmación de 0 fallos nuevos, y reporte
  append-only en .task/report (formato AGENTS.md §E).
- Sin filtros: NO omitas contratos, NO sustituyas el DoD por algo parcial, NO amplíes alcance.
  Si un DoD no se puede cumplir, DETENTE y dilo.
- C1 ya está cerrado; empieza en C2 y termina en C39.
- BASELINE: los guards de los contratos que aún no tocan están ROJOS a propósito. `npm run test:full`
  mostrará ~36 fallos hasta que cada contrato cierre; eso es baseline, NO fallos nuevos. No los
  "arregles" fuera de alcance.

Al terminar, entrega: lista de contratos C2..C39 con su estado (verde/parado+motivo) y el
`git log --oneline` de los commits de cierre.
```

## Arranque (frase corta equivalente)

Esta frase basta porque este archivo contiene las reglas completas:

```text
Trabaja con plans/contratos/EJECUCION.md. Ejecuta C2 a C39, todos, sin omitir
ninguno. Un contrato por vez: activate → implementar en allow → npm run gate
verde → commit --no-verify. Si un DoD no se puede cumplir, párate y me lo dices;
no lo sustituyas.
```

## Aclaraciones que aplican a todos los contratos

- Fuente única = `.task/contract.json` (no este documento ni el chat).
- No existe `promote stage` que ejecutar: los guards ya están copiados. Solo `activate`.
- `--no-verify` es obligatorio al commitear (el pre-commit no puede montar el worktree base).
- Un commit por contrato, con `(C<n>)` en el mensaje: así se verifica que no se omitió ninguno.
- Al terminar: `npm run test:full` + `npm run typecheck` una vez y reportar 0 fallos nuevos
  (descontando los guards de contratos aún no cerrados).

## Nota de cierre (obligatoria)

`--no-verify` es necesario en el commit de cierre: el hook pre-commit **no puede**
ejecutar el invariante porque `git worktree add` del `base` falla durante el
commit (`index.lock: No such file or directory`, medido). La evidencia del
invariante es `npm run gate` verde + CI. El pre-commit sí cubre alcance/DoD/guard.

## Lista completa de contratos

| ID | Invariante | Métrica HOY→META | Allow (archivos) |
|---|---|---|---|
| C1 | Instancia de reconocimiento en la puerta única | 1→0 | **cerrado** |
| C2 | Allowlist solo desde FLU_CONFIG | 2→0 | App.tsx, useNavigationCommands.ts |
| C3 | Un solo escritor de voiceProfiles | 3→1 | App.tsx, useVoiceProfiles.ts, fluStorage.js |
| C4 | Clave proveedor solo desde STORAGE_KEYS | 3→0 | aiServiceFactory.ts, decisionEngine.ts |
| C5 | API key de texto solo del resolver | 1→0 | searchConfigOverrides.ts |
| C6 | Wake word runtime desde FLU_CONFIG | 3→0 | voiceConfigCatalog.ts, VoiceAssistantBarWrapper.tsx |
| C7 | Base Pollinations única | 2→1 | sharedConfig.ts, visualConfig.js |
| C8 | Un solo escritor de conversación | 3→1 | App.tsx, useConversationPersistence.ts, fluStorage.js |
| C9 | Un solo backend de sesión | 2→1 | useSessionPersistence.ts, fluStorage.js, App.tsx, useFluVoiceAssistant.js |
| C10 | Sin doble escritura de minutas | 3→0 | useMinuteHandlers.ts, integrationStore.ts |
| C11 | Una sola tabla de notas/listas | 2→1 | useNotes.ts, useShoppingList.ts, notesService.ts, shoppingService.ts, fluDatabase.ts, App.tsx |
| C12 | Claves de texto desde STORAGE_KEYS | 7→0 | voice/lib/gemini.js |
| C13 | Sin catch silencioso | 160→0 | src/** |
| C14 | Sin borrado físico en Dexie | 4→0 | App.tsx, core/db/fluDatabase.ts |
| C15 | IDs UUIDv4 al insertar | 1→0 | voice/lib/fluStorage.js |
| C16 | Sin módulos muertos de src/lib | 15→0 | src/lib/**, localTranslate.js + tests |
| C17 | Sin docs/utilidades huérfanas | 6→0 | raíz, tools/e2e-sims, tools/live-check.mjs |
| C18 | Timeouts desde config | 7→0 | fbxWorkerClient, httpClient, searchProxy, voiceIdWorkerClient, browserProxy, musicSearch |
| C19 | Cliente sin fetch directo a proveedor | 3→0 | ocrService.ts, healthMonitor.ts, fluVisualStockSearch.js |
| C21 | Un solo punto de TTS | 8→1 | App.tsx, useConfigPersistence, useFluParticipant, useFluVoiceAssistant, healthMonitor, fluSpeech, FluParticipantSettingsPanel, localTts |
| C23 | AGENTS alineado con el stack real | 3→0 | AGENTS.md |
| C24 | Un solo default de modelo | 6→1 | FluSettingsPanel, voiceConfigCatalog, sharedConfig, appConfig, fluConfig, voice/lib/gemini.js |
| C25 | App no re-normaliza | 4→0 | App.tsx |
| C26 | Un solo commit de turno (commitUserTurnRow) | 3→1 | App.tsx |
| C27 | Una sola derivación de query | 4→1 | useFluVoiceAssistant.js, audioMath.js |
| C28 | Una sola implementación de strip de wake word | 5→1 | audioMath.js, wakeWord.js |
| C29 | Sample rate desde config | 10→0 | useFluVoiceAssistant.js, fluConfig.js |
| C30 | Una sola base IndexedDB propia | 2→0 | longTermMemory.ts, fluStorage.js, fluDatabase.ts |
| C31 | Perfiles de voz solo en Dexie | 1→0 | backupSystem.ts |
| C32 | Borrado lógico en longTermMemory | 1→0 | longTermMemory.ts |
| C33 | Tupla de sync en MemoryItem | 1→0 | longTermMemory.ts |
| C34 | Sin fallbackResponses muerto | 1→0 | services/fallbackResponses.ts + 2 tests |
| C35 | Sin console.debug | 12→0 | useFluVoiceAssistant.js, voice/lib/gemini.js |
| C36 | Consumidores no re-normalizan | 10→0 | generationTopic.ts, agendaCommandParser.ts, noteIntentParser.js |
| C37 | Una sola ruta de finalizeTurnCommit | 2→1 | conversationStreamCommit.js |
| C38 | Umbrales de autonomía/voz desde config | 4→0 | speakerDiarization.js, healthMonitor.ts, decisionEngine.ts, autoOptimization.ts, participantProfiles.ts |
| C39 | Motor no re-normaliza ni re-deriva | 2→0 | useFluVoiceAssistant.js, turnTranscript.js |

## Orden recomendado

C2, C3, C4, C5 → C6, C7, C12, C15, C24, C29 → C25, C26, C27, C28, C36, C37, C39 →
C18, C19, C38 → C8, C9, C10, C11, C14, C30, C31, C32, C33 → C13 → C16, C17, C34, C35, C23.

(de bajo riesgo y local, a refactor grande; C13 y C30 al final por tamaño.)
