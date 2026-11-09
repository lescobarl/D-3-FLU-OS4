# Bloqueos — 2026-11-08

Bloqueos abiertos del encargo «bautizo de voz / rutas dobles». Con cualquiera de
estos abierto, el encargo no se cierra.

| # | Bloqueo | Estado | Dueño | Criterio de cierre | Evidencia |
|---|---|---|---|---|---|
| B1 | `tests/vozReplayDueno20261019Comando.test.tsx` está ROJO por el árbol previo, no por el bautizo: la caja pierde el mandato (`la caja perdio el mandato: ""`). Deja la suite completa / CI en rojo, así que **la rama no es mergeable**. | ABIERTO | cableado de la caja y la locución (`conversationMotorProducto` → `ingesta` / `texto`) | replay en verde **y** la aserción «un bautizo por locución» medida sobre la sesión real: `conversacion.voz.bautizada` + `conversacion.nombre.pendiente` == 1 | `npm run test:file tests/vozReplayDueno20261019Comando.test.tsx` → `3 failed`, igual con y sin el cambio del bautizo (aislado con `git stash` del hook) |
| B2 | El nombre de la SESIÓN se resuelve con el detector crudo (`detectWakeIntroducedName`); la preferencia por nombre conocido (`preferKnownName`) solo la usa la identidad persistente. Riesgo: la fila guarda «Luis Sigue Sin» mientras la base dice «Luis». | ABIERTO — deuda funcional, **no** de rutas dobles | directorio de voces (`speakerDirectory`) | el nombre de la fila se resuelve en el directorio, al mostrar; el disparador solo registra el dato | mandato 2026-10-13 citado en `tests/vozEcoIdentidadGuard.test.ts` |
