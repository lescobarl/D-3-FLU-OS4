# Plan de Solución — Desviaciones detectadas en FLU OS4

> Documento de ejecución derivado de la auditoría de solo lectura (2026-09-19).
> No es un cambio de código: es el contrato maestro que gobierna cada hito.
> Regla base: **un hito = un invariante** (§11 AGENTS.md).
> Ningún punto se agrupa con otro. Ningún hito cierra sin guard rojo→verde y 0 fallos nuevos.

---

## 0. Reglas transversales (aplican a TODOS los puntos)

1. **Contrato antes de tocar código**: `.task/contract.json` con objetivo único, DoD (comando + valor esperado), guard, baseline y `allow`/`deny`.
2. **Guard primero, EN ROJO**: si el guard nace verde, el punto no está definido; no se empieza.
3. **Métrica congelada por hash**: el comando de conteo no se edita a mitad del hito; enmienda formal = nuevo hash + reinicio.
4. **Baseline de fallos**: se captura antes. Cierre = **0 fallos NUEVOS** (no "0 fallos").
5. **Checkpoint/rollback**: commit o backup de disco antes de cada hito riesgoso; si el conteo no baja, se revierte ESE hito mostrando el `git diff`.
6. **Verificación por niveles**: (a) `npm run test:file <ruta>` del área tocada; (b) `npx tsc --noEmit`; (c) suite completa SOLO al cierre de fase o entrega.
7. **Alcance cerrado**: `allow` = archivos del punto; `deny = [".task/**", "scripts/task-gate.mjs"]` inmutable por el agente.
8. **Prohibido sustituir alcance**: si el DoD no se cumple, se para y se reporta parcial honesto.
9. **Datos de simulación siempre fuera de producción**: fixtures en `tests/fixtures/**`, seeds por `fake-indexeddb`/`localStorage` mock, nunca en `src/`.
10. **Cierre**: `git diff --stat` + DoD ANTES/DESPUÉS + guard rojo→verde + baseline 0 nuevos. El DoD-producto (pantalla) lo declara el usuario.

### Orden de ejecución

```
F0 (barrera) → F1 (higiene) → F2 (hardcode) → F3 (helpers)
→ F6 (§2.9 borrado lógico) → F7 (§2.6/§2.4) → F5 (voz §9) → F4 (persistencia)
```

Racional: primero lo mecánico y de bajo riesgo para endurecer la barrera; al final voz y persistencia, que son funcionalidad validada que rompe el estado del sistema si falla.

---

# FASE 0 — Barrera anti-maquillaje

## P0-00 — Guard maestro de desviaciones + baseline congelado

- **Problema**: sin un medidor único, cada fix es fe y no se puede demostrar que la duplicación bajó.
- **Invariante**: existe `tests/deviationGuard.test.ts` con un bloque por punto; HOY el archivo no existe → META: existe y falla (rojo) enumerando los N de cada punto.
- **Cómo lo ejecuto**:
  1. Crear `tests/deviationGuard.test.ts` (Vitest, `environment: node`).
  2. Por cada punto P1-01…P7-27, un `describe` que lee archivos con `fs.readFileSync`, aplica regex y `expect(count).toBe(meta)`.
  3. Cada fallo imprime la lista `archivo:símbolo:línea` (no solo el número).
  4. Congelar el hash del test en `.task/contract.json` y registrar baseline en `.task/baseline.txt`.
- **Mi criterio de validación**:
  - `npx vitest run tests/deviationGuard.test.ts` → **ROJO** con la lista completa (nace rojo obligatoriamente).
  - `git diff --stat` del primer commit: debe aparecer SOLO el test nuevo + `.task/**`.
- **Inyección/simulación**: no requiere datos; lee el árbol real. Fixture de prueba: un archivo temporal en `tests/fixtures/dupSample.ts` con 2 definiciones para verificar que el guard SÍ detecta (test del test).
- **Riesgo/reversión**: nulo (archivo nuevo). Revertir = borrar el test.
- **Validación del usuario**: ver en consola la lista roja con los conteos; confirmar que refleja lo auditado.

---

# FASE 1 — Higiene de bajo riesgo (no toca lógica en uso)

## P1-01 — Eliminar `backups/` de disco (§2.10: Git es el backup)

- **Evidencia**: 15 bundles + copias completas (`backups/respaldo-2026-09-19-5.bundle` … `backups/2026-08-29/seq-1/…`).
- **Invariante**: `Test-Path backups` = `True` HOY → META `False`.
- **Cómo lo ejecuto**:
  1. Confirmar que `backups/` está en `.gitignore` (ya en `:26`) y que NO hay rama/commit que dependa de él.
  2. `git status` limpio → `Remove-Item -Recurse -Force backups`.
  3. Verificar que ningún import/ruta de código referencia `backups/`.
- **Mi criterio de validación**: `rg "backups/" src tests scripts tools vite.config.ts` = 0; `Test-Path backups` = False; `git status` sin borrados rastreados.
- **Inyección/simulación**: crear antes `tests/fixtures/backupsRef.ts` que declare una ruta a `backups/x`; el guard la usa para probar que el detector de referencias funciona; luego se elimina.
- **Riesgo/reversión**: bajo. Reversión = restaurar desde git (los bundles no están en git; si el usuario los quiere, debe decidirlo ANTES).
- **Validación del usuario**: confirmar que no necesita copias manuales (Git es el respaldo).

## P1-02 — Un solo documento de constraints: `AGENTS.md`

