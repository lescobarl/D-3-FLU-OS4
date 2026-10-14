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

---

## AMPLIACION 2026-10-03 (tarde): escenario aula/casa y arreglos del dia

ESCENARIO DECLARADO POR EL DUENO: salon de clases con muchos ninos, casa con familia y TV. El ruido de fondo
es el escenario NORMAL, no un caso raro.

CERRADO hoy (ademas de P8.32/P8.33/P8.34 de la manana):
  P8.28  el saludo/retrato en vez de respuesta. Causa: el historial empezaba por los turnos de FLU del
         onboarding y el modelo lite se presentaba. Fix en buildConversationMessages (la conversacion abre
         por el usuario). Commit f7b552a. Verificado con SIMULACION DE ESCRITORIO antes/despues.
  P8.37  la wake word se exige SIEMPRE (config voiceCommands.requireWakeAlways). Commit 67d8ad9.
         Verificado con simulacion: 3 frases de ambiente sin wake -> 1 solo contrato (el legitimo).

ABIERTO:
  P8.38  el ruido sigue abriendo FILA por el camino de stream/preview (3 de 3). Siguiente paso: instrumentar
         el escritor del stream y cortar ahi.
  P8.36  el turno del usuario se duplica en conversacion activa (1 turno -> 2 filas). Medido; falta capturar
         una frase con la escritura de la fila instrumentada para elegir el arreglo (turnId/replaceLastRawLog).
  P8.35  tests/fluTrace.test.ts pasa aislado y falla en el lote del dod -> `npm run gate` en ROJO por ahi.
  P8.31  src/core/media/musicActions.ts sin spec en e2eScope.

BANCO DE SIMULACION (fuera del repo, en %TEMP%\flu-repro): sim-desktop.cjs, sim-ingress3.cjs (reconoce el
reparto de filas), sim-aula.cjs (ESCENARIO aula/casa: conversacion activa + frases de ambiente).
Sonda del proxy: FLU_CONTRACT_TRACE=1 (apagada por defecto) escribe el cuerpo REAL de cada turno en el log.

---

## CIERRE 2026-10-04 (P8.38 cerrado; P8.36 con medicion nueva)

Rama feature/auditoria-codigo-unificaciones-01. Briefing: `npm run brief`.

CERRADO: P8.38 (commit ea76fa0) - con la wake exigida siempre, el ruido de fondo ya NO abre fila de
conversacion. Medido con la traza de los DOS escritores del store (banco
%TEMP%\flu-repro\sim-aula-trace.cjs): la fila la escribia el COMMIT del stream
(handleConversationStreamSync -> emitConversationLog -> commitUserTurnRow), no el preview ni el camino de
rechazo. Fix: emitTurnRow (unica puerta de emision) se cierra cuando requireWakeAlways y la captura no lleva
wake, con el veredicto del MISMO analisis del turno (resolveInlineWakeAtCommit.wakeWordMatched). Banco: filas
del AMBIENTE 3 de 3 -> 0 de 3; filas totales 6 -> 2. Guard tests/wakeRowNoiseGuard.test.ts (lint:guards + dod),
RED medido contra el src de base y VERDE ahora. Gate VERDE. Contrato SIN `invariant` (declarado: la propiedad
es un 0 de conducta, no hay N->1 en src que medir; AGENTS 7.7.e(3)) con base 4f30771.

MEDICION NUEVA sobre P8.36 (duplicacion del turno del usuario): en el banco, la frase legitima llegaba DOS
veces (hablante vacio + "Hablante 1") por el camino de emision del stream; con el fix de P8.38 la duplicacion
DESAPARECIO del banco (6 -> 2 filas). Falta decidir si el defecto que reporto el dueno por voz (19:06-19:26)
es este mismo o tiene otro disparador: el metodo es la instrumentacion puntual de los dos escritores
(addConversationEntry / batchLoadHistory) ya escrita en el banco.

ABIERTO (3): P8.31 (musicActions sin spec en e2eScope), P8.35 (fluTrace pasa aislado y falla en el lote del
dod), P8.36 (ver arriba).

PENDIENTE DEL DUENO (DoD-producto): repetir el escenario aula/casa en su pantalla (la fila de ruido ya no
deberia aparecer) y, si quiere, decidir si el dictado/minuta (fila de sesion) tambien debe filtrar el ruido.

REGLAS DE LA SESION: no correr la suite completa sin peticion expresa; validar con el fichero tocado + lint +
typecheck; el gate es de cierre y se corre UNA vez; ASCII en ficheros del repo.


---

## CIERRE 2026-10-04 (P8.36 cerrado: el ruido movia el id del turno y duplicaba la fila)

CERRADO: P8.36 (commit 11aea07). CAUSA MEDIDA: el turno del usuario se escribe dos veces (commit temprano +
resolucion) y ambos leen la identidad del turno del ESTADO GLOBAL (activeTurnIdRef.current,
useFluVoiceAssistant.js:406 y :410). El ingress incrementaba ese id con CUALQUIER evento ASR (ensureTurnId),
ruido de fondo incluido, asi que la resolucion escribia con OTRO id y el escritor unico (commitUserTurnRow,
reutiliza solo si currentTurn.id === turnId) AGREGABA una segunda fila. REPRODUCIDO y medido:
%TEMP%\flu-repro\sim-dup-turnid.cjs (frase con wake + un interim de ruido -> 2 filas; sin ruido -> 1). FIX:
predicado unico isTurnCapture (wakeTurnCommit.js) y el ingress solo acuna id para un turno de verdad: el ruido
no abre fila (P8.38) NI mueve el id. Banco: 2 -> 1 fila; aula/casa sigue 0 de 3. Guard
tests/wakeRowNoiseGuard.test.ts con los casos del mecanismo (8 casos), RED medido contra el src de 358b812.
Gate VERDE; barrera 176 ficheros / 1448 casos. HUECOS DECLARADOS: dos turnos REALES solapados, y el modo
requireWakeAlways=false (el ruido no es distinguible).

