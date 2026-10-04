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
  codigo: es un CATALOGO de 28 puntos, y los pendientes de abajo NO estan en ese
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

ESTADO DE HOY (2026-10-02): 0 pendientes en el ledger.
  P8.24 CERRADO (commit 35f7974): el fallo del bloque e2e NO era un crash del renderer. Era un
        CLICK de Playwright sobre [data-testid="onboarding-skip"] que nunca terminaba porque
        autoSkipOnboarding (intervalo 150 ms) ya retiraba el boton; Playwright esperaba su
        accionabilidad hasta agotar el timeout del test y lo reportaba como "Target page...
        closed", en una prueba DISTINTA cada corrida (3 de 4 corridas en rojo antes). Fix: skip
        IN-PAGE en _helpers.ts (gotoClean), flu-settings-panel.spec.ts y video-config.spec.ts; y
        el test 6 de auditoria-acciones-llm.spec.ts deja de asertar records[length-1] (getAll
        ordena por uuid) y busca la nota por contenido. Medido: e2e:scoped 40 passed / 1 skipped 2x.

AUDITORIA DE CODIGO: CERRADA (0 hallazgos abiertos; P8.1-P8.23 arreglados con guard o medidos).
Ademas se arreglo P8.22 (la app NO compilaba: import duplicado) - antes de eso DEV, build y e2e
estaban rotos y por eso el e2e nunca corria.

NO VERIFICADO (limites declarados, no pendientes): DoD-producto (tu pantalla); suite completa
(`npm run test:full`, exige autorizacion); suite e2e COMPLETA (se corrio el bloque acotado).

CERRADO (P8.21, P8.9, P8.10, P8.22 + los anteriores P8.1-P8.20 salvo refutados):
  P8.21 vocabulario de ids a commandIds.js; P8.9 esqueleto de worker a workerPendingBridge.js
  (validado con un Worker falso que acciona los 3 clientes reales); P8.10 speechWords al dueno;
  P8.22 import duplicado de isAutoSpeakerLabel (la app compila).

CERRADO despues (2026-10-02):
  P8.10 speechWords divergente (audioMath lowercases / conversationStream no): la copia local
  de conversationStream.js pasa al dueno (audioMath.speechWords). Los 4 usos solo miraban el
  numero de palabras -> sin cambio de conducta. Metrica 1 -> 0. Guard speechWordsSingleOwnerGuard
  (2e5fdd9 + 33dc14f).

CERRADO en esa auditoria (P8.1-P8.20, con guard nacido ROJO y verificacion por conducta):
  minutas (clave/formato/comparador/secuencia/etiqueta a dueno unico), sendJson unico en
  los proxies (+ charset y writeHead a mano fuera), itemAt/currentPrompt unicos en los 10
  motores, vocabulario de tipos con dueno unico (NewNoteInput se ANCHO con body), V6/V17
  del catalogo con detectores reales, isWorkerRuntime con dueno unico, getAsrConfig / newId /
  setField con dueno unico, normalizacion de los parsers (agenda/fechas) a textUtils,
  useServiceRef en 10 hooks, y el id de arranque (INICIAR_CONVERSACION) leido de
  FLU_CONFIG.navigation.sessionResetCommand en sus 5 consumidores.
  P8.14 REFUTADO (falso positivo: sharedConfig usa readServerEnv). P8.12 triaje: 5 defectos
  reales de 14 homonimos. Gate de cierre VERDE: invariante base=9 actual=0.
  Los guards nuevos estan en lint:guards.

BARRERA (hueco medido y tapado, 2026-10-02): tests/taskLedgerGuard.test.ts llamaba a
validateLedger SIN subjects/files, y validateLedger hace `if (!subject) continue`: I5 (el
cierre justificado por su commit) se aprobaba por VACIO en el pre-commit, mientras
`npm run ledger:check` (que SI los pasa) lo evaluaba. El guard ahora pasa readGitEvidence(),
con prueba de detector de los dos lados. Los 17 cierres que tenian la evidencia en prosa
recibieron la ruta real que su commit toco (I5). `npm run ledger:check` -> OK.