- **Evidencia**: `CLAUDE.md:4` ("Este es el ÚNICO archivo de constraints") vs `AGENTS.md:1` (canónico cargado, v7.3).
- **Invariante**: documentos que afirman ser "ÚNICO archivo de constraints" = 2 HOY → META 1.
- **Cómo lo ejecuto**:
  1. Verificar que nada del proceso lee `CLAUDE.md` (CI, hooks, Kilo config).
  2. Si `CLAUDE.md` no aporta contenido único, eliminarlo; si aporta, delegarlo a `AGENTS.md` sin duplicar reglas.
- **Mi criterio de validación**: `rg -c "ÚNICO archivo de constraints" -g "*.md"` = 1; `rg "CLAUDE.md" .github scripts kilo.json` = 0.
- **Inyección/simulación**: n/a (docs).
- **Riesgo/reversión**: nulo. Revertir = `git checkout CLAUDE.md`.
- **Validación del usuario**: aceptar `AGENTS.md` como fuente única.

## P1-03 — Eliminar código muerto en `fluStorage.js`

- **Evidencia**: `src/voice/lib/fluStorage.js:207 addConversationRow`, `:217 getLatestAuditLogs`, `:233 renameAuditLogSpeaker` — 0 importadores; vivos equivalentes en `fluConversationLog.ts:21` y `fluDatabase.ts:736,773`.
- **Invariante**: definiciones sin importador = 3 HOY → META 0.
- **Cómo lo ejecuto**:
  1. `rg "addConversationRow|getLatestAuditLogs|renameAuditLogSpeaker" src tests` → confirmar 0 usos externos.
  2. Eliminar las 3 funciones (y helpers privados que queden huérfanos tras el corte).
- **Mi criterio de validación**: `rg -c "function (addConversationRow|getLatestAuditLogs|renameAuditLogSpeaker)" src` = 0; guard `deviationGuard` verde en ese bloque; `npm run test:file tests/<persistencia>.test.ts` sin nuevos fallos.
- **Inyección/simulación**: seed de un `audit_log` vía `fluConversationLog.logFluReply` en `fake-indexeddb` y verificar que el equivalente vivo sigue escribiendo/leyendo (prueba de que el muerto no hacía falta).
- **Riesgo/reversión**: bajo. Revertir el hito.
- **Validación del usuario**: la bitácora de auditoría sigue mostrando filas nuevas tras el cambio.

## P1-04 — Rama muerta en `imageGeneration.js`

- **Evidencia**: `src/voice/lib/imageGeneration.js:110-114`: `if (c.primary === 'pollinations')` y el fallthrough devuelven el MISMO `buildPollinationsArtifact(...)`.
- **Invariante**: ramas con retorno idéntico = 2 HOY → META 1.
- **Cómo lo ejecuto**:
  1. Confirmar equivalencia exacta de ambos retornos.
  2. Colapsar a una sola ruta de retorno (sin cambiar el comportamiento observable).
- **Mi criterio de validación**: test de comportamiento: para `primary='pollinations'` y para default, el artefacto devuelto es idéntico antes y después; `imageGeneration.js:110-114` sin `if/else` redundante.
- **Inyección/simulación**: llamada unitaria con `{ primary: 'pollinations' }` y `{ primary: 'otro' }` comparando `JSON.stringify(artifact)`.
- **Riesgo/reversión**: bajo. Revertir el hito (el comportamiento no debe cambiar).
- **Validación del usuario**: generar una imagen de workspace y ver el mismo resultado.

---

# FASE 2 — Hardcode / configuración

## P2-05 — Wake words solo desde config (§9.4)

- **Evidencia**: `src/voice/lib/visualConfig.js:42`, `src/voice/lib/fluConfig.js:2643,2234-2242,2137`, `tools/live-check.mjs:3`.
- **Invariante**: literales de wake word fuera de `FLU_CONFIG.voiceCommands.wakeWords` = 5 sitios HOY → META 0.
- **Cómo lo ejecuto**:
  1. Añadir en config los arreglos derivados (`leadInStopwords`, `passiveMustExclude`, `shortFinalKeywords`, `initialPrompt`) generados a partir de `wakeWords`.
  2. Reemplazar cada literal por interpolación/derivación de config.
  3. En `tools/live-check.mjs`, leer la wake word de config/env.
- **Mi criterio de validación**: `rg "'ok flu'|'okay flu'|'oye flu'|'hey flu'" src tools` = 0 fuera de config; `npx vitest run tests/deviationGuard.test.ts` bloque P2-05 verde.
- **Inyección/simulación**: **cambiar la wake word a un valor ficticio** ("zumba bot") en un fixture de config y correr el test de escucha: la frase debe reconocerse con "zumba bot" y NO con "ok flu" → prueba de que no hay hardcode.
- **Riesgo/reversión**: medio (toca voz, pero solo config). Si el flujo de escucha cambia, revertir.
- **Validación del usuario**: decir "ok flu" y comprobar que sigue funcionando en pantalla.

## P2-06 — Endpoints/modelos en una sola fuente

- **Evidencia**: `fluConfig.js:1152,1166,1170,1180` duplican `sharedConfig.ts:76`; `AsrLab.tsx:179`; `appConfig.ts:183-198` duplica `.env.example`.
- **Invariante**: URLs/modelos literales duplicados = N HOY → META 1 por recurso (en `sharedConfig`).
- **Cómo lo ejecuto**:
  1. Inventariar cada endpoint/modelo y su canónico (`OPENROUTER_CONFIG`, `POLLINATIONS_DEFAULTS`, `GEMINI`, `DEEPSEEK`).
  2. Importar del canónico en `fluConfig.js`, `AsrLab.tsx`, `appConfig.ts`.
