# Plan: eliminar rutas/símbolos duplicados (por hito)

> Este plan lo ejecuta una sesión distinta de la autora del criterio.
> Regla de oro: **un dueño de la lógica; el resto re-exporta o adapta. No se
> reescribe comportamiento. No se editan tests existentes para que pasen.**

## Orden de hitos (uno por turno)

| # | Dominio | Guard (nace rojo) | Estado |
|---|---------|-------------------|--------|
| 1 | Scheduler: `isDue`/`collectDue`/`collectDueOrdered` | `tests/schedulerSingleDefinition.test.ts` | HECHO (guard verde) |
| 2 | Utils con mismo dominio real (`dayKey`, `uncheckAll`, etc.) | por definir | PENDIENTE |
| 3 | Participantes: `fluParticipant.ts` vs `participantFloor.js` | por definir | PENDIENTE |
| 4 | Minutos: `minuteKnowledgeHelpers.ts` vs `minuteKnowledge.js` | por definir | PENDIENTE |
| 5 | Persistencia: `fluDatabase.ts` vs `fluStorage.js` (requiere migración) | por definir | PENDIENTE |

> **Medidor único de todo**: `node scripts/auditoria.mjs` (reporte) y
> `node scripts/auditoria.mjs --strict --only <ID>` (gate del hito). IDs: D1..D4,
> V1..V8, N1. HOY: 1/12 en META (D1). Congelado por hash.


> Los pares con **mismo nombre pero distinta forma de dato** (p. ej.
> `editableFieldsOf` de paleta vs ambiente) NO son duplicación: no se tocan.

## Hito 1 — Scheduler (detalle)

**Objetivo**: la lógica de vencimiento (`isDue`/`collectDue`/`collectDueOrdered`)
vive en un solo archivo; `reminderScheduler.ts` deja de reimplementarla.

**Dueño canónico**: `src/core/temporal/scheduleEngine.ts`.

**Diseño acordado**:
1. En `scheduleEngine.ts`, generaliza por campo de tiempo (p. ej.
   `collectDueBy(items, getTime, ...)` / `collectDueOrderedBy(...)`) y deja
   `collectDue`/`collectDueOrdered` como la especialización de `nextAt`.
2. En `reminderScheduler.ts`: **borra** las declaraciones `export function` de
   los 3 símbolos. Re-exporta `isDue` desde `scheduleEngine` y expón
   `collectDue`/`collectDueOrdered` como **adaptadores** (`export const ... =`)
   que **delegan** en `scheduleEngine` usando `getTime = (i) => i.dueAt`.
3. `nextDueIn` (no duplicado) se queda donde está.
4. **No** tocar consumidores ni tests: `useReminders.ts` y
   `reminderScheduler.test.ts` deben seguir pasando sin cambios.

**Criterio de aceptación**:
- `isDue`/`collectDue`/`collectDueOrdered` se declaran una sola vez (`export function`) en `scheduleEngine.ts`.
- Los tests actuales del dominio pasan **sin editarlos**.
- 0 fallos nuevos.

## Reglas duras para la sesión ejecutora
- allow: `src/core/temporal/scheduleEngine.ts`, `src/core/reminders/reminderScheduler.ts`, `tests/schedulerSingleDefinition.test.ts`.
- deny: `.task/**`, `scripts/task-gate*.mjs`, `tests/*Guard*`, `tests/*guard*`, guards congelados.
- Prohibido editar tests existentes. Si hace falta, DETENTE y reporta.
- Prohibido "de paso"; hallazgo fuera de alcance se anota.

## Anexo — pendientes de la auditoría (NO cubiertos por el hito 1)

**Triage de D0 (catch-all) — HECHO: D0 = 0.** Los 17 sin clasificar quedaron así:

- **REALES (a unificar):**
  - Sumados a D2 (participantes): `canScheduleParticipantEvaluation`.
  - Sumados a D3 (minutos): `buildMinuteKnowledgeBase2`.
  - Nuevo **D5 (Hito 2) — utils/voice con misma lógica**: `normalizeForMatch`, `hasToken`,
    `normalizeSpaces`, `cleanForSpeech`, `dayKey`, `compareAudioSignatures`,
    `countSpeechWords`, `getTranscriptDelta`, `wouldShrinkLog`. (HOY=19, META=9.)
