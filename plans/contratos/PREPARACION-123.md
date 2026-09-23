# Preparación de ejecución — 123 escenarios (NO ejecutado)

> Documento de PREPARACIÓN. No aplica fixes, no corre tests, no lanza agentes.
> Su función es dejar la ejecución **lista, verificable e imposible de maquillar**
> usando la maquinaria existente (`plans/contratos/` + `.task/` + `npm run gate`).
> Fuente única del contrato activo: `.task/contract.json` (AGENTS.md §B16).

---

## 0. Estado real medido (HECHO)

- Existe infraestructura de puerta: `plans/contratos/promote.mjs`, `scripts/task-gate.mjs`,
  `scripts/audit-metric.mjs`, `.task/frozen.json` (37 hashes), `plans/contratos/guards/*` (37 guards).
- Contratos definidos: **C1–C39** (C20 y C22 no existen por diseño).
- `.task/contract.json` está en **C21** (`base=3119ff1...`), es decir hay una ejecución **en curso**.
- `plans/contratos/README.md` documenta el ciclo: `stage → checkpoint → activate → gate ROJO → implementar → gate VERDE → commit`.

**Deuda de verdad detectada en la propia maquinaria (crítica):**
- `tests/catchSilenciosoGuard.test.ts` da VERDE con cualquier `console.*` → el guard de C13 es **teatro**.
- `tests/wakeWordRuntimeGuard.test.ts` solo cubre `/ok\s*flu|okay\s*flow/` → deja pasar `'FLU'`, `'okay flu'`, `'hey flu'`, `'oye flu'`.
- Sin esto, cualquier contrato puede cerrar en falso. **Primero se repara la barrera (GA1), después se ejecuta lo demás.**

---

## 1. Por qué la corrección falla hoy (causa raíz)

No es el código: es que se mide con **guards de conteo/nombre** y a veces **falsos**, sin prueba de
que el guard falla ante el defecto real. Un guard que nunca probó su rojo no cierra nada (§B11–B12).

**Regla añadida (obligatoria) — prueba de mutación del guard:**
> Antes de confiar en un guard, se inyecta el defecto en una copia temporal y se comprueba que el
> guard **falla**, y que con el fix **pasa**. Sin ese par rojo→verde demostrado, el hito NO existe.

---

## 2. Mapa: 123 hallazgos → contrato existente o GAP

Cubierto por el pack C1–C39 (no requiere contrato nuevo):

| Hallazgos | Contrato | Invariante |
|---|---|---|
| D1,D2 (+raíz de A3) | **C6** | Wake word runtime desde FLU_CONFIG |
| B10 | **C28** | Una sola implementación de strip de wake word |
| B4,C13 | **C7** | Base Pollinations única |
| A1,E18 | **C13** | Sin catch silencioso (160→0) |
| D6?,D15–D20,D24,D25 | **C18,C24,C29,C38** | Timeouts/modelo default/sample rate/umbrales desde config |
| B1,B2 (cliente) | **C19** | Cliente sin fetch directo a proveedor |
| G2 | **C21** | Un solo punto de TTS |
| D7–D11 (clave) | **C4** | Clave proveedor solo desde STORAGE_KEYS |
| C14/C8/C9/C10/C11/C31 | **C3,C8,C9,C10,C11,C31** | Escritores únicos (voiceProfiles/conversación/sesión/minutas/notas) |
| C1–C9,C13,C15,C16 | parcial **C25,C36,C39,C27** | No re-normalizar / una derivación |
| F1 (borrado físico) | **C14** | Sin borrado físico en Dexie |
| E16 | **C15** | IDs UUIDv4 al insertar |
| E1–E9 (muertos) | parcial **C16,C17,C34** | Sin módulos/docs/fallbacks muertos |
| G7,G8,G10,G14 | parcial **C23** | AGENTS alineado con stack real |
| F5/C33 | parcial **C33** | Tupla sync en MemoryItem |
| A4 (debug prod) | parcial **C35** | Sin console.debug |

**GAP = no cubierto por C1–C39; requiere contrato nuevo.**

