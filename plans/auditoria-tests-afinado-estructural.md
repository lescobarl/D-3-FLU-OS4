# Auditoría de Tests — Afinado Estructural (Paso 3C)

> **Plan origen:** [`plan-afinado-estructural-2026-09-04.md`](plan-afinado-estructural-2026-09-04.md) — Paso 3C.
> **Fecha:** 2026-09-04.
> **Riesgo:** bajo (no se borra nada; solo se audita, prioriza y documenta).
> **Objetivo:** marcar los tests de bajo valor (falsa confianza) y priorizar ~15-20 tests de **integración del flujo completo** sobre la batería de unitarios de juegos/parsers individuales.

---

## 1. Contexto del problema

El defecto raíz del proyecto (rutas dobles de resolución de voz) **no lo detectan** los unitarios de módulos aislados (juegos, parsers, servicios individuales). Esos tests validan que una función pura devuelve lo esperado, pero **no** que el flujo real `voz → contrato → acción → UI` funcione sin duplicar efectos ni llamar a Gemini cuando no debe.

Por eso el plan prioriza una batería reducida de tests de integración del flujo completo como **red de seguridad principal**, manteniendo los unitarios como red secundaria (sin borrarlos).

---

## 2. Inventario y clasificación de la suite

La suite de `tests/` se clasifica en 4 categorías según su valor para detectar los defectos de integración del plan.

### Categoría A — INTEGRACIÓN DEL FLUJO DE VOZ (ALTO VALOR) ✅

Estos tests ejercitan el flujo real voz→contrato→acción o el árbitro determinista puro que decide la ruta. Son la **red de seguridad principal** del plan.

| Archivo | Qué valida | Valor |
|---------|-----------|-------|
| [`deterministicArbiter.test.ts`](tests/deterministicArbiter.test.ts) | Árbitro puro: 6 dominios (config/juego/ambiente/navegación/horario/búsqueda) + semántica "no Gemini si hay match" (§2B/3B) + cortesía verbal | **CRÍTICO** |
| [`voiceFlowIntegration.test.ts`](tests/voiceFlowIntegration.test.ts) | Flujo voz→acción real: branding off, dictado de horario, generación doc/video, guard de arquitectura de dispatch, búsqueda web determinista (§2D) | **CRÍTICO** |
| [`configCommands.test.ts`](tests/configCommands.test.ts) | Resolución de comandos de configuración (100 tests) — parser de config que alimenta el árbitro | ALTO |
| [`gameCommands.test.ts`](tests/gameCommands.test.ts) | Resolución de comandos de juego que alimenta el árbitro | ALTO |
| [`environmentIntents.test.ts`](tests/environmentIntents.test.ts) | Resolución de intenciones de ambiente que alimenta el árbitro | ALTO |
| [`horarioIntentParser.test.ts`](tests/horarioIntentParser.test.ts) | Parser de dictado de horario (alimenta el fast-path 2C) | ALTO |
| [`workspaceContractHorario.test.ts`](tests/workspaceContractHorario.test.ts) | Normalización de contratos de workspace (doc/video/horario) para su dispatch | ALTO |
| [`voiceCommandAnalysis.test.ts`](tests/voiceCommandAnalysis.test.ts) | Análisis de comandos de voz | ALTO |
| [`conversationFlow.test.ts`](tests/conversationFlow.test.ts) | `analyzeConversationFlow` / `buildFlowContext` (cuándo responder) | ALTO |
| [`idleDeterministicBehavior.test.ts`](tests/idleDeterministicBehavior.test.ts) | Comportamiento determinista en idle | ALTO |
| [`stability-guards.test.ts`](tests/stability-guards.test.ts) | Guardas de estabilidad del flujo | ALTO |
| [`architecture.test.ts`](tests/architecture.test.ts) | Guardas de arquitectura (dispatch por tipo, capas) | ALTO |

### Categoría B — INTEGRACIÓN DE SERVICIOS/DATOS (VALOR MEDIO-ALTO) 🟡

Validan integraciones reales entre módulos (no solo funciones aisladas), pero no el flujo de voz.