ABIERTO (2): P8.31 (musicActions sin spec en e2eScope), P8.35 (fluTrace pasa aislado y falla en el lote del dod).

PENDIENTE DEL DUENO (DoD-producto): repetir la loteria (una locucion -> una fila) y el escenario aula/casa en su
pantalla. Si vuelve a duplicar, el banco sim-dup-turnid.cjs y la traza de los dos escritores del store son el
instrumento para capturarlo.


---

## 2026-10-03 (noche) - El duplicado que sigue: P8.39 (reentrega vs repeticion) y P8.40 (diarizacion)

El dueno reporta que SIGUE duplicando (21:01:40/21:01:41) y que la diarizacion lo etiqueta "Hablante 1"
sabiendo quien es. MEDIDO en 30 s sin esperar a que FLU hable (banco %TEMP%\flu-repro\sim-acento.cjs): dos
finales que solo difieren en un acento -> 2 filas. El fix obvio (reutilizar la fila abierta si la emision es la
misma, spokenUtteranceRevision) SE PROBO Y SE REVIRTIO: rompe `tests/turnRowNoDuplicate.test.ts` DEFECTO 3 (dos
ordenes reales sin respuesta en medio = 2 filas, requisito medido porque antes se perdia la segunda). Es la
MISMA entrada con salidas opuestas: el escritor de la fila no puede distinguir reentrega del ASR de repeticion
real con texto+tiempo. Cierre = llevar al write la identidad del EVENTO ASR (revision del mismo resultado o
segmento de audio; isNewAudioSegment/turnAudioStartSampleRef ya existen) + UNA captura real con la traza de
eventos (__fluDev.enableListenTrace / getListenLog).

Diarizacion (P8.40): el preflight de AUDIO gana el nombre (turnSpeakerCommit.js:112/:146, source
"preflight-audio") y su label es automatico ("Hablante N"); el nombre del participante solo gana por wake-intro
o frase corta, y el fallback es pegajoso (lastLogged || sessionPrimary). Opciones declaradas en el ledger;
necesita la aprobacion del dueno (en aula, etiquetar con su nombre sin exigir cluster unico pondria su nombre a
los ninos).

ABIERTO (4): P8.31, P8.35, P8.39, P8.40.


---

## CERRADO 2026-10-03 (noche) - P8.39: una peticion, una fila (reentrega identica del ASR)

CERRADO P8.39 (commit 3d7543e). INSTRUMENTO FIEL (nuevo y clave): %TEMP%\flu-repro\sim-mic-real.cjs sustituye
SpeechRecognition por un micro falso ANTES de cargar la app, asi el pipeline REAL (onresult/onend/dispatch) corre
igual que con Chrome, sin tocar src. Con el se reprodujo el defecto del dueno (2 filas / 1 respuesta) y se midio
la causa: el dedup por captura identica de processCapture se desactivaba ENTERO con un turno en curso, y el
commit temprano escribia la fila por turnId en vez de por PETICION. FIX: src/voice/lib/captureDedup.js (criterio
unico) + audioMath.sameRequestWindowMs() (la ventana es un solo valor, la comparten despacho y fila) + el hook
preguntando al criterio. DESPUES: filas y ejecuciones cuadran (1/1, 1/1, 2/2 fuera de la ventana). Barrera 177
ficheros / 1457 casos; gate VERDE; DoD con los 60 tests que importan el src tocado.
REGLAS DE LA CASA (aprendidas hoy): (1) el simulador viejo (__fluDev.simulateRecognition) entra por el ingress y
NO toca processCapture, por eso ocultaba este defecto: para voz, usar el micro falso; (2) el hook esta en su
techo de tamano (4538/4539): el criterio nuevo vive en modulo, no en el god-file.

ABIERTO: P8.31 (musicActions sin spec e2e), P8.35 (fluTrace en el lote del dod), P8.40 (diarizacion: solucion
medida y declarada, pendiente de aprobar el comportamiento), P8.41 (mover el arnes de voz al repo como fixture
e2e: 0 de 11 specs conducen la entrada de voz hoy).


---

## 2026-10-03 (noche) - P8.40 implementado (falta pantalla), P8.35 cerrado

P8.40 (commit b296ab3): la etiqueta de diarizacion REGISTRADA estampa el nombre. Criterio unico
resolveRegisteredSpeakerName (solo etiquetas automaticas que coinciden con la registrada; un nombre propio
nunca se pisa; etiquetas de otros hablantes -aula- quedan igual) aplicado en conversationStreamCommit y en la
PUERTA UNICA de la fila de App (memo con la etiqueta del participante activo). Guard
tests/registeredSpeakerNameGuard.test.ts. FALTA MEDIR la cadena App->fila: en headless la lista de
participantes no se carga en el arranque automatizado (la fila seguia diciendo "Hablante 1" con el dato en la
base) -> se cierra en su pantalla o con un test de App con Dexie sembrada.
P8.35 (commit 273f292): la asercion del hallazgo de fluTrace se mide en el ULTIMO envio, no por indice fijo
(bajo carga el indice apuntaba al relleno). 25/25 aislado + lote pesado 6 ficheros/208 casos VERDE.

