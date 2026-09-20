# Informe completo de hallazgos y plan de contratos

Documento único. Incluye **todos** los hallazgos detectados en la auditoría, su
evidencia, categoría y lo que hace falta para cerrarlos. No sustituye a
`AGENTS.md`; lo aplica.

---

## 0. Cómo leerlo

- **A — Defecto demostrado**: verificado, y cerrable con un contrato (métrica +
  guard rojo + `allow` estrecho).
- **B — Deuda verificada**: real, pero es barrido o requiere tu decisión de
  diseño. Necesita un contrato antes de tocarse.
- **C — Posible falso positivo**: el patrón existe; puede ser legítimo. Se
  descarta solo con tu OK, o se convierte en contrato y lo vemos con el guard
  delante.

Un hallazgo **no** es una acusación: es "esto merece una decisión".

Estado actual:

| Bloque | Estado |
|---|---|
| C1 | Cerrado en verde (`c343af4`) |
| C2–C19, C21, C23, C24 | Materializados: guard **rojo verificado**, `allow` cerrado, `base`/`frozen` |
| C20, C22 | Subsumidos (ver §2.3) |
| A / B / C | Inventario completo en §1 |

---

## 1. Inventario completo

### 1.1 Voz / transcripción (§9)

| ID | Hallazgo | Evidencia (fuente) | Cat |
|---|---|---|---|
| V1 | AsrLab crea reconocimiento fuera de la puerta única | `src/dev/asrLab/AsrLab.tsx:77`, `:291` | **A** |
| V2 | Segunda instancia en onboarding vía `acquireSpeechRecognition` | `src/hooks/useOnboardingVoiceCapture.ts:174` | C (usa la fábrica y el lock) |
| V3 | Motor Whisper reasigna `recognitionRef` (2º motor) | `useFluVoiceAssistant.js:2349`; `voiceLocalFallback.js:60` | C (fallback por diseño) |
| V4 | Consumidores re-normalizan la frase | `useFluVoiceAssistant.js:3725`, `:1705`; `App.tsx:2174,2206,2285,2197`; `generationTopic.ts:40`; `agendaCommandParser.ts:279,317`; `noteIntentParser.js:105,199` | B |
| V5 | Implementación paralela muerta de normalización | `src/lib/transcriptQuality.ts:203` (0 consumidores) | B |
| V6 | Doble commit del turno con valores distintos | `useFluVoiceAssistant.js:3698` vs `:3851` | B (posible ya cubierto por `conversationTurnRowSingleWriter`) |
| V7 | Query derivada de valor re-derivado con fallback | `useFluVoiceAssistant.js:3936,4099,3210` | B |
| V8 | Cascada de display en 4 orígenes | `conversationDialogue.js:252`; `App.tsx:4683-4687` | C (cubierto por `voiceSingleSourceGuard` G5) |
| V9 | Wake words hardcodeadas en runtime | `voiceConfigCatalog.ts:801,802`; `VoiceAssistantBarWrapper.tsx:111` | **A** |
| V10 | 5 implementaciones de strip de wake word | `audioMath.js:544,1260,1296`; `wakeWord.js:52,63` | B |

### 1.2 Hardcode (prohibición §2.2)

