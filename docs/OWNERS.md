# Mapa de dueños — módulo CONVERSACIÓN

**Qué es esto.** Una línea por pregunta de diseño, con el único archivo que la
responde. Antes de escribir, busca tu pregunta aquí. Si ya está, edita ese
dueño; no crees otro. Si no está, declara el nuevo dueño, su único consumidor
y la kill list antes de crear el archivo.

**Cómo se lee.** El `símbolo` es el contrato; la `línea` es una pista y puede
moverse. Si la línea no coincide, busca el símbolo en el archivo.

**Fachada.** La entrada pública es `src/voice/conversation/index.ts`. Fuera del
módulo no se importa un archivo interno: si falta una llamada, se añade a la
fachada y se declara aquí.

**Regla dura.** Si el cambio reemplaza un dueño, el dueño viejo muere en el
mismo commit. Si no puedes borrarlo ahora, no añadas el nuevo ahora.

## Sesión y ciclo

| Pregunta | Dueño | Nota |
|---|---|---|
| ¿La sesión está activa y cuál es su estado? | `sesion.ts:90` `crearEstadoSesion` · `sesion.ts:157` `crearSesion` | Estado, caja, voz y cierre de fila. |
| ¿Quién acuña el turno de una fila? | `cierre.ts:227` `abrirLocucion` | El módulo decide; el producto consume la locución abierta. |
| ¿Qué turno lleva cada evento del producto? | `producto.ts:123` `crearMotorConversacionProducto` | Consumidor: no hay segundo mint. |
| ¿Qué motor ASR se elige al abrir? | `motor.ts:37` `elegirMotor` | Uno solo; sin swap en caliente. |
| ¿Qué sesión y turno se adoptan al abrir? | `motor.ts:96` `iniciar` | `sessionId` de la grabación o uuid; `turnId` opcional. |

## Texto y caja

| Pregunta | Dueño | Nota |
|---|---|---|
| ¿El texto nuevo pertenece a la línea abierta? | `fusion.ts:14` `perteneceALineaAbierta` | Usa `continuaLaFrase` y el silencio medido. |
| ¿Cómo se revisa el texto (extiende/revisa/mantiene)? | `revision.ts:68` `unirRevision` · `revision.ts:94` `decidirRevision` | Si pierde palabras, conserva el anterior y no pinta. |
| ¿Cómo se compone la hipótesis completa del evento ASR? | `src/voice/lib/speechMerge.js:338` `fraseDelEventoAsr` (adaptador `adapters.ts:162` `componerFraseDelEvento`) | Pregunta distinta de «¿pertenece?»: aquí se compone el texto del evento. |
| ¿Cómo se pega un trozo nuevo a la línea abierta en el producto? | `src/voice/lib/speechMerge.js:454` `mergeIntoOpenLine` (adaptador `adapters.ts:171` `fusionarEnLineaAbierta`) | Composición del límite; no decide revisión. |
| ¿La frase es eco del TTS? | `eco.ts:46` `esEcoDeTts` | Eco/barge-in contra `ultimoTextoDicho()`. |

## Cierre y fila

| Pregunta | Dueño | Nota |
|---|---|---|
| ¿La locución se cierra? ¿Por qué causa? | `frontera.ts:59` `decidirFrontera` | Única condición de cierre: `voz` / `frontera` / `silencio`. |
| ¿Cómo se cierra y se commitea una locución? | `cierre.ts:211` `crearReglasCierre` (`cerrarLocucion` 535, `commitar` 456, `guardarFila` 436, `reetiquetarFila` 665) | Único emisor de `row.committed`. |
| ¿Cómo se construye la fila? | `fila.ts:164` `construirFila` | Texto, voz, etiqueta y motivo. |
| ¿Cómo se resuelve la etiqueta del hablante? | `fila.ts:126` `resolverEtiqueta` | Nombre solo con evidencia; nunca `?`. |
| ¿La voz es la misma? | `identidad.ts:97` `decidirIdentidad` | Compartido por cierre activo y resolución pasiva. |
| ?C?mo se mide la voz al cerrar? | `cierre.ts:386` `medirVozAlCerrar` | ?nica medida de identidad; el hook solo espeja `fila.firma`. |
| ¿Cómo se corrige el rótulo de una fila concreta? | `pasivo.ts:46` `renombrarFilaDeUsuario` | No mide ni decide identidad: solo fija el nombre canónico por id. El resolver pasivo quedó retirado. |

## Ingesta y audio

