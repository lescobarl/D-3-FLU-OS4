# Relevo de sesion - FLU OS4

Artefacto de proceso, versionado a proposito: el resumen del chat se compacta y deja de
ser fuente; esto no. Se actualiza cuando cambie el estado.

Rama: feature/auditoria-codigo-unificaciones-01 (la tarea de saneamiento-01 cerro).
Estado en vivo (HEAD, arbol, pendientes): `npm run brief`. No se congelan hashes aqui a
proposito: un hash escrito a mano se queda viejo en el siguiente commit.

## Que pegar en la sesion nueva

Copia el bloque de abajo tal cual. Lo primero que hace la sesion nueva es el briefing, y
con eso ya sabe donde esta sin leer el repo entero.

```
Trabajo en FLU OS4. Repo: D:\D-Proyectos\D-3-FLU-OS4 (Windows, PowerShell).

PRIMER PASO OBLIGATORIO, antes de leer nada:  npm run brief
(si necesitas los ficheros cambiados: npm run brief -- --files)
Eso te da rama, HEAD, estado del arbol, base, limites del contrato y PENDIENTES.

REGLAS DURAS DE ESTA SESION:
- NO corras la suite completa (npm run test:full) salvo que yo lo pida en este turno.
  Valida con el fichero tocado:  npm run test:file <ruta>
- No repitas un comando que ya dio verde sin que el codigo haya cambiado.
- npm run gate SOLO al cierre y UNA vez.
- Cada arreglo se mide ANTES y DESPUES con el caso exacto, no con prosa.
- Escribe ASCII en ficheros del repo (hay guard de mojibake e higiene).
- PowerShell: para textos largos usa fichero (git commit -F), no comillas anidadas.

SI TE PIDO "UNA AUDITORIA", OJO CON ESTO (medido el 2026-10-02):
- `node scripts/auditoria.mjs` dice "28/28 hallazgos en META" y NO es una auditoria del
  codigo: es un CATALOGO de 28 puntos, y los 8 pendientes de abajo NO estan en ese
  catalogo. Una sesion que solo corra ese script concluira "esto esta limpio" y se
  equivocara. Ya paso: el 2026-10-02 el catalogo decia 28/28 mientras una auditoria
  propia (detectores en node + rg sobre todo src) encontraba duplicados de dato, un
  escritor de respuesta reimplementado, 10 copias de un accesor de juego y DOS
  DETECTORES DEL PROPIO CATALOGO que estaban verdes por apuntar a ficheros inexistentes.
- Metodo que SI vale: detectores propios (cuerpos duplicados por hash, mismos nombres
  definidos en >1 fichero, literales repetidos, URLs/claves/timers) + rg con archivo:linea
  + CONTROL NEGATIVO de cada detector (inyectar el defecto y ver que lo marca). Sin
  control negativo, un guard verde no prueba nada.
- La fuente de lo que falta es plans/ledger.json, NO el resumen del chat ni el catalogo.

ESTADO DE HOY (2026-10-02, cierre de la auditoria de codigo): 8 pendientes en el ledger.
  P8.8  el flujo de minutas NO tiene spec e2e (`npm run e2e:plan` esta ROJO a proposito,
        nombrando los 3 ficheros; no se declaro un mapeo falso)
  P8.9  esqueleto de ensureWorker copiado 3 veces (fbx / voiceId / whisper) con politica y
        timeout distintos: extraer un puente con la politica inyectada (no se puede medir
        sin la app delante)
  P8.10 speechWords DIVERGENTE: audioMath.js:432 pasa a minusculas, conversationStream.js:98 no
  P8.11 getAsrConfig duplicado: voiceActivitySegmenter.js:20 vs whisperAsr.worker.js:17
  P8.12 8 homonimos por verificar par a par (sourceLabel, cleanLabel, normalize, pickLabel,
        newId, toUI, resetTurn, downsample) - evidencia archivo:linea en el item
  P8.13 boilerplate serviceRef + TDZ replicado en 12 hooks de src/hooks
  P8.14 MODEL/IMAGE_MODEL con literal sin import.meta.env (sharedConfig.ts:120,125)
  P8.15 nota obsoleta V19 de auditoria.mjs (eslint.config.mjs existe)

CERRADO en esa auditoria (P8.1-P8.7, con guard nacido ROJO y verificacion por conducta):
  minutas (clave/formato/comparador/secuencia/etiqueta a dueno unico), sendJson unico en
  los proxies (+ charset y writeHead a mano fuera), itemAt/currentPrompt unicos en los 10
  motores, vocabulario de tipos con dueno unico (NewNoteInput se ANCHO con body), V6/V17
  del catalogo con detectores reales, isWorkerRuntime con dueno unico.
  Gate de cierre VERDE (23 commits). Los guards nuevos estan en lint:guards.

PENDIENTE DE PRODUCTO (sigue siendo tuyo, AGENTS.md A.1): jugar una loteria pidiendo
cartas seguidas (6 cartas distintas sin repetir y sin perder turnos), jugar un quien soy
fallando 5 veces a proposito (4 pistas distintas y luego revela y avanza), comprobar que
tras una generacion fallida el ultimo video/imagen por tipo sigue en el Pizarron, y que el
chip de ack "Te escucho" se ve ~2,2 s al arrancar la escucha.

Si te doy un defecto nuevo, dime antes: entrada cruda (lo que dije/escribi), salida
observada y salida esperada. Con eso directo al arreglo.
```

## Historial de cierres (para contexto, no es la fuente)

Saneamiento de cobertura (2026-10-02, rama saneamiento-01): 0 de 378 ficheros de src sin
pruebas de conducta (eran 36); el DoD cubre toda la suite de conducta; console.* dentro de
catch -> logCaughtError con guard endurecido; hardcode de politica de autonomia ->
autonomyPolicy.ts; literal 'invalid-input' -> resultReasons.ts; esqueletos de motores de
juego a gameUtils (isLastRound, isGameCommandSurface, finishRoundsIfLast).

Tickets cerrados antes: loteria (cartas seguidas), quien_soy (pistas), Pizarron (ultimo
objeto por tipo), planificador E2E (e2eScope) y rojo intermitente de la suite, juego (una
orden = una carta, eco de la orden de arranque), voz (eco de la cola del TTS), fila de
conversacion (una locucion = una fila), ack de escucha ("Te escucho").
