# Estado de sesión — 2026-09-13

> Rama: `feature/fase-conversacional-acciones`
> HEAD: `4768688` · Respaldo: rama `respaldo-2026-09-13-1` + `backups/respaldo-2026-09-13-1.bundle`
> Este documento es **histórico de trabajo**, no declara validación de producto.

---

## 1. Estado técnico

- `tsc -b`: limpio.
- `npm run lint` (guards, incluido en pre-commit/CI local): **39 tests** verdes.
- `npm run test:full`: **192 archivos / 2927 tests passed, 0 fallos**, excluyendo el guard
  **externo** `tests/schedulerSingleDefinition.test.ts` que nace ROJO (ver §4.9).
- Portal dev: `npm run dev` (Vite, persistente cuando la sesión lo permite), `http://localhost:5173`.

---

## 2. Cambios aplicados (por commit, más reciente primero)

| Commit | Qué |
|---|---|
| `4768688` | Fila del **usuario inmediata** (`userCommitOnly`) + limpieza de turno/spill al cerrar (corta el ciclo de comandos repetidos). |
| `14d4c65` | Tolerancia conversacional: `interimCommandDelayMs` 500→1400, gracia desde 2 palabras, `interimFinalizeGraceMs` 25→250, asentado de conversación. |
| `6224d15` | Commit temprano de la transcripción en `processCapture` (visibilidad inmediata). |
| `5714be8` | **Selector único de hora** (`src/core/temporal/timeOfDay.ts`) usado por temporal, horario y recordatorios. |
| `4327c76` | Limpieza por turno; hora con meridiem; citas con contexto; notas "lista"; minuta con precedencia sobre documento. |
| `1a704a8` | Dedup de capturas no descarta la corrección parcial→completo (bandera de settle). |
| `8166639` | Artefacto restaurado pinta el **objeto** (img/video/doc) + dedup anti-acumulación. |
| `336c3f9` | Clave OpenRouter desde `.env`; idempotencia de alarmas; log de latencia IA. |
| `3df2704` | Borrar alarmas sin hora = todas; cancelar por hora también las de una sola vez. |
| `8c23227` | Alarma de **una sola vez** por defecto; diaria solo si se pide explícito. |
| `da7295f` | Transcripción visible al instante; reply de estado hablado; dedup de capturas repetidas. |
| `936dc44` | Restauración del último artefacto persistido por prioridad (video > imagen > doc). |
| `66802fd` | Cierre único por `commitAndResolveTurn`; query derivada por `deriveQueryFromRow`. |
| `c277b95` / `865904a` | Par único `commit+resolución` en ramas adyacentes + deps. |
| `0f103d0` | Dictado natural (niños) en horario y notas. |
| `6819317` | Foco por turno; retención del último artefacto; doc fuera del área de texto; dominios horario/temporal/diary. |
| `e652ccf` | Puerta de invariantes (guard-nace-rojo) + `deny` de criterios (externo). |
| `1da82f2` / `607d001` | Fila usa el valor commiteado (guard de derivación); commit único de locución (`commitTurnPhrase`). |
| `0d2ca86` | Error de reconocimiento `network` con mensaje accionable; `engine-error` del motor local. |
| `1001a54` | Tabs del Pizarrón (Todo/Imágenes/Video-Docs/Historial); foco por artefacto; historial por punteros. |

---

## 3. Casos reportados y estado

### Aplicados (falta validación de pantalla)
1. **Fila del usuario aparecía solo al responder la IA** → commit temprano por el canal único (`userCommitOnly`).
2. **Ciclo: el comando se repetía** → limpieza de turn buffer + spill al cerrar (`clearTurnAfterResolve`).
3. **Transcripción en vivo** → `commitOnly` en todas las ramas.
4. **"Ok flu" poco tolerante** → subir pausa de cierre (config).
5. **Hora con meridiem** ("2:00 con 10 p.m" → 22:00) en temporal/horario/nlDate.
6. **Alarma**: una sola vez por defecto; diaria explícita; borrar/cancelar alarmas.
7. **Citas con contexto** ("revisar Data brix") y "junta/reunión".
8. **Notas**: "crea una lista…" y "nota del súper…".
9. **Minuta**: "generar minuta" → `GENERAR_RESUMEN` (no PDF).
10. **Búsqueda**: clave OpenRouter desde `.env`; resultados se limpian por turno; restauración por prioridad.

### Pendientes (ver §4)
- `[FLU recuerda]` en la conversación · nota cuando el LLM no emite `acciones` ·
  doble invocación en dev · latencia IA · guard externo del scheduler · contrato/CI.

---

## 4. Pendientes detallados y solución propuesta

1. **`[FLU recuerda]` aparece como mensaje de FLU** → `useConversationPersistence.ts:103`
   inyecta `systemEventLog` en la conversación. **Solución:** excluir esas entradas de la bitácora.
2. **Nota no creada cuando el LLM no emite `acciones`** → el parser ya devuelve etiqueta válida;
   **solución:** garantizar el fallback offline (`parseNoteIntentText`) o exigir `acciones` de nota.
3. **Doble invocación en dev (logs x2)** → revisar StrictMode/montaje doble del hook;
   hoy lo tapa el dedup. **Solución:** confirmar causa y, si aplica, guard de instancia única.
4. **Latencia de IA** → instrumentada (`latencia IA: Xms`). **Solución:** medir con turnos reales y
   optimizar (p. ej. retry del contrato, prompt).
5. **Guard externo `schedulerSingleDefinition` ROJO** → unifica `reminderScheduler` con `scheduleEngine`.
   **Solución:** re-export/adaptador en `reminderScheduler`.
6. **Contrato `.task/contract.json` obsoleto** → obliga a commitear con `--no-verify`.
   **Solución (usuario):** contrato del hito actual + CI obligatorio + branch protection.

---

## 5. Invariantes y guards (no editar sin re-aprobar)

- `tests/voiceTurnSingleWriter.test.ts` — un solo escritor de la locución.
- `tests/voiceTurnCommitDerivation.test.ts` — la fila usa el valor commiteado.
- `tests/voiceTurnClosingSingleRoute.test.ts` — cierre único (`commitAndResolveTurn`) y query por `deriveQueryFromRow`.
- `tests/voiceLiveSingleWriter.test.ts` — escritor único del interino.
- `tests/navSettleFlag.test.ts` — la corrección parcial→completo no se descarta.
- `tests/temporalIntentParser.test.ts`, `tests/horarioIntentParser.test.ts`,
  `tests/reminderIntentParser.test.ts`, `tests/noteParserBindings.test.ts`,
  `tests/deterministicArbiter.test.ts` — reglas de dictado/hora/minuta.

> Sugerido: congelar estos archivos en `deny`/CI para que el agente no los debilite.

---

## 6. Cómo re-verificar

```powershell
git log --oneline -22
npx tsc -b
npm run lint
npm run test:full        # excluye el guard externo rojo
git branch --list 'respaldo*'
```

Restaurar respaldo:
```
git clone backups\respaldo-2026-09-13-1.bundle
```

---

## 7. Límites (honesto)

- Todo lo de §3 es **DoD-técnico** (guards + suite). La validación en pantalla es del usuario.
- El punto 1 lo reportó el usuario 3 veces; el arreglo ataca la **fuente** (dónde se escribe la fila),
  pero **no está validado en pantalla**.
- El guard externo del scheduler sigue ROJO a propósito (criterio nuevo).

**Última actualización:** 2026-09-13 · **HEAD:** `4768688`
