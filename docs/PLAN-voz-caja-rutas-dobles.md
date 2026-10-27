# PLAN · voz/caja/rutas dobles (2026-10-22)

> **Nota (2026-10-27):** el CLI `npm run replay` se retiró con el corte de
> conversación; la medición vigente es `npm run playback`. Las referencias de abajo
> son registro histórico.

**Base medida:** auditoría del 2026-10-22 sobre `6d06ed34`. Defectos D1–D5 y rutas
dobles R1–R5 en `docs/HANDOFF-voz-caja.md` §2 y en el informe de auditoría de esa
sesión. **No hay cambios de producto aún**; este plan los ordena por riesgo.

**Criterio de aceptación del plan (lo que verá el dueño):** el escenario
«caja corta / línea viva larga» pasa de **rojo a verde** con la fila completa, la caja
**no fabrica** una frase que nadie dijo, no reaparece ninguna pérdida en
`d4c1c8f3` ni en la grabación del 17:15, y `gate` + `build` siguen verdes.

**Reglas de ejecución (AGENTS.md):** rama `feature/*`; un commit por fase; nada se
commitea sin pedido del dueño; suite completa PROHIBIDA (§1.15); validar con
`test:file` / `test:grep` / `npm test` (changed) + `lint` + `typecheck`; incluir la
**capa de composición** (tests que montan `useFluVoiceAssistant`) en toda fase que
toque voz (Anexo B.16); no se toca el `expected` real ni la transcripción del dueño.

---

## Estado de ejecución (2026-10-22)

**Hecho y validado:** Fase 0 (fixture `tests/fixtures/replay/caja-corta-linea-larga`,
rojo→verde), Fase 1 (dueño `fraseDeCierreDeLocucion`), Fase 2 (guard de reentrega),
Fase 3 (barrera P11.9 restaurada), Fase 4 (`boxShrink` + `rowShorterThanBox`),
R2 (vocabulario del sufijo en `src/lib/confirmationSuffix.ts`).

**Desvío declarado de la Fase 1:** el handoff pedía «publicada vs `readTurnLive`, la
más completa». La línea viva acumulada puede traer ya la locución SIGUIENTE (medido
2026-10-19: `vozReplayDueno20261019UltimaSesion`), así que el dueño resuelve
**final confirmado > caja (si es más completa y de la misma revisión) > línea viva
solo si no hay caja**. La caja adopta la frase de cierre al cerrar el turno
(`alCierre`: única excepción al «no sustituir», solo si no encoge).

**Hecho ademas:** la caja expone su **turno** (`turnoActual`), el ingress sella
`pendingFinalTurn` y `locutionClosed` solo adopta la caja del MISMO turno; R1 (la
migracion del sufijo vive en `src/core/multiuser/confirmationNameRepair.ts` con
puertos y test), R3 (`readNdjson` unico: playback delega en replay) y C2 (contrato
de normalizacion por modo fijado en test).

**R5 declarado:** el commit de SEGMENTO vacia la MEMORIA de la caja (no lo visible)
porque el segmento cierra ese tramo; no es un encogimiento. La perdida estaria en el
cierre y la cubre el dueno de la frase (final > caja > linea viva) + la fixture.

**C1 CERRADO (2026-10-22).** `duplicadosMergeD4c1c8f3` C1 estaba rojo porque la caja no
recibia el `final` confirmado: el harness del test cableaba `scheduleTurnCommit` a un doble
que solo apuntaba el texto, mientras el puente real (`conversationIngressBridge.js:52`) lo
delega en `syncConversationStream`. La caja tiene UN solo publicador, asi que sin esa puerta
no habia forma de que el contenido del final llegara al espejo. Dos cambios, sin ruta doble:

1. `montarDeps({ nivel })` declara QUE mide cada caso: `ingress` (puerta de fila aislada,
   nivel de los casos E) o `stream` (escritor real del puente, nivel de C1).
