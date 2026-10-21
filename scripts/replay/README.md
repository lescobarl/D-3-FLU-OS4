# replay — runner determinista de replay con expectativas

Fase `events` (filas y caja): reinyecta los eventos crudos de una grabación por el
consumidor/ingress **real** y compara el resultado con un `expected.json` aprobado.

Modo `vectors` (hablantes): re-ejecuta el resolutor **real** de diarización sobre las firmas
grabadas y el estado previo reconstruido de `turns.ndjson`; el `speaker` del commit es el
**esperado**, nunca una entrada.

```bash
# validar contra un expected APROBADO
npm run replay -- --session <carpeta> --mode events --expected <archivo> [--report <archivo>]

# observar sin golden (mide los invariantes de la caja y escribe el reporte)
npm run replay -- --session <carpeta> --mode events --report <archivo>

# generar un BORRADOR (approved:false) en un fichero NUEVO
npm run replay -- --session <carpeta> --mode events --draft-expected <archivo>

# hablantes: compara las etiquetas observadas contra el `speaker` de la fuente
npm run replay -- --session <carpeta> --mode vectors --report <archivo>
```

| Flag | Qué hace |
|------|----------|
| `--session <carpeta>` | carpeta de la grabación (`manifest.json` + los NDJSON del modo). **Obligatorio**: el runner no adivina ninguna sesión. |
| `--mode events` | filas y caja (exige `events.ndjson` no vacío). |
| `--mode vectors` | hablantes (exige `turns.ndjson` con al menos un `commit`). |
| `--expected <archivo>` | `expected.json` **aprobado**. Sin él, el runner **observa** (no valida golden). Solo `events`. |
| `--report <archivo>` | escribe el `report.json`. |
| `--draft-expected <archivo>` | genera un **borrador** (`approved:false`) en un fichero NUEVO; nunca sobrescribe. Solo `events`. |
| `--stamp-manifest` | marca (una vez, a mano) un manifiesto antiguo con `schemaVersion` y fidelidad. |
| `--timeout <ms>` | tope de pared del replay (por defecto **120000**). Al vencer: exit 2. |
| `--box-stall-ms <ms>` | tope de congelación de la caja (por defecto: `srGapCommitMs` de la config del producto). |
| `--dup-block-words <n>` | palabras del bloque repetido que cuenta como duplicación (por defecto **4**). |
| `--variant-words <n>` | prefijo mínimo (palabras) para emparejar dos textos como la MISMA locución con otra grafía (por defecto **2**). |
| `--locucion-similitud <0..1>` | similitud de grafía (Levenshtein normalizado) para justificar un **extra** como repetición de una locución que la fuente ya duplica (por defecto **0.7**). |
| `--no-infer-marks` | no infiere `sr-gap`/`recognition-end` de los timestamps. |

## Exit codes

| code | significado |
|------|-------------|
| `0` | coincide con el expected aprobado (u observación sin invariante roto); en `vectors`, **todas** las etiquetas coinciden **y** la cobertura es del 100 % |
| `1` | hay diferencias (filas, caja, un invariante roto o un mismatch de hablante con cobertura completa) |
| `2` | sesión inválida/incompleta, expected **no aprobado**, sesión **sin fidelidad** para validar, modo no soportado, **timeout**, o `vectors` **`partial`/`not-conclusive`** (no valida) |

## Entrada (grabación)

- `manifest.json` **obligatorio**, con `schemaVersion` (sin ella no se reinyecta nada) y,
  desde el sink actual, `appCommit`, `configHash`, `modelIds`, `language`, `sampleRate`.
- `meta.json` opcional.
- `events.ndjson` **obligatorio en `events`** y no vacío (`{seq,t,iso,category,event,data}`).
- `turns.ndjson`: contexto, **nunca** el golden. En `vectors` es la entrada (exige al menos
  un `commit`).
- `audio.*` no se usa en ningún modo (las firmas ya vienen grabadas en `turns.ndjson`).

Una sesión **incompleta** falla: si el manifiesto declara N eventos y el fichero no los
tiene, no se distingue «no pasó nada» de «se perdió el volcado». Un expected **aprobado**
exige además fidelidad completa: sin `appCommit`/`configHash`/`modelIds` la sesión no se
valida (solo se observa).

## Cierre de turno: marcas grabadas o inferidas

El sink **no graba** `onend` ni los `sr-gap` que el producto dispara por silencio. El runner
los **infiere de los timestamps** con la regla declarada (y lo cuenta en
`report.marks`):

1. `sr-gap` cuando entre dos eventos de voz pasa el `srGapCommitMs` de la config
   (`srGapSilenceReached`, dueño único del umbral);
2. **un** `recognition-end` al terminar la grabación (la sesión acabó).