AUDITOR DE CODIGO (persistido): `node scripts/auditoria-codigo.mjs` (+ `--self-test`) mide
las 6 senales con control negativo; barrera en tests/auditCodeSignalsGuard.test.ts. No es el
catalogo de 28 puntos: devuelve CANDIDATOS (archivo:linea); el veredicto exige leer el sitio.

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

---

## ESTADO 2026-10-03 (lo mas reciente: leer ESTO antes que lo de arriba)

Rama feature/auditoria-codigo-unificaciones-01. Briefing: `npm run brief`.

CERRADO hoy (todos con pre-commit verde):
  P8.32/R3  el bloque de parametros del contrato sale del god-file a src/voice/lib/contractParams.js
            (useFluVoiceAssistant.js 4577 -> 4539; techo del trinquete bajado a 4539 en commit aparte).
            Commits e13010c + 62554df + a0fa4e0. Guard: contractBoundaryGuard (10/10).
  P8.33     los 10 guards que solo vivian en el dod entran en lint:guards con prueba de detector REAL.
            lint:guards 164 ficheros / 1381 casos -> 174 / 1436. 3 controles negativos medidos.
            Commits 2c9aded + ea861be + 1cb42d9 + ea4060d.
  P8.34     triaje de homonimos cleanLabel/pickLabel: VEREDICTO = mismo nombre, regla distinta,
            0 rutas dobles, 0 cambios en src. Commit 2313050.

ABIERTO (3 pendientes en plans/ledger.json):
  P8.28  mecanismo no reproducido de la perdida del cuerpo. INSTRUMENTADO en la puerta del transcript
         (src/server/geminiProxy.ts, registra las claves del cuerpo cuando salta). No se cierra sin
         reaparicion: no se inventa la causa.
  P8.31  src/core/media/musicActions.ts sin spec en e2eScope. BLOQUEO MEDIDO: ningun spec e2e menciona
         musica (0) ni conduce la entrada de voz (0 SpeechRecognition) -> no hay mapeo que declarar y
         declararlo seria taparlo. PLAN: stub de SpeechRecognition en tests/e2e/_helpers.ts +
         tests/e2e/musica-en-partida.spec.ts + mapeo en e2eScope. Criterio: e2e:plan deja de nombrarlo
         Y el spec pasa en e2e:scoped. Commit b5fa77b.
  P8.35  tests/fluTrace.test.ts pasa 25/25 en AISLADO y falla dentro del lote del dod
         (linea 345: el caso asume exactamente 2 cuerpos y bajo carga hay >=3; recibio el relleno de
         ~800 eventos). NO es de esta sesion (ese test no importa el hook ni contractParams). PLAN:
         reproducir con el comando dod del contrato, quitar la dependencia del INDICE del cuerpo
         (mockClear entre fases / assertar cuerpos().at(-1)) sin debilitar el hallazgo, y cerrar con
         el lote + `npm run gate` EN VERDE. Commit 4b440a0.

BARRERAS corridas hoy:
  lint:guards + eslint + typecheck en cada commit: VERDE (174 ficheros / 1436 casos).
  npm run e2e:scoped (bloque -> auditoria-acciones-llm): 10/10 PASS en 4,3 min sobre la app real.
  npm run gate: ROJO, y el rojo es P8.35 (arriba), no la tarea. No se maquilla.

PENDIENTE DEL DUENO (DoD-producto): portal vivo en 5173 (PID 5040) -> agenda, notas y diario llegando
al prompt, y una frase corta repetida en dos contextos (antes devolvia la respuesta cacheada del otro).

REGLAS DE LA SESION: no correr la suite completa sin peticion expresa; validar con el fichero tocado +
lint + typecheck; el gate es de cierre y se corre UNA vez; ASCII en ficheros del repo (guard de mojibake).
