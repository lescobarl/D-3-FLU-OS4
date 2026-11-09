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
## Límites declarados (no son bloqueos)

- **El replay mide, no es barrera.** `vozReplayDueno20261019Comando` comprueba UN bautizo
  en la sesión real grabada, pero no detecta un segundo disparo: el comando de nombre se
  despacha diferido (`nameCommandDeferMs`) y no llega a la ventana del test. Contra un
  segundo disparador manda el caso `sites` del catálogo y `bautizoVozIdempotenteGuard`,
  los dos falsificados.

