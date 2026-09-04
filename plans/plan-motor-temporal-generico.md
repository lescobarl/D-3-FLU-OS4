# Plan — Motor Temporal Genérico (Alarmas, Despertador y Temporizador)

**Fase:** 1D · **Requiere:** Fase 1C (horario) cerrada y respaldada (seq-6).
**Autor:** FLU OS4 · **Estado:** Implementación autorizada por el usuario ("implementa esto").

---

## 1. Problema

El usuario pidió gestionar alarmas, despertador y temporizador. Al analizar el sistema
existente se confirmó que **solo existen recordatorios de un solo disparo** (sin
recurrencia, sin cuenta regresiva, sin sonido). Construir **tres subsistemas a medida**
(uno por característica) sería exactamente lo que el usuario rechazó: _"debemos de pensar
más genérico"_.

## 2. Idea central: 1 motor, N dominios

Un **recordatorio**, una **alarma** y un **temporizador** son el mismo concepto:

```
DISPARADOR (cuándo se activa) + RECURRENCIA (cómo se repite) + ENTREGA (cómo avisa)
```

- **Disparador (trigger):** `absolute` (timestamp fijo) · `daily` (hora del día `HH:MM`) · `countdown` (duración ms).
- **Recurrencia:** `once` · `daily` · `weekdays` (días 0-6) · `interval` (cada N ms).
- **Entrega:** toast + voz + tono WebAudio (config-driven).

Con esto, el **mismo motor** resuelve:

| Dominio | Disparador | Recurrencia típica |
|---|---|---|
| Recordatorio | `absolute` | `once` (o `daily`/`weekdays` con `repeat`) |
| Alarma / despertador | `daily` (`HH:MM`) | `daily` o `weekdays` |
| Temporizador | `countdown` | `once` |

## 3. Entregables (por orden de validación)

1. **`src/core/temporal/temporalTypes.ts`** — tipos compartidos (trigger, recurrencia, ítem persistente).
2. **`src/core/temporal/scheduleEngine.ts`** — lógica pura: `nextOccurrence`, `firstDueAt`,
   `timerRemainingMs`, `formatCountdown`, `collectDueOrdered`. Sin DOM, sin Dexie, sin Gemini.
3. **`fluDatabase.ts` (v12 — SOLO ADD, reversible):** tabla `temporalItems` +
   campo `repeat?` en `ReminderRecord` para recordatorios recurrentes.
4. **`src/core/temporal/temporalService.ts`** — servicio DI (patrón `reminderService`):
   alta/consulta/complete/cancel/remove + auditoría + tope activo config-driven.
5. **`src/core/temporal/audioAlert.ts`** — motor de tono WebAudio con driver inyectable
   (para pruebas y degradación elegante si el navegador bloquea audio).
6. **`src/voice/lib/fluConfig.js`** — sección `temporal` (tickMs, graceMs, maxActive, sound, ui, voice).
7. **`src/core/temporal/temporalIntentParser.ts`** — intenciones es/en:
   `alarm.add|list|cancel`, `timer.start|list|cancel` + frases de recurrencia
   ("todos los días", "entre semana", "every day") y duraciones ("de 5 minutos").
8. **`src/hooks/useTemporalItems.ts`** — hook gemelo de `useReminders`: runTick,
   re-arm de recurrentes, notify + speak + sonido, auto-complete de un solo disparo.
9. **`src/components/TemporalItemsPanel.tsx`** — panel en settings → grupo "Gestión"
   (junto a Recordatorios y Compras), sin pestaña nueva (NO SEP).
10. **`src/App.tsx`** — importar hook, exponer `__fluHandleTemporalText`, ramas en el
    manejador de texto y render del panel.
11. **Pruebas:** `tests/scheduleEngine.test.ts`, `tests/temporalService.test.ts`,
    `tests/audioAlert.test.ts`, `tests/temporalIntentParser.test.ts`, E2E
    `tests/e2e/temporal-engine.spec.ts` + capturas en `reports/temporal-visual/`.
12. **Backup `seq-7`** (robocopy, dir con fecha LOCAL America/Mexico_City) + MANIFEST.

## 4. Reglas respetadas

- **Regla #1:** sin hardcode — todo límite/texto/intervalo vive en `FLU_CONFIG.temporal`.
- **No SEP:** el panel se suma al grupo de gestión existente, sin pestañas ni rutas nuevas.
- **Dexie SOLO ADD:** `version(12)` agrega la tabla `temporalItems`; no altera tablas previas.
- **Sin parches:** cambios estructurados; los tests existentes (reminderScheduler, reminderService,
  reminderIntentParser, remindersAgenda) **no se modifican**.
- **Validación:** unit → suite completa → E2E funcional → capturas → backup antes de continuar.

## 5. Cómo el motor reutiliza el patrón actual

- `scheduleEngine.collectDueOrdered` es el mismo patrón probado de `reminderScheduler`
  (candidato `{id, nextAt, status}`), reimplementado genérico para no acoplar el dominio
  temporal al dominio de recordatorios.
- `useTemporalItems` copia la estructura segura de `useReminders` (servicio en ref antes
  de `useState` para evitar TDZ, ref de guardia anti-solape, `now`/`notify`/`speak` inyectables).
- `temporalService` sigue el DI de `reminderService` (db/config/now/newId, auditoría, SyncTuple).

## 6. Límites honestos a documentar

- El navegador puede **bloquear audio** sin gesto previo del usuario: el tono WebAudio
  degrada a toast+voz (driver noop), nunca rompe el flujo.
- Las alarmas solo suenan si la PWA está abierta o el SW permite notificación;
  un despertador que debe sonar con el navegador cerrado exige permisos/Service Worker
  (misma limitación de Siri/Alexa locales).