| Gap | Hallazgos | Motivo |
|---|---|---|
| **C40** | C10 | `IAIService` duplicada en `gemini.ts` + `deepseek.ts` (9 métodos) |
| **C41** | B1,B2,B3 | Ruta de red IA: motor directo vs proxy (más allá de C19) |
| **C42** | D7–D14 | Literales de proveedor fuera de config (decisionEngine/autoRecovery/factory/backup) |
| **C43** | F2 (onboarding/branding/participantes/búsqueda) | localStorage paralelo a Dexie no cubierto por C9/C10/C31 |
| **C44** | F3 | `onboardingStates` con escritor fuera del gateway |
| **C45** | F4,F5 | `newSyncTuple`/`bumpSync` + tupla inline (C33 solo MemoryItem) |
| **C46** | F1,F6 | Tablas muertas `reminders/horario/temporalItems` + índices `revision/deleted` |
| **C47** | D6,D26–D32 | Locales quemados |
| **C48** | D33–D36 | Hosts/URLs remotos quemados |
| **C49** | D37–D39,G3,G4 | 67 `as unknown as`, `any`, `allowJs`, `noUnused*` |
| **C50** | A4,A8 | Superficies de test/simulación en bundle productivo |
| **C51** | A5,A6,G10 | Harness de test real (Dexie real / `127.0.0.1`) |
| **C52** | G1,G2,F7,F9,F10 | Stack offline ausente (WebLLM/Orama/Piper/Rhubarb/worker DB/rAF/buffer) |
| **C53** | D40 | 104 estilos inline fuera de la excepción CSS |
| **C54** | C1–C9,C11–C13 | Utilidades de texto unificadas (normalize/collapse/shortText) |
| **C55** | E1–E9,E11,E13,E14,E15,E17 | Muertos/basura específicos no listados en C16/C17 |
| **C56** | D3,D4,D5 | Wake words dentro de config interna (`LISTENING_ACK_PHRASES`, `passiveMustExclude`) |
| **C57** | A2,A3 | **Meta-guard**: los guards deben fallar de verdad (prueba de mutación) |
| **GA1** | — | Reparar `catchSilenciosoGuard` y `wakeWordRuntimeGuard` (prerrequisito de todo) |

---

## 3. Especificación de los contratos GAP

Formato listo para materializar como `plans/contratos/contracts/C<n>.json` + `guards/<n>.test.ts`.
La métrica se agrega en `scripts/audit-metric.mjs` (nombre entre paréntesis).

