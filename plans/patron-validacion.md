# Patrón de Validación — FLU OS4 (reutilizable para FASE A/B/C/D)

Patrón único y repetible que seguí para verificar FASE A (rebranding por oficio + catálogos
dinámicos) y que se aplicará tal cual a FASE B (Juegos), C (Routing LLM) y D (voiceSynonyms).
Objetivo: **evidencia real, no solo "los tests pasan"** — capturas, persistencia real y
respuesta honesta sobre lo que NO se probó.

---

## 0. Regla de oro

> "La verificación está completa cuando la respuesta puede enumerar: qué se probó, con qué
> comando/evidencia, y qué NO se probó (y por qué no aplica o requiere API/costo)."

Nunca inventar evidencia. Si una zona queda fuera, se declara con su límite y su validación
estructural alternativa.

---

## 1. Definir la superficie afectada (antes de tocar código)

Listar los módulos que el cambio toca. Para FASE A fue:

- `src/core/environments/*` (environmentRegistry, environmentStore, environmentIntents,
  environmentPrompt, applyEnvironment, ambienteFactory, ambientesCatalog)
- `src/core/catalogs/*` (catalogSchema, catalogRegistry, mergeCatalog)
- `src/core/db/fluDatabase.ts` (Dexie version + tablas `ambientes`/`paletas`)
- `src/components/AmbientesPanel.tsx`, `AmbienteEditorForm.tsx`
- `tests/dynamicAmbientes.test.ts`, `tests/e2e/*`

De aquí salen las suites dirigidas del paso 3.

---

## 2. Unidad — capa rápida (sin API, sin navegador)

Comando:

```bash
npx vitest run tests/<modulo-afectado>.test.ts
```

Regla: **cada cambio de contrato lleva su test**. Cuando relajé `ambienteSchema`
(`voz.instrucciones`), reemplacé el test "rechaza vacío" por 3 tests del nuevo contrato
(acepta vacío / acepta espacios / rechaza no-texto) → 37/37.

Barrido dirigido de la superficie completa (FASE A):

```bash
npx vitest run tests/gameCatalog.test.ts tests/gameCommands.test.ts tests/gameEngine.test.ts \
  tests/gameSpeech.test.ts tests/configCommands.test.ts tests/configEnv.test.ts \
  tests/environmentRegistry.test.ts tests/environmentStore.test.ts tests/environmentIntents.test.ts \
  tests/environmentPrompt.test.ts tests/dynamicPaletas.test.ts
```

Resultado FASE A: **268 tests PASSED** (11 archivos).

---

## 3. Suite completa — línea base

```bash
npx vitest run
```

Resultado FASE A: **107 archivos / 2142 tests PASSED** (41.5s).
La línea base anterior era 2140 → el cambio neto (+2) está explicado por los tests del nuevo
contrato. Si el total baja o alguna suite vecina falla ⇒ **no-afectación rota, detener**.

---

## 4. E2E funcional — comportamiento real (navegador + IndexedDB + contract)

Specs que prueban el flujo real contra la app (no mocks):

```bash
npx playwright test tests/e2e/environment-e2e.spec.ts      # rebranding por oficio 9/9
npx playwright test tests/e2e/ambientes-visual.spec.ts     # prueba visual 6/6
```

Patrón de las helpers E2E (reutilizadas en cada spec):
- `gotoClean` — siembra onboarding + espera `.flu-branding-scope` y `--bg-primary`.
- Lectores de estado real vía stores/contrato: `__fluEnvironmentStore.getState().activeAmbienteId`,
  `document.documentElement.dataset.ambiente`, `--flu-bg`, `__bunnyStore.getState().activeDecoration`.
- Lectores de **persistencia real** (IndexedDB 'flu-os3'): `getAll()` sobre la tabla.
  - **Regla de oro IndexedDB:** el `id` del REGISTRO es UUIDv4; el slug canónico vive en
    `data.id` → siempre matchear `rows.find((r) => r.data.id === '...')` (patrón paletas-e2e).
- `driveContract` — inyecta el contract (`window.__fluOnContractResolved`) para probar la
  **ruta de voz/LLM** sin micrófono.
- `capture` — espera 1500ms y toma screenshot.

---

## 5. Visual — evidencia con capturas (lo que responde "¿se ve que funciona?")

Cada caso con captura nombrada y guardada en `reports/<fase>/`. FASE A:

| Evidencia | Archivo |
|---|---|
| cocina → chef built-in | `reports/ambientes-visual/builtin-chef.png` |
| jardinero built-in | `reports/ambientes-visual/builtin-jardinero.png` |
| bricolaje built-in | `reports/ambientes-visual/builtin-bricolaje.png` |
| bienestar built-in | `reports/ambientes-visual/builtin-bienestar.png` |
| asistente base (referencia) | `reports/ambientes-visual/builtin-asistente-base.png` |
| bosque dinámico (UI click) | `reports/ambientes-visual/dynamic-bosque-encantado-ui.png` |
| bosque dinámico (voz/contract) | `reports/ambientes-visual/dynamic-bosque-encantado-voice.png` |

Patrón: un built-in de referencia por estado + un **dinámico creado por la UI real** para
probar el mecanismo genérico (bosque es el mecanismo de playa/planetas/lo-que-sea).

---

## 6. No-afectación (después de cualquier fix)

Re-correr TODO lo anterior en orden, porque un fix puede romper otra zona:

1. Suite completa unit (`npx vitest run`).
2. Todos los specs E2E de las zonas vecinas (`environment-e2e`, `paletas-e2e`, `ambientes-visual`).
3. Confirmar inventario de capturas (`list_files` sobre `reports/<fase>/`).

Resultado FASE A tras los 2 fixes: 2142 unit + 9/9 + 6/6 + 7 capturas confirmadas.

---

## 7. Respuesta honesta (los 4 filtros del usuario)

Cada pregunta se responde con: **evidencia + límite + validación estructural alternativa**.

1. ¿Visualmente se rebrandea? → capturas (paso 5) + aclarar qué es built-in vs dinámico.
2. ¿No afectación? → suite completa + E2E vecinos (paso 6).
3. ¿Cada instrucción funciona? → `test.each` por frase ES/EN (paso 2) + E2E de activación
   (paso 4). Límite: la ruta LLM se valida estructuralmente (prompt inyectado con la esencia),
   no con llamada live (costo/API).
4. ¿Juegos/asistente/alma de fiesta? → suites unitarias de esas zonas + captura base del
   asistente + aclarar qué es ortogonal a la fase (p. ej. "alma de fiesta" = perfil de
   personalidad en config, NO tocado por FASE A).

---

## Checklist rápido (copiar al final de cada fase)

- [ ] 1. Superficie afectada documentada
- [ ] 2. Unit dirigido de la superficie → verde
- [ ] 3. Suite completa unit → verde (contar total y explicar delta)
- [ ] 4. E2E funcional (IndexedDB + contract) → verde
- [ ] 5. Capturas visuales nombradas en `reports/<fase>/`
- [ ] 6. No-afectación re-corrida (unit + E2E vecinos + inventario de capturas)
- [ ] 7. Respuesta honesta: evidencia + límites + validación estructural
- [ ] 8. Backup de la fase aprobada (robocopy; exit code 1 = éxito) antes de la siguiente
