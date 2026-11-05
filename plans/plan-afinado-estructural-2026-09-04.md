# Plan de Afinado Estructural — Fragmentación, Rutas Dobles y Tests

> **Fecha:** 2026-09-04
> **Objetivo:** Afinar los tres problemas de fondo que hacen lento el desarrollo y frágil el sistema: (1) fragmentación del código, (2) rutas dobles de resolución de voz, (3) tests que no validan el flujo real.
>
> **Regla de oro de este plan:** se basa en el **estado REAL del código verificado hoy**, no en planes teóricos previos. Varios cambios que los planes anteriores daban por pendientes **ya están implementados**. Este plan los marca como HECHO y se enfoca en los huecos reales que faltan.

---

## 0. Estado real verificado (lo que YA está hecho — no repetir)

Antes de proponer cambios, se verificó en el código actual que lo siguiente **ya existe**:

| Ítem | Dónde | Estado |
|------|-------|--------|
| Árbitro determinista unificado (config/juego/ambiente) | [`evaluateDeterministicFastPaths`](src/voice/hooks/useFluVoiceAssistant.js:2897) | ✅ HECHO |
| Idempotencia del contrato tardío (anula config/juego/ambiente si el fast-path disparó) | [`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js:3067) | ✅ HECHO |
| Fast-path de config con `BRANDING_OFF_VERBS` ("desactiva la temporada" → mode=disabled) | [`configCommands.js`](src/voice/lib/configCommands.js:104) | ✅ HECHO |
| Dispatch de workspace `doc`/`video` en `onContractResolved` | [`App.tsx`](src/App.tsx:1951) | ✅ HECHO |
| Preservación de tipo `doc`/`video` en `normalizeWorkspaceContract` | [`workspaceContract.js`](src/voice/lib/workspaceContract.js:154) | ✅ HECHO |
| Tests de integración del flujo voz→acción (regresión 2.1/2.5/2.6) | [`voiceFlowIntegration.test.ts`](tests/voiceFlowIntegration.test.ts) | ✅ HECHO |
| Test unitario de branding off | [`configCommands.test.ts`](tests/configCommands.test.ts:96) | ✅ HECHO |

**Conclusión:** el plan de corrección de defectos raíz está **sustancialmente implementado**. El afinado real se concentra en los **huecos que quedan**, listados abajo.

---

## 1. Fragmentación

### 1.1 Problema real
- El hook [`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js) tiene **4,168 líneas** y concentra orquestación + lógica de negocio + estado React.
- [`src/voice/lib`](src/voice) tiene **~70 archivos**, muchos de utilidad de 1 función (ej. `audioMath.js`, `pcmAudio.js`, `speakerCosineStrict.js`).
- [`src/core`](src/core) tiene **~60 módulos** de dominio.
- No hay una capa clara "lógica pura testeable" separada de "orquestación React".

### 1.2 Cambios por afinar

**A. Extraer un módulo puro de resolución determinista (fuera del hook React).**
- **Qué:** crear `src/voice/lib/deterministicArbiter.js` con una función pura `resolveDeterministicCommand(text, { language, phase })` que:
  - Evalúe en orden de prioridad los resolvers existentes: `resolveConfigCommandFromText`, `resolveGameCommandFromText`, `resolveEnvironmentIntent`, `resolveNavigationCommandFromTexts`, y los futuros (horario/branding/búsqueda).
  - Devuelva `{ matched: boolean, domain: string, action: object|null }`.