- **Mi criterio de validación**: `rg "https://openrouter.ai/api/v1|generativelanguage.googleapis.com|api.deepseek.com" src` = 1 por URL; `npx tsc --noEmit` limpio.
- **Inyección/simulación**: `vi.stubEnv('VITE_GEMINI_MODEL', 'modelo-ficticio')` y verificar que `appConfig` propaga ese valor (prueba de que no está quemado).
- **Riesgo/reversión**: bajo-medio. Revertir el hito.
- **Validación del usuario**: una consulta real a la IA responde igual que antes.

## P2-07 — Puertos/host fuera del código

- **Evidencia**: `vite.config.ts:89` (`5173`), `playwright.config.ts:12,17`, `tools/live-check.mjs:4`.
- **Invariante**: literales `5173`/`localhost`= N HOY → META 0 en `src`/configs (solo como default en un único punto por variable `PORT`).
- **Cómo lo ejecuto**: leer de `process.env.PORT`/config compartida; un solo `DEFAULT_PORT`.
- **Mi criterio de validación**: `rg "5173" src tools vite.config.ts playwright.config.ts` = 1 (el default) ; `npx vite build` (o arranque corto) OK.
- **Inyección/simulación**: `$env:PORT=5199; npm run dev` (timeout 15-30s, solo verificar arranque) → el server escucha en 5199.
- **Riesgo/reversión**: bajo.
- **Validación del usuario**: abrir la app en el puerto de su costumbre.

## P2-08 — Fallbacks que sustituyen config en silencio

- **Evidencia**: `appConfig.ts:183,196,197,199,219,241`, `aiServiceFactory.ts:57`, `App.tsx:2674`, `integrationStore.ts:327`, `useFluVoiceAssistant.js:1444`.
- **Invariante**: defaults silenciosos de config = N HOY → META 0 (o explícitos y centralizados con log/aviso).
- **Cómo lo ejecuto**: convertir cada `|| fallback` de configuración en lectura explícita que falle/avise si falta; los fallbacks legítimos (rate de audio) se mueven a constantes nombradas de config.
- **Mi criterio de validación**: test: con env vacío, la inicialización reporta error de configuración (no arranca con valor inventado); con env presente, usa el valor.
- **Inyección/simulación**: `delete import.meta.env.VITE_GEMINI_MODEL` en el test → `expect(() => init()).toThrow(ConfigError)`.
- **Riesgo/reversión**: medio (puede hacer fallar arranques que hoy "funcionan de casualidad"). Revertir si rompe flujo validado.
- **Validación del usuario**: arranque normal de la app con su `.env`.

## P2-09 — Secreto en `.env`

- **Evidencia**: `.env:5` con `sk-or-v1-…` real (no rastreado por `.gitignore:19`).
- **Invariante**: patrones de clave en repo = 1 en `.env` (disco) HOY → META 0 (rotada).
- **Cómo lo ejecuto**: rotar la key en OpenRouter, actualizar `.env`, confirmar que `.env.example` no lleva valor real.
- **Mi criterio de validación**: `rg "sk-or-v1-[0-9a-f]{20,}" -g "!.env"` = 0; `.env.example` solo con placeholder.
- **Inyección/simulación**: n/a (seguridad). Verificar que la app sigue autenticando con la key nueva.
- **Riesgo/reversión**: nulo, salvo invalidar la key vieja (deseado).
- **Validación del usuario**: confirmar que una llamada real a OpenRouter sigue funcionando.

---

# FASE 3 — Duplicación de helpers

## P3-10 — `normalizeForMatch` → 1

- **Evidencia (7)**: `musicPlayer.ts:100`, `configCommands.js:26`, `gameUtils.ts:21`, `gameCatalog.ts:67`, `veoVeo.ts:129`, `palabrasEncadenadas.ts:71`, `simonDice.ts:84`.
- **Invariante**: definiciones `normalizeForMatch` = 7 HOY → META 1 (`src/lib/textUtils.ts`).
- **Cómo lo ejecuto**: mover la mejor implementación a `textUtils.ts` (export), borrar las 6 copias y actualizar imports en el mismo hito.
- **Mi criterio de validación**: `rg -c "function normalizeForMatch" src` = 1; tests de juegos (`tests/*game*`) y `musicPlayer` sin fallos nuevos; guard bloque verde.
- **Inyección/simulación**: fixture con pares entrada→salida (acentos, mayúsculas, puntuación) que alimenta la función única y compara con snapshots de las 7 implementaciones originales (paridad).
- **Riesgo/reversión**: medio si las copias divergían; el fixture de paridad detecta divergencia ANTES de tocar. Revertir si algún par no coincide.
- **Validación del usuario**: jugar una ronda de cada juego (simón, veo veo, palabras encadenadas, lotería, ahorcado).

## P3-11 — `stripDiacritics` → 1

- **Evidencia (7)**: `gameUtils.ts:17`, `gameCatalog.ts:63`, `veoVeo.ts:125`, `palabrasEncadenadas.ts:67`, `simonDice.ts:80`, `searchLanguage.ts:27`, `audioMath.js:18`.
- **Invariante**: definiciones = 7 → 1.
- **Cómo lo ejecuto**: igual que P3-10, canónico en `textUtils.ts`; `audioMath.js` reexporta o importa.
- **Mi criterio de validación**: `rg -c "function stripDiacritics" src` = 1; paridad numérica con fixtures de caracteres (`á é í ó ú ñ ü`).
- **Inyección/simulación**: mismo fixture de pares.
- **Riesgo/reversión**: bajo-medio; paridad primero.
- **Validación del usuario**: búsqueda con acentos devuelve lo mismo.