| ID | Objetivo (1 frase) | Métrica propuesta HOY→META | Guard | allow (estrecho) |
|---|---|---|---|---|
| GA1 | Los guards detectan el defecto real | meta-test: guard falla con snippet malo | `guardMutationGuard.test.ts` | `tests/catchSilenciosoGuard.test.ts`, `tests/wakeWordRuntimeGuard.test.ts` |
| C40 | Una sola implementación de `IAIService` | `(ai-service-impl)` 2→1 | `aiServiceSingleImplGuard.test.ts` | `src/services/gemini.ts`, `src/services/deepseek.ts`, `src/services/aiServiceFactory.ts` |
| C41 | Una sola ruta de red hacia el proveedor | `(ai-network-route)` 3→1 | `aiNetworkRouteGuard.test.ts` | `src/services/gemini.ts`, `src/services/deepseek.ts`, `src/services/geminiContractClient.ts` |
| C42 | Proveedor solo desde config | `(provider-literals)` 8→0 | `providerLiteralGuard.test.ts` | `decisionEngine.ts`, `autoRecovery.ts`, `aiServiceFactory.ts`, `backupSystem.ts`, `useEnhancedBranding.ts`, `voiceConfigCatalog.ts` |
| C43 | Un backend por dominio persistido | `(domain-localstorage)` N→0 | `domainStorageSingleGuard.test.ts` | `useOnboarding.ts`, `App.tsx`, `useSeasonalBranding.ts`, `backupSystem.ts`, `fluParticipantConfig.js`, `searchConfigOverrides.ts` |
| C44 | Un solo escritor de `onboardingStates` | `(onboarding-writers)` 2→1 | `onboardingWriterGuard.test.ts` | `src/hooks/useParticipants.ts` |
| C45 | Una sola API de tupla sync | `(synctuple-api)` 2→0 | `syncTupleSingleSource.test.ts` (extender) | `src/core/db/fluDatabase.ts`, `src/core/db/syncTuple.ts`, `src/hooks/useConversationPersistence.ts` |
| C46 | Esquema Dexie sin tablas muertas | `(legacy-tables)` 3→0 | `dexieSchemaGuard.test.ts` | `src/core/db/fluDatabase.ts` |
| C47 | Locales desde config | `(locale-literals)` 10→0 | `localeConfigGuard.test.ts` | `fluSpeech.js`, `audioMath.js`, `nlDateParser.ts`, `describeTriggerText.ts`, `gemini.ts`, `deepseek.ts`, `AsrLab.tsx` |
| C48 | Hosts/URLs remotos desde config | `(remote-hardcode)` 4→0 | `remoteResourceGuard.test.ts` | `searchProxy.ts`, `browserProxy.ts`, `geminiDiagnostics.js`, `musicCatalog.ts` |
| C49 | TS estricto sin cast doble | `(ts-escapes)` 75→0 | `tsStrictGuard.test.ts` | `src/core/games/**`, `src/dev/asrLab/AsrLab.tsx`, `tsconfig.json` |
| C50 | Sin superficies de test en prod | `(prod-debug-surface)` 8→0 | `prodSurfaceGuard.test.ts` | `src/App.tsx`, `src/voice/lib/fluDebug.js` |
| C51 | Tests sobre backend real | `(test-mock-db)` N→0 | `testHarnessGuard.test.ts` | `playwright.config.ts`, `tests/**` |
| C52 | Stack offline real o enmienda | `(stack-offline)` decidir | `stackOfflineGuard.test.ts` | `src/services/localTts.ts`, `src/voice/**` o `AGENTS.md` |
| C53 | CSS por componente | `(inline-style)` 104→0 | `inlineStyleGuard.test.ts` | componentes con `style={{` |
| C54 | Utilidades de texto únicas | `(text-utils-copies)` 8→1 | `textUtilsSingleSourceGuard.test.ts` | `src/lib/textUtils.ts`, `src/voice/lib/audioMath.js`, `speechMerge.js`, `turnTranscript.js`, `imageGeneration.js`, `fluVisualPipeline.js` |
| C55 | Sin muertos/basura específicos | `(specific-dead)` 12→0 | `specificDeadGuard.test.ts` | `fluWindow.d.ts`, `listenLog.js`, `micIngressLog.js`, `activeListen.js`, `turnTranscript.js`, `voiceCommands.js`, `package.json`, `tools/e2e-sims/**` |
| C56 | Wake words solo desde config | `(wake-internal)` 3→0 | `wakeInternalGuard.test.ts` | `src/voice/lib/fluConfig.js` |
| C57 | Barrera de guards verificada | mutación demostrada | (incluye GA1) | — |

**Nota de realidad:** cada métrica de arriba debe **medirse con comando** y fijarse ANTES (hoy) y
DESPUÉS. Si al crear el contrato la métrica no baja, el hito se revierte (§B10). No se inventa el número.

---

## 4. Orden secuencial (por dependencia y riesgo)

```
FASE 0  Barrera      : GA1 → C57
FASE 1  Datos        : C45 → C46 → C44 → C43 → C31*/C9*/C10* (revalidar los ya cubiertos)
FASE 2  Motor IA/Voz : C40 → C41 → C42 → C6* → C56 → C28* → C1* → C30*
FASE 3  Texto/wake   : C54 → C47 → C48 → C29*
FASE 4  Errores      : C13*  (requiere GA1 verde)
FASE 5  Higiene      : C55 → C50 → C51 → C49 → C16*/C17*/C34*
FASE 6  Contrato/UI  : C23* → C52 → C53 → C2*/C7*/C21*
```
`*` = contrato ya existente en C1–C39; se ejecuta con su guard actual (o el reparado si aplica).

