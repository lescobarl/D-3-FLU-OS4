# HANDOFF · auditoría de voz / caja de última frase / filas

## TL;DR (lee esto y para si solo necesitas arrancar)

1. **Único cambio de producto pendiente:** el cierre por srGap pierde texto —
   `transcriptIngress.js:232-236` pisa la línea viva con la caja y `:257` commitea la caja.
   Debe crecer la caja (helper compartido con `conversationStreamCommit.js:983`), no recortar la fila.
2. **Barrera rota:** `tests/vozSrGapReferenciaVivaGuard.test.ts:203-210` espera la fila corta (detector invertido).
3. **Aceptado de Kilo:** caja sin encoger (`conversationStreamCommit.js:615-617`), un solo escritor de
   `publishedLiveRef`, guards de eco/nombre/clave mixta.
4. **Con test, sin sesión real:** `speakerDiarization.js` (H14, staged, no commiteado) y la ventana de eco (H9).
5. **No ejecutar nada** hasta que el dueño lo pida. **No commitear** sin pedido.
   Detalle completo: §2 (hallazgos), §3 (invariantes), §4 (P1…P6), §5 (validación).

---

**Qué es:** estado vivo de la auditoría del árbol de trabajo de Kilo (sin commitear) sobre
la caja de última frase, el ingress y los hablantes. **No es un doc de producto ni de
reglas**: las reglas están en `AGENTS.md`.
**Cómo se usa:** una sesión nueva (o otro agente) lo lee ANTES de tocar nada. La sección
`ESTADO DEL ÁRBOL` la regenera `node scripts/handoff.mjs`; el resto es conocimiento y solo
cambia cuando cambia el diagnóstico.
**Última revisión del diagnóstico:** 2026-10-22 (auditoría estática, sin ejecutar nada).

---

## 0. Cómo continuar

1. Leer este fichero + `AGENTS.md`. **No ejecutar nada** hasta que el dueño dé la orden.
2. El veredicto ya está tomado (§1). Lo que falta es una decisión del dueño, no más análisis.
3. Si el dueño pide código: abrir **primero** `§4 P1` (es el único defecto de producto).

---

## 1. Veredicto (3 líneas)

- **Aceptar y conservar** de Kilo: la caja no encoge (`conversationStreamCommit.js:615-617`),
  un solo escritor de `publishedLiveRef`, el fin de la mezcla de dos hipótesis para deltas
  cortos, y los tres guards de eco/hablantes (`audioMath.js:1681-1685`,
  `speakerIdentityRegister.js:85-100`, `registerParticipantVoice.ts:46-56`) más `claveMixta`
  (`conversationTurnRow.ts:426-470`).
- **Rechazar**: `fila = caja` resuelto *recortando la fila* en el cierre por srGap, con el
  detector P11.9 invertido en un test. Es el canal de pérdida que el dueño reportó.
- **Fuera de encargo**: FLU Playback (loader duplicado).

---

## 2. Hallazgos con evidencia (`archivo:línea`)

