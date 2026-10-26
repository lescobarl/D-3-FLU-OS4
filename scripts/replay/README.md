# replay — runner determinista de hablantes (modo `vectors`)

Re-ejecuta el resolutor **real** de diarización sobre las firmas grabadas en
`turns.ndjson` y el estado previo reconstruido; el `speaker` del commit de la fuente es el
**esperado**, nunca una entrada. Con cobertura < 100 % el modo queda `partial` y NO valida.

Los modos `events` (filas y caja) y `playback` se retiraron con la tubería vieja de
conversación (corte 2026-10-25). El producto se mide con **`npm run playback`**
(`scripts/playback.mjs`, grabación real) y con los tests del módulo; este runner no los
sustituye.

```bash
# hablantes: compara las etiquetas observadas contra el `speaker` de la fuente
npm run replay -- --session <carpeta> --mode vectors [--report <archivo>]
```

| Flag | Qué hace |
|------|----------|
| `--session <carpeta>` | carpeta de la grabación (`manifest.json` + `turns.ndjson`). **Obligatorio**: el runner no adivina ninguna sesión. |
| `--mode vectors` | modo único soportado. |
| `--report <archivo>` | escribe el `report.json`. |
| `--stamp-manifest` | marca (una vez, a mano) un manifiesto antiguo con `schemaVersion` y fidelidad. |
| `--timeout <ms>` | tope de pared del replay (por defecto **120000**). Al vencer: exit 2. |

`--expected` y `--draft-expected` eran del modo `events`: se rechazan (exit 2) en vez de
ignorarse en silencio.

## Exit codes

| code | significado |
|------|-------------|
| `0` | todas las etiquetas coinciden **y** la cobertura es del 100 % |
| `1` | hay diferencias de hablante con cobertura completa |
| `2` | sesión inválida/incompleta, modo no soportado, **timeout**, o cobertura `partial` / `not-conclusive` (no valida) |

## Entrada (grabación)

- `manifest.json` **obligatorio**, con `schemaVersion` y, para validar, `appCommit`,
  `configHash`, `modelIds`, `language`, `sampleRate` (fidelidad).
- `meta.json` opcional.
- `turns.ndjson`: contexto, **nunca** el golden. Es la entrada del modo (exige al menos un
  `commit` con firma de voz).
- `events.ndjson` y `audio.*` no se usan: las firmas ya vienen grabadas en `turns.ndjson`.

Una sesión **incompleta** falla: si el manifiesto declara N turnos y el fichero no los
tiene, no se distingue «no pasó nada» de «se perdió el volcado». Un turno sin
vector/duración queda `not-conclusive`; jamás un OK falso.

## Qué valida y qué NO

**Valida**: que el resolutor real reproduzca el hablante de los turnos **con evidencia**,
o enseñe el mismatch con su razón. También mide si una misma locución aparece con dos
etiquetas en la fuente (`speakerFlips`).

**NO valida** (fuera de alcance): filas/caja del producto (eso es `npm run playback`),
audio, ASR/Whisper, VAD, el preflight asíncrono de identidad y la UI. El runner **no
arregla** el producto: si encuentra un defecto, lo reporta.

## Piezas (una de cada)

| Pieza | Fichero |
|-------|---------|
| loader | `scripts/replay/loadSession.mjs` |
| entorno determinista (reloj, timers, random, UUID) | `scripts/replay/deterministicEnv.mjs` |
| runner | `scripts/replay/vectorsRunner.mjs` |
| comparador | `scripts/replay/compareExpected.mjs` |
| reporte | `scripts/replay/report.mjs` |
| fixtures de hablantes | `tests/fixtures/replay/vectors/` |

`vite.replay.config.mts` existe porque el `vite.config.ts` de la app define
`process.arch`/`process.platform` para el bundle y `vite-node` no puede asignarlos en Node.
