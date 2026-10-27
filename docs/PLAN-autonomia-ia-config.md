# PLAN · autonomía / IA / config (2026-10-22)

> **Nota (2026-10-27):** el CLI `npm run replay` se retiró con el corte de
> conversación; la medición vigente es `npm run playback`. Las referencias de abajo
> son registro histórico.

> **PARKED (2026-10-22):** fuera del alcance de esta sesión (conversación / transcripción /
> diarización). Los cambios de código de este plan están en el stash
> `fuera-de-alcance: autonomia/IA/imagen/config (2026-10-22)`; este documento se conserva
> como análisis, no como trabajo en curso.

**Origen:** auditoría de Kilo (17 puntos), **verificada por lectura** sobre `6d06ed34`
en la sesión del 2026-10-22. Complementa `docs/PLAN-voz-caja-rutas-dobles.md`:
aquel cubre conversación/transcripción/diarización; este cubre lo demás.

**Veredicto de la verificación:** 17/17 se sostienen. Matices:
- **P10** (normalizadores): en conversación NO se apilan dos reglas; el flujo es
  `normalizeMicText` (commit) + `cleanForSpeech` (log). La divergencia real es
  **entre modos**: escucha pasiva usa `normalizeTranscriptText` (24/2) y conversación
  usa `normalizeMicText` (48/bloques 4-14). `normalizeTurnCapture` decide por
  `conversationActive` (`turnTranscript.js:141-143`).
- **P9** (historial): no son dos escritores de la MISMA tabla; son la misma entidad en
  dos sistemas (`fluDb.sessionState.value.history` vs `fluDb.conversations`), y la copia
  no tiene lector (`useFluVoiceAssistant.js:668-681`). Sigue siendo ruta doble de datos
  (AGENTS §6.3), pero es **payload muerto**, no corrupción.
- **P5** (precisión): `completeText` sí manda timeout, pero **fijo**
  (`REQUEST_TIMEOUT_PRESETS.conversation`, `gemini.ts:107`) e ignora `request.timeoutMs`
  y `request.jsonMode`.

**Regla de oro de este plan:** nada declara «éxito» si no ocurrió. Ante cada sistema
simulado hay DOS salidas válidas y una prohibida: implementarlo, declararlo
deshabilitado en UI, o **mentir**. La tercera se elimina primero.

---

## Estado de ejecución (2026-10-22)

**Hecho:** A1, A2, A3 (las tres acciones devuelven `success:false` con motivo: ya no
declaran éxito sin efecto), A4 (`statusSince` + `consecutiveFailures` los sella el
monitor; el evaluador ya no mide contra `lastCheck` recién puesto), A5 (la UI ya no
promete recuperación automática), A6 (la optimización devuelve el número de propuestas
y la UI lo dice), A7 (se retiró la escritura de `flu-param-*`, que no tenía lector),
A10 (`ErrorBoundary` publica en `window.__FLU_CONSOLE_ERRORS`; el monitor ya no lee una
constante), B1 (el servicio de IA es un binding vivo: el proveedor aplica sin recargar),
B3 (el proxy respeta `jsonMode`, `timeoutMs` y el modelo; probado sobre el handler real),
B4 (test de `generateDocument`: jsonMode:false + deadline + modelo), C4 (la etiqueta
`Hablante N` se construye y se parsea con la plantilla), C5 (esperas fijas del TTS →
`waitForSpeechIdle`; pipeline de identidad por `onResolved`), C6 (los overrides solo
escriben el respaldo si falla el primario), C7 (`tickMs`/`autoStopMs` de agenda en
config), C8 (`history` ya no se duplica en `sessionState`), D1 (bloque vacío de
`ControlsPanel`), D3 (configs sin importadores), D4 (tablas de video a config),
D5 (idioma de OCR a config).

**Pendiente:** A8 (métricas reales + `this.config`: decisión D1), A9 (backup: decisión
D2), B2 (imagen: decisión D4), C1 (política de participación: decisión D3), C2
(regímenes de normalización: declarar o unificar), C3 (113 defaults de idioma: barrido
mecánico propio), D2 (`BunnyControlCenter`: conectar o borrar el panel con sus tests).