2. El commit declara `confirmedFinal: true` cuando la captura es un `final` de SEGMENTO
   (`transcriptIngress.js`, commit de `ingestFinalChunk`), y la caja admite esa emision como
   **frase canonica**, igual que el cierre: es texto CONFIRMADO por el ASR, no una hipotesis
   interina. `publicarEnLaCaja({ canonica: true })` es el unico dueno de la admision.

**Regla unica que quedo escrita (B.3: caja = fila):** un CIERRE o una CONFIRMACION entregan
la frase canonica y la caja la ADOPTA aunque no derive de lo mostrado (el interino puede ser
un texto fabricado). Se admite (a) crecer, o (b) un boceto **cubierto** por la frase
(`bocetoCubiertoPor`: todas sus palabras aparecen en la frase, en orden, tolerando
repeticiones del ASR). Asi el canon MAS CORTO entra cuando solo quita tartamudeo
("puso Cloud Cloud" -> "puso Cloud") y NO entra cuando el boceto ya lleva habla AJENA (la
locucion siguiente): ahi sigue mandando el no-encogimiento. Una emision INTERINA nunca
sustituye: esa sigue pasando por `resolverEmisionDeLaCaja`.

**Efecto medido en la grabacion real** (`tests/replayEvents.test.ts`, sesion d4c1c8f3):
`rowShorterThanBox` pasa a OK (la fila ya no es mas corta que su caja) y `boxShrink` sigue en
OK; el runner distingue ahora el acorte por **transferencia de la frase canonica**
(`observed.acortesCanonicos`, informado en el detalle del check) del **jitter** del ASR, que
es el unico que cuenta como defecto.

**Guardas anadidas:** `tests/vozCajaFraseViva.test.ts` seccion F (final confirmado mas largo
entra, canon mas corto entra si es eco, y NO cede ante habla ajena) y seccion G (arranque
compartido con cola AJENA no se concatena).

**FASE 2 CERRADA (2026-10-22).** `colaNuevaTrasSolape` rama (B) solo une cuando la emision
CONTINUA lo mostrado: el tramo reentregado llega al FINAL de la caja, o la palabra que la caja
muestra justo despues del tramo es la que la emision reescribe/crece (costura del ASR). Un
tramo INTERIOR con otra cola es otra hipotesis del mismo audio y ya no se concatena (medido:
"vamos a ver si es cie | lo que nos dijo" + "vamos a ver si es cie | esta todo resuelto"
fabricaba "es cie lo que nos dijo esta todo resuelto").

**Cambio de regla DECLARADO:** `tests/vozCajaUnSoloEscritorGuard.test.ts` tenia un caso
("ANADE la cola nueva de un tramo INTERIOR reentregado") que exigia justo la concatenacion que
la Fase 2 prohibe. Se reescribio al criterio nuevo y se le puso CONTROL POSITIVO (la
reentrega de la COLA con continuacion SI crece): no se apago la cobertura, se miden las dos
caras. La grabacion real d4c1c8f3 sigue verde con la regla nueva.

**FASE 4 COMPLETA.** Ademas de `boxShrink` y `rowShorterThanBox`, el comparador emite
`rowLiveLost` (fila mas corta que la LINEA VIVA de su misma revision). Primer intento mal
calibrado y corregido con dato: los 6 commits que marcaba eran filas que son PREFIJO de la
linea viva (dictado corrido: la linea viva ya lleva la locucion siguiente), asi que el flag
solo cuenta cuando la fila NO es prefijo. Falsificacion: fixture
`tests/fixtures/replay/checks/fila-corta-vs-viva.json` (lo enciende) y control negativo en
`limpia.json` (linea viva con locucion siguiente: NO lo enciende).

**R4 ejecutado, con correccion del diagnostico:** `resolveConversationLogText` y
`getLiveTurnDisplay` no tenian lector en `src` (solo su test) -> borrados con sus casos.
`readTurnDisplayCapture` NO estaba muerta: es la implementacion que consume
`readCommandSnapshot` (API viva del hook), asi que no se borro: se hizo INTERNA (sin export) y
su contrato se prueba por `readCommandSnapshot`.

**D3 CERRADO (2026-10-22, la caja duplicada de las grabaciones reales).** Tres causas, cada
una medida con la traza (no por parecido):

