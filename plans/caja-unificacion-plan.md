# Caja ("ultima frase"): unificacion de escritores (plan de ejecucion)

Estado 2026-10-14: el replay crudo (tests/replayDuenoDiarizacionGuard.test.ts, 353 eventos del
log real por el ingress) mide: 18 actualizaciones, 136 chars mostrados de 49.559 emitidos y
reemplazos DENTRO de un turno (29->31->37->44). Causa: la caja (publishedLiveRef) tiene SIETE
escritores y la regla monotona solo vive en la rama de preview 345-376.

## Mapa de escritores (medido)
- conversationStreamCommit.js:196 reset (parrafo/turno nuevo)
- conversationStreamCommit.js:345 union cola-solapada (rama corta)
- conversationStreamCommit.js:367 union (rama no-conserva)
- conversationStreamCommit.js:376 apply directo (rama preview)
- conversationStreamCommit.js:767 reset (cierre)
- useFluVoiceAssistant.js:906 escritura del flush/estable (FUERA del modulo dueno)
- useFluVoiceAssistant.js:915/979/1071/2620/2773 resets/spill

## Objetivo: un escritor, una regla
1) En conversationStreamCommit (dueno del modulo): exponer
   - publicarEnLaCaja(texto): contenida -> mantener; mas corta -> union o bloqueo; no contenida
     -> union o bloqueo; resto -> aplicar. (Unico punto que escribe publishedLiveRef.)
   - vaciarLaCaja(): resets legitimos (cierre confirmado, parrafo nuevo, reset de sesion).
2) Inyectar ambas por deps (setPublishedLive/vaciarPublishedLive) y migrar los SIETE puntos:
   el hook NO toca el ref; llama a la API inyectada. Cero rutas dobles.
3) El reset por cierre confirmado (settlesTurn) se mantiene SOLO via vaciarLaCaja.

## Validacion (la unica que cierra)
- Replay crudo por el ingress: 0 reemplazos DENTRO de turno; caja final por turno ~= lo dictado
  del turno; actualizaciones por turno > 1 cuando hay texto nuevo.
- Guards de caja: vozUltimaFraseSoloAcumula, vozBloqueLargoPierdeFila, vozLocucion*, replay.
- Suite de guards completa + typecheck en el pre-commit.

## Higiene de commit (en este orden)
1) src solo (0.22): conversationStreamCommit + speakerCore + hook, SIN tests.
2) tests/guard-files/report aparte. 3) debug.log archivado antes de cada commit.
4) auditLedgerSync: alinear el sensor con los items P11.21..P11.26 antes de cerrar.

## HITO 1 CERRADO (2026-10-14) - medido

- Escrituras del ref antes/despues: 11 sitios (5 modulo + 6 hook) -> **2** (publicar + vaciar,
  ambos dentro de `crearCajaDeLaFrase`) y **0** en el hook (guard: vozCajaUnSoloEscritorGuard).
- Replay crudo por el ingress (`npx vitest run tests/replayDuenoDiarizacionGuard.test.ts`):
  - antes: 18 actualizaciones, 136 chars de caja, 3 reemplazos intra-turno (29->31->37->44).
  - despues: 133 actualizaciones, 992 chars (max=992), **0 reemplazos** intra-turno, 0 6-gramas
    repetidos en la caja final.
- Puntos migrados: hook (flush/estable, spill, resetVoiceDisplay, arranque/parada/sesion) y modulo
  (ancla de parrafo nuevo con `{ visible: false }`, cola solapada, solape anadido, emision
  actual, reset de cierre).
- Coste acotado: ventana de 160 palabras en el solape (sin ella el replay no terminaba).