| Pregunta | Dueño | Nota |
|---|---|---|
| ¿Cómo entra el audio y se registra el tramo? | `ingesta.ts:65` `crearIngesta` (`ingestaAudio` 538) · `tramos.ts:50` `crearRegistroTramos` | El tramo es la identidad de la locución. |
| ¿Cómo entra el ASR y se resuelve el tramo? | `ingesta.ts:65` `crearIngesta` (`ingestaAsr` 693, `drenarResultadosAsr` 513) · `ingesta.ts:115` `esReentregaDeLaFila` · `ingesta.ts:140` `tramoSinteticoParaTexto` · `tramos.ts:178` `crearBufferAsr` | El módulo atribuye el texto dentro de su cola. |
| ¿Cómo se verifica el cambio de voz? | `ingesta.ts:220` `verificarCambioVoz` · `ingesta.ts:366` `partirLocucionPorCambioDeVoz` | Mide el tramo entrante antes de atribuir texto. |
| ¿Cómo se miden las muestras y su duración? | `muestras.ts:23` `duracionMsDeMuestras` | La identidad sale del audio medido, no del tramo. |
| ¿Cómo se serializan las llamadas y se manejan los pendientes? | `cola.ts:25` `crearCola` · `cola.ts:74` `crearPendientes` · `texto.ts:44` `crearFlujoTexto` (`finalizarPendientes` 280) | Una cola; los pendientes conservan su tramo real. |

## Producto y persistencia

| Pregunta | Dueño | Nota |
|---|---|---|
| ¿Cómo se compone el motor para el producto? | `producto.ts:123` `crearMotorConversacionProducto` | Une adaptadores reales y el motor. |
| ¿El evento ASR trae un final? | `producto.ts:79` `traeFinal` | El final marca la frase; no cierra la locución. |
| ¿Cómo se mapea una fila a snapshot de audio/firma del turno? | `turnSnapshot.js:20` `snapshotDeTurno` · `:43` `grabarSnapshotDeTurno` · `:76` `grabarRevisionDeFila` | Único dueño de `recordSessionTurn` para locuciones; se consume por la fachada. |
| ¿Cómo se persiste la fila? | `adapters.ts:430` `crearAlmacenDexieProducto` → `src/core/db/conversationRowWriter.ts:101` `escribirRegistroConversacion` | Único escritor físico de `fluDb.conversations`. |
| ¿Cómo se refleja en el store/UI? | `src/voice/compose/conversationMotorProducto.js:111` `row.committed` → `addConversationEntry` (133); `speaker.labeled` (95) → `setEntrySpeakerName` (104) | Llamador espejo; no es un segundo escritor. |
| ¿Cómo se evita que el store reescriba la fila del módulo? | `src/hooks/useConversationPersistence.ts:171` `debePersistirEntrada` · `:149` `mismaFilaPersistida` | `conversacionEscrituraUnica` lo prueba. |
| ¿Cómo se renombra el hablante desde la UI? | `adapters.ts:494` `renameRowSpeakerName` (re-export en `src/voice/api/conversation.ts:10`) | Una sola vía de renombre. |
| ¿Quién etiqueta las filas de la sesión con el nombre dicho? | `motor.ts:197` `registrarNombre` (puerto `producto.ts:286`) · disparador ÚNICO `src/voice/compose/conversationMotorProducto.js:174` en `row.committed` | `registrarNombre`: solo la sesión. Fija `nombresPorVoz`/`nombrePendiente` y emite `speaker.labeled`. No escribe directorio ni base. Un segundo call site es ruta doble (caso declarado en `scripts/rutas-dobles-baseline.json`). |
| ¿Quién registra el nombre propio en la identidad global? | `src/voice/lib/speakerIdentityRegister.js:334` `registerSpeakerIdentityFromCommand` → `:87` `registerSpeakerIdentity` (consumidor `useFluVoiceAssistant.js:381`) | Directorio por voz + base + clusters + primario. No reescribe filas (fila inmutable). |

## Configuración

| Pregunta | Dueño | Nota |
|---|---|---|
| ¿Qué tiempos, umbrales y motor se usan? | `ports.ts:334` `CONVERSACION_CONFIG` | Única lectura de `getTranscriptPauseCfg().srGapCommitMs`. |

## Lo que NO es ruta doble

Estas cuatro zonas parecen dos y no lo son. No las «unifiques» sin leer la nota:

1. **El espejo del store.** `useConversationPersistence` escribe la misma fila
   por el mismo `conversationRowWriter`. No es un segundo escritor: es un
   llamador que copia el store a Dexie y salta las filas del módulo
   (`debePersistirEntrada`). `conversacionEscrituraUnica` lo prueba.
2. **Identidad medida vs corrección de rótulo.** `cierre.resolverVoz` mide al
   cerrar; `pasivo.renombrarFilaDeUsuario` solo fija el nombre canónico de una
   fila por id. No hay segunda medida: el resolver pasivo quedó retirado.