| # | Evidencia | Qué pasa |
|---|-----------|----------|
| H1 | `src/voice/lib/transcriptIngress.js:232-236` | El flush del srGap **pisa** `openLine`/`pendingInterim`/`pendingFinal` con la caja (`publishedLiveRef`) *antes* del EVAL: si la caja rechazó una emisión más larga, la hipótesis completa se destruye ahí. |
| H2 | `src/voice/lib/transcriptIngress.js:257` | `captureFinal = canonSinTartamudeo(liveText \|\| capture)`: la fila es la caja, aunque la línea viva tuviera más texto. Antes ganaba la más completa (`liveText.length > capture.length ? liveText : capture`). |
| H3 | `src/voice/lib/conversationStreamCommit.js:983-994` | El bloque que *hace crecer* la caja (lo correcto) no es alcanzable desde el srGap: H1 ya vació `listenState`, así que `lineaVivaCierre === ''` y la condición nunca se cumple. |
| H4 | `tests/vozSrGapReferenciaVivaGuard.test.ts:203-210` | El detector P11.9 está invertido: el caso "caja corta / línea viva larga" ahora espera la fila **corta**. Era la prueba de mutación que protegía la pérdida de texto. |
| H5 | `scripts/replay/compareExpected.mjs:547-553` | `boxLost` exige `fila ⊇ caja` del instante. Una fila corta con caja corta pasa: por eso d4c1c8f3 da 7/7 y el dueño puede seguir perdiendo frases. |
| H6 | `src/voice/lib/conversationStream.js:545` | Sigue `mergeSpeechText(..., keepAll:true)` para dos hipótesis largas: la raíz de la mezcla está estrechada (deltas ≤3 palabras, `isSameFragmentRevision`), no eliminada. |
| H7 | `src/voice/lib/conversationStream.js:435-445` | JSDoc huérfano de `esCorreccionDelMismoTramo` (función ya eliminada). |
| H8 | `src/voice/lib/transcriptIngress.js:45` | Línea en blanco dentro del import (hueco de la reversión). |
| H9 | `tests/vozEcoIdentidadGuard.test.ts:17-23` | Mockea `getLastCompletedSpeechAt` **y** la ventana (1200 ms): prueba el mecanismo, no el umbral. El eco real no está medido con grabación. |
| H10 | `src/hooks/useParticipants.ts:148-193` | Migración de datos (borra participante + renombra filas) dentro de un `useEffect` con clave de localStorage, no en el dueño del dato. |
| H11 | `src/hooks/useParticipants.ts:163-166` + `src/voice/lib/audioMath.js:1681-1685` | El vocabulario del sufijo de confirmación (`registrado/registrada/registered`) vive en 3 sitios (stopwords, regex `baseOf`, tests). |
| H12 | `scripts/playback/session.mjs:29,149` | Segundo `readNdjson`/`loadSession`, ruta doble con `scripts/replay/loadSession.mjs`. Fixture `tests/fixtures/playback/mini` con `events.ndjson` y `turns.ndjson` de 0 bytes. |
| H13 | `src/voice/lib/conversationStreamCommit.js:817,1310` | La invariante "la caja no encoge" solo cubre la puerta de `resolverEmisionDeLaCaja`; `vaciarLaCaja({visible:false})` puede limpiar la memoria a mitad de locución. |
| H14 | `src/voice/lib/speakerDiarization.js:415-431,489-520,548-560,622,976-990,1122-1136` (SIN COMMITEAR) | Kilo quitó el atajo `anchorVerified` que **saltaba** `namedAssignmentConfirmed`: un ancla verificada ya no se salta el margen contra la mejor voz alternativa (solo conserva su piso, `namedAssignmentConfirmed:166-172`). Ataca el síntoma "la mujer aparece como Luis". Ahora trae 3 casos sobre el resolutor REAL (`tests/simulacionReglasVoz.test.ts`: mujer 0.5 → no Luis; titular 1.0 → Luis; turno mezclado no vuelve a Luis por el pin del primario). **Falta la sesión real**: el riesgo simétrico es que la voz del dueño deje de nombrarse cuando hay otra parecida cerca (más `Hablante N`). |

**Nota de vigencia (2026-10-22 10:18):** el trabajo auditado ya está commiteado en
`3b9d4217 fix(voz): eco, clave mixta, caja sin shrink y fila canonica`, con los números de
línea de H1-H13 verificados sobre el árbol actual. H14 (`speakerDiarization.js`) es trabajo
NUEVO, todavía sin commitear, que no estaba en la auditoría original.

---

## 3. Invariantes que hay que exigir (medibles, en positivo)

1. **`fila ⊇ max(caja, línea viva)`** cuando la línea viva es la **misma locución**. Es la
   que falta y la que explica el síntoma del dueño.
2. **`acorta:true` aplicadas = 0** en la traza de la caja.
3. **Filas más cortas que la última caja de su locución = 0** (hoy `boxLost` no lo mide).
4. **Una hipótesis por hueco de audio** (no concatenar dos motores).
5. **Un solo escritor de `publishedLiveRef`** (`crearCajaDeLaFrase`).
6. **La caja no encoge dentro de la locución**; el único encogimiento es el vaciado del cierre.

---