Si la grabación SÍ trae marcas (`listen|sr-gap`, `listen|recognition-end`,
`listen|recognition-error`, `listen|rebuild`) se usan esas y no se infiere nada encima.
`--no-infer-marks` lo apaga: entonces el cierre queda como lo decida el pipeline.

## Traza de caja

`observed.boxTrace` guarda **cada** actualización de la caja:

```json
{ "t": 1792527711736, "text": "mientras vamos a preparar …", "reason": "publish" }
```

- `publish`: la caja escribió un texto (aunque sea **igual** al anterior: no se deduplica).
- `clear`: vaciado legítimo al cerrar el turno.

`observed.box` (valores sin consecutivos repetidos) y `observed.boxAtCommit` (caja en el
instante de cada commit) se mantienen por compatibilidad. La congelación se mide con
`observed.boxStall` (`medirCongelacionCaja`, criterio único y probado en
`tests/replayEvents.test.ts`): la ventana entre dos cambios **reales** de la caja cuenta si

1. hubo texto de ASR **distinto** al que la caja mostraba (la caja ignoró algo que sí se
   dijo) → motivo `texto-nuevo-ignorado`, o
2. hubo **≥ 2 eventos de voz** aunque el texto se repita (`minEventosActivos`): el ASR
   avanzó y la caja no se movió → motivo `asr-repetido-sin-cambio`.

El **silencio** (ningún evento de voz en la ventana) **no** es congelación.

## `expected.json`

```json
{
  "schemaVersion": 1,
  "scenario": "saludo",
  "mode": "events",
  "approved": true,
  "expect": {
    "rows": [{ "text": "hola que tal", "speaker": "Hablante 1" }],
    "rowCount": 2,
    "noPrefixDuplication": true,
    "boxDuplicated": 0,
    "box": ["hola que tal", "ahora otra cosa"]
  }
}
```

| Campo | Qué compara |
|-------|-------------|
| `rows` / `rowCount` | filas escritas (texto y hablante) |
| `box` | valor de la caja en el instante de cada commit |
| `noPrefixDuplication` | ninguna fila con corrida de palabras que crecen (`du dupli duplica`) |
| `boxDuplicated` | nº de commits cuya caja estaba duplicada (por defecto **0**) |

Checks de caja que **siempre** se calculan sobre la traza (no hace falta declararlos):
`noBoxPrefixDuplication`, `noBoxDuplicatedBlock`, `boxStall`, `boxLost` y `boxDuplicated`.
Una caja duplicada se reporta como **duplicación**, nunca como pérdida.

`speakers` **no se valida** en `events` (sin audio/vectores): si el expected los declara, el
reporte lo marca en `notCovered`.

## Filas FUENTE (`turns.ndjson`) — no son golden

`turns.ndjson` trae las instantáneas del producto (`kind: "base"`, `kind: "commit"`). Las
**filas fuente** son SOLO los `commit`, con `{ text, speaker }`. Se comparan contra las filas
que el replay observó con **un solo dueño del diff** (`sourceRowDiff`):

| Clase | Significado | ¿Falla? |
|-------|-------------|---------|
| `sourceDuplicates` | filas repetidas **en la fuente** (la sesión real ya duplica) | no |
| `missingUnique` | filas únicas de la fuente **sin contrapartida** en el replay | **sí** (pérdida real) |
| `textVariants` | el mismo tramo con otra grafía (prefijo común de `--variant-words`) | no |
| `extraAceptadas` | fila del replay sin contrapartida 1:1 que **repite una locución que la fuente ya duplica**, con la grafía del ASR (similitud ≥ `--locucion-similitud`) | no (se declara) |
| `extraUnique` | fila del replay **sin locución hermana** en la fuente | **sí** (extra real) |

La justificación de un extra exige **evidencia en la fuente**: la locución hermana tiene que
aparecer **más de una vez** en `turns.ndjson` (`vecesEnFuente > 1`). Si aparece una sola vez
—o no aparece— el extra es real y el check `sourceRows` falla. El reporte guarda, por cada
aceptada, `repiteDe`, `vecesEnFuente` y `similitud`, así que no se esconde en un “OK”.

La comparación normaliza (minúsculas, sin acentos, sin puntuación, espacios colapsados) pero
el reporte conserva el **texto original** de cada lado. Regla: `29 commits / 18 filas` con
`missingUnique: 0` **no es una pérdida** — la diferencia son duplicados de la fuente.

## Modo `vectors` (hablantes)

Lee `turns.ndjson` (`kind: "base"` y `kind: "commit"`) y, para **cada** commit, reconstruye
el estado **PREVIO** (la instantánea anterior, nunca la del propio commit):

