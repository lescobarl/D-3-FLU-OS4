# Relevo de sesion - FLU OS4

Artefacto de proceso, versionado a proposito: el resumen del chat se compacta y deja de
ser fuente; esto no. Se actualiza cuando cambie el estado.

Ultima actualizacion: 2026-10-02. Rama: feature/saneamiento-01-limpieza-barrera.
Estado en vivo (HEAD, arbol, pendientes): `npm run brief`. No se congelan hashes aqui a
proposito: un hash escrito a mano se queda viejo en el siguiente commit.

## Que pegar en la sesion nueva

Copia el bloque de abajo tal cual. Lo primero que hace la sesion nueva es el briefing, y
con eso ya sabe donde esta sin leer el repo entero.

```
Trabajo en FLU OS4. Repo: D:\D-Proyectos\D-3-FLU-OS4 (Windows, PowerShell).

PRIMER PASO OBLIGATORIO, antes de leer nada:  npm run brief
(si necesitas los ficheros cambiados: npm run brief -- --files)
Eso te da rama, HEAD, estado del arbol, base, limites del contrato y pendientes.

REGLAS DURAS DE ESTA SESION:
- NO corras la suite completa (npm run test:full) salvo que yo lo pida en este turno.
  Valida con el fichero tocado:  npm run test:file <ruta>
- No repitas un comando que ya dio verde sin que el codigo haya cambiado.
- npm run gate SOLO al cierre y UNA vez.
- Cada arreglo se mide ANTES y DESPUES con el caso exacto, no con prosa.
- Escribe ASCII en ficheros del repo (hay guard de mojibake e higiene).
- PowerShell: para textos largos usa fichero (git commit -F), no comillas anidadas.

ESTADO DE HOY: 0 pendientes en el ledger (`node scripts/task-ledger.mjs check` OK).
La ultima sesion (2026-10-02) cerro el saneamiento de COBERTURA:
- Capa ciega CERRADA: 0 de 378 ficheros de src sin pruebas de conducta (eran 36). Commits 5a0353f y 7206643.
- El DoD cubre TODA la suite de conducta (351 tests); el comando DoD se troceo en ARRAY porque el string
  acumulado superaba el limite de linea de cmd.exe (~8191) y task-gate.mjs ya ejecuta cada trozo. Commit fceaf6f.
- Bug de voz arreglado: showListeningAck pintaba el ack y lo borraba en el mismo tick (el chip "Te escucho"
  nunca se veia). Commit 9dfa99f, test de conducta nacido ROJO -> VERDE, arreglo neutro en lineas.
Auditoria INDEPENDIENTE (2026-10-02) y su cierre (heuristicas propias sobre los 378 ficheros de src):
- console.* como registro de un catch -> logCaughtError (9 sitios; 23517b2). Guard endurecido para vetar
  console.* dentro de catch, con prueba de detector y allowlist al logger (7c4157c).
- Hardcode de politica en src/core/autonomy -> fuente unica autonomyPolicy.ts (~165 numeros; c9d92ca).
- Literal 'invalid-input' (40 sitios, 10 ficheros) -> src/lib/resultReasons.ts (cefe45b).
- Esqueleto de motores de juego a duenos unicos en gameUtils: isLastRound (18 sitios, 644ba16),
  isGameCommandSurface (17 motores, 0c67f4f), finishRoundsIfLast + roundsOverMessage (mensaje de fin;
  c7bd867/6ef1d66). Duplicacion de bloques de 4 lineas: 12 -> 5 (los 5 son patrones de LLAMADA compartidos).
- Suite COMPLETA verde (483 ficheros / 5450 tests, 2026-10-02). Base del contrato avanzado a 769994e
  (headroom de alcance: el diff acumulado iba por 400/504 ficheros).
Limpio (medido): 0 var/eval/catch-vacio/as-any/claves API/storage directo/TODO real; los 34 '==' son '== null'.
Los ultimos cierres de tickets son:
- Lotería (cada 2 turnos no cambiaba carta / perdia ejecucion): cerrado, commit 033cc69.
- ¿Quién soy? (pistas vagas / fallo que repetia la ultima pista): cerrado, commit 80aa99d.
- Pizarron (no se borra el ultimo objeto por tipo): cerrado, P7.60/P7.62/P7.64.
- Planificador E2E (e2eScope) + rojo intermitente de la suite: cerrados, a3999d6.
- Juego (un turno con dueno de la voz, una orden = una carta, eco de la orden de arranque): cerrados, P7.69/P7.71.
- Voz (el habla real con repeticion corta no cierra el turno mudo, eco de la cola del TTS): cerrado, P7.70.
- Fila de conversacion (una locucion = una fila; un servicio no escribe la conversacion): cerrados, P7.72/P7.73.
- quien_soy (la pista que no acota no es posible): cerrado, P7.59/P7.67.

LO UNICO ABIERTO: verificacion de PRODUCTO en mi pantalla (AGENTS.md A.1, no
automatizable): jugar una loteria pidiendo cartas seguidas (6 cartas distintas sin
repetir y sin perder turnos), jugar un quien soy fallando 5 veces a proposito (4 pistas
distintas y luego revela y avanza) y comprobar que tras una generacion fallida el ultimo
video/imagen por tipo sigue en el Pizarron. Ademas (2026-10-02): al arrancar la escucha, comprobar
que el chip de ack "Te escucho" se ve ~2,2 s (antes no se veia nunca).

Si te doy un defecto nuevo, dime antes: entrada cruda (lo que dije/escribi), salida
observada y salida esperada. Con eso directo al arreglo.
```