**Hecho ademas (seguridad):** A8 quedo **neutralizado**: la fuente de metricas es
'sample' y `allowSampleMetrics` es `false` en produccion, asi que el motor NO cambia el
proveedor con datos de ejemplo (con B1 el cambio se aplicaba al instante). Falta solo
decidir entre instrumentar metricas reales o retirar el motor.
---

## Fase A · P0 — quitar el éxito falso (antes de implementar nada)

| # | qué | evidencia | acción |
|---|---|---|---|
| A1 | Restauración de backup vacía que devuelve `success:true` y busca una clave que no existe | `autoRecovery.ts:479` (`flu-backup-<fecha>`) vs `backupSystem.ts:907` (`flu-backup-backup-<uuid>`); bloque vacío `:482-485`; `success:true` `:493-498` | conectar al `BackupSystem` real o devolver `success:false` con motivo |
| A2 | Reintento «con backoff» que solo duerme y reporta éxito | `autoRecovery.ts:331-341` | ejecutar la operación real o retirar la acción |
| A3 | «Reiniciar componente» que solo emite un evento | `autoRecovery.ts:386-411` | renombrar a `soft-restart` real o declararlo no-op |
| A4 | Reglas 1-6 inalcanzables: `minDurationMs` mide desde `lastCheck` recién puesto; `minConsecutiveFailures` exige incidentes que se crean DESPUÉS de elegir la regla | `autoRecovery.ts:638-643` vs `healthMonitor.ts:325,389,440,491,566,628,672`; incidente creado en `:794` | dueño del «desde cuándo está mal»: campo `statusSince` en `ComponentHealth` |
| A5 | La UI afirma «puede recuperarse automáticamente» con monitor no-op | `useAutonomyIntegration.ts:256-277`, `autoRecovery.ts:736-738` | conectar monitor o declarar el sistema inactivo |
| A6 | Optimización manual notifica éxito con historial vacío | `autoOptimization.ts:235-238,807-820`; `useAutonomyIntegration.ts:593-598` | notificar según resultado real (`optimized: 0`) |
| A7 | Parámetros optimizados a `flu-param-*`, que nadie lee | `autoOptimization.ts:607-620` (único sitio que menciona la clave) | escribir en el dueño real del parámetro o retirar |
| A8 | Decisiones con métricas de ejemplo y compuertas hardcodeadas | `decisionEngine.ts:386-409,442,447,474` | alimentar `recordProviderMetrics` desde el motor real y leer `this.config` |
| A9 | Backup «comprimido/incremental» que no comprime ni incrementa | `backupSystem.ts:985-993`; `strategy` solo en metadata `:693-697`; `DEFAULT_BACKUP_CONFIG` en save/load/cleanup `:908,940,846-855` y en la instancia `:1028` | comprimir de verdad o renombrar la estrategia; usar `this.config` |
| A10 | Telemetría de salud simulada: `errorBoundaryActive:true` constante y `window.__FLU_CONSOLE_ERRORS` que nadie escribe | `healthMonitor.ts:645-658,652`; `fluWindow.d.ts:56`; `ErrorBoundary.tsx:28-30` | que `ErrorBoundary` publique; si no, quitar la métrica |

**Aceptación:** ningún camino devuelve `success:true` sin efecto observable; las reglas
de recuperación se ejercitan con un `ComponentHealth` sintético que las dispare (test).

---

## Fase B · P0 — ajustes que no aplican

| # | qué | evidencia | acción |
|---|---|---|---|
| B1 | Cambiar proveedor de IA en Ajustes no cambia el motor hasta recargar | `aiServiceFactory.ts:72-74,142`; consumidores `useAppAnalysis.ts:12`, `useDocumentAnalysis.ts:13`, `useMinuteHandlers.ts:14`, `useDocumentGeneration.ts:13`, `useFluParticipant.ts:10`, `useWorkspaceImage.ts:15`; `App.tsx:1027` | servicio que resuelve proveedor POR LLAMADA (o recrear el singleton al cambiar) |
| B2 | Ajustes de imagen (modelo y key) sin consumidor; dos pipelines de imagen | `useConfigPersistence.ts:126-128,267-295`; solo `IMAGE_API_URL` se lee (`appConfig.ts:473`); `visualConfig.js:39` (`flux`) | un solo pipeline de imagen y el modelo/key desde el configurador |
| B3 | `/api/gemini/text` fuerza `json_object` a todo endpoint remoto, ignora `jsonMode`/`timeoutMs` y no manda el modelo configurado | `geminiProxy.ts:691,715-716,719`; `gemini.ts:97-107`; contrato `aiServiceBase.ts:147-154` | el proxy respeta `jsonMode`, `timeoutMs` y `model` del contrato |
| B4 | Generación de documentos puede recibir JSON y no tiene deadline propio | `aiServiceBase.ts:504-510` vs B3 | cubierto por B3 + test de `generateDocument` |

