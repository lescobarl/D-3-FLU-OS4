# Estado de sesión — 2026-09-17

> Documento de estado. No es código; es el punto de partida para la próxima sesión.

## Contexto

- Rama: `feature/fase-conversacional-acciones`
- App: React/PWA offline (Vite 8). Voz + calendario unificado + diarización + pizarrón.
- Gates corridos hoy: `typecheck` limpio · guards estructurales (`npm run lint`) verdes ·
  suites tocadas verdes (agenda/seed/parser/voz).

## Completado en este ciclo

| Bloque | Estado |
|---|---|
| Catálogo de auditoría | 28/28 en META |
| Diarización | unificada (1 motor, 1 coseno, 1 normalizador) |
| Calendario | 1 servicio (`agendaService`) + 1 motor (`useAgenda`) + 1 panel (`AgendaPanel`) |
| Voz offline | fallback Whisper WASM ante `network`/`no-speech` |
| Minuta | rollover 100% por usuario |
| Aislamiento multiusuario | historial, pizarrón, búsqueda/imagen/video, agenda, notas, documentos, compras |
| **Bug seed DEMO** | **corregido** (ver abajo) |
| **Bug "hoy"→mañana** | **corregido** |
| **Bug duplicado transcripción** | **corregido (carrera del mismo turno)** |

## Bugs reportados — resolución

### 1. Seed DEMO re-sembraba items borrados — CORREGIDO
- Causa raíz: `App.tsx` listaba solo `status:'pending'`; al cancelar, el item pasa a
  `deleted`, el label desaparecía del set y el seed lo recreaba.
- Fix: se lista **todos los estados** y el filtro vive en una función pura
  `selectDemoAgendaInputs(existing, now)` (`src/core/agenda/demoSeed.ts`).
- Guard de comportamiento: `tests/demoSeed.test.ts`.

### 2. Registro duplicado en transcripción — CORREGIDO
- Causa raíz: la MISMA línea cerrada se re-emitía al único escritor (doble `onend`/
  doble dispatch) y el dedup por `lastEmittedTranscriptRef` no cubría el caso.
- Fix: guard determinista `isDuplicateTurnCommit` (`src/voice/lib/turnStream.js`) aplicado
  en el **único escritor** `handleConversationStreamSync` (`conversationStreamCommit.js`).
  Discrimina por habla nueva (`lastResultAt` vs `lastCommitAt`), **sin ventanas de tiempo**,
  y preserva "pausa ⇒ fila nueva".
- Guard: `tests/voiceTurnRefireDedup.test.ts`.
- Pendiente de runtime real: confirmar en la app viva que la fila ya no se duplica.

### 3. "hoy" agendaba para mañana — CORREGIDO
- Causa raíz doble: `nlDateParser.ts` rama `today` rodaba `startOfDay` a mañana; y
  `agendaCommandParser.ts:186` rodaba incondicionalmente la hora compuesta.
- Fix: con **día explícito** ("hoy"/"mañana"/weekday/fecha) NO se rueda; solo la hora
  pelada ("a las 7") cae a la próxima ocurrencia.
- Guard: bloque `"hoy" no salta a mañana` en `tests/agendaCommandParser.test.ts`.

### 4. Panel derecho (AgendaPanel) — código alineado; falta tu validación visual
- `AgendaPanel` ya implementa la definición: **un solo listado** con todos los temporales
  mezclados, diferenciados **solo por color**; "Próximos" y "Notas" aparte.
- Cableado en `WorkspaceHub` (prop `agenda`). No se tocó para no romper lo validado.
- El cierre de este punto es **DoD-producto**: lo declarás vos al verlo en tu pantalla.

## Reglas a respetar en la próxima sesión

1. **Validar contra la pantalla del usuario**, no contra typecheck/tests.
2. **Leer el código existente antes de reemplazar**.
3. **No tocar**: orden de presentación (video/imagen/documento) en `ResultFeed`/`WorkspaceHub`; notas y próximos.
4. **Una sola fuente** por intención; sin rutas dobles, sin hardcode, sin parches.
5. Un commit por hito; verde (typecheck + guard) por hito.

## Orden sugerido

1. Validar en pantalla los bugs 1-3 (arranca `python run_dev.py` / `npm run dev`).
2. Validar el panel (bug 4) contra la definición de color único.
3. Si algo falla en runtime, adjuntar trace y re-medir.