ABIERTO: P8.31 (spec de musica; depende del arnes), P8.40 (medicion en pantalla), P8.41 (mover el micro falso
a tests/e2e como fixture: 0 de 11 specs conducen la voz - es la barrera que habria cazado P8.39).
TECHO DE TAMANO: hook 4539/4539 y App 4643/4643: cualquier linea nueva obliga a compensar.


---

## CERRADO 2026-10-03 (noche) - P8.42: un id por locucion (1 peticion = 1 fila = 1 ejecucion)

CERRADO P8.42 (commit 6576b00). Reproducido con el instrumento fiel: reentrega de la MISMA locucion con el turno
VIVO -> 2 filas / 1 contrato (el log del dueno). FIX: el id del turno se acuna por LOCUCION (una entrega con el
turno vivo y la misma emision = mismo id) y la FILA obedece el veredicto del despacho (dispatch|dedup|skip).
MEDIDO: 1 fila / 1 contrato en los tres escenarios; loteria 2 cartas / 2 peticiones (sin regresion). Guard de 3
casos en conversationStreamCommit.test.ts.

CLAVES PARA LA SIGUIENTE SESION:
  - Probar con el MICRO FALSO (%TEMP%\flu-repro\sim-mic-real.cjs), NO con __fluDev.simulateRecognition: ese
    entra por el ingress y no toca processCapture (por eso oculto este defecto dos sesiones).
  - La decisión del turno tiene ya un dueno: id por locucion + veredicto del despacho que la fila obedece.
  - Techos: hook 4536/4539, App 4643/4643 (compensar lineas).

ABIERTO: P8.31 (spec de musica, depende del arnes), P8.40 (diarizacion implementada: falta la medida en
pantalla), P8.41 (mover el micro falso al repo como fixture e2e: 0 de 11 specs conducen la voz).


## ESTADO 2026-10-10 (lo vigente; lo de arriba con fecha 2026-10-02 esta OBSOLETO)

- Ledger: **0 pendientes**. Cerrados los 8 defectos reportados por el dueno:
  P9.50 (flake P6 + D2), P9.51 (repeticion ASR en cualquier posicion), P9.52 (ultima frase
  en negro + panel sin "user"), P9.53 (saludo de cierre con UN solo dueno), P9.54 (los
  numeros son DATO, no eco), P9.55 (srGap: el EVAL aceptaba solo silencio), P9.56/P9.57
  (un dueno de la etiqueta de hablante y de la DECISION de identidad) y **P9.59** (la
  locucion del CIERRE ya no se pierde: el commit sin fila del segmento marcaba la locucion
  como "ya emitida" y el cierre caia como duplicado). Commits: c0a1c0e (src+guard) y
  8ef424c (ledger+report).
- Comando de arranque: `npm run brief`. Validacion por cambio: `npm run test:file <ruta>`
  + `npm run lint` + `npm run typecheck`; cierre: `npm run gate` (UNA vez) y
  `npm run e2e:scoped` (spec del bloque, segun `.task/contract.json -> e2eScope`).
- PENDIENTE DEL USUARIO (DoD-producto, no del agente): validar en pantalla (localhost:5173,
  F5 porque cambian workers/identidad) los 8 casos y el dictado largo 1..40.
- NO CUBIERTO por el agente: la suite completa (`npm run test:full`, solo con autorizacion
  expresa del usuario en ESE turno).

## 2026-10-10 (despues de P9.59) — dos hitos mas, ambos cerrados

- **P9.60** (47a93e7 src, 232e121 guard, 8bd1283 ledger): la locucion CONFIRMADA sin fila
  ya NO se descarta en el rebuild del watchdog; se cierra por la misma puerta que onend.
  Dueno unico de la decision: `activeListen.hasConfirmedOpenLine`.
- **P9.61** (778d922 test, 44eaa21 ledger): prueba de TUBERIA COMPLETA (monta el hook real
  y dispara el watchdog con fake timers). Reproduce el defecto en la capa del watchdog
  (`filas=[]` en la version previa) y lo fija. El contrato lo mecaniza:
  `invariant.base=43a7a96` -> el gate comprueba `guard base=1 actual=0`.
- Estado: **0 pendientes** (346 cierres). Portal de validacion: http://localhost:5173.

---

## ESTADO 2026-10-10 (sesion del dueno 15:02-15:14) - que se cerro y que falta

### Cerrado
- **P9.63** (31b904d src+tests, `chore(ledger)`): el srGap vuelca **solo con silencio**. Se
  retiro la rama "turno viejo" de P9.55 que vaciaba la conversacion a mitad del dictado.
  Guard `vozLocucionVivaLargaGuard` (replay del log). Metrica staleTurn/staleMs 4 -> 0.
- **P9.66** (9220780 src, `test(voz)`, `chore(ledger)`): "soy `<nombre>`" **si** renombra la
  MISMA voz. El umbral de "misma voz" era un literal 0.78 POR ENCIMA de la banda medida
  (0.69-0.74) -> unificacion insatisfacible. Dueno unico nuevo: `sameVoiceFloor()`
  (config `productionClusterReuseThreshold`). Guard `vozRenombreVozCompartidaGuard`. Metrica 2 -> 0.