- **COLISIONES (no unificar):** `stripDiacritics` (uno hace lowercase), `uncheckAll`
  (checked vs done), `buildGenerationPrompt` (docs vs visual), `formatSpeakerLabel`,
  `resolveConversationSpeaker` (firmas distintas), `getAsrSegmentationCfg` (throw vs {}).
  Documentadas en `ALLOW_COLLISION` de `scripts/auditoria.mjs`.

Duplicación estructural (requieren guard + diseño propio, uno por hito):
- H2 Utils con nombre repetido: `dayKey`, `uncheckAll`, `hasToken`, `normalizeForMatch`,
  `stripDiacritics`, `formatMinuteHistoryLabel`. Verificar cuáles son duplicación REAL
  (misma lógica) y cuáles solo comparten nombre (esos NO se tocan).
- H3 Participantes (~18 funciones): `src/lib/fluParticipant.ts` vs `src/voice/lib/participantFloor.js`.
  OJO: `FluParticipantSettingsPanel.jsx` importa AMBOS.
- H4 Minutos: `src/lib/minuteKnowledgeHelpers.ts` vs `src/voice/lib/minuteKnowledge.js`
  (duplicación anidada: helpers importa minuteKnowledge.js).
- H5 Persistencia: `src/core/db/fluDatabase.ts` (Dexie) vs `src/voice/lib/fluStorage.js`
  (IndexedDB crudo). RIESGO ALTO: toca datos; requiere migración explícita. ÚLTIMO.

Vicios contra reglas propias (cada uno merece su guard):
- IDs con `Date.now()+Math.random()` en vez de UUIDv4 (§3.6):
  `App.tsx:422`, `goalTracker.ts:116`, `backupSystem.ts:559`, `autoRecovery.ts:794`,
  `gemini.ts:830`, `videoAssembler.ts:68`.
- Catch vacíos que silencian (§2.6): 11 en `useFluVoiceAssistant.js` (`:1324`, `:1908`-`:1976`)
  + `gemini.js:1242`.
- `as any`: ~75 en `App.tsx`, ~24 en `appConfig.ts`.
- `console.log` residual: `App.tsx` (8), `useAvatarVoiceSync.ts` (18, gateados por debug),
  `autoRecovery`, `emotionEngine`, `BunnyModel`.
- Hardcode de contenido: `src/services/musicPlayer.ts:40-76` (URLs archive.org).
- Monkey-patch global: `src/avatar/lib/masterBinding.ts` (parchea `THREE.PropertyBinding.create`).
- Test deshabilitado: `tests/e2e/comandos-usuario-luis.spec.ts:85` (`describe.skip`).
- Residuo debug/dev: `src/dev/asrLab/AsrLab.tsx`, `src/voice/lib/fluDebug.js`,
  `src/voice/lib/fluTrace.js`, `src/voice/lib/listenLog.js`.
- `src/core/config/appConfig.ts:250-251`: URLs de ejemplo en lista de conectividad.

**Puntos ciegos del escáner (NO cubiertos por el catálogo):**
- Duplicación con MISMO nombre solo se detecta si el símbolo es `export`. Duplicados
  internos (no exportados) no se cuentan.
- Duplicación con DISTINTO nombre (misma lógica, otro nombre) no se detecta por nombre.
  Ejemplo revisado: `services/gemini.ts` (cliente `/api/...`) vs `voice/lib/gemini.js`
  (implementación canónica del proxy) — verificado que NO es duplicación de ruta.
- Boilerplate repetido dentro de un archivo (p. ej. 4× `fetch('/api/gemini/contract')`
  en `services/gemini.ts`): detectado a ojo, no por el catálogo.

NO tocar (falsos duplicados: mismo nombre, distinto dominio):
- `editableFieldsOf`/`emptyEditableFields` en `paletaFactory.ts` vs `ambienteFactory.ts`.
- `resolveGeminiApiKey` (firmas distintas: `appConfig.ts` no-arg vs `gemini.js` con arg).

Regla: cada hito = 1 dominio + 1 guard que nace rojo + medición ANTES/DESPUÉS.