3. **Composición del límite vs revisión del módulo.**
   `speechMerge.fraseDelEventoAsr` / `mergeIntoOpenLine` componen la hipótesis
   del evento; `fusion.perteneceALineaAbierta` y `revision.unirRevision`
   deciden pertenencia y revisión. Preguntas distintas.
4. **Nombre de sesión vs identidad global.** `motor.registrarNombre` es la
   etiqueta de continuidad de la SESIÓN (dueño y disparador único en el mapa):
   fija `nombresPorVoz`/`nombrePendiente` y emite `speaker.labeled` para las
   filas futuras. `registerSpeakerIdentityFromCommand`
   (`src/voice/lib/speakerIdentityRegister.js:334`) es la identidad
   PERSISTENTE: directorio por voz, base de participantes, clusters y primario.
   Borrar uno rompe su parte; no son dos copias del mismo responsable.

También es legítimo:

- Dos llamadores al mismo dueño (no es ruta doble).
- Una cadena de fallback con un solo orquestador (AGENTS §1.6).

## Cómo se actualiza

1. Antes de escribir, busca tu pregunta en este archivo.
2. Si ya está: edita ese dueño. No crees otro.
3. Si no está: declara el nuevo dueño, su único consumidor y la kill list antes
   de crear el archivo.
4. Si reemplazas un dueño: el viejo muere en el mismo commit. Si no puedes
   borrarlo ahora, no añadas el nuevo ahora.
5. Archivo nuevo: declara aquí la pregunta, el dueño único, el consumidor y la
   kill list antes de crearlo. Si el dueño ya existe, edítalo. Si la pregunta no
   está clara, paras y preguntas.
6. Función nueva dentro de un archivo existente: actualiza `funciones` en
   `scripts/conversacion-rutas-dobles-baseline.json` en el mismo commit. Si
   responde una pregunta nueva, declárala en la fila del dueño; el ratchet de
   `conversacionRutasDoblesGuard` falla si el nombre no está congelado.
7. No toques guards, baselines, allowlists, CODEOWNERS ni `package.json` sin
   aprobación explícita del dueño.

## Gate de escritura (hook)

`.claude/settings.json` ejecuta `scripts/owner-gate.mjs` antes de un `Write`.
Si el destino es un archivo de código NUEVO bajo `src/` y no aparece en una
fila de tabla de este mapa, el Write se bloquea antes de crear el archivo.

- Dentro de `src/voice/conversation/` basta el nombre: `nuevo.ts:1`.
- Fuera del módulo, usa la ruta completa: `src/.../nuevo.ts:1`.
- Los tests van en `tests/` y no pasan por el gate.
- El hook de `Write` no ve archivos creados por `Bash`; el modo `--staged`
  del pre-commit y el modo `--diff` del CI los cubren.

El gate no decide si el dueño es bueno: solo exige que exista la fila. La
calidad de la fila (pregunta, consumidor único y kill list) la revisa el
dueño en el commit.

## Backstop de commit y CI

El hook de `Write` solo ve `Write`. Los archivos creados por `Bash` y los
commits con `--no-verify` se cubren en dos capas:

- `.githooks/pre-commit` ejecuta `node scripts/owner-gate.mjs --staged`: mira
  los archivos NUEVOS del índice y bloquea el commit si alguno no está
  declarado. Lee el mapa del índice, no del árbol, y valida exactamente el
  commit. Se salta con `git commit --no-verify`.
  `guard-architecture --staged` (también en el pre-commit) deriva de este mapa
  los símbolos dueños y exige **una sola definición** en `src` para cada uno. En
  `--staged` lee el mapa y los archivos del **índice** (lo que se va a
  commitear), no del árbol de trabajo; el CI lo ejecuta sobre el checkout
  completo. Si un símbolo no aparece o aparece en dos archivos, el gate falla.
- `.github/workflows/ci.yml` ejecuta
  `node scripts/owner-gate.mjs --diff <base>`: mira los archivos NUEVOS del PR
  o del push y falla el check. Es el backstop que cierra el `--no-verify`; si
  el check es obligatorio en la rama, el merge no pasa. No es retroactivo: si
  el commit que añadió el archivo aún no tenía `scripts/owner-gate.mjs` en su
  árbol, el archivo queda exento; un archivo añadido con el gate presente sí
  exige fila. Así el PR que introduce el gate no falla por los archivos que ya
  existían antes de él.
- `.github/CODEOWNERS` exige revisión del dueño para el módulo
  (`src/voice/conversation/**`) y sus consumidores externos
  (`conversationRow.js`, `speakerDirectory.js`, `conversationRowWriter.ts` y
  `useConversationPersistence.ts`).

Los dos modos fallan cerrados: si no pueden leer el mapa, el índice o el rango,
bloquean. En un push con base inalcanzable (force push), el CI omite el paso;
el evento de PR, con `base.sha`, sigue siendo la puerta fiable.