### Pendiente (necesita MEDICION del dueno, no se toca a ciegas)
- **P9.64** (inflado de hablantes): modelo FAITHFUL offline = con la banda medida (0.70-0.72)
  **no** infla (1 cluster en 20-30 turnos); el inflado solo aparece si la MISMA voz cae a
  <=0.62 (a 0.04 del 0.58 de voz distinta). Hace falta el `Identity ... lastSim=...` REAL de
  una sesion fresca (el log del dueno se limpio).
- **P9.65** (filas sin hablante): el relleno tardio (`applyResolvedSpeaker`) descarta la
  resolucion de un turno viejo (guard monotono), justo los que el srGap de P9.63 cerraba.
  Faltan medir las filas sin hablante DESPUES de P9.63+P9.66.
- **P9.62** (healthMonitor "Text API timeout"): sonda sin reintento; decision de diseno.

### Desbloqueo (una locucion basta)
El relayLog ya escribe `Identity label=... lastSim=...` (voiceIdentityResolve.js): basta hablar
en http://localhost:5173 y leer `debug.log` con `npm run voz:log` para fijar el valor seguro
de P9.64 y contar las filas sin hablante de P9.65.

## 2026-10-10 (despues de la sesion de P9.64/P9.65) - A1 CERRADO

- **A1** (ccfb835 src+contrato; 8370fd5 guard+lint:guards+ledger): el REGISTRO del nombre
  propio tiene UN dueno (`src/voice/lib/speakerIdentityRegister.js`: `registerSpeakerIdentity`
  + `registerSpeakerIdentityFromCommand`) y el comando `REGISTRAR_PARTICIPANTE` desemboca en la
  misma ruta que la del commit (`wake-intro`); antes habia 2 implementaciones y el comando no
  tenia consumidor (decia "Registrado {name}." sin registrar nada).
  Metrica (puerta): modulos que implementan el registro 2 -> 1. Guard
  `tests/vozRegistroNombreUnicoGuard.test.ts` (lint:guards), rojo medido por mutacion.
  Gate VERDE: metrica base=2 actual=1 target=1 - guard base=1 actual=0.
- SIGUIENTE: el texto del plan A2..B5 NO esta en el repo (el usuario lo dio en el chat); A1 se
  reconstruyo del encargo + la medicion. A2+ necesita la lista o seguir midiendo duplicaciones
  del mismo dominio (registro/identidad de hablante) una por turno.
- NO CUBIERTO por el agente: DoD-producto (pantalla: "okay flu soy Luz" en localhost:5173),
  suite completa y E2E completa (spec del bloque: tests/e2e/voz-escenario-dueno.spec.ts).

## 2026-10-10 (2) - A1 CERRADO DEL TODO (huecos 1 y 2)

- **A1 huecos** (fbb5647 guard+detector; c0b27bc src+contrato; ledger/report): el registro
  del nombre aplica el MISMO efecto por las dos rutas: los clusters vivos (cose "Hablante 3"/"4")
  y el primario con fuente "presented" (manda sobre el sembrado del participante).
  Puente nuevo `src/app/useIdentitySessionRef.ts` (sin estado propio: puntero a los refs del
  hook, que los publica) para que la ruta del comando use la MISMA instancia. Metrica:
  escritores directos del primario con presentacion de voz 1 -> 0. Gate VERDE.
- PLAN PENDIENTE (dado por el dueno en el chat, 2026-10-10): A2 borrar el flag muerto
  `renameSessionAutoLabelsOnRegister`; A3 coser clusters con el criterio de la DIAARIZACION
  (no el umbral 0.66) + pasar clusters por el comando; A4 el primario no debe borrarse en el
  reinicio de escucha (el comando debe fijarlo); A5 ninguna fila sin hablante (respaldo en el
  commit); A6 una voz = un cluster (tope/fusion); B1 un solo dueno del "descarte" de locuciones;
  B2 el eco se mide contra el texto REAL de FLU (caso "el elote", nace ROJO: MEDIR antes que
  filtro se comio la frase); B3-B5 solo descartar alucinacion clara, recomponer la locucion
  antes de commitear (fragmentos cortados) y un unico commit por turno.
- NO CUBIERTO por el agente: el DoD-producto (pantalla: "okay flu soy Luz" en localhost:5173
  y los turnos siguientes con su nombre), suite completa y E2E completa
  (spec del bloque: tests/e2e/voz-escenario-dueno.spec.ts).

## 2026-10-10 (3) - A2 cerrado (bandera muerta)

- **A2** (201ddf4): `roomCapture.renameSessionAutoLabelsOnRegister` borrada (sin consumidor).
  Guard `tests/vozFlagHuerfanoGuard.test.ts` (lint:guards, nace ROJO). Metrica 1 -> 0.
- SIGUIENTE: A3 (coser clusters con el criterio de la diaarizacion, no el 0.66), A4, A5, A6,
  B1..B5. Plan completo en el mensaje del dueno (2026-10-10).

## 2026-10-10 (4) - A3 cerrado (cosido con el criterio de la diarizacion)

- **A3** (6d7a8e7): `sameVoiceCosidoFloor()` (config `cosineNewVoiceThreshold`) +
  `sameVoiceLabelGroup()` como dueno unico del cosido; `findLabelsWithSharedVoice` delega.
  Guard `tests/vozCosidoDiarizacionGuard.test.ts` (lint:guards, nace ROJO). Metrica 1 -> 0.
