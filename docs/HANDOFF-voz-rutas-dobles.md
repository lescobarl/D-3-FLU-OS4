# Handoff — voz / rutas dobles (sesión 2026-11-05)

## Estado del repo

- Rama: `feature/ratchet-src-completo`.
- HEAD: `29cd3f69 feat(guards): revisor de funciones antes de crear duplicados`.
- Commits previos relevantes: `89004099` (control de escucha unificado), `17751dde` (última fila por fin de audio).
- Los cambios de voz de abajo y este handoff van en el commit de este fix; sin push.

## Cambios de voz (en este commit)

Archivos:
- `src/voice/conversation/texto.ts`
- `src/voice/conversation/tipos.ts`
- `src/voice/conversation/cierre.ts`
- `src/voice/conversation/ingesta.ts`
- `src/voice/lib/speakerIdentityRegister.js`
- `scripts/conversacion-rutas-dobles-baseline.json`
- `scripts/rutas-dobles-baseline.json`
- `tests/conversacionApi.test.ts`
- `tests/conversacionEtiquetasYMezclaGuard.test.ts`
- `tests/rutasDoblesGuard.test.ts`
- `tests/vozEcoIdentidadGuard.test.ts`

Qué hacen:
1. **Pendiente viejo al stop**: `texto.ts:descartarPendienteCubierto` y `pendientesVigentes` descartan el pendiente con `tramo.fin <= ultimaFilaPorFin(...).tramo.fin`, con motivo **`obsoleto`**. No hay una segunda decisión de `turnoYaEscrito`.
2. **Prefijo en partición**: `ingesta.ts` marca `partidaDeVoz` solo si la anterior se recortó (`recortarAnterior !== null`); `LocucionAbierta`/`DatosApertura` lo transportan; `sinPrefijoDeLaFilaAnterior` lo consume. No se infiere por geometría.
3. **Eco del nombre**: `speakerIdentityRegister` distingue `origin: "passive"` (aplica ventana de eco) y `origin: "command"` (no); `registerSpeakerIdentityFromCommand` pasa `command`.
4. **Ruta `turnoYaEscrito` limpia**: solo `ingesta.ts:esReentregaDeLaFila`; caso `turno-ya-escrito` con techo 1. El pendiente cubierto tiene su caso `audio-cubierto` con dueño `texto.ts` y techo 1.
5. **Guard de rutas**: `tests/rutasDoblesGuard.test.ts` añade la comparación de la línea base contra `HEAD`/`origin`; una subida de `goal` o `allowed` falla (`solo baja`).

## Cambios AJENOS sin commitear (no tocar ni stagear)

- `.github/CODEOWNERS`
- `scripts/revisor-funciones.mjs`
- `scripts/revisor-git.mjs`
- `tests/revisorPuertasGuard.test.ts`

Son del commit/sesión del revisor de funciones; no los he tocado.

## Validación (corrida actual, HEAD `29cd3f69` + cambios sin commit)

```
conversacionApi                 46/46
conversacionEtiquetasYMezcla    21/21
vozEcoIdentidadGuard             5/5
rutasDoblesGuard                54/54
conversacionRutasDoblesGuard    21/21
conversacionDescartesMotivoGuard 21/21
guard:duplicados                 0/0
guard:duplicados25               143 declarados / 143 baseline
npm run gate                    2428 passed | 2 skipped → EXIT=0
```

La corrida incluye los cambios ajenos sin commitear del revisor. No ejecutar la suite completa (prohibida; solo CI).

## Pendientes de producto (no tocados)

1. **Nombre «soy XX»**: eco corregido; falta validar vector/ancla y UI real.
2. **`cerrando` truncado**: con la regla exacta unificada, una cola truncada de una orden de control puede crear fila; falta decisión (¿prefijo?) y revisar `allowWithoutWake`.
3. **Pérdida de cola** (final 540 → fila 495).
4. **Mezcla de frases** (fila 5 y fila 8 del log).
5. **Etiquetas/diarización**: solo 2 medidas cerradas, `sinVector`, mismo hablante alterna Hablante 1/2, anclas 0.
6. **Congelamientos ASR**: huecos de 25.3 s y 29.0 s sin `chrome-raw`.
7. **Latencia general del ASR**.

## Validación pendiente

- Playback del audio `14c1aa32`, pantalla, sesión real, E2E.
- El log de la sesión: `debug.log` (15:34:40–15:47:14) en la raíz; grabación en
  `%TEMP%\flu-recordings\14c1aa32-5b49-49ba-b119-d4755c9e8d7f\` (`events.ndjson`, `turns.ndjson`).

## Reglas que NO se deben deshacer

- La última fila la decide `fila.ts:ultimaFilaPorFin`; no reintroducir `sort` inline.
- El control de escucha lo decide `audioMath.detectListeningControl`; el adaptador delega; no recopiar el matching.
- `turnoYaEscrito` es solo la reentrega de texto de `ingesta`; el pendiente cubierto usa `obsoleto` (dueño `texto`). No subir techos; añadir caso nuevo con dueño.
- `partidaDeVoz` es un hecho de `partirLocucionPorCambioDeVoz` (`recortarAnterior`); no inferir por geometría.
- `registerSpeakerIdentity` es el dueño del nombre; `origin` es procedencia, no una bandera de producto.
- `guard:duplicados` debe quedar en 0/0; `rutasDoblesGuard` y `conversacionRutasDoblesGuard` en lint.

## Protocolo del usuario

- Un dueño por pregunta; kill list en el mismo cambio; baseline solo baja; dos mutaciones; test rojo por la ruta real; no parches, no hardcode, no rutas dobles.
- No commit/push sin pedido explícito; no tocar guards/tests ajenos; no suite completa.