| Dato | De dónde sale |
|------|---------------|
| `clusters` | commit anterior; para el primero, los `participants` del `base` (con `voiceVector` + `voiceAnchorVerified`) |
| `lastSpeaker` | `lastSpeaker` del commit anterior (`''` en el primero) |
| `lastSignature` | `signature` del commit anterior |
| `sessionPrimary` | `primary` del commit anterior; en el primero, el participante **activo** del `base` (nombre propio + ancla verificada). Con 0 o ≥2 candidatos NO se adivina: `''` y aviso `primary-ambiguo`/`primary-desconocido` |
| `preferSpeaker` | `lastSpeaker` previo |
| `speakerHighWater` | máximo índice ya visto en esos mismos clusters |
| `signatureVector` | `signature` del commit (la firma grabada del turno) |
| `voicedSampleCount` | `audioEndSample - audioStartSample` |
| umbrales y pisos | `micCapture` sobre `FLU_CONFIG` (no hay constantes locales) |

El `speaker` del commit **no se pasa como entrada**: es el **esperado**. Se compara con
nombres **canónicos** (`Luis`, `Hablante N`) contra lo que devuelve
`resolveConversationSpeaker`.

- turno **sin vector** o **sin duración** → `skipped` con su motivo (`sin-vector`,
  `sin-duracion`); no se inventa nada;
- **cobertura** = turnos evaluados / commits. Con cobertura < 100 % el modo se declara
  **`partial`** (exit 2): lo evaluado puede coincidir, pero NO es una validación completa de
  hablantes y no se vende como tal. El reporte guarda `coverage`, `partial`, `evaluated` y
  los omitidos por motivo;
- si **ningún** turno se puede evaluar → `status: "not-conclusive"` y **exit 2** (nunca un
  OK vacío);
- un mismatch trae `expected`, `observed` y `reason` (diagnóstico del resolutor).

**Límites declarados** (lo que el snapshot no guarda, y por eso se reporta en vez de taparse):

- `voicedSampleCount` es el **tramo del turno**, no las muestras con voz (cota superior);
- la etiqueta viva pudo salir del **preflight asíncrono** del worker sobre el audio; aquí se
  re-ejecuta el resolutor sobre la firma grabada, que es la evidencia reproducible;
- `speakerHighWater` se reconstruye de los clusters previos: no ve etiquetas renombradas o
  borradas antes de ese punto (el store sí las ve).

**Cobertura medida (d4c1c8f3)**: 15 de 29 commits evaluables (52 %) → `partial`, exit 2. Los
14 restantes **no se pueden evaluar** sin evidencia nueva: 9 commits no guardaron `signature`
y 5 tienen `audioEndSample === audioStartSample`. Mejorarlo exigiría recalcular la firma sobre
`audio.pcm` con el modelo (fuera del runner) o grabar la cuenta de muestras con voz — ambas
cosas son cambios de producto/grabación, no del runner.

## Artefactos

- `report.json` (`--report`): `sourceRows`/`observedRows`/`sourceDuplicates`/`missingUnique`/
  `extraUnique`/`textVariants` (con su `sourceDiff`), sesión + fidelidad, eventos aplicados, marcas (grabadas vs
  inferidas), checks con su detalle, clasificación (`perdidas`/`duplicadas`), `notCovered`,
  umbrales usados y la traza completa de la caja.
- Tabla en consola con el mismo contenido.

## Qué valida y qué NO

**Valida**: que una grabación de eventos produzca las filas esperadas y que la caja no
duplique, no se congele, no pierda el bloque que mostraba, y que el turno cierre por las
marcas. En `vectors`: reproduce el hablante de los turnos **con evidencia**, o enseña el
mismatch con su razón; con cobertura < 100 % el modo queda `partial` y NO valida.

**NO valida** (fuera de alcance): audio, ASR/Whisper, VAD, el preflight asíncrono de
identidad y la UI. El runner **no arregla** el producto: si encuentra un defecto, lo
reporta.

## Piezas (una de cada)

| Pieza | Fichero |
|-------|---------|
| loader | `scripts/replay/loadSession.mjs` |
| entorno determinista (reloj, timers, random, UUID) | `scripts/replay/deterministicEnv.mjs` |
| runner (`events`) | `scripts/replay/eventsRunner.mjs` |
| runner (`vectors`) | `scripts/replay/vectorsRunner.mjs` |
| comparador | `scripts/replay/compareExpected.mjs` |
| reporte | `scripts/replay/report.mjs` |
| fixtures de checks | `tests/fixtures/replay/checks/*.json` |
| fixtures de fuente | `tests/fixtures/replay/source/*.json` |
| fixtures de hablantes | `tests/fixtures/replay/vectors/` |

`vite.replay.config.mts` existe porque el `vite.config.ts` de la app define
`process.arch`/`process.platform` para el bundle y `vite-node` no puede asignarlos en Node.
