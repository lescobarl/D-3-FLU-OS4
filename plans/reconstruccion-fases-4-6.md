# Reconstrucción de Fases 4–6 — Catálogo maestro A–J (transparente y auditable)

> **Contexto:** El catálogo maestro original de los Módulos A–J (Fases 4–6) **no está en disco**
> (búsquedas exhaustivas previas no lo localizaron). Ante la directiva vigente
> *"ejecutas todas las fases secuencialmente, no te detengas"* y la interrupción de una
> solicitud de aclaración, se procedió **autónomamente** a reconstruir el alcance de las
> Fases 4–6 como módulos coherentes y **no solapados**, siguiendo el patrón exacto ya
> establecido y validado (Fase 3 = `participants` + `materiaGris`).
>
> Este documento es la **traza de reconstrucción**: qué se asume, qué se implementa,
> cómo se valida. Todo cambio sigue: Regla #1 (sin hardcode → `FLU_CONFIG`),
> Obligación #5 (auditoría), Obligación #6 (UUIDv4), Obligación #7 (SyncTuple).

---

## Estado del catálogo A–J (verificado en disco)

### Ya construido y validado (Fases 1–3)
| Módulo | Estado | Evidencia |
|---|---|---|
| A1/A2 PWA + Service Worker | ✅ | `public/sw.js`, `public/manifest.webmanifest` |
| B2 Notificaciones | ✅ | `src/core/notifications` |
| D1 Onboarding | ✅ | `src/core/onboarding`, `OnboardingOverlay.tsx` |
| D3 No molestar (DND) | ✅ | `src/core/dnd` |
| B1/B4/B10 Recordatorios | ✅ | `src/core/reminders` (B3 scheduler, B11 autor) |
| B5 Agenda del día | ✅ | `src/lib/dailyAgenda.ts` |
| B8 Lista de compras | ✅ | `src/core/reminders/shoppingService.ts` |
| A3/A4/A5 Multi-usuario | ✅ | `src/core/multiuser/participantRegistry.ts` |
| B9 Cumpleaños | ✅ | `participantRegistry.participantsWithBirthdayNear` |
| F5 Materia gris | ✅ | `src/core/multiuser/materiaGrisService.ts` |

### Huecos reales detectados (Fases 4–6) — NO tienen módulo persistente ni panel
- **Hábitos y Metas (Módulo G)** — solo existe `src/lib/goalTracker.ts`, que es un
  tracker **de sesión de conversación** (puro, sin DB ni panel), NO cubre hábitos/metas
  personales persistentes por participante.
- **Bienestar / Ánimo (Módulo H)** — no hay tabla, servicio ni panel de registro de ánimo.
- **Contactos (Módulo I)** — no hay tabla ni panel de contactos.
- **Diario personal (Módulo J)** — no hay tabla ni panel de diario.

---

## Reconstrucción propuesta (Fases 4–6)

| Fase | Módulo(s) | Alcance reconstruido |
|---|---|---|
| **Fase 4** | **G — Hábitos y Metas** | Hábitos/metas persistentes por participante con rachas (streaks) y check-in diario; integrado con Materia Gris (F5) por `participantId`. |
| **Fase 5** | **H — Bienestar / Ánimo** | Registro diario de ánimo por participante (1–5), nota, historial y resumen. |
| **Fase 6** | **I — Contactos** + **J — Diario personal** | Contactos con relación a `participants` (vinculación cumpleaños B9) y diario de voz/notas con fechas. |

Cada fase sigue el patrón: **tabla Dexie (v7/v8/v9) → servicio con DI → hook con
lazy-init → panel en tab Settings → `FLU_CONFIG` → tests unitarios → spec E2E** →
validación completa (`npm run build`, `npm test`, Playwright).

---

## Fase 4 — Módulo G: Hábitos y Metas (implementación)

### Tablas Dexie — `version(7)`
- `goals: 'id, participantId, status, category, createdAt'`
  - `GoalRecord { id, participantId, participantName?, title, description?, category, status: 'active'|'done'|'paused'|'archived', targetDays?, unit?, createdAt, updatedAt, sync }`
- `goalCheckIns: 'id, goalId, participantId, date, createdAt'`
  - `GoalCheckInRecord { id, goalId, participantId, date /* YYYY-MM-DD */, done, note?, createdAt, updatedAt, sync }`

### Servicio — `src/core/habits/habitService.ts`
`createHabitsService({ db: { goals, checkIns }, config, now, newId })` (patrón
`materiaGrisService`, verboatim): `buildSync`, auditoría en cada mutación, validación
de entrada, DI de reloj/id.

API:
- `addGoal(input)` → `{ ok, record } | { ok:false, reason:'invalid-input'|'limit-reached' }`
- `listGoals(participantId?)` → orden: activos primero, luego `createdAt` desc
- `checkIn({ goalId, date, done, note? })` → upsert diario + `streak` recalculado
- `getStreak(goalId, reference?)` → días consecutivos `done` hasta la fecha de referencia
- `getStats(participantId?)` → por meta: `completedDays`, `streak`, `progress`
  (`completedDays / targetDays` si aplica)
- `updateStatus(id, status)` → transición de estado (audita)
- `removeGoal(id)` → borra la meta **y sus check-ins** (audita ambos)

### Config — `FLU_CONFIG.habits` (sin hardcode)
`{ enabled, categories, defaultTargetDays, maxGoalsPerParticipant, ui, voice }`.

### Hook — `src/hooks/useHabits.ts` (patrón `useMateriaGris`, lazy-init anti-TDZ)
`useHabits({ now })` → `{ service, goals, stats, loading, refresh, addGoal, checkIn, updateStatus, removeGoal }`.

### Panel — `src/components/HabitsPanel.tsx`
Formulario de alta (participante + título + categoría + días objetivo), lista de metas
con racha/progreso, check-in de hoy, cambio de estado, borrado. Testids `habits-*`.

### Pruebas
- `tests/habitsService.test.ts` — mock `addAuditLog` + Map-based in-memory db, reloj fijo
  `NOW = 2026-01-15T10:00`.
- `tests/e2e/pwa-habits.spec.ts` — alta → check-in → racha → reload → persistencia.

---

## Trazabilidad
- Cada archivo nuevo declara su fase/módulo en el header (convención del repo).
- Sin parches: todo pasa por el patrón service/hook/panel/config.
- La validación productiva es: `npm run build` (= `tsc -b` + `vite build`),
  `npm test` (= `vitest run`, suite creciente), y la suite E2E combinada con el nuevo spec.