| ID | Hallazgo | Evidencia (fuente) | Cat |
|---|---|---|---|
| H1 | 37 URLs en módulos de config | `appConfig.ts:184-295`, `sharedConfig.ts:76-96`, `visualConfig.js:31,37`, `fluConfig.js:1176-1245`, `musicCatalog.ts:16-52` | B (config permitida) |
| H2 | Base Pollinations duplicada | `sharedConfig.ts:96` vs `visualConfig.js:31` | **A** |
| H3 | 19 nombres de modelo quemados | `sharedConfig.ts:75,80,89`; `appConfig.ts:183,196,197`; `fluConfig.js:148,1194,2146` | B |
| H4 | 100+ números mágicos (timeouts, sample rates, umbrales) | `httpClient.ts:17-40`; `searchProxy.ts:31`; `browserProxy.ts:15`; `participantProfiles.ts:47-80`; `speakerDiarization.js:73-76`; `healthMonitor.ts:120-140` | B |
| H5 | Allowlist duplicada fuera de config | `App.tsx:3929`; `useNavigationCommands.ts:445` | **A** |
| H6 | Literal `'flu-ai-provider'` fuera de `appConfig` | `decisionEngine.ts:676,743`; `aiServiceFactory.ts:22` | **A** |
| H7 | Lectura directa de `VITE_OPENROUTER_API_KEY` | `searchConfigOverrides.ts:158` | **A** |
| H8 | `localhost` vs `127.0.0.1` | `tools/live-check.mjs:4`; `playwright.config.ts:5`; `searchProxy.ts:143`; `browserProxy.ts:80` | B |
| H9 | `fetch` directo saltando proxy | `ocrService.ts:63`; `healthMonitor.ts:273,508`; `fluVisualStockSearch.js:17,64`; `gemini.js:1785,1813,1819` | B |
| H10 | Puerto `5173` en 4 sitios | `vite.config.ts:89`; `playwright.config.ts:4,21`; `tools/live-check.mjs:4` | B |
| H11 | Clave OpenRouter viva en `.env` | `.env:5`. HECHO: `git ls-files .env` = vacío → **no trackeada**; el archivo no debe compartirse | B (seguridad) |

### 1.3 Persistencia (rutas dobles §2.8)

| ID | Hallazgo | Evidencia (fuente) | Cat |
|---|---|---|---|
| P1 | 3 escritores de `fluDb.voiceProfiles` | `App.tsx:4560,4569`; `useVoiceProfiles.ts:68,84,97`; `fluStorage.js:145,196,219` | **A** |
| P2 | Conversación en 3 rutas | `useConversationPersistence.ts:112`; `fluStorage.js:30-42`; `integrationStore.ts:117` | B |
| P3 | Sesión en 2 rutas (localStorage vs Dexie) | `useSessionPersistence.ts:15`; `fluStorage.js:267,277` | B |
| P4 | Minutas con doble escritura simultánea | `useMinuteHandlers.ts:105-107,186-187,260,317` | **A** |
| P5 | Notas vs Lista de compras (2 tablas/servicios) | `fluDatabase.ts:186,209`; `useNotes.ts:79` vs `useShoppingList.ts:72` | B |
| P6 | Claves de config duplicadas | `useConfigPersistence.ts:181,186,218,225`; `backupSystem.ts:396,432,436` | B |
| P7 | Memoria en IDB aparte | `longTermMemory.ts:63` | B |
| P8 | 3 bases IndexedDB | `flu-os3`, `flu-voz-local`, `flu-long-term-memory` | B |
| P9 | TTS en 2 módulos + acceso directo | `services/localTts.ts` vs `voice/lib/fluSpeech.js`; `App.tsx:4468,4492,4516` (`window.speechSynthesis`) | B |
| P10 | Gemini con 4 entradas | `services/gemini.ts`; `voice/lib/gemini.js`; `services/geminiContractClient.ts`; `server/geminiProxy.ts` | B |
| P11 | Perfiles de voz también en localStorage | `backupSystem.ts:296` (`STORAGE_KEYS.VOICE_PROFILES`) vs Dexie | B |
| P12 | `flu-text-model`/`flu-text-api-key` con defaults divergentes | `appConfig.ts:86-87` vs `voice/lib/gemini.js:1187-1241` | B |

### 1.4 Arquitectura y constraints

