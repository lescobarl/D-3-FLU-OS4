# Estado del Sistema FLU OS4 — 2026-09-06

> Snapshot verificado en la auditoría integral del 2026-09-06 (rama `feature/fase-conversacional-acciones`).
> Puerta de calidad en cierre: `npx tsc -b` + `npm run test:full` + `npm run build`.

## Aplicación
- **Dev server**: `npm run dev` → Vite en `http://localhost:5173` (auto-open solo en dev manual; no abre pestaña en corridas Playwright vía `PLAYWRIGHT_SERVER=1`).
- **E2E (Playwright)**: servidor propio en el puerto `5175` (`playwright.config.ts`), spec en `tests/e2e/`.
- **Stack real**: React 19, Vite 8, Zustand 5, Dexie (24 tablas, versioning v3→v17), TypeScript estricto. Sin React Router ni Tailwind (CLAUDE.md §3 describe el stack objetivo; la migración está pendiente).

## Convenciones en vigor
- `npm test` corre SOLO los tests afectados (`vitest run --changed`); `npm run test:full` la suite completa. Blindado por `tests/protocolGuard.test.ts`.
- Config externa centralizada en `src/core/config/appConfig.ts` (guard en `tests/hardcodeGuard.test.ts`; allowlist real documentada en CLAUDE.md §8.3/8.4).
- Eventos de dominio por bus: `src/core/events/fluEvents.ts` (UI) y `src/core/autonomy/autonomyEvents.ts` (sistemas autónomos).
- `.env.example` es la única fuente de verdad de variables; alineado con `appConfig` y cubierto por `tests/configEnv.test.ts`.

## Trabajo de remediación entregado (2026-09-06)
- Checkpoint del WIP "Fase conversacional": IA emite `acciones {dominio, texto}` re-resueltas por parsers deterministas; onboarding `completeWithName` para perfiles existentes; limpieza de estado huérfano al borrar participante; meridiano am/pm en parser temporal. E2E de auditoría (acciones LLM y despacho real) en `tests/e2e/`.
- Limpieza de debug productivo: retirado el bloque "DIAGNÓSTICO TEMPORAL" (`setInterval` 2 s), `relayLog [DIAG-*]`, `console.[log] [FLU-DEBUG]*` y los duplicados `[DIAG]` de avatar. Los `catch` vacíos de SW/listen registran error con contexto.
- Autonomía: bus `autonomyEvents.ts` (interfaz común suscribible) sustituye los 8 `CustomEvent 'flu-*'` de `window` que no tenían listener; el hook los convierte en notificaciones del panel. `AutonomyStatusPanel` es presentacional (state/actions por props) → una sola instancia del hook. Eliminada la telemetría fabricada (`getConsolidatedAutonomyStatus`) y orquestadores muertos.
- Config/env alineados (`.env.example` ↔ `appConfig` ↔ `configEnv.test`); default `VITE_GEMINI_MODEL` unificado en `gemini-2.5-flash-lite`; `VITE_WHATSAPP_WEB_BASE` documentada y testeada; removidas vars fantasma.
- Higiene: `reports/` (PNG E2E regenerables) excluido de git; `.gitignore` corregido; `sessionBootstrap.js`/`speakerClusterStore.js`/`streamStt/client.js` eliminados (sin importadores); `backups/` reducido de 1.69 GB a 238 MB (solo 08-29) y **sin copias de `.env`** (secretos fuera de git); 13 planes obsoletos del linaje pizarrón/agenda borrados y referencias colgantes corregidas.
- Deduplicación de rutas dobles: `pickLabel` ×4 → `src/lib/textUtils.ts` (con test); fallback de persistencia Zustand ×2 → `src/store/storage.ts`; helpers E2E ×4 specs → `tests/e2e/_helpers.ts` (gotoClean/stubLocalSpeech/readStore/clearStore/captureScreenshot).
- Tests depurados: triviales/no-op eliminados de `architecture.test.ts`, EXPRESSION_MAP validado de verdad, cabeceras OS3→OS4, `useConfigPersistence.test` renumerado 1–17. `npm run lint` ejecuta los guards reales (hardcode/protocol/stability).

## Trabajo de remediación entregado (2.ª tanda, mismo día)
- **Ejecutado y verificado**: lo anterior con `tsc -b` limpio, `npm run test:full` 2686/2686 (143 archivos) y `npm run build` OK en la rama `feature/fase-conversacional-acciones`.
- **No fusionado (requiere ciclo dedicado con validación runtime)**: la unificación de los 3 motores de contrato IA (`voice/lib/gemini.js` / `services/deepseek.ts` / `services/gemini.ts`) y el code-split de `App.tsx` (React Router + lazy). Son refactors grandes que exigen validación con LLM real (E2E con API key) y un ciclo por fases; no se ejecutan a ciegas en un solo pase para no violar la regla de corrección validada.

## Deudas técnicas identificadas (auditoría 2026-09-06)
1. **Mandatos arquitectónicos ausentes (CLAUDE §7.1/§7.2)**: no existe tabla `app_catalogos` + UI Configuradora, ni Workflow Engine + UI Diseñadora, ni `screenRegistry`/pantallas dinámicas.
2. **Monolitos**: `App.tsx` (~5.1k líneas), `App.css` (~4.9k), `useFluVoiceAssistant.js` (~4.3k). Sin React Router/lazy ni `src/modules/`.
3. **Rutas IA paralelas**: contrato FLU en `voice/lib/gemini.js`, `services/deepseek.ts` y `services/gemini.ts` (elegir UNA fuente).
4. **Config duplicada**: `voice/lib/fluConfig.js` (2.5k líneas) importado desde `core` + `voiceConfigCatalog` → centralizar en `core/config`.
5. **Autonomía — DI interna**: los motores instancian colaboradores con `new` (`DataExtractor`, `FactorEvaluator`, …). Requiere plan + tests (hoy no hay tests unitarios de motores).
6. **`src/lib` huérfano**: ~11 módulos de IA solo importados por tests (conversationFlow, memoryConsolidation, goalTracker, …). Decidir integración o retiro.
7. **Stream STT**: `streamStt/client.js` sin consumidor (feature a medio cablear).
8. **Plans**: ~15 planes superados del linaje pizarrón/agenda/catálogos sin depurar (la convención del repo conserva bitácoras).
9. **Estética/capas**: `architecture.test.ts`↔`integration.test.ts` solapados; helpers e2e duplicados (~150 líneas × 4 specs).

## Historial resumido (verificado en git)
- Rama `feature/fase-conversacional-acciones`: `6f46e43` (WIP checkpoint), `9e3555d` (debug), `6d3d6a4` (autonomía), `c4d5d9f` (config/env), más el cierre de este día.
- `main` queda 21 commits adelante de `origin/main` + el trabajo de la rama por integrar (flujo `feature/*`, CLAUDE §1.4).

---
*Última actualización: 2026-09-06 · Snapshot estático; la verificación final (suite completa + build) corre en el cierre del día.*