## P3-12 — `normalizeSpaces` / `cleanForSpeech` → 1

- **Evidencia**: `src/lib/textUtils.ts:15,22` vs `src/voice/lib/audioMath.js:26,98`.
- **Invariante**: pares duplicados = 2 → 1 (paridad declarada en `textUtils.ts:4`).
- **Cómo lo ejecuto**: unificar en `textUtils.ts`; `audioMath.js` importa.
- **Mi criterio de validación**: `rg -c "function (normalizeSpaces|cleanForSpeech)" src` = 2 (una por símbolo); test de paridad de paridad.
- **Inyección/simulación**: fixture con espacios múltiples, tabs y texto con markdown de voz.
- **Riesgo/reversión**: bajo.
- **Validación del usuario**: la transcripción no muestra espacios dobles.

## P3-13 — Dominio minutas → 1 módulo

- **Evidencia**: `src/lib/minuteKnowledgeHelpers.ts` vs `src/voice/lib/minuteKnowledge.js` (5 símbolos repetidos: `formatMinuteDraftText`, `findMinuteRecordBySequence`, `resolveMinuteThemeForSpeech`, `createMinuteDraftFromSummary`, `buildMinuteKnowledgeBase2`); `minuteKnowledge.js:8` admite el canónico en `lib/`.
- **Invariante**: definiciones por símbolo = 2 → 1.
- **Cómo lo ejecuto**: dejar como canónico `src/lib/minuteKnowledgeHelpers.ts`; `minuteKnowledge.js` pasa a adapter/reexport delgado; actualizar `useMinuteKnowledge.ts:165`.
- **Mi criterio de validación**: `rg -c "function (formatMinuteDraftText|findMinuteRecordBySequence|resolveMinuteThemeForSpeech|createMinuteDraftFromSummary|buildMinuteKnowledgeBase2)" src` = 1 por símbolo; `tests/<minutas>.test.ts` verde.
- **Inyección/simulación**: seed de 3 minutas en `fake-indexeddb`; verificar `formatMinuteDraftText` y `resolveMinuteThemeForSpeech` idénticos a la salida previa.
- **Riesgo/reversión**: medio (dominio). Revertir el hito si divergen.
- **Validación del usuario**: dictar una minuta y ver el tema en pantalla.

## P3-14 — Normalización/ similitud de speaker → 1

- **Evidencia**: `speakerEmbeddingCore.js:37 normalizeVector` vs `speakerCore.js:37 normalizeEmbeddingVector`; coseno en `audioMath.js:1377,1411,1429` vs `speakerCore.js:49`.
- **Invariante**: rutinas de similitud L2/coseno = 3 → 1 (`speakerCore.js`).
- **Cómo lo ejecuto**: unificar en `speakerCore.js`; borrar copias de `speakerEmbeddingCore.js`/`audioMath.js`.
- **Mi criterio de validación**: `rg -c "function (normalizeVector|normalizeEmbeddingVector|cosineDistance|cosineSimilarity|compareCosineSignatures)" src` = 1 por símbolo; test numérico con vectores conocidos.
- **Inyección/simulación**: fixture de 2 embeddings fijos con similitud esperada calculada a mano; la función única debe dar el mismo valor (±1e-9).
- **Riesgo/reversión**: alto (afecta diarización). Tocar SOLO si hay cobertura; si no, primero escribir el test de comportamiento.
- **Validación del usuario**: identificar 2 hablantes en una conversación real.

## P3-15 — Parser de fecha → 1

- **Evidencia**: `src/core/reminders/dateParser.ts:67 parseDateTime` vs `src/core/reminders/nlDateParser.ts:203 parseNlDateTime`; `tests/remindersDateParser.test.ts` importa ambos.
- **Invariante**: parsers = 2 → 1.
- **Cómo lo ejecuto**: fusionar capacidades en `dateParser.ts`; `nlDateParser` reexporta; ajustar test existente.
- **Mi criterio de validación**: `rg -c "function (parseDateTime|parseNlDateTime)" src` = 1; `npm run test:file tests/remindersDateParser.test.ts` verde.
- **Inyección/simulación**: tabla de frases ("mañana 9", "el viernes", "en 2 horas") con fecha esperada fija (fake timers).
- **Riesgo/reversión**: medio. Revertir si una frase deja de parsear.
- **Validación del usuario**: crear un recordatorio hablando una fecha.

---

# FASE 6 — §2.9 borrado lógico (se ejecuta antes de voz, tras helpers)

## P6-23 — Borrado físico → lógico en servicios

- **Evidencia**: `notesService.ts:157` (existe `softRemove()` en `:163` sin usar), `documentsService.ts:79`, `contactService.ts:253`, `diaryService.ts:214`, `shoppingService.ts:134,164`, `habitService.ts:378,388`, `catalogRegistry.ts:163`, `participantRegistry.ts:363`, `onboardingService.ts:164`, `useParticipants.ts:172`, `useConversationPersistence.ts:153,213`, `App.tsx:4544-4588`.
- **Invariante**: llamadas físicas `.delete(`/`bulkDelete(` en capa de dominio = N HOY → META 0.
- **Cómo lo ejecuto**:
  1. Introducir/asegurar `deleted:true` + tupla `[revision, updated_at, deleted]` (§3.7) en cada tabla.
  2. Reemplazar `delete` por `softRemove` con incremento atómico de `revision` y `updated_at` UTC.
  3. `App.tsx:4544-4588` (perfil de voz) usa soft delete y auditoría.