| ID | Hallazgo | Evidencia (fuente) | Cat |
|---|---|---|---|
| A1 | `new` / `?? new X()` en raíz de composición | autonomy: `healthMonitor.ts:728-729`; `autoOptimization.ts:740-741`; `backupSystem.ts:625-627,1139`; `autoRecovery.ts:704-706`; `decisionEngine.ts:630-632`. Servicios (singleton al pie): `services/deepseek.ts:789`; `services/gemini.ts:872`; `videoAssembler.ts:333` | C (instanciar en la raíz de composición es legítimo) |
| A2 | Errores silenciados | 122 `catch {}` + 50 `.catch(()=>…)` (`geminiProxy.ts:658-708`; `aiServiceFactory.ts:46,66`; `onboardingService.ts:127`; `useOnboarding.ts:123-280`; `gemini.ts:184-423`) | B |
| A3 | Borrado físico donde debe ser lógico | `App.tsx:4560,4569,4581,4593`; `fluDatabase.ts:774` (`auditLog.clear()`); `longTermMemory.ts:274` (`store.delete`) | B |
| A4 | IDs no-UUID al insertar | `fluStorage.js:185` (`voice-${Date.now()}`), `:257-258` (`id:'current'`) | B |
| A5 | Contador secuencial indexado | `useMinuteKnowledge.ts:242`; `fluDatabase.ts:566` | B |
| A6 | Tailwind ausente (stack §4) | sin `tailwind.config.*`/`postcss`; 8.312 líneas CSS + 104 inline | C (rediseño) |
| A7 | Sin `src/modules/`; tipos inline | 54 `.tsx` en `src/components`; tipos en `fluDatabase.ts:22-530` | C (estructura) |
| A8 | Tupla de sync `[revision,updated_at,deleted]` | cumple en las 23 tablas Dexie | — (sin acción) |
| A9 | `MemoryItem` sin `revision`/`updated_at` | `longTermMemory.ts:19-41` | B |
| A10 | Stack real ≠ stack mandado (§4): React 19 / Vite 8 / TS 6 vs React 18 / Vite 5 / Tailwind 3 | `package.json:40,68,66` | B (decisión: actualizar AGENTS o alinear) |

### 1.5 Basura / artefactos (§2.10)

| ID | Hallazgo | Evidencia (fuente) | Cat |
|---|---|---|---|
| J1 | 15 módulos sin importador de producción | 14 verificados en `src/lib`: `conversationFlow`, `emotionalState`, `exportUtils`, `forgettingCurve`, `goalTracker`, `longTermMemory`, `memoryConsolidation`, `minuteSuggester`, `participantProfiles`, `preferenceLearner`, `proactiveEngine`, `theoryOfMind`, `transcriptQuality`, `userEmotionDetector`; + `voice/lib/localTranslate.js`. `fallbackResponses.ts` reportado por auditoría (ruta a confirmar) | B (¿feature futura o muerto?) |
| J2 | 4 archivos raíz sin referencia | `plan_solucion_basura.md`, `CONTEXTO_FLU_OS2.md`, `ESTADO_SISTEMA.md`, `mermaid-diagrama1.png` | B |
| J3 | Spec E2E huérfano + utilidad sin script | `tools/e2e-sims/sim-pollinations-caida-openrouter.spec.ts` (fuera de `playwright.config.ts:8`); `tools/live-check.mjs` (sin entrada en `package.json`) | B |
| J4 | `.task/` con ~20 rutas muertas | `.task/baseline.json`, `.task/contract.json` | B (congelado; lo toca el usuario) |
| J5 | 12 `console.debug` | `useFluVoiceAssistant.js` ×11; `gemini.js:1242` | B (bajo riesgo) |
| J6 | `dist/` en disco | ignorado en `.gitignore:5`; untracked | — |
| J7 | Backups/probes/`*.bak` | ninguno | — |

---

## 2. Plan de contratos (todos)

`allow` es la zona editable; la métrica la imprime `scripts/audit-metric.mjs`
(se amplía con un selector por contrato) y el guard vive en `tests/`.

### 2.1 Ya escritos y en rojo (verificados)

| ID | Invariante | Métrica HOY→META | allow | Guard |
|---|---|---|---|---|
| C1 | Instancia de reconocimiento solo en la puerta única | 1→0 | `src/dev/asrLab/AsrLab.tsx` | `vozInstanciaUnicaGuard` |
| C2 | Allowlist solo desde FLU_CONFIG | 2→0 | `App.tsx`, `useNavigationCommands.ts` | `searchAllowlistFuenteUnicaGuard` |
| C3 | Un solo escritor de `voiceProfiles` | 3→1 | `App.tsx`, `useVoiceProfiles.ts`, `fluStorage.js` | `voiceProfilesEscritorUnicoGuard` |
| C4 | Clave de proveedor solo desde `STORAGE_KEYS` | 3→0 | `aiServiceFactory.ts`, `decisionEngine.ts` | `aiProviderStorageKeyUnicaGuard` |
| C5 | API key de texto solo desde el resolver | 1→0 | `searchConfigOverrides.ts` | `textApiKeyResolverUnicoGuard` |