**Aceptación:** cambiar el proveedor/modelo en Ajustes cambia la siguiente llamada sin
recargar (test de integración del factory); un documento generado no vuelve envuelto en
JSON; `fetch` con deadline en el proxy.

---

## Fase C · P1 — divergencias y rutas dobles

| # | qué | evidencia | acción |
|---|---|---|---|
| C1 | Defaults de participación duplicados y divergentes (`enabled`, 15000/180000, 0.5/0.65, 10/12, 20/5, 20/24, 10/8, 3000/12000) | `fluParticipant.ts:89-107` vs `fluConfig.js:1686-1709`; merge en `useFluParticipant.ts:94-104` | una sola fuente: `FLU_CONFIG.fluParticipant`; los tests usan la de producción |
| C2 | Dos regímenes de normalización (pasiva vs conversación) | `turnTranscript.js:132-143`; `speechMerge.js:192-199`; `conversationStreamCommit.js:1003` | declarar el régimen por modo o unificar el colapso |
| C3 | `language = 'es'` / `\|\| 'es'` repetido 113 veces | `UI_DEFAULTS.LANGUAGE` (`appConfig.ts:333`); p.ej. `fluSpeech.js:326`, `deterministicArbiter.js:136`, `geminiProxy.ts:369`, `gemini.ts:137` | resolver por defecto único (Anexo B.8) |
| C4 | Etiqueta `Hablante N` hardcodeada frente a plantilla configurable | `speakerCore.js:80,91`; `speakerLabels.js:98`; plantilla `fluConfig.js:88` | parsear con la plantilla (misma fuente que la construcción) |
| C5 | Esperas fijas donde ya hay promesa/evento | `App.tsx:3693-3699,3717-3719,3740-3742`; `waitForSpeechIdle` `fluSpeech.js:228`; sondeo 30 ms `turnIdentityPipeline.js:184-195` | `await waitForSpeechIdle()` / `onResolved` |
| C6 | Overrides del buscador escritos en DOS almacenes siempre | `searchConfigOverrides.ts:291-318` (295 y 313) | escribir respaldo SOLO si el primario falló |
| C7 | Agenda: `tickMs` 15000 y `autoStopMs` 30000 fuera de config | `useAgenda.ts:78,109`; `FLU_CONFIG.agenda` `fluConfig.js:452-489` | declarar en config |
| C8 | Historial de conversación en dos sistemas; copia sin lector | `fluStorage.js:87-116`; escritores `useFluVoiceAssistant.js:1015…4046`; lectura ignorada `:668-681`; canónico `useConversationPersistence.ts:28-30` | un solo almacén; retirar `history` de `sessionState` |

**Aceptación:** por fila, un commit; los tests de cada dominio usan la MISMA config que
producción (C1 es el caso crítico: hoy pueden estar verdes con otra política).

---

## Fase D · P2 — basura declarada

| # | qué | evidencia |
|---|---|---|
| D1 | `ControlsPanel` con `if (logsEnabled) {}` vacío y botones que solo loguean | `avatar/components/ControlsPanel.tsx:95-104` |
| D2 | `BunnyControlCenter` exportado y nunca importado | `avatar/index.ts:27` |
  **CERRADO (2026-10-22):** pantalla eliminada con su test y su CSS (`-252` lineas; ningun
  importador en `src`, `tests` ni `e2e`). `BunnyViewer` pasa a resolver el color del estado con
  `bunnyStateColor` (dueno unico en `bunnySceneConfig`), que era el pendiente declarado del
  ledger. `gate`, `npm test` y `build` verdes. |
| D4 | `videoAssembler` declara «NO HARDCODE» junto a tablas locales | `services/videoAssembler.ts:119-134` |
| D5 | OCR fija `'spa+eng'` sin derivar del idioma activo | `services/ocrService.ts:51` |

**Aceptación:** se borra lo muerto (Git es el respaldo) o se conecta; no se deja
«declarado» sin dueño.

