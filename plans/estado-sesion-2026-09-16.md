# Estado de sesión — 2026-09-16

> Rama: `feature/fase-conversacional-acciones` · HEAD: `08583ae` · Árbol limpio.
> Objetivo: consolidar el calendario (alarma/recordatorio/cita/junta/clase) en un
> solo modelo, un solo parser, un solo servicio, una sola tabla y un solo motor.

---

## 1. Estado técnico (verificado en HEAD `08583ae`)

- `npx tsc -b` → **0 errores**.
- `npm run test:full` → **219 archivos / 2.867 tests, 0 fallos** (55s).
- Árbol limpio (`git status` sin cambios).

---

## 2. Commits de la sesión (más reciente primero)

| Commit | Qué |
|---|---|
| `08583ae` | Borra hooks muertos `useReminders`/`useTemporalItems`. |
| `42483c9` | **Guard del swap de UI agenda (rojo → verde)**. |
| `cad9df7` | Contrato + report del swap de UI y limpieza de comentarios. |
| `40bf591` | Borra paneles viejos (`RemindersPanel`/`TemporalItemsPanel`/`HoyPanel`/`AgendaHub`) y sus tests. |
| `b831db3` | **Cablea `useAgenda` + `AgendaPanel`** en `App`/`FluSettingsTabView`/`WorkspaceHub`. |
| `e339c4d` | Porta el disparo seguro a `useAgenda` (`stopEpoch`/auto-stop/`stopRinging`/`ringing`). |
| `5671c9f` | docs(sesion): estado 2026-09-16 (versión previa, superada por este doc). |
| `26b89e1` | **Borra los 3 parsers viejos** (`reminderIntentParser`, `temporalIntentParser`, `horarioIntentParser`, `horarioVoiceEntry`, `temporalDedup`) + handlers en `App.tsx` + 12 tests. "Un solo parser". |
| `928449e` | `useAgenda` (motor runtime) + `AgendaPanel` (UI única) + `agendaService.complete()`. |
| `f56c9e9` | El árbitro **ya no enruta** a `reminder`/`temporal`/`horario`; todo pasa por `agendaCommand`/`shopping`/`diary`/`note`. |
| `10758ec` | Extrae `shopping` a `shoppingIntentParser` + dominio `shopping` (desacopla del calendario). |
| `0728091` | Consulta (hoy/mañana/semana/mes) y borrado de clase por materia+día en el parser/handler únicos. |

(Ayer: `52ffa2f` dictado de clase, `bf68623` lectura única, `6c58078` agendaSummary,
`dd42c12` tabla `agenda` v21, `ef75e25` migración, `1260167` motor puro, etc.)

---

## 3. Módulos nuevos (verdes)

| Módulo | Rol |
|---|---|
| `src/core/agenda/agendaModel.ts` | Tipos + reglas (trigger único, dedup, color, acción por tipo). |
| `src/core/agenda/agendaQuery.ts` | Ventanas día/semana/mes + tick. |
| `src/core/agenda/agendaCommandParser.ts` | Parser único de voz (create/cancel/update/list). |
| `src/core/agenda/agendaService.ts` | CRUD único (dedup, borrado lógico, complete). |
| `src/core/agenda/agendaMigration.ts` | Copia no destructiva de las 3 tablas viejas. |
| `src/core/agenda/agendaMotor.ts` | Motor puro de disparo (sonar/avisar/marcar). |
| `src/core/agenda/agendaSummary.ts` | Consulta única hablable. |
| `src/hooks/useAgenda.ts` | Motor runtime (lee `agenda`, dispara, completa; disparo seguro). |
| `src/components/AgendaPanel.tsx` | UI única día/semana/mes. |
| `src/core/reminders/shoppingIntentParser.ts` | Lista de compras separada. |
| `src/core/db/fluDatabase.ts` | Tabla `agenda` (Dexie v21 + migración). |

---

## 4. Hecho vs. pendiente (swap de UI)

### Hecho (borrados ya)
- Paneles: `HoyPanel`, `RemindersPanel`, `TemporalItemsPanel`, `AgendaHub`.
- Hooks: `useReminders`, `useTemporalItems`.
- Parsers viejos de voz (ver `26b89e1`).
- `useAgenda` + `AgendaPanel` cableados en `App`/`FluSettingsTabView`/`WorkspaceHub`.
- Guard del swap en verde (`42483c9`).

### TODAVÍA pendiente (doble ruta restante)
1. **`useHorario` + `HorarioPizarron` siguen vivos y cableados** (doble ruta contra
   `useAgenda`/`AgendaPanel`):
   - `src/App.tsx:117-118` imports (`useHorario`, `clasesDelDia`, `HorarioModo`).
   - `src/App.tsx:1579` `const horario = useHorario(...)`.
   - `src/components/HorarioPizarron.tsx` (componente).
   - Tests: `tests/horarioColorField.test.tsx`, `tests/e2e/pizarron-funcionalidades.spec.ts`.
2. **`reminderScheduler.ts`**: muerto en `src`, pero su test `tests/reminderScheduler.test.ts`
   sigue importándolo (test huérfano, a borrar).
3. **`audioAlert.ts`**: NO es deuda — se reutiliza legítimamente como driver WebAudio
   (`createWebAudioDriver`) desde `useAgenda.ts` y `App.tsx`. No borrar.

**Regla que lo obliga:** una sola fuente de verdad; no rutas en paralelo para el mismo
recurso. `useHorario`/`HorarioPizarron` es la ruta residual que aún debe eliminarse.

---

## 5. Respaldos (verificados)

`respaldo-2026-09-15-1` … `-8` (bundles en `backups/`, `git bundle verify` OK).

---

## 6. Cierre (honesto)

- **DoD-técnico**: cumplido (tsc 0, test:full 219/2.867 verde, árbol limpio, guard del swap verde).
- **Pendiente real**: eliminar la ruta residual `useHorario`/`HorarioPizarron` + borrar
  `tests/reminderScheduler.test.ts` huérfano.
- **DoD-producto**: validación en pantalla del usuario (agenda + sonido) — reservada al usuario.

**Última actualización:** 2026-09-16 · **HEAD:** `08583ae`