### 2.2 Propuestos (se materializan tras tu decisión)

| ID | Cubre | Invariante propuesto | HOY→META | allow | Cat |
|---|---|---|---|---|---|
| C6 | V9 | Wake word runtime sale de `FLU_CONFIG` | 3→0 | `voiceConfigCatalog.ts`, `VoiceAssistantBarWrapper.tsx` | A |
| C7 | H2 | Base Pollinations única | 2→1 | `sharedConfig.ts`, `visualConfig.js` | A |
| C8 | P2 | Un solo escritor de conversación | 2→1 | `useConversationPersistence.ts`, `fluStorage.js` | B |
| C9 | P3 | Un solo backend de sesión | 2→1 | `useSessionPersistence.ts`, `fluStorage.js`, `App.tsx`, `useFluVoiceAssistant.js` | B |
| C10 | P4 | Sin doble escritura de minutas | 1→0 | `useMinuteHandlers.ts`, `useMinuteKnowledge.ts` | A |
| C11 | P5 | Notas y lista comparten fuente | 2→1 | `useNotes.ts`, `useShoppingList.ts`, `notesService.ts`, `shoppingService.ts`, `fluDatabase.ts` | B |
| C12 | P6 | Claves de config desde `STORAGE_KEYS` | N→0 | `useConfigPersistence.ts`, `backupSystem.ts` | B |
| C13 | A2 | Sin `catch` que trague error sin log | 172→0 (por lotes) | por lote | B |
| C14 | A3 | Sin borrado físico de entidades; log de auditoría inmutable | 5→0 | `App.tsx`, `fluDatabase.ts` | B |
| C15 | A4 | Todo insert usa UUIDv4 | 2→0 | `fluStorage.js` | B |
| C16 | J1 | Sin módulos muertos en `src/lib` | 14→0 | `src/lib/**` + tests asociados | B |
| C17 | J2/J3 | Sin docs/spec huérfanos | 5→0 | raíz, `tools/e2e-sims` | B |
| C18 | H4 | Timeouts/umbrales desde config | N→0 (por dominio) | por dominio | B |
| C19 | H9 | Sin `fetch` directo a proveedor | ~10→0 | por archivo | B |
| C20 | A6/A7 | Tailwind + `src/modules/` | decisión | — | C |
| C21 | P9 | TTS con una sola entrada (`localTts` o `fluSpeech`) | 3→1 | `localTts.ts`, `fluSpeech.js`, `App.tsx` | B |
| C22 | P10 | Gemini con una sola entrada de cliente | 4→1 | por definir (depende de si el proxy es la única vía) | B |
| C23 | A10 | Stack del repo alineado con AGENTS (o AGENTS actualizado) | decisión | `AGENTS.md` + `package.json` | B |
| C24 | P11/P12 | Perfiles de voz y claves de modelo con una sola fuente | 2→1 | `backupSystem.ts`, `appConfig.ts`, `voice/lib/gemini.js` | B |

### 2.3 Estado de materialización

**Materializados y verificados en rojo (37):** (C1 ya cerrado en verde)

| Contrato | Métrica HOY→META | Estado |
|---|---|---|
| C1 | 1→0 | **verde (cerrado c343af4)** |
| C2 | 2→0 | rojo |
| C3 | 3→1 | rojo |
| C4 | 3→0 | rojo |
| C5 | 1→0 | rojo |
| C6 | 3→0 | rojo |
| C7 | 2→1 | rojo |
| C8 | 3→1 | rojo |
| C9 | 2→1 | rojo |
| C10 | 3→0 | rojo |
| C12 | 7→0 | rojo |
| C14 | 4→0 | rojo |
| C15 | 1→0 | rojo |
| C16 | 15→0 | rojo |
| C17 | 6→0 | rojo |
| C23 | 3→0 | rojo |
| C11 | 2→1 | rojo |
| C13 | 160→0 | rojo |
| C18 | 7→0 | rojo |
| C19 | 3→0 | rojo |
| C21 | 8→1 | rojo |
| C24 | 6→1 | rojo |
| C25 (V4) | 4→0 | rojo |
| C26 (V6) | 3→1 | rojo |
| C27 (V7) | 4→1 | rojo |
| C28 (V10) | 5→1 | rojo |
| C29 (H4) | 10→0 | rojo |
| C30 (P7/P8) | 2→0 | rojo |
| C31 (P11) | 1→0 | rojo |
| C32 (A3) | 1→0 | rojo |
| C33 (A9) | 1→0 | rojo |
| C34 (J1) | 1→0 | rojo |
| C35 (J5) | 12→0 | rojo |
| C36 (V4 resto) | 10→0 | rojo |
| C37 (V6 resto) | 2→1 | rojo |
| C38 (H4 resto) | 4→0 | rojo |
| C39 (V4 motor) | 2→0 | rojo |