---

## Tests que hoy fijan la simulación (actualizar al arreglar)

AGENTS §4: si un test mide una regla obsoleta, se corrige **y se declara**. Estos
existen y están verdes; ninguno prueba la ruta real:

| Test | Qué fija hoy | Acción |
|---|---|---|
| `tests/autoRecovery.test.ts:50-126` | solo el `ConditionEvaluator`, con `lastCheck` viejo **inyectado**; la ruta real (health fresco) nunca se ejerce | añadir test de la **ruta real** (`evaluateAndRecover` con health recién medido); A4 |
| `tests/decisionEngine.test.ts:173` | un caso llamado **«HALLAZGO: los VALORES salen de la muestra de config»**: declara el defecto como esperado | reescribir cuando `recordProviderMetrics` tenga llamador real; A8 |
| `tests/useAutonomyIntegration.test.tsx:33-45,65` | mockea `startGlobalAutoRecovery` con `setHealthMonitor: () => {}` y afirma `autoRecovery: true` | al conectar el monitor, el mock deja de ser no-op; A5 |
| `tests/autoOptimization.test.ts:50-83` | usa `recordMetrics` directo, no `recordPerformanceMetrics` ni el camino que notifica | cubrir el camino real; A6 |
| `tests/fluParticipant.test.ts` | usa `DEFAULT_PARTICIPANT_CONFIG` en todo el archivo | pasa a la config de producción; C1 |
| `tests/searchOverridesStorage.test.ts:62-69` | cubre el respaldo con cuota llena, **no** la escritura doble con localStorage sano | añadir el caso «limpiar localStorage no resucita el valor viejo»; C6 |

**Regla:** un test que hoy pasa por un mock no es evidencia de que el efecto ocurra.

---

## Decisiones del dueño (bloquean la fase)

| Decisión | Opciones | Bloquea |
|---|---|---|
| D1 · Restaurar backup / reintentar / reiniciar | (a) implementar contra `BackupSystem` real, (b) devolver `success:false` y declararlo en UI | A1-A3 |
| D2 · Backup «comprimido/incremental» | (a) comprimir de verdad (dependencia nueva), (b) renombrar la estrategia y no prometer compresión | A9 |
| D3 · Política de participación canónica | ¿`enabled` true o false? ¿180 s o 15 s? ¿0.65 o 0.5? | C1 |
| D4 · Ajustes de imagen | (a) modelo+key se usan en la generación, (b) se retiran del configurador | B2 |
| D5 · Optimización de parámetros | (a) escribir en el dueño real del parámetro, (b) retirar la acción y su mensaje | A7 |

Sin D1-D5 no se toca el código: elegir por iniciativa propia cambia la política del
producto.

---

## Qué NO tocar

- ASR, VAD, diarización, vectors y `scripts/replay/**`: son la herramienta de medida.
- El `expected` real y la transcripción del dueño: nunca se commitean.
- Datos del usuario (participantes, anclas, historial): una migración se hace en el
  dueño del dato, no en un `useEffect`.
- La suite completa: es del CI (§1.15).
- Nada se commitea sin pedido expreso.

---

## Validación (por fase)

```bat
npm run test:file <test del área tocada>
npm run test:grep -- "<caso>"
npm run lint
npm run typecheck
npm run gate
npm run build
```

- Suite completa: PROHIBIDA (§1.15).
- Capa de composición obligatoria cuando se toque voz (`useFluVoiceAssistant`).
- Lo que no se pueda implementar sin decisión de producto (A1/A3/A9: ¿implementar o
  declarar?) se lleva al dueño con la propuesta; no se decide por iniciativa propia.

---

## Orden recomendado (una tarea a la vez)

1. `docs/PLAN-voz-caja-rutas-dobles.md` Fases 0-3: el único defecto **reproducido con
   el runner** y con barrera invertida. Es pequeño y contiene el síntoma del dueño.
2. Fase A (éxito falso), empezando por A1-A5: es lo que la UI afirma y no ocurre.
3. Fase B (ajustes inertes), B1 primero: el ajuste de proveedor es el más visible.
4. Fase C, C1 primero (tests que miden otra política).
5. Fase D al final, en el mismo commit que toque cada zona.

**No se mezcla** con el plan de voz: son dominios distintos y juntarlos rompe
«una sola tarea a la vez».