- SIGUIENTE: A4 (ciclo de vida del primario), A5 (ninguna fila sin hablante), A6 (una voz =
  un cluster), B1 (descarte con motivo), B2 (eco contra el texto real de FLU: MEDIR primero),
  B3 (solo alucinacion clara), B4 (recomponer antes de commitear), B5 (1 commit por turno).

## 2026-10-10 (5) - A4 cerrado (ciclo de vida del primario)

- **A4** (ea1b1b3): `src/voice/lib/sessionLifecycle.js` (NUEVO) decide: abrir/reanudar la
  escucha NO limpia el primario; cerrar la sesion SI. Frases en config
  (`voiceCommands.sessionClosePhrases`); `matchesCommandPhrase` exportado de audioMath.
  Guard `tests/vozPrimarioReinicioGuard.test.ts` (nace ROJO). Metrica 1 -> 0.
- PENDIENTE del plan: A5 (ninguna fila sin hablante), A6 (una voz = un cluster), B1 (descarte
  con motivo), B2 (eco contra el texto real de FLU: MEDIR primero), B3 (solo alucinacion clara),
  B4 (recomponer antes de commitear), B5 (1 commit por turno).

## 2026-10-10 (6) - A5 cerrado (ninguna fila sin hablante)

- **A5** (1c9e1e8 guards; 985380b src): `resolveRowSpeakerName` devuelve el RESPALDO de
  config cuando no hay nombre medido; `preserveProperSpeaker` no deja la fila vacia.
  Guard `tests/vozFilaConHablanteGuard.test.ts` (nace ROJO). Metrica 2 -> 0.
- PENDIENTE del plan: A6 (una voz = un cluster: tope/fusion), B1 (descarte con motivo),
  B2 (eco contra el texto real de FLU: MEDIR antes de tocar), B3 (solo alucinacion clara),
  B4 (recomponer antes de commitear), B5 (1 commit por turno).

## 2026-10-10 (7) - B3 cerrado (solo alucinacion clara)

- **B3** (5960d40): `classifyGarbageTranscript` -> garbage solo para empty/nonword; el
  tartamudeo es motivo. `resolveCommittablePhrase` devuelve {phrase, usedFallback, reason,
  discarded} y conserva toda frase con palabras reales. Guard
  `tests/vozAlucinacionClaraGuard.test.ts` (nace ROJO). Metrica 1 -> 0.
- PENDIENTE: A6 (tope+fusion de clusters), B1 (un dueno del descarte, todo descarte con
  motivo), B2 (eco vs texto REAL de FLU: MEDIDO -> el peel trunca contenido real), B4
  (recomponer antes de commitear), B5 (1 commit por turno).

## 2026-10-10 (8) - B2 cerrado (eco contra el texto real de FLU)

- **B2** (d7a16f4): `src/voice/lib/echoPolicy.js` (NUEVO) es el dueno del eco: fuente =
  ultima fila de FLU (con edad ms), ventana `echoWindowMs` (3000) anclada al fin de su habla,
  cobertura `echoCoverageFloor` (0.6). `peelWakeQuestionEcho` exige cobertura y
  `resolveEchoSources` es el unico constructor de fuentes (wake-turn + planificador).
  Guard `tests/vozEcoTextoRealGuard.test.ts` (nace ROJO). Metrica 1 -> 0.
- PENDIENTE: A6 (tope+fusion de clusters), B1 (un dueno del descarte con motivo), B4
  (recomponer antes de commitear), B5 (1 commit por turno).

## 2026-10-10 (9) - B1 cerrado (descarte con motivo)

- **B1** (1293514): `src/voice/lib/phraseDiscard.js` (NUEVO) = dueno unico del descarte
  (`DISCARD_REASONS` cerrado + `discardLocution` que siempre emite motivo/sitio). Cableados
  los 4 descartes del stream + el de turnCommitPhrase. Guard
  `tests/vozDescarteConMotivoGuard.test.ts` (nace ROJO). Metrica 3 -> 0.
- PENDIENTE: B4 (recomponer antes de commitear), B5 (1 commit por turno), A6 (tope+fusion
  de clusters).

## 2026-10-10 (10) - B4 cerrado (recomponer antes de commitear)

- **B4** (0498c89): `recomposeLocution`/`isFragmentOfLocution` (turnStream) = dueno unico de
  la recomposicion; lo usan `reconcileCommitText` y `resolveTurnCommitPhrase`. Guard
  `tests/vozLocucionRecompuestaGuard.test.ts` (nace ROJO). Metrica 1 -> 0.
- PENDIENTE: A6 (tope+fusion de clusters).

## 2026-10-10 (11) - B5 cerrado (verificacion fijada)

- **B5** (cdb9547): la propiedad 'cada locucion => 1 fila' YA se cumplia (medido con el arnes
  real del stream). Se cierra como verificacion fijada con guard end-to-end y contrato SIN
  invariant (no se inventa defecto). Guard `tests/vozUnCommitPorTurnoGuard.test.ts`.
- PENDIENTE: A6 (tope+fusion de clusters: unica pieza del plan sin cerrar).

## 2026-10-10 (12) - A6 cerrado (una voz = un cluster)

