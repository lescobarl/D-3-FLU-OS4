# Bloqueos — 2026-11-08

Bloqueos abiertos del encargo «bautizo de voz / rutas dobles». Con cualquiera de
estos abierto, el encargo no se cierra.

**Ninguno abierto.** B2 se cerró: el nombre de una VOZ se resuelve en su dueño único
(`src/voice/lib/speakerDirectory.js` `knownVoiceNames` + `preferKnownVoiceName`) y el
disparador del bautizo (`src/voice/compose/conversationMotorProducto.js:178`) entrega
ESE nombre al módulo, nunca la captura cruda del ASR («Luis Sigue Sin» → «Luis»).
La etiqueta de la fila sigue siendo la que resuelve el módulo al cerrar (decisión
2026-10-17/30, no se re-resuelve al mostrar) y ahora es siempre el nombre del
directorio. Muros: caso `nombre-dicho-preferencia-conocida` del catálogo de rutas
dobles y `tests/bautizoVozIdempotenteGuard.test.ts` (con falsificación).

## Límites declarados (no son bloqueos)

- **El detector ve el símbolo, no la intención (L2).** El caso
  `nombre-dicho-preferencia-conocida` mide la declaración de la regla
  (`function preferKnownVoiceName`). Un alias con otro nombre o una copia de la regla
  bajo otro identificador no se detectan: se revisan en el diff.
- **L4 cerrado con número, no bajando el umbral.** Medido 2026-11-08:
  `guard:literales` congela 403 literales (minChars=18) en 485 archivos; con minChars=12
  sube a 761 y 145 de los nuevos son identificadores legítimos repetidos en ≥3 archivos
  (MIME, eventos, i18n, animaciones). Bajar el umbral añade ruido, no barrera, y la
  convención «ids ≥18» no compraba nada porque el detector solo escanea `src`. Lo que sí
  era un agujero real —**un id de caso repetido**— queda con barrera medida en 0:
  `idsRepetidos` (`scripts/rutas-dobles.mjs`) + caso en `tests/rutasDoblesGuard.test.ts`,
  falsificado inyectando el duplicado en el catálogo.
- **C7/C9/C10 cerrados como NO defecto (medido 2026-11-08).**
  - C9: la ventana de identidad es `minSegundosVozMedida` (1,5 s) **a propósito** —
    `ingesta.ts` `lanzarMedidaSiCorresponde`: en la sesión 8149df78, 12 de 124 mediciones
    copiaban hasta 709.824 muestras para sacar un vector de 512. No es un recorte olvidado.
  - C7 (`vozInsuficiente`, 330 ms < 350 ms): es el PRIMER intento de una locución sobre una
    ventana con poca voz; la medida se reintenta cuando el búfer crece `minSegundosVozMedida`
    (freno `muestrasEnUltimoIntento`). En la sesión, tras el fallo de 02:25:57 las medidas de
    02:26:24/25 salieron `ok` con vector 512: el sistema se recupera solo.
  - C10 (`asrFinal` con `ms/speechLikeMs/rms: null`): esos campos solo se rellenan cuando el
    evento trae métricas del motor; Chrome no las entrega. No se inventan.

## Medida del defecto «se alarga / se pierde lo dicho» (ANTES, 2026-11-08)

Medida con el dueño único del medidor (`scripts/conversacionGrabacionMetricas.mjs`,
`leerGrabacion` + `medirGrabacion`) sobre la sesión real preservada en
`%TEMP%\flu-preservado\sesion-2026-11-08-0225\`:

| Métrica | Valor |
|---|---|
| `tailLossChars` | 508 — **ARTEFACTO de emparejado**, ver abajo |
| `rowsNotEqualAnyFinal` | 7 de 9 filas — mismo artefacto |
| pérdidas por turno | 474→210 · 160→17 · 128→38 · 138→127 |
| `maxGapMs` | **17.573 ms** de ASR mudo |
| `chromeRawGapsOverStall` | **5** huecos por encima del umbral de stall |
| `speakerFlips` | 3 |
| `sinVector` | 1 |
| `commitsAfterStop` / `duplicateTurnIds` | 0 / 0 |

**CORRECCIÓN (misma sesión, 2026-11-08):** el medidor empareja fila↔final por `turnId`, y el
módulo **reutiliza el mismo `turnId` en varias locuciones** (`turns.ndjson`: la fila de 210
lleva el turno `33208f00`, el mismo que el final de 474 que en realidad pertenece a la
locución `e6ac5bae`). Emparejando por LOCUCIÓN las pérdidas reales son 474→443 (−31),
160→153 (−7), 138→127 (−11): **el habla NO se pierde al 50 %**. La deuda real está en el
MEDIDOR (`scripts/conversacionGrabacionMetricas.mjs:99 medirGrabacion`): debe emparejar por
`locutionId`, no por `turnId`, o sus cifras mienten. Los números de arriba que NO dependen
del emparejado (`maxGapMs`, `chromeRawGapsOverStall`, `speakerFlips`, `sinVector`) siguen
siendo válidos.

Estos son los números que tiene que BAJAR la próxima sesión. Se recalculan con:

```
node --input-type=module -e "import {leerGrabacion,medirGrabacion} from './scripts/conversacionGrabacionMetricas.mjs'; const g=leerGrabacion('<carpeta-de-la-sesion>'); console.log(JSON.stringify(medirGrabacion(g),null,1))"
```

C4 (srGap con consumidor) y C5 (sin solape) atacan `maxGapMs`, `speakerFlips` y la pérdida
por turno: una locución que se corta a tiempo se escribe con SU texto, en vez de acumular
y quedarse con la última reentrega.
## Límites declarados (no son bloqueos)

- **El replay mide, no es barrera.** `vozReplayDueno20261019Comando` comprueba UN bautizo
  en la sesión real grabada, pero no detecta un segundo disparo: el comando de nombre se
  despacha diferido (`nameCommandDeferMs`) y no llega a la ventana del test. Contra un
  segundo disparador manda el caso `sites` del catálogo y `bautizoVozIdempotenteGuard`,
  los dos falsificados.