1. **El replay inventaba eventos.** El sink escribe UNA fila por resultado del motor, todas
   con el mismo `t`, y el runner reinyectaba cada fila como un evento propio: hipotesis que
   Chrome nunca emitio juntas. `buildMicBurstEvent` acepta ahora la LISTA de resultados
   (`interims`/`finals`) y `eventsRunner` agrupa las filas consecutivas con el mismo `t` y
   tipo, reconstruyendo el evento original. Herramienta, no producto: sin esto se medía otro
   sistema.
2. **`reentregaLoMostrado` exigia que la emision fuera MAS LARGA.** Una reentrega de la misma
   locucion con la ultima palabra a medias ("… hablando de un" -> "… hablando de") no se
   reconocia como reentrega, y la rama de "completar la ultima palabra" creia que "un" crecia
   hasta "unidad" y pegaba la EMISION ENTERA detras: la caja mostraba la locucion DOS VECES
   (`cec7281d`, 238 -> 471 chars, bloque "unidad de medida actualizada" repetido). Ahora la
   reentrega se decide por POSICION (todas las palabras mostradas menos la ultima) y no por
   longitud; con UNA sola palabra mostrada sigue mandando el crecimiento ("du" -> "dupli").
3. **La caja se publicaba ANTES de la normalizacion de la fila.** La fila pasa por
   `normalizeMicText` (colapsa el eco del ASR) despues de reconciliar con la caja, asi que la
   caja conservaba "ya esta ya esta" y la fila no (d4c1c8f3 #0). Ahora la publicacion canonica
   va DESPUES de normalizar y la FRASE CANONICA manda sobre el boceto (no se reconcilia),
   salvo que el boceto APORTE habla que la frase no dice: ese criterio es `bocetoCubiertoPor`,
   el mismo de la caja, y es lo que mantiene la barrera P11.9.

**Medido despues (5 sesiones reales, mismas fixtures):**

| sesion | caja duplicada (antes) | caja duplicada (ahora) | rowLiveLost | rowShorterThanBox |
|---|---|---|---|---|
| `cec7281d` | 1 commit + 52-54 bloques | **0** | OK | OK |
| `7fce0045` | 1 commit + 17 prefijos | **0** | OK | OK |
| `d4c1c8f3` | 0 | **0** | OK | OK |
| `a5fa23e4` | 0 | **0** | OK | OK |
| `bab92f6a` | 0 | **0** | OK | OK |

**Guarda nueva:** `tests/vozCajaUnSoloEscritorGuard.test.ts` bloque B2 (la reentrega con MENOS
palabras no duplica; crecimiento de palabra y reentrega de cola siguen creciendo). El reporte
del replay gana `observed.boxDecisions` (que se PIDIO a la caja, si se aplico y con que
destino): sin eso una union de mas y una emision legitima se ven igual en la traza.

**D4 CERRADO (2026-10-22): la caja se quedaba con una hipotesis vieja.** Medido en
`7fce0045`: la caja mostraba `"porque a los tal vez"` durante 10,7 s con **80 emisiones del
ASR dentro**. La causa era la regla de revision: exigia `comun >= 2` palabras de arranque
compartidas, asi que una hipotesis MAS LARGA que corrige la segunda palabra (`"porque tal vez
tu papa necesita..."`) no entraba nunca y la caja se quedaba con el texto peor.
Ahora una emision **MAS LARGA que arranca con la misma primera palabra** es la hipotesis
vigente de la MISMA locucion y la caja la muestra (se REEMPLAZA, no se une: unirlas fabricaba
una frase). Una locucion DISTINTA no comparte el arranque (`comun 0`) y sigue bloqueada; una
emision mas CORTA sigue sin tocar la caja (mandato de no-encoger).

**`boxStall` afinado con el mismo criterio (no silenciado).** El check contaba como congelacion
cualquier hueco con habla dentro, pero con los mandatos de no-encoger y no-sustituir esa espera
es LEGITIMA: si el ASR acorta o cambia de frase, la caja debe quedarse quieta. Ahora el defecto
es uno solo y medible: **una EXTENSION rechazada** (la emision era lo mostrado + mas texto y la
caja no crecio). El runner anota `extension` en cada decision y `medirCongelacionCaja` solo
cuenta esas ventanas; el resto se informa en `esperaMs` (dato, no defecto). Sin decisiones
conserva la atribucion historica para no perder sensibilidad en llamadores externos.
Falsificacion: dos casos nuevos en `tests/replayEvents.test.ts` (extension rechazada ->
congelacion con motivo `extension-ignorada`; emision que acorta o es de otra locucion -> 0 y
`esperaMs`). Los dos casos de fixture que median la regla vieja se reescribieron con la regla
declarada (`silencio`: `esperaMs` 800, `maxGapMs` 0; `repetida`: insistir con la MISMA frase no
es congelacion y el check queda OK).

**Medido despues, 5 sesiones reales:** `boxStall` OK (0 ms de congelacion real) en las cinco;
`noBoxPrefixDuplication`, `noBoxDuplicatedBlock`, `boxDuplicated`, `boxShrink`,
`rowShorterThanBox` y `rowLiveLost` tambien OK. Queda como dato, NO como defecto, el diff
`sourceRows` de `7fce0045`/`cec7281d`/`a5fa23e4`/`bab92f6a`: la fuente incluye las filas de las
ORDENES (la IA no se ejecuta en el replay) y el replay infiere las marcas de cierre, asi que
esas filas no son comparables 1:1; `d4c1c8f3`, que si tiene expected aprobado, sale limpio.

---

## Fase 0 · Escenario reproducible (sin tocar producto)

**Objetivo:** que el defecto sea una barrera, no una anécdota. Hoy está reproducido
solo en `%TEMP%` (exit 1).

1. Promover el escenario a fixture: `tests/fixtures/replay/caja-corta-linea-larga/`
   con `manifest.json` (schemaVersion 2, `events`/`turns` reales, fidelidad
   `fixture`), `events.ndjson`, `turns.ndjson` y `expected.json` **`approved:true`**
   con la fila correcta (la que el dueño dijo).
2. El fixture es **sintético** (no contiene audio ni transcripción del dueño).

**Aceptación:** `npm run replay -- --session tests/fixtures/replay/caja-corta-linea-larga --mode events --expected …/expected.json`
→ **exit 1 hoy** (pérdida medida: falta «… y el horno», sobra la frase mezclada).

**Riesgo:** ninguno de producto. `godFileSizeGuard` no aplica a fixtures.

---

## Fase 1 · D1/D3 — un solo dueño de la frase de cierre

**Causa raíz:** hay **tres precedencias** para «qué texto cierra la locución»:

| sitio | precedencia |
|---|---|
| `src/voice/lib/transcriptIngress.js:228,232-236,257` | **la caja**, siempre |
| `src/voice/lib/conversationStream.js:492` (`published \|\| capturaDeFilaAlCerrar`) | la caja, y el estado solo como respaldo |
| `src/voice/lib/conversationStreamCommit.js:983-994` | la línea viva **solo si** crece la caja (hoy inalcanzable desde el srGap: `transcriptIngress.js:259` ya vació `listenState`) |

**Cambio anunciado:**

1. `src/voice/lib/conversationStream.js` (+20/−15): dueño único
   `fraseDeCierreDeLocucion({ publicada, lineaViva })`:
   - misma revisión (`utterancesSameRevision`) → **la más completa**;
   - revisión distinta → **la publicada** (nunca concatenar);
   - devuelve `{ texto, creceCaja }`.
   `evaluateSrGapSegmentCommit` y `capturaDeFilaAlCerrar` consumen ese dueño (se
   elimina la segunda elección).
2. `src/voice/lib/transcriptIngress.js` (−10): en `flushSrGapSegmentThroughIngress`
   se siembra con `fraseDeCierreDeLocucion(...)` y se pasa como `published`; **antes**
   de `resetInterimControlBuffers`.
3. `src/voice/lib/conversationIngressBridge.js` (+6): exponer en el ctx
   `growBox`/`publicarEnLaCaja` (inyectado, no importado) desde el hook.
4. `src/voice/hooks/useFluVoiceAssistant.js` (+4): pasar `cajaVivaRef.current.publicarEnLaCaja`
   al ctx del ingress (misma instancia de caja, sin segundo escritor).

**No se hace:** concatenar, `keepAll`, segunda vía de escritura de `publishedLiveRef`,
ni tocar `publicarEnLaCaja` (sigue siendo el único escritor).

**Aceptación:** Fase 0 en **verde** (fila completa, `sourceRows` faltan 0/sobran 0);
`tests/vozCajaFraseViva.test.ts`, `tests/ingressHipotesisUnica.test.ts`,
`tests/turnArtifactKind*` intactos; capa de composición verde.

**Riesgo ALTO:** `transcriptIngress.js` y `conversationStreamCommit.js` son god-files
(trinquete `tests/godFileSizeGuard.test.ts`): el neto de la fase debe ser ≤ 0 líneas
en cada uno (se recorta el JSDoc huérfano de `conversationStream.js:426-445` en la
misma fase).

---

## Fase 2 · D2 — la caja no fabrica hipótesis mezcladas

**Causa raíz:** `resolverEmisionDeLaCaja` (`conversationStreamCommit.js:514-546`)
aplica `solape` (`colaNuevaTrasSolape`) cuando la emisión comparte un **bloque
interior**, aunque sea otra hipótesis del mismo audio: une «vamos a preparar la
receta» + «prepara la receta completa con todos los ingredientes» en una frase que
nadie dijo (reproducido en la traza del escenario).

**Cambio anunciado:** la rama `solape` exige **cola genuina**: el bloque compartido
debe terminar al final de lo mostrado (la emisión reentrega la cola y sigue). Si el
solape es interior, es otra hipótesis → se decide como `revision`/`bloqueado`, nunca
se concatena. Dueño del criterio sigue siendo `colaNuevaTrasSolape` (se endurece su
guarda, no se duplica).

**Aceptación:** en el escenario, `boxTrace` no contiene la frase mezclada; el caso
legítimo («la receta» → «la receta y el horno») **sí** crece; `boxDuplicated = 0`.

**Riesgo MEDIO:** puede cambiar `#11` (P6 del handoff). Si la caja deja de admitir la
variante corta, `#11` se reevalúa — se declara, no se «arregla» mezclando.

---

## Fase 3 · D4 — restaurar la barrera P11.9

**Cambio anunciado:** `tests/vozSrGapReferenciaVivaGuard.test.ts:203-210` pasa a
exigir la **línea viva** (misma revisión) cuando la caja es la corta; se añade la
prueba de mutación: si el flush borra el texto vivo ⇒ **rojo**.

**Aceptación:** T1–T4 se conservan; el nuevo caso falla con el código de Fase 1
revertido y pasa con él (se demuestra revirtiendo en local, sin commit).

---

## Fase 4 · D5 — los dos números en el runner

**Cambio anunciado** (solo `scripts/replay/**`, herramienta de medida):

1. `acortaAplicadas`: nº de publicaciones de caja que acortan respecto a la anterior,
   derivado de `boxTrace` (debe ser **0**).
2. `rowLiveLost`: fila más corta que la **línea viva** de su locución. Exige que
   `eventsRunner` grabe `liveAtCommit` (lectura de `readTurnLive` en el commit; no se
   cambia producto).

**Aceptación:** los dos checks aparecen en el reporte con su detalle; se corren sobre
`d4c1c8f3` **y** la grabación del 17:15; `boxStall` se mantiene pegado al tope (3331
ms con tope 3500: un número bajo ahí **no** prueba nada).

---

## Fase 5 · Rutas dobles (commits separados, tras validar 1–4)

| # | cambio | ficheros | riesgo |
|---|---|---|---|
| R1 | sacar la migración del `useEffect` al dueño del dato (servicio de participantes); el renombrado de filas vuelve a pasar por el único dueño con `claveMixta` | `src/hooks/useParticipants.ts:156-193`, servicio de participantes | MEDIO-ALTO |
| R2 | un solo vocabulario del sufijo de confirmación (constante única; stopwords y reparación la importan) | `src/voice/lib/audioMath.js:1684-1687`, `useParticipants.ts:161` | MEDIO |
| R3 | unificar loader: `scripts/playback/session.mjs` consume `scripts/replay/loadSession.mjs` (arrastra `tests/e2e/playback.spec.ts:13`) y decidir `tests/fixtures/playback/mini` (0 bytes: solo sirve al CLI) | `scripts/playback/session.mjs`, `tests/fixtures/playback/mini` | MEDIO |
| R4 | borrar `resolveConversationLogText` / `readTurnDisplayCapture` / `getLiveTurnDisplay` (solo los usa su test) y su test | `src/voice/lib/conversationSession.js:23,33,49`, `tests/conversationSession.test.ts` | BAJO |
| R5 | declarar o cerrar el hueco de `vaciarLaCaja({visible:false})` en segmento | `conversationStreamCommit.js:1310` | MEDIO |

**Aceptación por fila:** un commit, `test:file` de lo tocado + capa de composición,
sin cambio de comportamiento observable en el runner (mismas filas antes/después).

---

## Fase 6 · Cierre

```bat
npm run replay -- --session tests/fixtures/replay/caja-corta-linea-larga --mode events --expected ...\expected.json
npm run replay -- --session <d4c1c8f3> --mode events --report <r1.json>
npm run replay -- --session <17:15>    --mode events --report <r2.json>
npm run replay -- --session <17:15>    --mode vectors --report <r3.json>
npm run test:file tests/vozSrGapReferenciaVivaGuard.test.ts
npm run test:file tests/vozCajaFraseViva.test.ts
npm run test:file tests/ingressHipotesisUnica.test.ts
npm run test:file tests/replayEvents.test.ts
npm run e2e            :: solo si se tocó UI/persistencia (R1)
npm run gate           :: typecheck + lint
npm run build
```

- La suite completa **no** se corre (AGENTS §1.15).
- `vectors` sobre la sesión real seguirá en `partial`/exit 2 mientras la cobertura sea
  52 % (15/29): se reporta como límite, no se «aprueba».
- Cierre con el formato fijo: **Cambios aplicados · Validado contra · No validado**.

---

## Cierres de lo que estaba DECLARADO (2026-10-22)

**C3 (idioma re-declarado) — medido, no es ruta doble.** Los 52 sitios con `language = 'es'`
en `src/voice` son VALORES POR DEFECTO de funciones que reciben el idioma, no un segundo
almacen ni un segundo selector: el dueño sigue siendo el configurador y los llamadores pasan
el idioma activo (`speakResponse(texto, language)` en `App.tsx`, `useMinuteHandlers`,
`FluAvatarVoiceBridge`, `useNavigationCommands`). Unico resto a vigilar: el respaldo
`options.lang || 'es'` de `src/services/localTts.ts:123` (TTS local con opciones). Convertir
los 52 defaults en una constante seria churn cosmetico sin cambiar una sola conducta (§6.1:
si el numero no baja, es cosmetico), asi que se declara y se deja medido aqui.

**`mergeSpeechText(..., keepAll)` — revaluado, se conserva.** Su razon de ser era no perder
texto al unir dos hipotesis largas; la causa que lo forzaba (la caja fabricando uniones) se
estrecho con D2/D3 y en las CINCO sesiones reales ya no aparece ninguna mezcla ni bloque
duplicado. Sigue teniendo dos llamadores vivos (`conversationStream.js:163,583`) y su contrato
es "no perder texto", no "mezclar": se queda. Si la mezcla reaparece, el sitio de la decision
es `colaNuevaTrasSolape`, no el merge.

## Puente con el plan complementario

La auditoría de Kilo (17 puntos, verificada por lectura el 2026-10-22) vive en
`docs/PLAN-autonomia-ia-config.md`. **Cinco de esos puntos caen en ESTA área** y no
estaban en las fases 0-6; se ejecutan **después de la Fase 3** (el defecto reproducido
manda) y su detalle está en el plan complementario:

| Punto | Qué | Evidencia | Fase allí |
|---|---|---|---|
| C1 | Defaults de participación divergentes (tests pueden medir otra política) | `src/lib/fluParticipant.ts:89-107` vs `src/voice/lib/fluConfig.js:1686-1709` | C |
| C2 | Dos regímenes de normalización (pasiva 24/2 vs conversación 48/4-14) | `src/voice/lib/turnTranscript.js:141-143`, `speechMerge.js:192-199` | C |
| C3 | `language = 'es'` re-declarado 113 veces (incluye voz) | `src/voice/lib/fluSpeech.js:326`, `deterministicArbiter.js:136` | C |
| C4 | `Hablante N` hardcodeado frente a plantilla configurable | `src/voice/lib/speakerCore.js:80,91` vs `fluConfig.js:88` | C |
| C5 | Esperas fijas con `waitForSpeechIdle` disponible y sondeo de 30 ms | `src/App.tsx:3693-3742`, `src/voice/lib/turnIdentityPipeline.js:184-195` | C |

**Regla:** el plan de voz no se amplía con esos puntos; se encadenan. Si uno de ellos
bloquea la Fase 1, se sube de orden y se declara aquí.

---

## Fuera de alcance (declarado)

- JSDoc huérfano e import con hueco (se absorben en Fase 1 por el trinquete).
- `mergeSpeechText(..., keepAll)`: REVALUADO y conservado (ver "Cierres de lo declarado");
  su contrato es "no perder texto", no mezclar.
- Ventana de eco medida con grabación real (H9) y `speakerDiarization` (H14): necesitan
  sesión real, no código.
- FLU Playback más allá de R3.
- Cualquier cambio que exija el `expected` real o la transcripción del dueño.

---

## Segunda ronda: cierre de las rutas dobles de IDENTIDAD y DEDUPE (2026-10-22, noche)

Ejecutado sobre la auditoria de Kilo. **Codigo muerto retirado** (sin consumidor en `src`; el
unico lector era su propio guard, AGENTS §1.8/§6.5):

| Retirado | Donde estaba | Por que |
|---|---|---|
| `preserveProperSpeaker` | `src/voice/lib/conversationTurnRow.ts` (199 lineas del archivo pasaron a 163) | Copia de la regla "una etiqueta automatica no degrada un nombre propio" que el DUENO real (`updateTurnRowSpeaker`, `conversationTurnRow.ts:571-667`) ya aplica con criterio MAS fuerte (consulta `resolveVoiceIdentity`). |
| `resolveRegisteredSpeakerName` | `src/voice/lib/speakerLabels.js` (183 -> 183 tras retirar jsdoc+funcion) | La regla "la etiqueta asciende al nombre registrado" esta RETIRADA por mandato (la fila escribe la etiqueta TAL CUAL): la funcion solo existia para su guard. Guard eliminado y sacado de `scripts/guard-files.mjs`. |
| `shouldSkipTurnLog` + `prepareLogCommit` | `src/voice/lib/conversationSession.js`, `src/voice/lib/turnTranscript.js` | Delegacion sin consumidor: la decision real la toma `isDuplicateLogPhrase` (fila visible) y la puerta del commit. |
| `phrasesRelate` | `src/voice/lib/activeListen.js` | Comparador prefijo sin consumidor (el vivo es `utterancesRelate`, `speechMerge.js:10`). |
| parametros `evidenciaAcustica` / `registered` de `resolveRowSpeakerName` (+ `registeredSpeaker` de `UserTurnRowInput`, `updateTurnRowSpeaker` y `App.tsx`) | `conversationTurnRow.ts:145`, `src/App.tsx:1368` | Ninguno cambiaba la salida: sugerian una decision que vive en `updateTurnRowSpeaker`. |

**DEDUPE: tres etapas, UN criterio de tiempo.** Las tres puertas de "esto ya se dijo" no se
fusionan (B.14: la dedupe de emision identica ya se intento y rompio turnos legitimos):

| Etapa | Dueno | Pregunta |
|---|---|---|
| ingreso del FINAL | `isRedundantFinal` (`activeListen.js:100`) | ¿este final ya esta cubierto por lo commiteado? |
| COMMIT del turno | `isDuplicateTurnCommit` (`turnStream.js:200`) | ¿este turno ya cerrado se re-entrega? |
| fila VISIBLE (log) | `isDuplicateLogPhrase` (`conversationSession.js:68`) | ¿esta linea ya se registro? |

Lo que SI era ruta doble y se ha cerrado: la ventana de "mismo evento". `isDuplicateLogPhrase`
comparaba sin ventana, asi que una pregunta MAS CORTA segundos despues de otra larga se
colapsaba como duplicada y la locucion se quedaba sin fila (misma clase de defecto que el
ingreso arreglo el 2026-10-18). Ahora recibe `msSinceLastEmit` y comparte el dueno unico de la
ventana (`committedEchoStreakWindowMs`, `activeListen.js:95`); el hook pasa el tiempo desde el
ultimo registro (`useFluVoiceAssistant.js:1575`, con `lastLogEmitAtRef`). Falsificacion en
`tests/conversationSession.test.ts` (dentro de la ventana -> duplicado; pasada la pausa -> habla
nueva).

**IDENTIDAD: dos preguntas, dos duenos (NO se fusionan).** Se midio antes de tocar:

- `resolveVoiceIdentity` (`speakerDirectory.js:141`) responde **"¿esta VOZ ya es alguien
  (nombre)?"** sobre el directorio de voces + candidatos de la base, con piso por fuente.
- `resolveConversationSpeaker` (`speakerDiarization.js:864`) responde **"¿que ETIQUETA recibe
  este turno?"** sobre los clusters de la sesion (frontera, sticky, cluster nuevo).

Son la misma ENTRADA (un vector) y salidas distintas (nombre vs etiqueta) sobre almacenes
distintos; fusionarlas exige unificar el almacen (directorio vs clusters), que es rediseno y
choca con los guardas vivos de esa decision (`tests/vozIdentidadDecisionUnicaGuard.test.ts`,
`tests/vozIdentidadDuenaUnicaGuard.test.ts`). Se declara aqui con las lineas: **una entrada, dos
preguntas, un dueno por pregunta**. Bajo AGENTS §6.2 no es ruta doble (no producen lo mismo).

**COMMIT: una sola escritura.** `commitAndResolveTurn` (`useFluVoiceAssistant.js:260`) es la
orquestacion del PAR display+contrato; la fila la escribe SIEMPRE `commitUserTurnRow`
(`conversationTurnRow.ts:713`) por las dos entradas (commit temprano y commit del stream), y
`tests/conversationTurnRowSingleWriter.test.ts` ejecuta la secuencia real y exige 1 fila. Lo
que si estaba duplicado (el canon anti-tartamudeo de la frase) quedo con un solo dueno en la
ronda anterior (`turnCommitPhrase.js` -> `canonSinTartamudeo`).

**`waitForCaptureSettle` — se conserva, medido como no-defecto.** `turnTranscript.js:223`: espera
acotada (`transcriptSettleStepMs` 40 / `StableMs` 120 / `MaxMs` 200, `fluConfig.js:285-287`), una
vez por cierre de turno, sobre la unica senal que existe hoy (el texto de captura es una
funcion de lectura, no un observable). Convertirla en evento exige instrumentar el ingreso con
un observable de captura (rediseno de la via caliente) para ahorrar <=200 ms en el cierre; el
commit tardio ya es idempotente (`captureDedup`), asi que no perder ni duplicar texto no
depende de esta espera. Se declara cerrado como decision, no como pendiente.

**Validado en esta ronda:** `npm run typecheck` (0 errores), `npm test` (399 archivos, 4811
pruebas), `npm run gate` (293 guards + `eslint --max-warnings=0` sin salida), `npm run build`
(2.56 s). Suite completa: no ejecutada (AGENTS §1.15).