- **A6** (525c014): `capAndFuseSpeakerClusters` + `autoSpeakerCount` (speakerClusters) =
  dueno unico de la FUSION por el criterio de la diarizacion y del TOPE de etiquetas
  automaticas; el preflight pasa por el dueno; tope en config (`conversationMaxAutoSpeakers`
  6; fluConfig 2770/2772, mismo renglon). Guard `tests/vozUnClusterPorVozGuard.test.ts`
  (nace ROJO). Metrica 1 -> 0. DECISION DECLARADA: el valor 6 es un freno ajustable.
- PLAN COMPLETO: A1..A6 y B1..B5 CERRADOS. Pendiente del dueno: DoD-producto (pantalla),
  suite completa (gate de CI) y E2E completa.

## 2026-10-10 (13) - A5 CORREGIDA (validacion del dueno 14:00-14:08)

- **A5c** (src 80f80fb; guard+contrato d24cdb6; ledger 4dbae6b): la fila escribe TAL CUAL la
  etiqueta del resolver; el RESPALDO solo si no hay etiqueta; el vinculo registrado asciende a
  nombre propio SOLO con evidencia acustica; preserveProperSpeaker no estampa un nombre propio
  sin evidencia sobre una fila ya etiquetada. Se retira el log de descarte (phraseDiscard) de la
  ruta de preview (B1 habia metido spam: 457 WARN/8 min). Guard
  tests/vozFilaConHablanteGuard.test.ts mide la propiedad UTIL (nace ROJO 4/6). Metrica 1 -> 0.
- IMPACTO: (1) la fila lleva la etiqueta del resolver; (2) 'soy Luis' sustituye las filas de esa
  voz; (3) Luis NO cae en la voz de la mujer; (4) sin spam de descarte en preview.
- SIGUIENTE (autorizado, en orden): preflight antes del commit -> plegado luis/Luis ->
  instrumento lastSim (ciego 39/39) -> ciclo de vida del microfono (InvalidStateError).

## 2026-10-10 (14) - #1 CERRADO: el preflight va ANTES del commit

- **P1preflight** (src 94abeda; guard+contrato 37b7175): `primeTurnSpeakerPreflight`
  (turnIdentityPipeline) = dueno unico de la espera ACOTADA (1.5 s) de la instantanea FINAL
  de identidad; el cierre del turno la espera ANTES de escribir la fila. Fabrica unica del
  resolver: `buildFinalSpeakerSnapshotResolver` (conversationStreamCommit); forma
  resolutor/fabrica: `finalSnapshotRunner`. La espera NO bloquea (si vence, el commit escribe
  igual). Guard `tests/vozPreflightAntesCommitGuard.test.ts` NACE ROJO (gate base=1 -> actual=0).
  Metrica 0 -> 1. TECHO: useFluVoiceAssistant.js 4539/4539 (no se rompio).
- LIMITE: plazo 1.5 s; si el embedding real tarda mas, la fila seguiria naciendo sin hablante
  (pendiente de verificar con el micro del dueno).
- SIGUIENTE (autorizado, en orden): plegado luis/Luis -> instrumento lastSim (ciego 39/39) ->
  ciclo de vida del microfono (InvalidStateError).

## 2026-10-10 (15) - Bloque 3+1 CERRADO (plegado, sonda, micro, flanco)

- **P23bloque** (src 83d9173; guards+contrato 704bebf): (A) `foldSpeakerKey` en la busqueda
  de cluster, el cosido, la fusion, la firma del commit y el alias/renombre -> "luis"/"Luis"
  son UNA identidad y el renombre cubre las dos grafias; (B) campo canonico `lastSim` en el
  diagnostico + dueno de la linea (`formatIdentityDiagnosis`) -> la sonda deja de salir ciega;
  (C) el lock del micro lo gobiernan los EVENTOS (`onstart`/`onend`) y `start` es idempotente
  -> sin `InvalidStateError`; (D) `preserveProperSpeaker` no estampa nombre propio sin
  evidencia acustica NI del texto (opcion `evidenciaDeTexto`).
- Guards: `vozPlegadoEtiquetaGuard`, `vozSondaLastSimGuard`, `vozReinicioMicroGuard` (NUEVOS) +
  caso en `vozFilaConHablanteGuard`. Gate base=1 -> actual=0. Metrica 1 -> 0.
- TECHOS: hook 4539/4539 · App 4624/4643 · fluConfig 2772/2772 (ninguno roto).
- PLAZO DEL PREFLIGHT: `voiceIdentity.capture.identityPipeline.commitPreflightTimeoutMs` = 1500 ms
  (config, ajustable). Si el embedding real tarda mas, la fila sigue naciendo sin hablante.
- SIGUIENTE: DoD-producto del dueno (su micro/log). Pendientes del ledger: P9.62, P9.64, P9.65.

## 2026-10-10 (16) - CONGELADO por orden del dueno (no se abren hitos por cuenta del agente)

- Estado: **CONGELADO**. El agente NO abre hitos por su cuenta. Solo entra si la prueba
  EN PANTALLA del dueno falla; en ese caso, reglas de siempre: reproducir antes de tocar,
  guard que mida la propiedad UTIL (nace ROJO), no cerrar por "gate verde" (solo cuando el
  escenario del dueno pase, o declararlo NO CUBIERTO) e impacto en producto por escenario.
- AVISO 1 (techos, escritos por el dueno): `useFluVoiceAssistant.js` **4539/4539** y
  `fluConfig.js` **2772/2772** estan EN EL TECHO; cualquier cambio futuro en esos ficheros
  comprime o saca codigo (no se amplian).