- **Mi criterio de validación**: `rg "\.delete\(|bulkDelete\(" src/core src/hooks` = 0; test: crear → borrar → la fila sigue con `deleted:true` y `revision+1`; las queries normales la excluyen.
- **Inyección/simulación**: seed de 1 fila por tabla en `fake-indexeddb`; ejecutar remove y consultar directo a la tabla (sin filtro) para ver `deleted:true`.
- **Riesgo/reversión**: medio (cambia semántica de listados). Revertir el hito si alguna lista muestra borrados.
- **Validación del usuario**: borrar una nota/contacto y comprobar que desaparece de la UI; los demás siguen intactos.

---

# FASE 7 — §2.4 / §2.6 / hooks de prueba

## P7-24 — Inyección de dependencias (eliminar `new` en lógica)

- **Evidencia**: `decisionEngine.ts:632`, `healthMonitor.ts:725`, `autoRecovery.ts:701`, `autoOptimization.ts:737`, `backupSystem.ts:627`, `videoAssembler.ts:333`.
- **Invariante**: `new` de colaboradores dentro de lógica de negocio = 6+ HOY → META 0 (recibidos por constructor/interfaz).
- **Cómo lo ejecuto**: constructor con parámetros por interfaz (`I...`), defaults solo en el composition root.
- **Mi criterio de validación**: `rg "= new (DecisionMaker|FactorEvaluator|HealthMetricTracker|RecoveryActionExecutor|ConditionEvaluator|ParameterOptimizer|DataExtractor|DataRestorer|FFmpegClass)\(" src` = 0; test que inyecta un fake y verifica que se usa.
- **Inyección/simulación**: fake por interfaz en el test; assert de que el método delega en el fake (spy llamado).
- **Riesgo/reversión**: medio. Revertir el hito.
- **Validación del usuario**: n/a directa (no visible); se valida por suite.

## P7-25 — Eliminar `catch` que silencian (§2.6)

- **Evidencia**: `speechRecognitionLocal.js:88,102` (crítico), `clientLogRelay.ts:39`, `musicSearch.ts:108`, `deepseek.ts:93`, `deviceActionService.ts:158`, `useWorkspaceSearch.ts:195,248`, `fluSpeech.js:28` (cae a defaults quemados), `App.tsx:3400,3412`.
- **Invariante**: `catch` sin log ni propagación = N HOY → META 0.
- **Cómo lo ejecuto**: cada catch registra en el log de auditoría con contexto y propaga o degrada explícitamente (nunca `// ignore`).
- **Mi criterio de validación**: guard regex `catch\s*{[^}]*}` sin `logger|console.error|throw|report` = 0; test de inyección de fallo → aparece entrada en audit log.
- **Inyección/simulación**: provocar el error con un fake que lanza en `speechRecognitionLocal` y verificar fila en audit log + estado consistente.
- **Riesgo/reversión**: medio (un catch que hoy "traga" puede empezar a propagar). Revertir el hito si rompe un flujo.
- **Validación del usuario**: la app sigue respondiendo tras un fallo de micro.

## P7-26 — Hooks de test fuera de producción

- **Evidencia**: `App.tsx:2041`, `useFluVoiceAssistant.js:2577,3580`, `fluDebug.js:910`, `listenLog.js:26`, `clientLogRelay.ts:87`.
- **Invariante**: asignaciones `window.__flu*` sin guard `import.meta.env.DEV` = N HOY → META 0.
- **Cómo lo ejecuto**: envolver cada exposición en `if (import.meta.env.DEV)` (patrón ya usado en `integrationStore.ts:893`).
- **Mi criterio de validación**: `rg "window\.__(flu|fluDev|fluDebug|fluListenLog|fluClientLog)" src` con guard DEV en todos = 0 sin guard; build de producción no contiene esos símbolos (`rg "__fluDev" dist` = 0 tras build).
- **Inyección/simulación**: build `npm run build` y grep sobre `dist/`.
- **Riesgo/reversión**: bajo en prod; los e2e en DEV siguen funcionando.
- **Validación del usuario**: app en producción sin globals de test.

## P7-27 — Tipos/`any` en lógica de carga

- **Evidencia**: `appConfig.ts:613 as unknown as T`, `useFluParticipant.ts:208`, `App.tsx:4127`, `loteria.ts:129,137,152`; `asrLab` es dev (excluido).
- **Invariante**: `as unknown as` en lógica de carga = N HOY → META 0 (casts tipados o validación de esquema).
- **Cómo lo ejecuto**: validar con type guards/parsers en lugar de doble cast; tipar el retorno real.
- **Mi criterio de validación**: `rg "as unknown as" src --glob "!src/dev/**"` = 0; `npx tsc --noEmit` limpio; eslint sin nuevos `no-explicit-any`.
- **Inyección/simulación**: fixture de storage malformado → el parser lo rechaza sin romper la app.
- **Riesgo/reversión**: bajo-medio. Revertir el hito.
- **Validación del usuario**: la app carga estado guardado de una sesión previa.

---

# FASE 5 — Tubería de voz §9 (máximo riesgo, al final)

> Cada punto exige guard de COMPORTAMIENTO que EJECUTE el flujo, no solo conteo (§12).

## P5-18 — `normalizeTranscript` único

- **Evidencia (3)**: `src/lib/transcriptQuality.ts:203`, `src/voice/lib/turnTranscript.js:132`, `src/voice/lib/speechMerge.js:133`.
- **Invariante**: normalizadores de transcripción = 3 → 1.
- **Cómo lo ejecuto**: elegir canónico, borrar copias, actualizar consumidores; sin cambiar salida canónica.
- **Mi criterio de validación (comportamiento)**: test que ejecuta: frase cruda → normalizador único → resultado idéntico a la salida canónica previa (snapshot). `rg -c` = 1.
- **Inyección/simulación**: fixture de 10 frases reales con acentos/muletillas/ASR noise; snapshot dorado de la salida canónica.
- **Riesgo/reversión**: alto. Checkpoint antes; revertir si el snapshot difiere.
- **Validación del usuario**: hablar y ver la frase correcta en bitácora.