**Subsumidos (sin contrato propio, para no fabricar un guard débil):**

| Contrato | Por qué |
|---|---|
| C20 (Tailwind / `src/modules`) | El default aprobado (D4) es **no migrar** y dejar la excepción por escrito: eso lo cumple **C23**, que actualiza AGENTS.md. No hay cambio de código que medir |
| C22 (Gemini 4 entradas) | La duplicación real (API key/resolución de texto) ya la cubren **C4, C5 y C12**; el endpoint vive solo en `appConfig.ts:184-185`. Un guard "4→1" sería un proxy, no una propiedad |

**Descartados por no ser defecto (con evidencia):**

| Hallazgo | Evidencia de que no es defecto |
|---|---|
| H3 (otros modelos) | Solo en módulos de config (`appConfig`, `sharedConfig`, `fluConfig`) y placeholders de UI; fuera de config/dev = 0 |
| H9 (fal/Openverse) | El endpoint vive en `sharedConfig.ts:88`; los demás fetch son same-origin por proxy |
| H10 (puerto 5173) | Los 3 sitios leen `process.env.PORT` con fallback (`vite.config.ts:89`, `playwright.config.ts:4`, `tools/live-check.mjs:4`) — patrón correcto |
| H11 (`.env`) | `git ls-files .env` = vacío: no está trackeada |
| P6 (`flu-language`/`flu-session-role`) | 0 literales fuera de config; ya usan `STORAGE_KEYS` |
| A5 (`minutes.sequence`) | No es PK (la PK es UUID); es un campo de orden |
| V2/V3/A1/A6/A7/A8 | Ya documentados arriba como no-defecto / decisión |

**Cobertura final:** todo hallazgo en **A (defecto)** está materializado como contrato; los **B** están materializados salvo los subsumidos; los **C** quedan descartados con evidencia. Total: **37 contratos** con métrica, guard rojo verificado, `allow` cerrado, `base` y `frozen`.

Cada C8–C20 nace con: métrica nueva en `audit-metric.mjs`, guard rojo que lista
`archivo:línea`, `allow` estrecho, `base` fijo y `frozen.json`.

---

## 3. Lo que necesito de ti

Solo **decisiones**. Propongo un default para cada una; di "todos los defaults"
o corrige los que quieras.

| # | Decisión | Default propuesto |
|---|---|---|
| D1 | Borrado de datos | Lógico (`deleted:true`); `auditLog.clear()` se elimina (log inmutable) |
| D2 | 14 módulos muertos de `src/lib` | Borrarlos (git es el backup) |
| D3 | Unificar persistencia | Sí, entidad por entidad (C8–C12) |
| D4 | Tailwind | No migrar; dejar CSS plano y **corregir el stack en `AGENTS.md`** o marcar excepción formal |
| D5 | `?? new` en fábricas de autonomy | No es violación; documentar excepción y no contratar |
| D6 | Magic numbers / URLs / modelos | Extraer a config por dominio, por lotes (C18 + H1/H3) |
| D7 | `fetch` directo a proveedor | Enrutar por proxy/resolver existente (C19) |
| D8 | `localhost` en tools/playwright | Dejar; solo backend usa `127.0.0.1` |
| D9 | Módulos muertos que parezcan feature futura | Confirmar: ¿autoconocimiento/memoria se cablean o se borran? |
| D10 | Orden de ejecución | C1→C5, luego C6,C7,C10 (A), después persistencia C8,C9,C11,C12 y arquitectura C13–C15, y al final basura C16,C17 |

Además, para arrancar C1–C5:

1. **Revisa `git status` y haz el checkpoint** (incluye los guards rojos staged).
2. Autoriza el **ensayo end-to-end** de C1 (`checkpoint → activate → npm run gate`).
3. Dime **"genera C6…Cn"** con los defaults aprobados y los materializo igual que C1–C5.

---

## 4. Precondiciones y riesgos conocidos

- Sin checkpoint, `base` no contiene guards ni métrica y `activate` congela mal.
- `promote activate` + worktree base (junction de `node_modules`) **no está
  probado end-to-end en tu Windows**: el ensayo de C1 lo verifica.
- El árbol actual está sucio; el checkpoint incluye esos cambios.
- `npm run typecheck` hoy da **0 errores** (medido).
- El comando `/tarea` no se pudo registrar (bug del validador de frontmatter de
  este build); el prompt está en `plans/contratos/launch-prompt.md`.

---

## 5. Regla

Sin puerta verde no hay commit ni cierre. El agente no decide si cumplió: lo
decide `scripts/task-gate.mjs`. Cada hallazgo de este informe solo pasa a
"ejecutado" cuando tiene contrato, guard rojo→verde y `npm run gate` en verde.

---

## Anexo A — Mapeo completo hallazgo → cobertura (sin filtros)

| ID | Hallazgo | Cobertura | Estado |
|---|---|---|---|
| V1 | AsrLab instancia reconocimiento directo | C1 | cerrado (verde) |
| V2 | Onboarding segunda instancia | Descartado: usa `acquireSpeechRecognition` + lock central | disposición |
| V3 | Whisper reasigna recognitionRef | Descartado: fallback por diseño | disposición |
| V4 | Consumidores re-normalizan | C25 (App) + C36 (3 consumidores) + C39 (motor) | rojo |
| V5 | transcriptQuality muerto | C16 | rojo |
| V6 | Doble commit de turno | C26 (commitUserTurnRow) + C37 (finalizeTurnCommit) | rojo |
| V7 | Query derivada con fallback | C27 | rojo |
| V8 | Cascada de display | Guard existente `voiceSingleSourceGuard` G5 | disposición |
| V9 | Wake word runtime hardcodeada | C6 | rojo |
| V10 | 5 implementaciones de strip | C28 | rojo |
| H1 | 37 URLs en config | Descartado: módulos de configuración | disposición |
| H2 | Base Pollinations duplicada | C7 | rojo |
| H3 | Otros modelos | Descartado: solo config/placeholders | disposición |
| H4 | 100+ magic numbers | C18 (timeouts) + C29 (sample rate) + C38 (umbrales) | rojo |
| H5 | Allowlist duplicada | C2 | rojo |
| H6 | Literal `flu-ai-provider` | C4 | rojo |
| H7 | `VITE_OPENROUTER_API_KEY` directa | C5 | rojo |
| H8 | `localhost` vs `127.0.0.1` | Descartado: tools usan env | disposición |
| H9 | `fetch` directo | C19 (3 módulos); resto same-origin/config | rojo + disposición |
| H10 | Puerto 5173 | Descartado: `process.env.PORT` con fallback | disposición |
| H11 | `.env` con key real | Descartado: `git ls-files .env` vacío | disposición |
| P1 | 3 escritores voiceProfiles | C3 | rojo |
| P2 | Conversación en 3 rutas | C8 | rojo |
| P3 | Sesión en 2 backends | C9 | rojo |
| P4 | Minutas doble escritura | C10 | rojo |
| P5 | Notas vs lista de compras | C11 | rojo |
| P6 | Claves config duplicadas | Descartado: ya usan `STORAGE_KEYS` | disposición |
| P7 | Memoria en IDB aparte | C30 | rojo |
| P8 | 3 bases IndexedDB | C30 | rojo |
| P9 | TTS doble | C21 | rojo |
| P10 | Gemini 4 entradas | Subsumido: C4 + C5 + C12 | disposición |
| P11 | Perfiles de voz en localStorage | C31 | rojo |
| P12 | Defaults divergentes modelo/key | C12 + C24 | rojo |
| A1 | `new` en raíz de composición | Descartado: es la raíz de composición | disposición |
| A2 | 160 catch silenciosos | C13 | rojo |
| A3 | Borrado físico | C14 (fluDb) + C32 (longTermMemory) | rojo |
| A4 | IDs no-UUIDv4 | C15 | rojo |
| A5 | `minutes.sequence` | Descartado: no es PK (PK UUID) | disposición |
| A6 | Tailwind ausente | C23 (excepción documentada) | rojo |
| A7 | Sin `src/modules/`, tipos inline | Descartado: decisión estructural | disposición |
| A8 | Tupla de sync | Cumple | ok |
| A9 | MemoryItem sin revision/updatedAt | C33 | rojo |
| A10 | Stack real ≠ mandado | C23 | rojo |
| J1 | 15 módulos muertos | C16 (14 lib + localTranslate) + C34 (fallbackResponses) | rojo |
| J2 | 4 archivos raíz sin referencia | C17 | rojo |
| J3 | Spec huérfano + live-check | C17 | rojo |
| J4 | `.task` con rutas muertas | disposición: congelado, lo gestiona el usuario | disposición |
| J5 | 12 `console.debug` | C35 | rojo |
| J6 | `dist/` en disco | Descartado: `.gitignore` | disposición |
| J7 | Backups/probes | Ninguno | ok |