- AVISO 2 (lo PRIMERO que mirara el dueno): el preflight espera **1.5 s**
  (`voiceIdentity.capture.identityPipeline.commitPreflightTimeoutMs` = 1500 ms). Si su micro
  tarda MAS, la fila nacera SIN hablante: es el primer punto a verificar en su prueba.
- Alcance real (0.23): CUBIERTO=el registro de la congelacion y los dos avisos; NO CUBIERTO=
  el DoD-producto (pantalla/micro del dueno).

## 2026-10-10 (17) - PERDIDA DE CONVERSACION (la "garrafal") CERRADA

- **P25perdida** (src 9d0c339; guards 73b2faa): la locucion CONFIRMADA sin fila se DESCARTA-
  BA. La cadena medida: FINAL de Chrome (no escribe fila por diseno) + interinos de la
  locucion siguiente + a los ~4.2 s (`conversationStallMs=4200` < `srGapCommitMs=10000`) el
  watchdog REBUILDA y `hasConfirmedOpenLine` daba "no confirmada" (los interinos posteriores
  tocan la linea) -> la linea se descartaba con la locucion dentro.
- ARREGLO: el ingress marca la confirmada sin fila en `listenState.pendingFinal` (slot que ya
  existia y estaba muerto); `hasConfirmedOpenLine` mira esa marca; los cierres (onend/srGap)
  sellan la CONFIRMADA antes que la linea viva; el parcial en vuelo se sigue descartando.
- Guard nuevo `vozLocucionConfirmadaNoSePierdeGuard` (nace ROJO, gate base=1 -> actual=0) +
  correccion de criterio en P9.60. Metrica 0 -> 1. Lint 244/1971 verde.
- TECHOS: hook 4539/4539 (este hito no lo toco) · App 4624/4643 · fluConfig 2772/2772.
- SIGUIENTE: validacion del dueno en pantalla. OJO: el preflight espera 1.5 s (si su micro
  tarda mas, la fila nace sin hablante).

## 2026-10-11 (noche) - P9.64 MEDIDO: propuesta de mandos de audio (SIN APLICAR)

- Portal reiniciado (PID nuevo, 5173, HTTP 200) y `debug.log` limpiado a 0 bytes: base limpia para la corrida.
- Medido con desk de funciones REALES (`.agent_tmp/audit/desk-audio-knobs.test.ts`, 5/5):
  la ventana del limite de turno es la COLA del buffer (`minSamplesMs = cap`): en aula manda el cap 1800
  (el base 900 no se usa) -> fuga de audio PRE-turno (voz de FLU) 83% con locucion de 300 ms, 50% con
  900 ms, 0% con >=1800 ms. El embedder rechaza <350 ms (16000 x 0.35) mientras `conversationMinVoicedMs`
  = 8. Piso EFECTIVO de reutilizacion 0.63 (0.66 - classroomReuseRelax 0.03). Con la banda de SU log
  (0.041..0.824) sale `production-forced-new-voice`; con la banda limpia (0.69-0.74) 1 sola etiqueta.
- PROPUESTA (NO aplicada; la aprueba el dueno): tail 5000->2000 - cap UNICO 2000 (aula 1800->2000) -
  MinVoiced 8->350 - MinVoicedForNew (aula) 1400->2200 - `productionClusterReuseThreshold` 0.66 SIN TOCAR -
  `classroomReuseRelax` 0.03->0 - + R1 (la ventana nunca empieza antes del turno) y R2 (piso de voz en la
  via de limite). Detalle crudo en `.task/report` (MEDICION + PROPUESTA 2026-10-11).
- PENDIENTE DEL DUENO: aprobar los valores; su corrida con el checker (`npm run voz:log`); re-sembrar el
  ancla si nacio contaminada. Casos vistos en su pantalla (2026-10-11 20:29-20:34): la orden de nombre
  tuvo DOS respuestas (determinista "Registrado Luis." + LLM "Entendido. Procedere..."), el wake llego
  como "flujo" y no disparo, y el micro se congelo/repite locucion (falta el log para diagnosticarlo).
- NO CUBIERTO: el DoD-producto (su pantalla/micro); suite completa y E2E completa (exigen autorizacion).

## 2026-10-14 - P11.12 CERRADO: el cierre de la ultima frase es SOLO por silencio

- Mandato del dueno (2026-10-13): el cierre es por SILENCIO o cambio de hablante; la
  conversacion solo lleva datos consolidados (solo inserts, no updates).
- Fix (commit aa1cd9f): resolveSrGapTrigger SOLO dispara con silencio real (fuera la rama
  SIN CONTENIDO NUEVO); evaluateSrGapSegmentCommit sin cierre por contenido y sin los
  frenos finos (bloqueaban colas cortas de lo ya commiteado); fluConfig sin
  srGapCommitExtensionMinChars / srGapCommitNoNewContentMinChars. Guard nuevo
  vozCierreSoloSilencioGuard (6 casos, en lint:guards) con ROJO-EN-VIEJO medido: 2
  ficheros / 4 casos caen con el src de HEAD; pin P9.68 alineado; pin P9.75 refraseado y
  verde.
- Red medida: lint 277 ficheros / 2256 casos + eslint 0; typecheck 0; pnpm test --changed
  356 ficheros / 4391 casos con SOLO los 2 rojos preexistentes de P11.11.