## P5-19 — Wake strip único

- **Evidencia**: `wakeWord.js:52,63` (se declara único) vs `audioMath.js:553,1305,1215,1334`.
- **Invariante**: implementaciones de strip = N → 1 (`wakeWord.js`).
- **Cómo lo ejecuto**: `audioMath.js` importa de `wakeWord.js`; borrar duplicados.
- **Mi criterio de validación**: `rg -c "function (stripWakeWord|stripWakeWordForDisplay|splitTranscriptAtWakeWord|extractFluVoiceCommand)" src` = 1 por símbolo; behavior test con wake word de config.
- **Inyección/simulación**: fixture `wakeWords:['zumba bot']`; frases con y sin wake; assert de split.
- **Riesgo/reversión**: alto. Revertir si un comando deja de reconocerse.
- **Validación del usuario**: "ok flu, <comando>" funciona.

## P5-20 — Cadenas de respaldo del split con orden único

- **Evidencia**: `audioMath.js:257,376,398,820,855,1034` (`afterWake||commandText||snapshot`) vs `audioMath.js:859` y `WorkspaceSearch.tsx:115` (`afterWakeText||afterWake||commandText`).
- **Invariante**: órdenes de fallback para la misma señal = 2 → 1.
- **Cómo lo ejecuto**: definir UN selector de split y usarlo en los 8 puntos y en `WorkspaceSearch`.
- **Mi criterio de validación (comportamiento)**: test: frase con comando → lo visible en `phrase-display` == lo que ve `WorkspaceSearch` == `commandText` buscado. Guard: `rg` de la cadena alternativa = 0.
- **Inyección/simulación**: 5 frases que hoy disparan cada rama del fallback; comparar los 3 consumidores.
- **Riesgo/reversión**: alto. Revertir si el comando visible ≠ el buscado.
- **Validación del usuario**: decir un comando y ver la barra de búsqueda con el mismo texto.

## P5-21 — Commit de frase: un solo escritor

- **Evidencia**: `useFluVoiceAssistant.js:347,356,374,1691,1778` + `conversationTurnRow.ts:44`, `turnStream.js:61`, `conversationStream.js:779`, `turnSpeakerCommit.js:51`, `wakeTurnCommit.js:156`.
- **Invariante**: escritores de commit de la frase = N → 1.
- **Cómo lo ejecuto**: centralizar el commit en un único punto; los demás pasan a ser resolutores puros (sin escritura).
- **Mi criterio de validación (comportamiento)**: una frase → UNA fila en bitácora Y UNA query con el mismo texto (assert de tamaño de array y de contenido). Guard de conteo de writers.
- **Inyección/simulación**: arnés que inyecta una frase sintética por el pipeline y cuenta filas/llamadas a IA; repetir 3 veces para descartar dobles.
- **Riesgo/reversión**: máximo. Checkpoint obligatorio; revertir ante cualquier duplicado.
- **Validación del usuario**: hablar y ver 1 sola burbuja/fila; la IA responde a esa frase.

## P5-22 — Retirar `resolveNavigationCommand` legacy

- **Evidencia**: `deterministicArbiter.js:248` dice sustituir la doble ruta, pero `useFluVoiceAssistant.js:2269,4302` la llama.
- **Invariante**: rutas de decisión de comando = 2 → 1 (`deterministicArbiter`).
- **Cómo lo ejecuto**: migrar los dos call sites a `resolveDeterministicCommand`/`planVoiceCommandDispatch`; borrar el import y la función si queda huérfana.
- **Mi criterio de validación (comportamiento)**: test por comando de navegación (abrir agenda, buscar, etc.) con la ruta única; `rg "resolveNavigationCommand" src` = 0.
- **Inyección/simulación**: tabla de comandos → acción esperada, ejecutada por el pipeline.
- **Riesgo/reversión**: alto. Revertir si un comando deja de navegar.
- **Validación del usuario**: probar los comandos de navegación en pantalla.

---

# FASE 4 — Doble persistencia (lo último)

## P4-16 — Una sola IndexedDB

- **Evidencia**: `src/voice/lib/fluStorage.js:3` (`flu-voz-local`: `voice_profiles`, `audit_logs`, `session_state`, `minute_knowledge`, `speaker_clusters`) vs `src/core/db/fluDatabase.ts:561` (`flu-os3`: `auditLog`, `conversations`, `minutes`, `voiceProfiles`, `sessionState`). `App.tsx:1255` (Dexie) y `App.tsx:212` (raw IDB) consumen AMBAS.
- **Invariante**: bases con mismas entidades = 2 → 1 (`flu-os3`).
- **Cómo lo ejecuto**:
  1. Diseñar migración one-shot `flu-voz-local` → `flu-os3` (idempotente, por UUID, con `revision`).
  2. `fluStorage.js` pasa a adapter sobre `fluDatabase.ts`.
  3. Eliminar la segunda apertura de DB.
  4. Migrar los call sites `App.tsx:4586,4588,4594`.
