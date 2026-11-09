# Bloqueos — 2026-11-08

Bloqueos abiertos del encargo «bautizo de voz / rutas dobles». Con cualquiera de
estos abierto, el encargo no se cierra.

| # | Bloqueo | Estado | Dueño | Criterio de cierre | Evidencia |
|---|---|---|---|---|---|
| B2 | El nombre de la SESIÓN se resuelve con el detector crudo (`detectWakeIntroducedName`); la preferencia por nombre conocido (`preferKnownName`) solo la usa la identidad persistente. Riesgo: la fila guarda «Luis Sigue Sin» mientras la base dice «Luis». | ABIERTO — deuda funcional, **no** de rutas dobles | directorio de voces (`speakerDirectory`) | el nombre de la fila se resuelve en el directorio, al mostrar; el disparador solo registra el dato | mandato 2026-10-13 citado en `tests/vozEcoIdentidadGuard.test.ts` |

## Límites declarados (no son bloqueos)

- **El replay mide, no es barrera.** `vozReplayDueno20261019Comando` comprueba UN bautizo
  en la sesión real grabada, pero no detecta un segundo disparo: el comando de nombre se
  despacha diferido (`nameCommandDeferMs`) y no llega a la ventana del test. Contra un
  segundo disparador manda el caso `sites` del catálogo y `bautizoVozIdempotenteGuard`,
  los dos falsificados.

