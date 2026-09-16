# Estado de sesión — 2026-09-16

> Rama: `feature/fase-conversacional-acciones` · HEAD: `26b89e1` · Árbol limpio.
> Objetivo: consolidar el calendario (alarma/recordatorio/cita/junta/clase) en un
> solo modelo, un solo parser, un solo servicio, una sola tabla y un solo motor.

---

## 1. Estado técnico (verificado)

- `npx tsc -b` → **0 errores**.
- `npm run test:full` → **223 archivos / 2.890 tests, 0 fallos**.
- `npm run lint` → 40/40 (guards).

---

## 2. Commits de la sesión (más reciente primero)

| Commit | Qué |
|---|---|
| `26b89e1` | **Borra los 3 parsers viejos** (`reminderIntentParser`, `temporalIntentParser`, `horarioIntentParser`, `horarioVoiceEntry`, `temporalDedup`) + sus handlers en `App.tsx` + 12 tests. "Un solo parser". |
| `928449e` | `useAgenda` (motor runtime) + `AgendaPanel` (UI única) + `agendaService.complete()`. |
| `f56c9e9` | El árbitro **ya no enruta** a `reminder`/`temporal`/`horario`; todo pasa por `agendaCommand`/`shopping`/`diary`/`note`. |
| `10758ec` | Extrae `shopping` a `shoppingIntentParser` + dominio `shopping` (desacopla del calendario). |
| `0728091` | Consulta (hoy/mañana/semana/mes) y borrado de clase por materia+día en el parser/handler únicos. |
| `52ffa2f` | Dictado de clase ("agrega matemáticas el lunes a las 8") como weekly. |
| `bf68623` | Lectura única ("qué hay para hoy") desde la tabla `agenda`. |
| `6c58078` | `agendaSummary` (consulta hablable día/semana/mes). |

(Antes de hoy: `dd42c12` tabla `agenda` v21, `ef75e25` migración no destructiva,
`1260167` motor puro `agendaMotor`, `633d876` cableado de escritura, etc.)

---

## 3. Módulos nuevos (todos verdes, en `src/core/agenda/` + hooks/components)

| Módulo | Rol |
|---|---|
| `agendaModel.ts` | Tipos + reglas (trigger único, dedup, color, acción por tipo). |
| `agendaQuery.ts` | Ventanas día/semana/mes + tick. |
| `agendaCommandParser.ts` | Parser único de voz (create/cancel/update/list). |
| `agendaService.ts` | CRUD único (dedup, borrado lógico, complete). |
| `agendaMigration.ts` | Copia no destructiva de las 3 tablas viejas. |
| `agendaMotor.ts` | Motor puro de disparo (sonar/avisar/marcar). |
| `agendaSummary.ts` | Consulta única hablable. |
| `src/hooks/useAgenda.ts` | Motor runtime (lee `agenda`, dispara, completa). |
| `src/components/AgendaPanel.tsx` | UI única día/semana/mes. |
| `src/core/reminders/shoppingIntentParser.ts` | Lista de compras separada. |
| `src/core/db/fluDatabase.ts` | Tabla `agenda` (Dexie v21 + migración). |

---

## 4. Lo que FALTA (único pendiente): swap de UI/hooks

La lógica está 100% unificada. Falta reemplazar la UI vieja por la nueva:

1. **Reemplazar paneles**: `HoyPanel`, `HorarioPizarron`, `RemindersPanel`,
   `TemporalItemsPanel` → `AgendaPanel` (ya construido).
   - Dependencias vivas: `WorkspaceHub.tsx:25,166,168,831` (HoyPanel/HorarioPizarron),
     `HoyPanel.tsx` → `AgendaHub` + `HorarioPizarron`,
     `FluSettingsTabView.tsx:24,72,74,169,170` (RemindersPanel/TemporalItemsPanel),
     `ResultFeed.tsx:13` (AgendaHub).
2. **Reemplazar hooks**: `useReminders`, `useTemporalItems`, `useHorario` → `useAgenda`.
   - Usos en `App.tsx`: instanciación (1433/1440/1529), scheduler (1636),
     import de horario desde imagen (1545), props a paneles (~5026-5070, 5232-5271).
3. **Borrar** los 4 paneles + 3 hooks + `reminderScheduler.ts` + `audioAlert.ts` + sus ~10 tests.

**Bloqueo honesto:** este swap es un cambio de UI de ~20 sitios en `App.tsx` +
3 hubs, con el import de horario desde imagen de por medio. No se ejecutó a ciegas
para no romper el verde (regla "sin afectar lo ya validado").

---

## 5. Respaldos (verificados)

`respaldo-2026-09-15-1` … `-8` (bundles en `backups/`, `git bundle verify` OK).

---

## 6. Cierre (honesto)

- **DoD-técnico**: cumplido (tsc 0, lint 40/40, test:full verde, árbol limpio).
- **DoD-producto**: el swap de UI/hooks y la validación en pantalla quedan pendientes.
- El ruteo de voz no tiene rutas dobles y los parsers viejos están eliminados.

**Última actualización:** 2026-09-16 · **HEAD:** `26b89e1`