| Archivo | Qué valida |
|---------|-----------|
| [`integration.test.ts`](tests/integration.test.ts) | Integración de stores/bridge/avatar (2800 líneas) |
| [`e2e-productive-flows.test.ts`](tests/e2e-productive-flows.test.ts) | Flujos productivos completos (2090 líneas) |
| [`os3-features.test.ts`](tests/os3-features.test.ts) | Features OS3 |
| [`os3-productive-validation.test.ts`](tests/os3-productive-validation.test.ts) | Validación productiva OS3 |
| [`validateIntegralCtx.test.ts`](tests/validateIntegralCtx.test.ts) | Validación de contexto integral |
| [`translationIntegration.test.ts`](tests/translationIntegration.test.ts) | Traducción multiturn |
| [`fluParticipantRealEval.test.ts`](tests/fluParticipantRealEval.test.ts) | Evaluación real de participante |
| [`searchProxy.test.ts`](tests/searchProxy.test.ts) | Proxy de búsqueda |
| [`streamSttProvider.test.ts`](tests/streamSttProvider.test.ts) | Proveedor STT |
| [`localAi.test.ts`](tests/localAi.test.ts) | IA local |
| [`localTranslate.test.ts`](tests/localTranslate.test.ts) | Traducción local |
| [`localTts.test.ts`](tests/localTts.test.ts) | TTS local |

### Categoría C — UNITARIOS DE DOMINIO (VALOR MEDIO) 🟢

Validan parsers/servicios de un dominio concreto. Útiles como red secundaria, pero **no** detectan rutas dobles.

`reminderIntentParser`, `remindersDateParser`, `reminderService`, `reminderScheduler`, `remindersAgenda`, `temporalIntentParser`, `temporalService`, `deviceActionIntentParser`, `deviceActionService`, `diaryService`, `notesService`, `shoppingService`, `shoppingList`, `moodService`, `habitsService`, `contactsService`, `communicationProfileService`, `materiaGrisService`, `notificationService`, `onboardingService`, `onboardingFlow`, `horarioService`, `scheduleEngine`, `documentParser`, `documentChunker`, `documentGenerationStore`, `minuteKnowledgeHelpers`, `generationPrompts`, `analysisFallbacks`, `appAnalyzer`, `exportUtils`, `formatAdapters`, `emotionalState`, `theoryOfMind`, `userEmotionDetector`, `preferenceLearner`, `proactiveEngine`, `goalTracker`, `forgettingCurve`, `memoryConsolidation`, `longTermMemory`, `systemEventLog`, `discourseMarkers`, `transcriptQuality`, `catalogRegistry`, `participantRegistry`, `participantProfiles`, `environmentRegistry`, `environmentStore`, `environmentPrompt`, `dynamicAmbientes`, `dynamicPaletas`, `decorationsCatalog`, `seasonalEffects`, `searchCatalog`, `searchConfigOverrides`, `searchLanguage`, `searchSession`, `browserNavigation`, `browserProfileService`, `browserReadability`, `browserSession`, `musicCapabilities`, `musicSearch`, `videoAssembler`, `httpClient`, `configEnv`, `voiceConfigCatalog`, `fluParticipant`, `fluParticipantHook`, `fluSpeech-japanese`, `language-regression`, `simpleRequestDetection`, `speechMerge`, `turnSpeakerCommit`, `speakerSoloCoalesce`, `transcriptionDedupLoss`, `audioAlert`, `dndPolicy`, `conversationFlow`.

### Categoría D — UNITARIOS DE JUEGOS/ACTIVIDADES (BAJO VALOR PARA EL PLAN) 🔴

Batería de juegos/actividades individuales. **Falsa confianza** respecto al defecto central: validan que cada juego responde a su frase, pero **no** que el flujo de voz las enrute correctamente ni que no haya doble habla/efecto. Son los que el plan marca como de menor prioridad (sin borrarlos).

`abecedario`, `adivinaCancion`, `adivinaNumero`, `ahorcado`, `calculoMental`, `cuentaConmigo`, `cuentoColaborativo`, `karaoke`, `loteria`, `memoriaSecuencias`, `ordenaSecuencia`, `palabrasEncadenadas`, `quienSoy`, `repiteTraduce`, `respiracion`, `riddles`, `selfKnowledge`, `simonDice`, `storyteller`, `trabalenguas`, `trivia`, `veoVeo`, `gameCatalog`, `gameEngine`, `gameSpeech`, `animationConsistency`.