## 4. Pendientes por riesgo

**P1 · ALTO — el cierre por srGap no puede perder la línea viva.**
Arreglo: en `transcriptIngress.js:228`, antes de sembrar, calcular la frase de cierre como
*misma revisión y más completa* (`published` vs `readTurnLive`) y usarla como
`published`/`captureFinal`; y que esa misma frase **haga crecer la caja** por el único
escritor (helper compartido con `conversationStreamCommit.js:983`). Sin concatenar, sin
`keepAll`, sin segunda vía de escritura.

**P2 · ALTO — restaurar el detector P11.9** con su mutación: borrar el texto vivo en el
flush ⇒ rojo; `live` corta + `openLine` larga ⇒ la fila no puede ser la corta salvo que la
caja ya fuera la corta **y** se haya intentado crecerla (H4).

**P3 · ALTO — añadir los dos números de §3.2 y §3.3 al runner**, además de `boxLost`, y
correrlos sobre `d4c1c8f3` **y** sobre la grabación del 17:15.

**P4 · MEDIO** — ventana de eco medida con grabación (H9) y llevada a config; vocabulario
único del sufijo (H11); migración al dueño del dato (H10).

**P5 · BAJO** — JSDoc muerto e import con hueco (H7, H8); Playback a su rama o reusando el
loader del replay (H12).

**P6 · DECLARADO, no pendiente** — `#11` ("no lo voy a preparar al 100%" vs "…100 porque"):
con "la caja no encoge" la corrección más corta no se pinta, así que la fila se queda en
"100 porque". Es variante aceptada **mientras** la caja no admita revisiones más cortas. Si
algún día se abre esa puerta, `#11` se reevalúa. No mezclar las dos hipótesis para
recuperarlo.

---

## 5. Cómo se valida

```bat
node scripts/replay.mjs --session <ruta-sesion> --mode events     :: 7/7 checks; boxStall < tope
node scripts/replay.mjs --session <ruta-sesion> --mode vectors    :: partial/exit 2 si cobertura < 100%
npm run test:file tests/vozSrGapReferenciaVivaGuard.test.ts
npm run test:file tests/vozCajaFraseViva.test.ts
npm run test:file tests/ingressHipotesisUnica.test.ts
npm run test:file tests/replayEvents.test.ts
npm run gate      :: typecheck + lint
npm run build
```

- **Prohibido** `npm run test:full` / `vitest run` sin filtro (AGENTS §1.15): la suite
  completa es del CI.
- Un cambio de voz/caja/juegos/agenda obliga a correr también la **capa de composición**
  (tests que montan `useFluVoiceAssistant`), no solo los imports directos (Anexo B.16).
- `boxStall` va estructuralmente pegado al tope: el cierre por silencio se estampa en
  `últimaVoz + srGap` y la ventana se mide hasta la última voz (3331 ms con tope 3500). Un
  número bajo ahí **no** demuestra que no hubo bloqueo.

---

## 6. Qué NO tocar

- ASR, VAD, diarización, vectors, runner (`scripts/replay/**`): son la herramienta de medida.
- El `expected` real y la transcripción del dueño: nunca se commitean.
- Producto mientras el runner encuentre un bug: se reporta.
- Nada se commitea sin pedido explícito del dueño.

---

## 7. ESTADO DEL ÁRBOL (generado)

<!-- AUTO:ESTADO -->
generado: 2026-10-22 16:21:45

- rama: `feature/auditoria-codigo-unificaciones-01`
- HEAD: `2f604502 feat(playback): FLU Playback fase 1 y runner estable`
- sin cambios en ficheros rastreados
- modificados: 3
  - `M  scripts/guard-files.mjs`
  - `M  src/voice/lib/speakerDiarization.js`
  - `A  tests/simulacionReglasVoz.test.ts`
- sin trackear: 2
  - `?? docs/`
  - `?? scripts/handoff.mjs`

> El estado de arriba es el arbol REAL en el momento de generar. Si el dueño no ha
> commiteado, una sesion nueva NO hereda estos cambios: los hereda del disco, no de git.
<!-- /AUTO:ESTADO -->