- RIESGO VIVO: la congelacion con interinos repetidos (P9.68) pasa a depender del detector
  de eco committed-echo + rebuild del reconocimiento, no del cierre -> se valida en la
  corrida del dueno.
- PENDIENTES vivos: P9.76 (lock del micro al INTENTAR start), P9.80 (la orden de nombre
  responde DOS veces), P11.11 (los 2 rojos de Fase E en speakerPrimarySeed; DECISION DEL
  DUENO pendiente: alinear el test a P10.8/P11.4 o devolver la siembra de Fase E).
- SIGUIENTE: su corrida en pantalla (una locucion larga debe escribirse UNA vez; la fila
  no debe reutilizarse/reemplazarse a mitad del dictado) + decision sobre P11.11.

## 2026-10-14 (cierre de serie) - P9.76 + P9.80 + P11.11 CERRADOS: 0 pendientes

- P11.11 (commit f7fb33c): los 2 casos de Fase E se alinean a la regla vigente (el ancla SI
  se crea; el turno que la crea NO lleva el nombre sin MEDIDA) + detector de dos lados; el
  fichero entra en lint:guards (antes estaba fuera). 2 failed/2 passed -> 5/5.
- P9.80 (commit f7fb33c, cierre como MEDICION + barrera): "Registrado Luis." x2 no es
  reproducible hoy; sus habilitadores cerraron en b3e8541/beeef07/42059e6/89c8fb8. La
  barrera (vozRespuestaNombreUnaGuard) mide con funciones reales: la via pasiva no despacha
  el comando (0 tramos con wake propia), el planificador lo resuelve UNA vez y la re-entrega
  del mismo turno da plan dedup.
- P9.76 (commit 695aa28): el micro avisa cuando el motor no confirma arranque (confirmed
  separado de capturing): 2.o start sin onstart = false (recuperacion viva) y 1 sola llamada
  a start(). Rojo-en-viejo medido (1 de 8 casos con el src de HEAD). Consumidores revisados
  (el hook usa el false; onboarding lo ignora).
- PENDIENTES vivos: NINGUNO (`npm run ledger` -> 0 pendientes; 426 cierres registrados).
- SIGUIENTE (del dueno, su corrida en pantalla): (1) una locucion larga se escribe UNA vez y
  la fila no se reutiliza/reemplaza a mitad del dictado (P11.12); (2) "okay flu soy X" no
  duplica la respuesta (P9.80) ni estrena nombre sin medida (P11.11); (3) el micro vuelve
  tras morir (P9.76).

## 2026-10-14 - AUDITORIA DE CODIGO (pedida por el dueno): 0 en src, A7 en scripts/

- Vara CONGELADA (.task/frozen.json) sobre src (424 ficheros): duplication.mjs = 0 grupos;
  auditoria-codigo.mjs = 0 cuerpos duplicados / 0 colisiones / 0 parches; self-test OK.
- Homonimos (7) y hardcode (3 candidatos) LEIDOS: todo similitud de forma o legitimo
  (detalle en .task/report, seccion AUDITORIA DE CODIGO 2026-10-14).
- Archivos: 0 identicos, 0 huerfanos reales (16 explicables), 0 imports rotos.
- FUERA DE LA VARA: scripts/ con walk/readSources/block/duplicateBodies/sh duplicados entre
  instrumentos CONGELADOS y el gate -> PENDIENTE NUEVO A7 (todo): requiere ENMIENDA del dueno
  (nuevo hash de frozen + tocar el gate) antes de unificar.

## 2026-10-14 - A7 CERRADO: un solo dueno del instrumental (autorizacion amplia del dueno)

- Fix (commit 7c427f6): scripts/fsScan.mjs (walkFiles/readSources/block) + scripts/runCmd.mjs
  (sh/shRaw); los 6 consumidores (duplication, auditoria-codigo, auditoria, audit-metric,
  hito, task-gate) importan del dueno; readSources sigue exportada donde era API publica.
- LA VARA NO SE MOVIO: 7 mediciones byte-identicas antes/despues (los 50 ids de audit-metric,
  duplication.mjs, auditoria-codigo.mjs + self-test, catalogo 28/28, purposeOwners.mjs).
- scripts/: 3 -> 0 cuerpos duplicados; homonimos 5 -> 1 (main, sin relacion). Re-congelado
  (frozen.json, 7 ficheros) y GATE paso 0 VERDE; guardas consumidoras 8/8.
- PENDIENTES: ninguno (0 en el ledger).

## 2026-10-14 - P11.13 CERRADO: el aviso de Vite por imports sin extension, eliminado de raiz

- Fix (commits b468cb0 + c8c6aa2): 261 imports del grafo del config con su extension real
  (83 ficheros: src/** + vite.config.ts) + barrera nueva viteConfigNativenessGuard (rojo-en-
  viejo medido: 261 offenders con el arbol viejo) + reparacion de 5 casos en guards de texto
  (0.22: commit aparte) + contrato refrescado (base 7ad1b8c, dod con la union de 203 tests).
- NO se silencio el aviso (VITE_CONFIG_NATIVE_IGNORE_WARNING = supresion, prohibida 2.3).
- MEDIDO: build 254 items -> 0 (mismos 1306 modulos); typecheck 0; 7 mediciones congeladas
  byte-identicas; DoD ENTERO 203 ficheros VERDE; dev server sin el aviso.
- PENDIENTES: ninguno (0 en el ledger).