Regla de secuencia: **un contrato = un commit = un gate verde**. Prohibido agrupar.

---

## 5. Orquestación con agentes (alineación estricta)

El agente ejecutor **no decide alcance ni criterio**: los lee de `.task/contract.json`.
Se lanza **un contrato a la vez**, en secuencia, nunca en paralelo (evita cruces de `allow`).

| Rol | Subagente | Función |
|---|---|---|
| Promotor | **usuario** (no agente) | `promote.mjs <C> stage` → checkpoint → `activate` (fija `base`, congela hash) |
| Ejecutor | `general` (1 contrato) | Implementa SOLO dentro de `allow`; corre `npm run gate`; para y reporta si DoD no se cumple |
| Auditor de cierre | `verificador` | Solo lectura: corre el gate en árbol actual y worktree limpio, revisa `git diff`, busca ruta doble/parche/evasión con mocks |

**Prompt del Ejecutor (plantilla, por contrato):**
```text
Trabaja con plans/contratos/EJECUCION.md y .task/contract.json (contrato activo C<n>).
1) Lee .task/contract.json. Ese es el ÚNICO alcance y criterio; ignora el chat.
2) npm run gate → debe salir ROJO (guard nace rojo). Si sale verde, PARA y repórtalo.
3) Implementa la solución de raíz SOLO dentro de "allow". Prohibido parche, hardcode, ruta doble.
4) npm run gate → debe quedar VERDE.
5) NO declares "listo/hecho". Reporta: git diff --stat, salida cruda del gate (rojo→verde),
   baseline y 0 fallos nuevos. Commit: fix(C<n>): <resumen>.
Si necesitas tocar algo fuera de "allow": PARA y pide enmienda (nuevo hash). No lo hagas.
```

**Prompt del Verificador (después de cada hito):**
```text
Refuta el cierre de C<n>. Solo lectura. Corre npm run gate en el árbol actual y en un worktree
limpio. Revisa el git diff real. Busca: ruta doble, parche cosmético, hardcode nuevo, guards que
pasan por conteo y no por comportamiento, y evasión con mocks. Devuelve hallazgos con archivo:línea.
```

**Criterio de paso de fase:** (a) gate verde del contrato; (b) verificador sin hallazgos bloqueantes;
(c) 0 fallos nuevos vs baseline. Si falla (a/b/c): revertir ESE hito, mostrar `git diff`, re-planificar.

---

## 6. Garantías anti-mentira (lo que hace imposible fingir)

1. `allow` estrecho + `base` fijo: tocar fuera ⇒ la puerta falla.
2. `frozen.json`: guard/métrica congelados por hash; editarlos rompe el gate.
3. `task-gate-invariant.mjs`: exige `DESPUÉS===target`, `ANTES!==DESPUÉS`, guard **falla en base** y **pasa ahora**.
4. Prueba de mutación del guard (sección 1): sin rojo demostrado, no hay verde válido.
5. Evidencia en `.task/report` (append-only) + commit: no basta el chat.

---

## 7. Cierre obligatorio por hito (AGENTS.md §E)

```
Cambios aplicados: <lista>
Validado contra: npm run gate (salida cruda ROJO→VERDE) + git diff --stat + baseline 0 nuevos
No validado: <DoD-producto — reservado al usuario>
```

---

## 8. Pendientes que requieren decisión del USUARIO (no se puede ejecutar solo)

- Materializar los contratos GAP: crear `contracts/C40..C57.json` + `guards/*.test.ts` + métricas en `audit-metric.mjs`.
- **Antes de todo:** `promote.mjs` de GA1/C57 y verificar que los guards reparados nacen ROJOS.
- Decidir C52 (implementar stack offline vs **enmendar** `AGENTS.md` §4 con hash) y C43 (¿onboarding/branding a Dexie o excepción declarada?).
- Validar el baseline de fallos (`npm run test:full`) antes de FASE 1.

---

## 9. Estado

**NO EJECUTADO.** No se modificó `src/`, no se corrió `npm run gate`/tests, no se lanzaron agentes,
no se crearon contratos ni guards. Este documento es solo la preparación.