> **Nota:** los unitarios de juegos son valiosos para el equipo de contenido (regresión de cada actividad), pero **no** son la red de seguridad del afinado estructural. Se conservan, solo se despriorizan en la jerarquía de validación.

---

## 3. Batería priorizada de integración del flujo completo (~15-20)

Estos son los tests que **deben pasar siempre** antes de considerar un cambio de voz como seguro. Cubren el flujo real y los defectos de rutas dobles.

### Núcleo del flujo voz→acción (12 tests críticos)

1. **`deterministicArbiter` — "resuelve el dominio de configuración (branding off)"** → `desactiva la temporada` → config `mode=disabled`.
2. **`deterministicArbiter` — "resuelve el dominio de juego (inicio de adivinanzas)"** → `juguemos a las adivinanzas` → game.
3. **`deterministicArbiter` — "resuelve el dominio de ambiente (activar chef)"** → environment.
4. **`deterministicArbiter` — "resuelve el dominio de navegación (búsqueda web)"** → navigation/BUSCAR.
5. **`deterministicArbiter` — "resuelve el dominio de horario (agregar por dictado)"** → horario.add.
6. **`deterministicArbiter` — "con flag activo y match config produce contrato determinista (NO llama a Gemini)"** (§2B/3B).
7. **`deterministicArbiter` — "con flag activo y match juego produce contrato con respuesta_voz vacía (motor habla)"** (§2B/3B — evita doble habla).
8. **`deterministicArbiter` — "con flag activo y match ambiente produce contrato con respuesta_voz vacía"** (§2B/3B).
9. **`voiceFlowIntegration` — "resuelve 'desactiva la temporada' a mode=disabled sin depender de Gemini"** (regresión 2.1).
10. **`voiceFlowIntegration` — "encadena parseHorarioIntent → createHorarioService.add y persiste"** (regresión 2.5).
11. **`voiceFlowIntegration` — "en conversación la acción final es command BUSCAR (no flu → no Gemini)"** (§2D).
12. **`voiceFlowIntegration` — "el resolvedor de config devuelve un contrato accionable (no texto libre)"** (guard fast-path).

### Guardas de arquitectura (4 tests)

13. **`voiceFlowIntegration` — "cada tipo normalizable pertenece a una familia con dispatch"** (guard de dispatch).
14. **`architecture.test`** — guardas de capas/arquitectura.
15. **`stability-guards.test`** — guardas de estabilidad del flujo.
16. **`idleDeterministicBehavior.test`** — comportamiento determinista en idle.

### E2E de punta a punta (playwright, cuando hay cambio de UI) (4 tests)

17. **`e2e-productive-flows`** (vitest) — flujos productivos completos.
18. **`e2e/cobertura-completa.spec.ts`** — cobertura e2e de la app.
19. **`e2e/complete-validation.spec.ts`** — validación completa e2e.
20. **`e2e/productive-injection.spec.ts`** — inyección productiva e2e.

> **Total priorizado: 20 tests** que constituyen la red de seguridad del afinado estructural.

---

## 4. Cómo ejecutar la batería priorizada

```bash
# Núcleo del flujo voz→acción + guardas (rápido, sin navegador)
npx vitest run tests/deterministicArbiter.test.ts tests/voiceFlowIntegration.test.ts tests/configCommands.test.ts tests/gameCommands.test.ts tests/environmentIntents.test.ts tests/horarioIntentParser.test.ts tests/workspaceContractHorario.test.ts tests/architecture.test.ts tests/stability-guards.test.ts tests/idleDeterministicBehavior.test.ts

# E2E de punta a punta (requiere dev server + playwright)
npx playwright test tests/e2e/cobertura-completa.spec.ts tests/e2e/complete-validation.spec.ts
```

---

## 5. Conclusión

- Los **unitarios de juegos/actividades** (Categoría D) son de bajo valor para detectar los defectos de rutas dobles → **falsa confianza** si se usan como única red. Se conservan (regresión de contenido) pero se **despriorizan**.
- La **red de seguridad principal** son los ~20 tests de integración del flujo completo (Categoría A + guardas + e2e).
- **No se borró ningún test.** Solo se documentó la jerarquía de prioridad para que las iteraciones de voz validen contra la batería priorizada, no contra la batería completa de juegos.
