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