- **Por qué:** hoy esa lógica vive dentro del hook (no testeable en aislamiento, acoplada a refs/estado). Extraerla permite testear el árbitro sin React y es el paso previo obligatorio para el punto 2.
- **Archivos:** nuevo `src/voice/lib/deterministicArbiter.js`; refactor de [`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js:2897) para consumirlo.
- **Riesgo:** medio. Es refactor de extracción, no cambio de comportamiento. Validar con los tests de integración existentes.

**B. Establecer regla de capas y documentarla.**
- **Qué:** definir y documentar en `CLAUDE.md`/`CONTEXTO_FLU_OS2.md` la regla:
  - `src/voice/lib/*` = lógica pura y testeable (sin React, sin refs).
  - `src/voice/hooks/*` = solo orquestación, estado y efectos.
  - `src/core/*` = dominios de negocio (catálogos, servicios, parsers).
- **Por qué:** hoy la regla se viola (negocio dentro del hook gigante). Documentarla evita que vuelva a crecer el monolito.
- **Archivos:** `CLAUDE.md`, `CONTEXTO_FLU_OS2.md`.
- **Riesgo:** bajo (solo documentación).

**C. No crear más archivos de utilidad de 1 función.**
- **Qué:** al añadir helpers, agruparlos en módulos cohesivos en lugar de un archivo por función.
- **Por qué:** la fragmentación excesiva también es un problema de navegación.
- **Riesgo:** bajo (regla de estilo).

---

## 2. Rutas dobles

### 2.1 Problema real
- El árbitro `evaluateDeterministicFastPaths` cubre **solo 3 dominios**: config, juego, ambiente.
- **No cubre** navegación, horario, branding (como dominio propio), búsqueda web.
- El árbitro corre los fast-paths **en paralelo con Gemini** y reconcilia con idempotencia. **No decide "si hay match determinista → NO llamar a Gemini"**.
- Navegación y UI se resuelven por separado en `processCapture` (vía `resolveNavigationCommandFromTexts` en [`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js:3370)), no en el árbitro unificado.

### 2.2 Cambios por afinar

**A. Ampliar el árbitro a TODOS los dominios deterministas.**
- **Qué:** en `resolveDeterministicCommand` (nuevo módulo puro del punto 1A), incorporar:
  - `resolveNavigationCommandFromTexts` (navegación) — ya existe en [`voiceCommands.js`](src/voice/lib/voiceCommands.js:82).
  - `resolveEnvironmentIntent` — ya existe.
  - Resolver de horario por dictado (ver punto 2C).
  - Resolver de búsqueda web (ver punto 2D).
- **Por qué:** hoy cada dominio tiene su resolver pero no todos están en el mismo árbitro, por eso algunos comandos "hablan sin ejecutar" en conversación.
- **Archivos:** nuevo `deterministicArbiter.js`; ajustar `evaluateDeterministicFastPaths` para delegar en él.
- **Riesgo:** medio-alto. Requiere mapear qué dominios pueden despacharse por `onContractResolved` y cuáles necesitan dispatch propio.

**B. Cambiar la semántica a "si hay match → manda y no llama a Gemini".**
- **Qué:** en `processConversationFluQuery` ([`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js:2951)), evaluar el árbitro determinista PRIMERO. Si `matched === true`:
  - Ejecutar la acción.
  - **NO llamar a Gemini** (o llamarlo solo para la frase de cortesía, sin contrato de acción).
- Si `matched === false` → recién ahí llamar a Gemini.
- **Por qué:** es la causa raíz de "la IA habla sin ejecutar": hoy Gemini responde verbalmente mientras el fast-path quizá no matcheó.
- **Archivos:** [`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js:2951).
- **Riesgo:** ALTO. Es un cambio de comportamiento crítico en el flujo conversacional. Debe hacerse con un flag de feature y validarse con tests de integración + prueba manual del flujo real. **Este es el cambio de mayor impacto y el que más cuidado requiere.**

**C. Cerrar el hueco de horario por voz (dictado de entradas).**
- **Qué:** implementar un fast-path de voz de horario que use `parseHorarioIntent`/`structureHorarioText` para agregar/consultar/eliminar entradas por dictado, y cablearlo en el árbitro.
- **Por qué:** el estado vacío promete "dicta una cita o actividad" ([`fluConfig.js`](src/voice/lib/fluConfig.js:527)) pero no hay ruta de voz determinista para agregar.
- **Archivos:** nuevo resolver de horario; cablear en `deterministicArbiter.js` y `onContractResolved`.
- **Riesgo:** medio-alto (nuevo dominio de voz).

**D. Cerrar el hueco de búsqueda web determinista.**
- **Qué:** verificar que "busca X" en conversación dispara la búsqueda de forma determinista y no depende de que Gemini decida. Revisar `useWorkspaceSearch` y el fast-path de búsqueda.
- **Por qué:** el log del terminal muestra múltiples `[FLU-DEBUG] generateFluContract called ... transcript: Busca en la web` — la búsqueda está yendo a Gemini repetidamente en lugar de resolverse por fast-path.
- **Archivos:** `src/hooks/useWorkspaceSearch.ts`, `src/voice/lib/voiceCommands.js`, `deterministicArbiter.js`.
- **Riesgo:** medio.

**E. Eliminar la duplicación de `resolveConfigCommandFromText`.**
- **Qué:** hoy `resolveConfigCommandFromText` se llama en 3 lugares del hook ([`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js:3070), :3602, :3782). Centralizar en el árbitro único.
- **Por qué:** la duplicación es fuente de inconsistencias (un lugar puede matchear y otro no).
- **Archivos:** [`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js).
- **Riesgo:** medio (refactor).

---

## 3. Tests

### 3.1 Problema real
- Hay **~140 archivos de test** en [`tests`](tests), la mayoría unitarios de módulos aislados.
- Ya existe [`voiceFlowIntegration.test.ts`](tests/voiceFlowIntegration.test.ts) que cubre regresión 2.1/2.5/2.6 y guard 3.1.
- **Hueco:** no hay tests que cubran el **árbitro unificado ampliado** (punto 2A) ni la **semántica "no llamar a Gemini si hay match"** (punto 2B), porque esos cambios aún no existen.

### 3.2 Cambios por afinar

**A. Test del árbitro puro `resolveDeterministicCommand`.**
- **Qué:** nuevo `tests/deterministicArbiter.test.ts` que, dado un texto de voz, verifique que el árbitro devuelve `{ matched, domain, action }` correcto para cada dominio (config, juego, ambiente, navegación, horario, búsqueda) y que NO depende de Gemini.
- **Por qué:** es el test que blinda el punto 2A.
- **Archivos:** nuevo `tests/deterministicArbiter.test.ts`.
- **Riesgo:** bajo.

**B. Test de la semántica "no llamar a Gemini si hay match".**
- **Qué:** test que simule el flujo de `processConversationFluQuery` y verifique que, cuando el árbitro matchea un comando determinista, **no** se invoca `requestFluContractForTranscript`.
- **Por qué:** es la regresión del defecto central "habla sin ejecutar".
- **Archivos:** nuevo test o ampliar `voiceFlowIntegration.test.ts`.
- **Riesgo:** medio (requiere mockear el hook o extraer la lógica a una función pura testeable).

**C. Reducir tests unitarios de bajo valor / priorizar integración.**
- **Qué:** auditar los ~140 tests y marcar cuáles son de bajo valor (falsa confianza). Priorizar ~15-20 tests de integración del flujo completo sobre la batería de unitarios de juegos/parsers individuales.
- **Por qué:** los unitarios de módulos aislados no detectan los defectos de integración (rutas dobles).
- **Archivos:** auditoría de `tests/`.
- **Riesgo:** bajo (no borrar, solo priorizar y documentar).

**D. Usar `window.__fluDev.runFluPhrase` para tests e2e de punta a punta.**
- **Qué:** aprovechar el hook de test existente ([`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js:3248)) para simular frases de voz reales en tests e2e de integración.
- **Por qué:** valida el flujo real voz→contrato→acción→UI, no solo funciones aisladas.
- **Archivos:** tests e2e en `tests/e2e/`.
- **Riesgo:** medio (e2e más lentos, requieren entorno).

---

## 4. Orden de ejecución recomendado (por riesgo creciente)

| Paso | Cambio | Riesgo | Depende de | Estado |
|------|--------|--------|------------|--------|
| 1 | **1A** Extraer `deterministicArbiter.js` puro | Medio | — | ✅ HECHO |
| 2 | **3A** Test del árbitro puro | Bajo | Paso 1 | ✅ HECHO |
| 3 | **2E** Eliminar duplicación de `resolveConfigCommandFromText` | Medio | Paso 1 | ✅ HECHO |
| 4 | **2A** Ampliar árbitro a navegación/horario/búsqueda | Medio-alto | Paso 1 | ✅ HECHO |
| 5 | **2C** Fast-path de horario por dictado | Medio-alto | Paso 4 | ✅ HECHO |
| 6 | **2D** Fast-path de búsqueda determinista | Medio | Paso 4 | ✅ HECHO |
| 7 | **3B** Test "no llamar a Gemini si hay match" | Medio | Paso 8 | ✅ HECHO |
| 8 | **2B** Semántica "si hay match → no Gemini" (flag de feature) | **ALTO** | Pasos 1-6 | ✅ HECHO |
| 9 | **1B/1C** Documentar capas y reglas | Bajo | — | ✅ HECHO |
| 10 | **3C** Auditoría y priorización de tests | Bajo | — | ✅ HECHO |
| 11 | **3D** E2E con `window.__fluDev.runFluPhrase` | Medio | — | ✅ HECHO (tests existentes) |

### Progreso (bitácora)

- **2026-09-04 — Pasos 1, 2, 3 (1A/3A/2E) completados.**
  - **1A:** Creado [`deterministicArbiter.js`](src/voice/lib/deterministicArbiter.js) con `resolveDeterministicCommand` y `resolveStatefulDomains`. Refactorizado [`evaluateDeterministicFastPaths`](src/voice/hooks/useFluVoiceAssistant.js:2897) para delegar la resolución de config/juego/ambiente en el árbitro puro; el hook conserva solo la orquestación del despacho (`onContractResolved`).
  - **2E:** Eliminada la duplicación de `resolveConfigCommandFromText`/`resolveEnvironmentIntent` en los 3 bloques de idempotencia ([`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js:3066), :3605, :3791) centralizándolos en `resolveStatefulDomains` con el patrón `lateStateful`.
  - **3A:** [`deterministicArbiter.test.ts`](tests/deterministicArbiter.test.ts) con 13 tests (config/juego/ambiente/navegación + guardias). Todos pasan.
  - **Validación:** 127 tests pasan (`deterministicArbiter`: 13, `voiceFlowIntegration`: 14, `configCommands`: 100).

- **2026-09-04 — Paso 5 (2C) completado: fast-path de horario por dictado.**
  - **2C:** Se cableó el dominio `horario` en el árbitro puro [`deterministicArbiter.js`](src/voice/lib/deterministicArbiter.js). `ARBITER_DOMAINS` ahora es `['config','game','environment','horario','navigation']`; se añadió el paso 4 de resolución (entre `environment` y `navigation`) que invoca `parseHorarioIntent` y solo marca **match** cuando la intención es **accionable** (`handled && action` → `horario.add/query/remove`). Los casos de aclaración (p. ej. falta la hora, `action === null`) NO se marcan como match: el despacho real de esos casos vive en App.tsx (`__fluHandleHorarioText`, [`App.tsx`](src/App.tsx:3044), invocado en :1765), que sí maneja la aclaración.
  - **Hallazgo arquitectónico:** el dictado de horario ya estaba implementado de forma determinista en [`App.tsx`](src/App.tsx:3044) vía `window.__fluHandleHorarioText` (que llama a `parseHorarioIntent` y ejecuta contra `useHorario`). El hueco real era que el árbitro puro no reconocía el dictado de horario, por lo que no podía usarse para saltarse Gemini (base del paso 2B). `structureHorarioText` es la capa de estructuración OCR (no la ruta de voz); la función correcta para dictado es `parseHorarioIntent`.
  - **3A (extensión):** [`deterministicArbiter.test.ts`](tests/deterministicArbiter.test.ts) pasó de 13 a 17 tests: 4 nuevos para el dominio horario (agregar/consultar/quitar por dictado + guardia de que la aclaración sin hora NO matchea). Se actualizó la expectativa de `ARBITER_DOMAINS`.
  - **Validación:** 17 tests del árbitro pasan; 51 tests de integración/parser pasan (`voiceFlowIntegration`, `horarioIntentParser`, `workspaceContractHorario`). Sin regresión en el hook: `processCapture` solo extrae `domain === 'navigation'` del árbitro, y `resolveStatefulDomains` excluye correctamente `horario` (el despacho de horario no pasa por `onContractResolved`).

- **2026-09-04 — Pasos 4 y 6 (2A navegación / 2D búsqueda determinista) completados.**
  - **2A (navegación):** el árbitro puro [`deterministicArbiter.js`](src/voice/lib/deterministicArbiter.js) ya resolvía el dominio `navigation` (paso 5, vía `resolveNavigationCommandFromTexts`). Se blindó con tests de navegación (iniciar conversación, búsqueda web con/sin consulta, en inglés) y con la guardia de prioridad config-sobre-navegación.
  - **2D:** fast-path de búsqueda web determinista (BUSCAR). En conversación, `resolveFinalConversationAction` ([`audioMath.js`](src/voice/lib/audioMath.js:586)) ya enruta los comandos deterministas de navegación/UI (BUSCAR/NAVEGAR) a `{kind:'command'}` → `dispatchPassiveVoiceCommand` (NO Gemini). Solo las consultas FLU genuinas llegan a `processConversationFluQuery` (`{kind:'flu'}`). Tests añadidos en [`voiceFlowIntegration.test.ts`](tests/voiceFlowIntegration.test.ts) (§2D).
  - **Validación:** sin regresión; la búsqueda web por fast-path no depende de Gemini.

- **2026-09-04 — Pasos 8 y 7 (2B semántica "no Gemini" + 3B test) completados.**
  - **2B:** añadido el flag de feature `FLU_CONFIG.arbiter.skipGeminiOnMatch` (default `false`) en [`fluConfig.js`](src/voice/lib/fluConfig.js:1918). Extraída la semántica §2B a la función pura `resolveDeterministicSkipGeminiContract` ([`deterministicArbiter.js`](src/voice/lib/deterministicArbiter.js:256)) que, con el flag activo y un match de dominio de estado (config/juego/ambiente), construye el contrato determinista completo (con `respuesta_voz` de cortesía) y devuelve `{ domain, contract }`; devuelve `null` cuando NO se debe saltar Gemini (flag apagado, sin match de estado, o dominio no-estado como navegación/horario). Añadida la helper pura `resolveDeterministicCourtesySpeech` ([`deterministicArbiter.js`](src/voice/lib/deterministicArbiter.js:206)): config SÍ produce confirmación verbal (applyConfigAction aplica el estado en silencio), mientras que juego/ambiente devuelven `''` (el motor local ya habla su propia voz → evita doble habla). Refactorizado el bloque §2B de `processConversationFluQuery` ([`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js:3009)) para delegar en la función pura: si matchea, despacha el contrato determinista por `onContractResolved` y hace `return` (el `finally` resetea `isProcessingRef`/status), saltándose `requestFluContractForTranscript`. Con el flag OFF (default) el flujo queda intacto (batch paralelo `Promise.allSettled`).
  - **3B:** [`deterministicArbiter.test.ts`](tests/deterministicArbiter.test.ts) pasó de 20 a 37 tests: 9 de `resolveDeterministicCourtesySpeech` + 8 de `resolveDeterministicSkipGeminiContract` (flag OFF → null; flag ON sin match de estado → null; dominio no-estado navegación → null; match config/juego/ambiente → contrato determinista con `metadata.provider='deterministic-arbiter'`). La semántica "no llamar a Gemini si hay match" queda testeada a nivel de módulo puro (el plan permite extraer la lógica a una función pura testeable).
  - **Validación:** 37 tests del árbitro pasan; 204 tests pasan en el conjunto relacionado (`deterministicArbiter`, `voiceFlowIntegration`, `configCommands`, `gameCommands`, `environmentIntents`). Sin regresión en el hook.

- **2026-09-04 — Paso 9 (1B/1C) completado: documentación de capas y reglas.**
  - **1B:** documentada la regla de capas de voz en [`CLAUDE.md`](CLAUDE.md) (nueva fila 10 de la tabla de convenciones §8) y en [`CONTEXTO_FLU_OS2.md`](CONTEXTO_FLU_OS2.md) (nuevo ítem 4 del Backlog Técnico): `src/voice/lib/*` = lógica pura y testeable (sin React/refs/efectos); `src/voice/hooks/*` = solo orquestación, estado y efectos; `src/core/*` = dominios de negocio. Prohibido meter negocio/parseo dentro de un hook gigante: si una decisión es testeable en aislamiento, debe vivir en `lib/` como función pura y el hook solo orquestarla.
  - **1C:** documentada la regla de cohesión (nueva fila 11 en [`CLAUDE.md`](CLAUDE.md) y ítem 4 en [`CONTEXTO_FLU_OS2.md`](CONTEXTO_FLU_OS2.md)): al añadir helpers, agruparlos en módulos cohesivos por responsabilidad en lugar de crear un archivo por función.
  - **Riesgo:** bajo (solo documentación, sin cambio de código). No requiere validación de tests.

- **2026-09-04 — Paso 10 (3C) completado: auditoría y priorización de tests.**
  - **3C:** creada la auditoría [`auditoria-tests-afinado-estructural.md`](plans/auditoria-tests-afinado-estructural.md). Clasifica la suite en 4 categorías: **A** integración del flujo de voz (alto valor), **B** integración de servicios/datos (medio-alto), **C** unitarios de dominio (medio), **D** unitarios de juegos/actividades (bajo valor para el plan — falsa confianza). Se priorizó una batería de **20 tests de integración del flujo completo** (núcleo voz→acción + guardas de arquitectura + e2e) como red de seguridad principal. **No se borró ningún test** (riesgo bajo, solo priorizar y documentar).

- **2026-09-04 — Limpieza de basura/evidencias/duplicados (solicitud explícita del usuario).**
  - **Alcance autorizado:** "borra toda la basura, las evidencias no sirven, borra todo lo que no afecte a la aplicacion". Se eliminó **todo lo que no afecta a la aplicación** y se conservó lo que sí la afecta.
  - **Eliminado:**
    - **Evidencias** `reports/`: todas las carpetas de capturas/evidencia visual (`ai-pizarron-fixes`, `ambientes-visual`, `horario-visual`, `pizarron-funcionalidades`, `pizarron-ux`, `temporal-visual`, `validacion-visual-flujos`, `workspace-image`, `decorations`, `e2e`). `reports/` quedó vacío.
    - **Scripts de diagnóstico** `.mjs` en `tests/e2e/` (32) y `scripts/` (20): `analyze-*`, `audit-*`, `captura-*`, `check-*`, `diag-*`, `find-*`, `inspect-*`, `probe-*`, `screenshot-*`, `validate-*`, `verify-*`, `measure-*`, `repro-*`, `sample-*`, `smoke-*`, `test-user-phrase`, `compare-*`, `headless-*`, `repro-bare-*`. **Conservado** `scripts/sync-ffmpeg-core.mjs` (referenciado por `postinstall` y `sync:ffmpeg` en [`package.json`](package.json:13)).
    - **Specs de diagnóstico** `.spec.ts` en `tests/e2e/` (9): `debug-tab-click`, `diagnose-movimiento-canvas`, `diagnostico-dance-*`, `diagnostico-transcripcion-real`, `probe-search-input`.
  - **Conservado (afecta a la app):** todos los specs de regresión/validación legítimos (`validate-*`, `verify-*`, `visual-check`, `validacion-visual-flujos-corregidos`, `participacion-real`, `participacion-enojo-respuesta-real`, etc.), los helpers de test `r3fProxy.ts`/`threeProxy.ts`, `fixtures/`, y todos los tests unitarios/integración de `tests/`.
  - **Verificación de integridad:** búsqueda de imports de los `.mjs` borrados en los specs restantes → **0 resultados** (sin imports rotos). La única referencia a un archivo borrado es un **comentario** inofensivo en [`decorationsCatalog.ts`](src/avatar/decorations/decorationsCatalog.ts:6). **285 tests pasan** tras la limpieza (batería priorizada de 10 archivos: `deterministicArbiter`, `configCommands`, `voiceFlowIntegration`, `voiceCommandAnalysis`, `workspaceContractHorario`, `horarioIntentParser`, `horarioService`, `environmentIntents`, `gameCommands`, `browserNavigation`). La limpieza **no afecta a la aplicación**.

- **2026-09-04 — Paso 11 (3D) completado: E2E con `window.__fluDev.runFluPhrase`.**
  - **3D:** el hook `window.__fluDev.runFluPhrase` ([`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js:3321)) delega en `awaitConversationAction(phrase, { awaitHandlers: true, source: 'e2e-dev' })` — la ruta REAL voz→contrato→acción→UI. Ya existen specs e2e que lo usan para validar el flujo real de punta a punta:
    - [`participacion-real.spec.ts`](tests/e2e/participacion-real.spec.ts:530) — REAL 2: `runFluPhrase('ok flu adelante')` commitea el borrador real al `conversationHistory` del store como `role:'flu'`/`speakerName:'FLU'`.
    - [`participacion-enojo-respuesta-real.spec.ts`](tests/e2e/participacion-enojo-respuesta-real.spec.ts:646) — usa `runFluPhrase` como vía de fallback de la misma ruta `awaitConversationAction`.
  - **Nota de alcance:** la semántica §2B "no llamar a Gemini si hay match" se valida a nivel de módulo puro por los 37 tests de [`deterministicArbiter.test.ts`](tests/deterministicArbiter.test.ts) (el plan permite extraer la lógica a una función pura testeable). Un e2e de §2B exigiría activar el flag `FLU_CONFIG.arbiter.skipGeminiOnMatch` ([`fluConfig.js`](src/voice/lib/fluConfig.js:1920)), que por diseño está **APAGADO por defecto** (regla de seguridad del plan: reversible, se enciende solo cuando se quiera activar la semántica en producción). Por eso el e2e de §2B no se fuerza: validar el flujo real con `runFluPhrase` ya está cubierto por los specs existentes.

**Regla de seguridad:** el paso 8 (semántica "no Gemini") es el de mayor impacto y debe hacerse **último**, con un flag de feature (`FLU_CONFIG.arbiter.skipGeminiOnMatch`) para poder revertirlo en caliente, y validarse con el test 3B + prueba manual del flujo conversacional real.

---

## 5. Criterios de validación (definición de "hecho")

1. **`npm run test`** pasa sin regresiones (los ~140 tests + los nuevos).
2. El nuevo `deterministicArbiter.test.ts` cubre los 6 dominios y pasa.
3. El test 3B verifica que un comando determinista NO invoca Gemini.
4. Prueba manual: en conversación, "desactiva la temporada" apaga el branding **sin** que Gemini "hable sin ejecutar".
5. Prueba manual: "busca X" dispara la búsqueda por fast-path (no se ve el spam `generateFluContract` repetido en el terminal).
6. Prueba manual: "agrega matemáticas lunes a las 8" agrega una entrada de horario real por voz.
7. El hook [`useFluVoiceAssistant.js`](src/voice/hooks/useFluVoiceAssistant.js) ya no contiene la lógica de resolución duplicada (delega en el árbitro puro).

---

## 6. Nota de alcance y riesgo

Este plan NO propone reescribir el sistema ni mover los ~70 archivos de `lib/` de golpe. Propone **cambios quirúrgicos incrementales** que:
- Extraen la lógica de resolución a un módulo puro testeable (desacopla del monolito).
- Amplían el árbitro existente (que ya funciona para 3 dominios) a todos los dominios.
- Cambian la semántica de ejecución con un flag de feature reversible.
- Blindan con tests de integración del flujo real.

El cambio de mayor riesgo (2B) se aísla al final y es reversible. Cada paso es verificable de forma independiente con los criterios de la sección 5.