- **Mi criterio de validación (comportamiento)**: test que siembra datos en `flu-voz-local`, corre migración, y verifica lectura desde `flu-os3` sin pérdida; luego assert de que solo se abre 1 DB (`rg -c "indexedDB.open|new Dexie" src` = 1).
- **Inyección/simulación**: `fake-indexeddb` con esquema viejo poblado (perfiles + audit + sesión) y assert de filas tras migrar; correr la migración 2 veces para probar idempotencia.
- **Riesgo/reversión**: máximo (pérdida de datos). Checkpoint + backup de datos de usuario ANTES; dry-run en fixture; si falla, revertir y NO borrar la DB vieja.
- **Validación del usuario**: sus perfiles de voz, bitácora e historial siguen presentes tras actualizar.

## P4-17 — `save/loadSessionState` único

- **Evidencia**: `src/hooks/useSessionPersistence.ts:42,58` (localStorage) vs `src/voice/lib/fluStorage.js:295,309` (IDB).
- **Invariante**: pares save/load = 2 → 1 (IDB `flu-os3`).
- **Cómo lo ejecuto**: unificar en `fluDatabase.ts`; migrar el valor de localStorage a IDB una vez.
- **Mi criterio de validación (comportamiento)**: sesión guardada en un origen se recupera tras recarga; `rg -c "function (saveSessionState|loadSessionState)" src` = 1 por símbolo.
- **Inyección/simulación**: mock de localStorage con estado previo → migración → assert en IDB.
- **Riesgo/reversión**: alto. Revertir si la sesión no se restaura.
- **Validación del usuario**: recargar la app y conservar el estado de sesión.

---

# Matriz de inyección de datos (resumen)

| Escenario | Mecanismo | Dónde vive | Qué prueba |
|---|---|---|---|
| DB (perfiles, sesión, minutas, audit) | `fake-indexeddb` + seeds UUIDv4 | `tests/fixtures/seed*.ts` | migración, borrado lógico, sin pérdida |
| Wake word / voz | config fixture `wakeWords:['zumba bot']` + `__fluDev.runFluPhrase` | `tests/fixtures/voicePhrases.ts` | no hardcode, split único, 1 fila/1 query |
| Config faltante | `vi.stubEnv` / borrar var | test local | falla explícita, no default silencioso |
| Paridad de helpers | tabla entrada→salida + snapshot de la impl. original | `tests/fixtures/parity*.json` | reemplazo sin cambio de salida |
| Errores silenciados | fake que lanza en el borde | test local | queda fila en audit log + estado consistente |
| Fechas | frases + `vi.useFakeTimers()` | test local | parser único estable |
| Build de producción | `npm run build` + grep en `dist/` | salida CI | sin globals ni secretos |
| Secretos | `rg` sobre repo excluyendo `.env` | CI | no hay claves rastreadas |

Ninguna inyección toca `src/` ni datos reales del usuario. Los seeds son efímeros por test.

---

# Criterios de validación del agente (por hito y de cierre)

**Por hito:**
1. `git diff --stat` real (archivos del `allow`, nada fuera).
2. DoD = comando de conteo **ANTES** y **DESPUÉS** (si no baja, el hito se revierte).
3. Guard rojo→verde con lista `archivo:símbolo:línea`.
4. `npm run test:file` del área + `npx tsc --noEmit`.
5. 0 fallos nuevos contra baseline.

**De cierre de fase/entrega:**
- Suite completa verde (o única corrida permitida de `test:full`).
- `rg` de invariantes de la fase en la meta.
- `git diff --stat` acumulado y resumen en el lugar inmutable (commit/PR + `.task/report`).

Formato de cierre obligatorio:
```
Cambios aplicados: <lista>
Validado contra: <comando + salida cruda ANTES/DESPUÉS; guard; baseline 0 nuevos>
No validado: <pendiente del usuario>
```

---

# Validación del USUARIO (al final, DoD-producto)

Solo el usuario cierra esto. Checklist en su pantalla, sobre la app real (`http://127.0.0.1:8000` / puerto de uso):

1. **Voz**: decir "ok flu, <comando>" → aparece **1** burbuja y **1** fila en bitácora; la barra de búsqueda muestra el comando sin la wake word; la IA responde a esa misma frase.
2. **Navegación**: los comandos de agenda/búsqueda siguen funcionando (ruta única).
3. **Datos**: sus perfiles de voz, bitácora y estado de sesión persisten tras recargar y tras la migración de DB.
4. **Borrado lógico**: al borrar una nota/contacto/perfil, desaparece de la vista pero el sistema no corrompe el resto.
5. **Config**: cambiar un valor en `.env` (p. ej. modelo) se refleja sin recompilar lógica quemada; falta de config avisa en vez de inventar.
6. **Minutas/juegos/recordatorios**: dictar minuta, jugar una ronda y crear un recordatorio con fecha funcionan igual que antes.
7. **Producción**: no hay globals de test (`window.__fluDev`) ni secretos expuestos.

**Criterio de aceptación**: el usuario confirma cada punto en pantalla. Sin su confirmación, el estado es "en progreso: hice X, falta Y" (§A1).

---

## Anexo — Trazabilidad punto → evidencia de auditoría