**Totales:** 37 contratos · 0 hallazgos sin disposición. (C1–C39 ejecutados.)

---

## Enmiendas ratificadas (2026-09-20)

### Alcance (auto-aplicadas por el ejecutante, ratificadas a posteriori)

El ejecutante amplió `allow` para poder cumplir el objetivo. No se autorizaron de
forma previa; **el usuario las ratifica ahora**. Regla para próximas veces: PARAR y
pedir enmienda **antes** de ampliar `allow`.

| Contrato | `allow` ampliado con | Motivo |
|---|---|---|
| C10 | `src/hooks/useMinuteKnowledge.ts` | la escritura única vive en ese hook |
| C14 | `src/hooks/useConversationPersistence.ts` | el punto de borrado real está ahí |
| C16 | `src/core/db/fluDatabase.ts` + `tests/longTermMemoryDeleteGuard.test.ts` + `tests/memoryItemSyncGuard.test.ts` | borrar el módulo rozó la tabla y sus guards |
| C18 | `src/core/config/appConfig.ts` + `src/core/config/sharedConfig.ts` | los timeouts centrales viven ahí |
| C38 | `src/core/config/appConfig.ts` + `src/core/config/sharedConfig.ts` | los umbrales centrales viven ahí |
| C21 | `src/core/config/sharedConfig.ts` + `tests/localTts.test.ts` | config de TTS + test del módulo |
| C30 | `maxLines` 400 → 600 | el refactor de IndexedDB excedió 400 líneas |

### Criterio / instrumento

- **C32 y C33 quedan SUBSUMIDOS por C16**: `src/lib/longTermMemory.ts` se eliminó por no
  tener importador de producción; su guard pasa de forma vacua
  (`if (!existsSync(TARGET)) return`). Ratificado. No revertir.
- **Métrica `memoryitem-sync` alineada**: devuelve `0` (no `-1`) cuando el módulo no
  existe, para que instrumento y guard digan lo mismo.
- **`tests/conversationTurnRowSingleWriter.test.ts`**: pasó de ">= 3 sitios" a "== 1
  sitio" porque C26 dejó un único punto `commitUserTurnRow`. Aceptado como parte de C26.
- **Commit `3119ff1` (regresión)**: fix cross-contrato del normalizador único
  (`audioMath.normalizeSpokenCommand`). Aceptado.
- **Guards extra** `deviationGuard`, `voiceSingleEngineGuard`, `speechEchoGuard`:
  aditivos y verdes. Se conservan.
- **Commit `5f1a157` del orquestador**: mixto (doc + 4 archivos del ejecutante);
  contenido válido. Aceptado.

---

## Deuda abierta

- **C13 (logging sin contexto)**: los 160 `catch` registran `console.warn('[catch] <archivo>')`
  sin el error ni contexto descriptivo (§2.6). Pendiente logging con contexto. Candidato a **C40**.
- **Contrato activo obsoleto**: `.task/contract.json` quedó en **C21** (base `3119ff1`)
  tras el cierre; no se reactiva.
