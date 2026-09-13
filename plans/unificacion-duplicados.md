# Plan: eliminar rutas/símbolos duplicados (por hito)

> Este plan lo ejecuta una sesión distinta de la autora del criterio.
> Regla de oro: **un dueño de la lógica; el resto re-exporta o adapta. No se
> reescribe comportamiento. No se editan tests existentes para que pasen.**

## Orden de hitos (uno por turno)

| # | Dominio | Guard (nace rojo) | Estado |
|---|---------|-------------------|--------|
| 1 | Scheduler: `isDue`/`collectDue`/`collectDueOrdered` | `tests/schedulerSingleDefinition.test.ts` | EN CURSO |
| 2 | Utils con mismo dominio real (`dayKey`, `uncheckAll`, etc.) | por definir | PENDIENTE |
| 3 | Participantes: `fluParticipant.ts` vs `participantFloor.js` | por definir | PENDIENTE |
| 4 | Minutos: `minuteKnowledgeHelpers.ts` vs `minuteKnowledge.js` | por definir | PENDIENTE |
| 5 | Persistencia: `fluDatabase.ts` vs `fluStorage.js` (requiere migración) | por definir | PENDIENTE |

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