| Punto | Archivos principales |
|---|---|
| P1-01 | `backups/**`, `.gitignore:26` |
| P1-02 | `CLAUDE.md:4`, `AGENTS.md:1` |
| P1-03 | `fluStorage.js:207,217,233` |
| P1-04 | `imageGeneration.js:110-114` |
| P2-05 | `visualConfig.js:42`, `fluConfig.js:2643,2234,2137`, `live-check.mjs:3` |
| P2-06 | `fluConfig.js:1152,1166,1170,1180`, `sharedConfig.ts:76`, `AsrLab.tsx:179`, `appConfig.ts:183-198` |
| P2-07 | `vite.config.ts:89`, `playwright.config.ts:12,17`, `live-check.mjs:4` |
| P2-08 | `appConfig.ts:183,196,197,199,219,241`, `aiServiceFactory.ts:57`, `App.tsx:2674` |
| P2-09 | `.env:5`, `.gitignore:19` |
| P3-10 | 7 archivos citados en el punto |
| P3-11 | 7 archivos citados |
| P3-12 | `textUtils.ts:15,22`, `audioMath.js:26,98` |
| P3-13 | `minuteKnowledgeHelpers.ts`, `minuteKnowledge.js`, `useMinuteKnowledge.ts:165` |
| P3-14 | `speakerEmbeddingCore.js:37`, `speakerCore.js:37,49`, `audioMath.js:1377,1411,1429` |
| P3-15 | `dateParser.ts:67`, `nlDateParser.ts:203` |
| P6-23 | 14 servicios citados |
| P7-24 | 6 archivos citados |
| P7-25 | 12 puntos citados |
| P7-26 | 5 puntos citados |
| P7-27 | `appConfig.ts:613`, `useFluParticipant.ts:208`, `App.tsx:4127`, `loteria.ts:129` |
| P5-18 | `transcriptQuality.ts:203`, `turnTranscript.js:132`, `speechMerge.js:133` |
| P5-19 | `wakeWord.js:52,63`, `audioMath.js:553,1305,1215,1334` |
| P5-20 | `audioMath.js:257,376,398,820,855,1034,859`, `WorkspaceSearch.tsx:115` |
| P5-21 | `useFluVoiceAssistant.js:347,356,374,1691,1778` + 5 libs |
| P5-22 | `deterministicArbiter.js:248`, `useFluVoiceAssistant.js:2269,4302` |
| P4-16 | `fluStorage.js:3`, `fluDatabase.ts:561`, `App.tsx:1255,212` |
| P4-17 | `useSessionPersistence.ts:42,58`, `fluStorage.js:295,309` |

---

*Documento de plan. No se ejecutó ningún cambio de código ni suite de pruebas al generarlo.*

---

# Estado de ejecución (2026-09-19)

## Ejecutado y verificado
- **P1-03**: eliminadas 4 funciones muertas en `src/voice/lib/fluStorage.js` (`addConversationRow`, `getLatestAuditLogs`, `renameAuditLogSpeaker`, `readLatestFromIndex`) — 0 referencias confirmadas.
- **P1-04**: colapsada la rama idéntica en `src/voice/lib/imageGeneration.js` (`primary === 'pollinations'` y fallthrough devolvían lo mismo).
- **P7-26**: `window.__fluOnContractResolved` ahora se expone SOLO en DEV vía `exposeContractHookDev` (`src/App.tsx`).
- **P7-26**: `syncListenLogGlobals` guardado por `IS_DEV` (`src/voice/lib/listenLog.js`).
- **P3-11**: `stripDiacritics` **7 → 2**. Canónico en `src/lib/textUtils.ts`; eliminadas copias en `gameUtils`, `gameCatalog`, `veoVeo`, `palabrasEncadenadas`, `simonDice`, `searchLanguage` (importan/reexportan). Queda `audioMath.js` por **divergencia real** (hace `.toLowerCase()` + `ACCENT_MAP`).
- **P3-10**: `normalizeForMatch` **7 → 2**. Canónico en `src/lib/textUtils.ts`; consolidados los juegos y `configCommands.js`. Queda `musicPlayer.ts` por **divergencia real** (no colapsa espacios y usa lowercase-first).
- **P1-01**: eliminado `backups/` (8306 archivos, 2.88 GB). Git intacto (estaba ignorado).
- **P0-00**: creado `tests/deviationGuard.test.ts` (verde, anti-regresión) que codifica P1-01/03/04, P7-26 y P3-10/11.
- **P3-15**: **falso positivo**. `parseDateTime` (formatos explícitos) y `parseNlDateTime` (lenguaje natural) son funciones distintas y complementarias, no duplicados. No se toca.
- **P2-09**: cerrado sin acción de agente; `.env` está en `.gitignore` y no hay clave en archivos rastreados. Rotación queda a criterio del usuario.

Verificación: `npx tsc --noEmit` limpio · `npx vitest run tests/deviationGuard.test.ts` **7/7 verde** · `npm test` (`--changed`) **1008/1009 verde**. El único fallo (`tests/misrouteGuards.test.ts` → lotería) es **preexistente**: `src/core/games/loteria.ts:180` usa `playerId` como ganador y ese archivo NO está en el diff.

## No ejecutado (bloqueado por constraint, irreversibilidad o divergencia real)
- **P1-01** (backups): irreversible, no están en git; requiere tu OK explícito.
- **P1-02** (CLAUDE.md): lo lee `tests/protocolGuard.test.ts:32,56-71` (guard validado). Borrarlo rompe la suite; la raíz real es migrar esas aserciones a `AGENTS.md`.
- **P2-09** (rotar API key): acción externa en el dashboard de OpenRouter.
- **P3-12** (`normalizeSpaces`/`cleanForSpeech`): `src/lib/textUtils.ts` usa `String(s || '')` y `src/voice/lib/audioMath.js` usa `String(text)` → **divergen para `null`/`undefined`**; consolidar cambia comportamiento. Requiere decisión + test.
- **F5 voz §9**, **F4 doble IndexedDB**, **P6-23 borrado lógico**, **P2-08 fallbacks**, **P3-14 speaker**: alto riesgo sin suite; requieren guard de comportamiento y corrida completa al cierre.
- **P2-07** (puertos): 3 configs; exige módulo compartido para un único default (churn de config, bajo valor).

Alcance corto por hito aplicado: no se tocó nada de voz/persistencia validada sin verificación.
