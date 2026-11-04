# AGENTS.md — Reglas de ingeniería

**Versión:** 9.0 · **Última actualización:** 2026-10-18

Este repositorio se valida con **typecheck, linters y pruebas funcionales**. No hay
gates de metadatos, ledger de pendientes, auditoría del historial de Git, reglas de
alcance de commits ni contratos de proceso. La calidad se demuestra con el software
funcionando y con pruebas que ejecutan el flujo real. **La suite completa está
PROHIBIDA en local**: la corre el CI (§1.15).

---

## Anexo 0 — Hechos del proyecto (dato verificable, no regla)

| Hecho | Valor |
|-------|-------|
| Tipo | SPA/PWA. Sin backend desplegado; `src/server/**` son middlewares del dev-server de Vite. |
| Lenguaje/Build | TypeScript 6 estricto · Vite 8 · React 19 |
| Routing/Estado/DB | React Router v6 · Zustand 5 · Dexie 4 (IndexedDB) |
| Estilos | CSS propio (sin Tailwind) |
| Idioma | `es` / `en` / `both`, UN selector en la cabecera (`App.tsx`); sin librería i18n |
| IA/Medios locales | `@huggingface/transformers`, Whisper WASM (workers), `tesseract.js`, `pdfjs-dist` |
| Testing | Vitest 3 + React Testing Library · Playwright (E2E) |
| Node | 22 (el de CI) |

### Comandos

| Acción | Comando |
|--------|---------|
| Dev | `npm run dev` |
| Tipos | `npm run typecheck` |
| Linters (D0 duplicados + comportamiento + ESLint) | `npm run lint` |
| ESLint | `npm run lint:eslint` |
| Test rápido (archivo tocado) | `npm run test:file <ruta>` |
| Test de cambios | `npm test` |
| Suite completa (solo CI / autorización expresa) | `npm run test:full` |
| Gate de entrega | `npm run gate` |
| E2E | `npm run e2e` |
| Build | `npm run build` |

`npm run gate` ejecuta `typecheck + lint`; no corre la suite completa (prohibida, §1.15) ni audita Git.
El pre-commit ejecuta `lint + typecheck` y nunca la suite completa.

---

## 0. VERDAD Y VALIDACIÓN

1. **Toda afirmación cita su fuente:** comando + salida real, o `archivo:línea`.
2. **No se declara terminado lo que no se validó.** El agente cierra lo técnico; la
   validación de producto (pantalla y uso real) la confirma el usuario.
3. **Parcial honesto:** `No lo hice; hice solo X parcial en [archivo:línea]`.
   Reportar un avance parcial nunca se penaliza; disfrazarlo, sí.
4. **Distinguir HECHO de SUPUESTO.** Un supuesto no cierra nada.
5. **Si algo propio rompe:** se revierte ese cambio, se muestra el `git diff` real y
   se vuelve a medir. Sin reverts silenciosos.
6. **La verdad es la pantalla del usuario.** Si reporta que algo no coincide, se
   investiga de nuevo; no se insiste con el dato propio.
7. **Prohibido validar solo con mocks.** Los tests pueden aislar dependencias, pero
   el flujo central debe ejercitarse con el artefacto real del proyecto.

---

## 1. PROHIBICIONES ABSOLUTAS

1. **No hardcode:** configuración por entorno, archivo de configuración o inyección.
2. **No parches ni soluciones temporales:** se corrige la causa raíz.
3. **No `new` en lógica de negocio:** dependencias por interfaces.
4. **No commits directos a `main`/`master`:** ramas `feature/*`.
5. **No `try/catch` vacíos** ni que silencien errores: se registra con contexto y se
   propaga. Un `catch` registra por `logCaughtError(contexto, ...detalles)`
   (`src/lib/caughtError.ts`); `console.*` no cuenta como registro.
6. **No rutas dobles:** una sola fuente de verdad por intención. Una **cadena de
   respaldo** (proveedor 1 → 2 → 3, ordenada en config, con un solo orquestador) no
   es una ruta doble: es resiliencia y se conserva.
7. **No borrado físico en offline:** el borrado es lógico (`deleted: true`).
8. **No basura en el proyecto:** código y archivos muertos, duplicados u obsoletos se
   eliminan. Git es el respaldo; no se crean copias manuales por iteración.
9. **No tests arbitrarios ni duplicados:** cada test cubre un caso real y único.
10. **No errores de lógica ni de implementación.** El código se entrega correcto.
11. **No `timeout: null`** en comandos. Los procesos largos se verifican y se
    terminan por PID.
12. **No dejar procesos largos colgados.** Se identifica el PID exacto.
13. **No generar respaldos por iniciativa propia** (`git bundle`, copias fechadas,
    tags) salvo petición expresa del usuario en ese turno.
14. **No warnings `act()`** ni tests dependientes de timing. Tests deterministas
    (fake timers, `act()`), sin depender de la carga de la máquina.
15. **PROHIBIDO ejecutar la suite completa.** Solo la corre el CI (`CI=true` es
    autorización expresa) o una sesión humana que lo pida en ESE turno
    (`FLU_AUTH_FULL_SUITE=1`). El agente NO la corre por iniciativa propia ni pone
    la variable: validar un cambio es `test:file` / `test:grep` / `npm test`
    (`--changed`) + `lint` + `typecheck`. Prohibidos también los atajos
    equivalentes (`npx vitest run` sin filtro, `vitest run` sin ruta,
    `test:coverage`). La barrera es mecánica, con DOS puertas y UN criterio
    (`scripts/full-suite-policy.mjs`): `vitest.config.ts` —por donde pasa cualquier
    corrida— y `scripts/require-full-suite-auth.mjs` (script npm). Guard de
    conducta: `tests/fullSuitePathBarrier.test.ts`.

---

## 2. OBLIGACIONES ESTRICTAS

1. **Inyección de dependencias** por interfaces.
2. **JSDoc en todo componente/método nuevo:** contrato de la interfaz.
3. **Responsabilidad Única (SRP):** una razón de cambio por archivo/clase.
4. **Inmutabilidad:** no se mutan objetos de estado compartidos; se crean copias
   dirigidas. Las filas ya escritas no se reescriben si la regla de dominio dice que
   son inmutables.
5. **Log de auditoría** para cambios de configuración.
6. **UUIDv4 en toda inserción:** prohibidas llaves numéricas secuenciales.
7. **Tupla de sincronización** en cada tabla: `[revision, updated_at, deleted]`;
   `revision` incrementa atómicamente y `updated_at` se actualiza en UTC.
8. **Errores con contexto** (ver §1.5).
9. **Aislamiento de contexto de IA:** cada inferencia inicia contexto ciego; se purga
   el estado global residual antes de cada llamada.
10. **Circular Buffer en audio:** vaciado cíclico contra fugas de memoria.
11. **requestAnimationFrame para 3D**: renderizado aislado; comunicación con
    IndexedDB vía `postMessage`.

---

## 3. CONVENCIONES DE CÓDIGO

- Archivos: `PascalCase` componentes, `camelCase` hooks/utils. Un componente por
  archivo.
- Estructura real: `src/core/[dominio]/` (lógica), `src/components/` (UI),
  `src/hooks/`, `src/lib/`, `src/services/`, `src/app/` (despacho/acciones),
  `src/voice/` (motor de voz, JS), `src/avatar/`. NO existe `src/modules/`.
- Interfaces con prefijo `I`; tipos sin prefijo. Tipos en `src/types/[dominio].ts`.
- **EOL:** conserva la del fichero. El repo es mixto (`core.autocrlf=false`, sin
  `.gitattributes`): hay blobs en LF y en CRLF. Cambiar la clase EOL hace que Git
  marque todo el fichero como modificado. Se repara con `npm run fix:eol`.
- **`git diff --check` y CRLF (convención del entorno):** en un repo mixto, las reglas
  de espacios por defecto de Git cuentan el CR de cada línea CRLF como *trailing
  whitespace*, así que marcan cualquier línea añadida a un fichero CRLF (también las de
  commits anteriores: `git show <sha> --check`). La comprobación correcta aquí declara
  `cr-at-eol`:
  `git -c core.whitespace=blank-at-eol,blank-at-eof,space-before-tab,cr-at-eol diff --check`
  Ese comando sí caza los espacios/tabuladores reales al final de línea. No se cambia la
  EOL de una línea para satisfacer al comando sin `cr-at-eol`: eso rompería `eolGuard`.
- **Vocabulario:** una etiqueta, un sitio. Un conjunto de valores que debe coincidir
  entre subsistemas se declara UNA vez y el resto importa la lista o consulta
  pertenencia por un predicado (`isVisualWorkspaceTipo`). Prohibido re-enumerarlo.
- **Trinquete de tamaño:** `tests/godFileSizeGuard.test.ts` fija el techo de cada
  god-file. Solo baja o empata; si una consolidación necesita +N líneas, se recortan
  allí mismo o el commit no pasa.
- Los `.js` NO los comprueba `tsc` (`checkJs` off). Un `export { x } from '...'` sin
  `import` compila en verde y rompe en runtime al usar el binding dentro del módulo.
  Si un módulo re-exporta algo que además usa: importa Y re-exporta, y ancla la
  delegación con identidad de función.

---

## 4. VALIDACIÓN E ITERACIÓN

### Por cambio

- `npm run test:file <ruta>` para el archivo en curso.
- `npm run test:grep -- "<texto>"` filtra por nombre de caso.
- `npm run typecheck` en cada iteración; un error de tipos es error de entrega.
- `npm run lint` (pruebas de comportamiento + ESLint).
- `npm run verify:fast` (EOL + tipos + ESLint).

### Al cerrar una tarea

- `npm run gate` (typecheck + lint) + `npm run build`. La suite completa NO se
  corre en local: es del CI (§1.15); si el usuario la pidió, se anota.
- `npm run e2e` para los flujos de UI afectados.
- Si un test falla, se corrige la causa raíz; no se ajusta el test para tapar el
  defecto salvo que el test mida una regla obsoleta, y entonces se declara.

### Suite completa: prohibida por defecto

- **Qué se bloquea:** `vitest run`/`bench` sin ruta de test y sin
  `--changed`/`-t`/`--related`/`--shard`. El VALOR de un flag no es un filtro
  (`--reporter dot` sigue siendo suite completa).
- **Qué abre la puerta:** `CI=true`/`GITHUB_ACTIONS` (los pone la plataforma) o
  `FLU_AUTH_FULL_SUITE=1` pedido por el usuario en ese turno. El agente no pone la
  variable: "verificar que no rompí nada" no es un pedido.
- **Atajo declarado (no es puerta trasera):** `--config vitest.guards.config.ts`
  acota porque su `include` es `GUARD_FILES`; la política lo declara como dato y el
  guard comprueba que ese include sigue siendo la lista.
- **Modo watch** (`npm run test:watch`) no se bloquea: es interactivo, pero también
  corre el repo entero; se usa solo cuando el humano lo está viendo.
- **Un incumplimiento no se disfraza:** si se corrió, se anota en el reporte; no se
  presenta como "validación".

### Reglas de los tests

- Un guard de comportamiento ejecuta el flujo real, no solo cuenta nombres.
- Un detector debe tener una prueba que lo falsifique (entrada infractora → marca;
  entrada legítima → no marca).
- Los tests de lógica pura usan `environment: 'node'`; solo los componentes usan
  `jsdom`. Cero warnings `act()`.
- Carga perezosa de dependencias pesadas.

---

## 5. ENTREGA Y FOCO

1. **Criterio de aceptación por escrito antes de tocar código** (1-2 líneas de qué
   verá el usuario cuando esté bien).
2. **Una sola tarea a la vez, sin desvíos.** Hallazgo fuera de alcance → se anota al
   final (`archivo:línea`) y se sigue la tarea.
3. **"No afectar lo validado" se demuestra con tests.**
4. **"Ejecuta / hazlo" = primera tool call en esa misma respuesta.**
5. **No detenerse ante complejidad:** con diagnóstico y localización, se ejecuta
   completo; la validación visual la hace el usuario después.
6. **Cada cambio se anuncia ANTES** (archivo + intención) y se muestra DESPUÉS con
   `git diff` real. Sin decisiones ocultas ni reverts silenciosos.
7. **Cierre en formato fijo:**
   `Cambios aplicados · Validado contra · No validado`.
   El DoD de producto queda reservado al usuario.

---

## 6. EVIDENCIA ESTRUCTURAL

1. **Criterio numérico para refactors:** comando que cuenta la duplicación, valor
   ANTES y DESPUÉS. Si el número no baja, el cambio es cosmético.
2. **Rutas dobles vs. cadenas de respaldo:**

   | | **Ruta doble (MALO)** | **Cadena de respaldo (BUENO)** |
   |---|---|---|
   | Qué es | La MISMA responsabilidad implementada N veces | N proveedores distintos con roles distintos |
   | Riesgo | Divergen | Degradación controlada |
   | Dónde vive | Copias dispersas | Un orquestador + orden en config |

   Si los N caminos producen lo mismo por el mismo motivo, es ruta doble → 1. Si
   producen lo mismo por motivos distintos y en orden de prioridad ante fallo, es
   respaldo → se conserva.
3. **Un dominio, un almacén.** La misma entidad en dos sistemas (Dexie +
   localStorage, o Dexie + store en memoria) no es respaldo: es ruta doble de datos.
4. **Un guard mide implementaciones, no literales.** Debe alcanzar todas las formas
   reales del símbolo, ser case-insensitive cuando aplique, cubrir todo `src` y
   tener prueba de mutación.
5. **Un guard fuera de `lint:guards` no es una barrera.** Si existe, se lista o se
   borra. Los guards deben evitar la vacuidad: exigir que ven la fuente y que el
   defecto existió.
6. **Duplicado vs. similitud de forma.** Duplicado = dos dueños del mismo
   responsable que pueden divergir. Similitud de forma = mismo esqueleto en
   responsables distintos; no es un pendiente, se reporta aparte.

---

## 7. VELOCIDAD DE INTERACCIÓN

1. **Evidencia en el primer mensaje:** entrada cruda + salida real + resultado
   esperado.
2. **Prohibido volcar contexto completo.** Se lee el fragmento o bloque nuevo.
3. **Ventana mínima de logs:** solo la marca o línea relevante.
4. **Verificación por niveles:** test del archivo tocado → typecheck → gate al
   cierre. No correr todo por cada edición (la suite completa está prohibida, §1.15).
5. **No re-verificar lo ya verde** sin que el código haya cambiado.
6. **Delegar lo instrumental:** búsquedas y exploración a subagentes; el principal
   sintetiza.
7. **Instrumentación puntual, no trazas masivas.**
8. **Modelo/razonamiento proporcional a la tarea.**
9. **Salida corta y de formato fijo.** Sin narrar el proceso.
10. **Cerrar antes de abrir.** Ningún hito queda pendiente mientras se empieza otro.
11. **Ante ambigüedad costosa, decidir y avanzar** con el default declarado.

---

## 8. BARRERA CONTRA RUTAS DOBLES (constraints obligatorios)

Estas reglas son duras y aplican a toda tarea, no solo a las de refactor.

1. **Dueño declarado antes de escribir.** Antes de crear o tocar código, grep del
   símbolo o responsabilidad y declarar el dueño `archivo:línea`. Si no existe,
   declarar el nuevo dueño y su consumidor ANTES de crear el archivo. Sin ese dato no
   se escribe. El mapa vive en `docs/OWNERS.md`; se lee antes de escribir. Si la
   pregunta ya está, se edita ese dueño; no se crea otro.
2. **Un dueño por responsabilidad.** Lo demás importa o delega. Prohibido crear una
   segunda implementación de la misma responsabilidad. Si el cambio reemplaza un
   dueño, la kill list (lo que se borra) va en el mismo commit. Si no puedes borrar
   el camino viejo ahora, no añadas el nuevo ahora.
3. **Baseline solo baja.** Cada lista de excepciones y su techo se congelan en un
   archivo versionado. Una excepción nueva exige motivo, dueño y fecha; no se añade sin
   aprobación del dueño (CODEOWNERS). Si un caso se arregla, se borra su excepción y se
   baja el techo en el mismo commit; el guard debe fallar si una entrada queda muerta.
4. **Caso nuevo, guard + infractor.** Toda categoría nueva necesita un guard que falle y
   una prueba con un caso infractor real: se inyecta, se pega el fallo y se borra. Un
   guard verde por no mirar no cuenta.
5. **UI/3D no se unifica sin test.** Un componente o módulo 3D solo se unifica si existe
   una prueba del archivo que cubra el flujo afectado; si no, se dictamina y se deja.
6. **No commit salvo pedido explícito.** No se hace commit, amend, push ni PR por
   iniciativa propia. Solo cuando el usuario lo pida en ese turno.
7. **No merge sin barrera.** No se mergea sin check verde y revisión del dueño; no se
   usa bypass ni se desactiva la protección. La configuración de GitHub (PR obligatorio,
   aprobaciones, Code Owners, status checks, sin bypass) es parte del contrato.
8. **Cierre con evidencia literal.** Se cierra con `Cambios aplicados · Validado contra ·
   No validado` y la salida literal del gate. No se resume el gate ni se presenta como
   validado lo que no se ejecutó.
9. **La suite completa no se corre en local.** Se valida con `test:file` / `test:grep` /
   `npm test`, `lint`, `typecheck` y `gate` (§1.15).

---


## Anexo B — Invariantes de dominio (FLU OS · adaptar/borrar por proyecto)

> Estas reglas valen mientras el proyecto sea FLU OS. Cualquier cambio en escucha,
> transcripción, bitácora, burbuja del avatar, barra de búsqueda o query a la IA debe
> cumplirlas y se verifica con el criterio numérico de §7.

1. **La escucha debe ser centralizada**: UNA sola instancia de reconocimiento
   (`speechRecognitionLocal`) para el flujo principal. Prohibido instanciar escucha en
   otros componentes mientras la principal esté activa.
2. **Ningún otro elemento debe tener tratamiento sobre la escucha/transcripción**:
   normalización, deduplicación y commit de la frase viven en UN solo lugar (el motor de
   voz). Prohibido re-normalizar en consumidores.
3. **Misma frase canónica**: burbuja del avatar, bitácora y phrase-display se alimentan de
   la MISMA frase. Prohibidas cascadas de respaldo distintas por componente.
4. **El único wake word es el configurado** en `FLU_CONFIG.voiceCommands.wakeWords`.
   Prohibido hardcodear wake words fuera de config.
5. **La barra de búsqueda debe mostrar lo mismo que la transcripción**, solo sin la wake
   word y solo los comandos; la quita ÚNICAMENTE para presentación
   (`splitTranscriptAtWakeWord`), nunca para decidir contenido.
6. **Lo que escucha FLU debe ser lo mismo que la transcripción**: la `question` enviada a
   la IA se deriva de la MISMA frase canónica commiteada.
7. **Un único punto de TTS**: un solo módulo encapsula `speechSynthesis`; el resto consume
   esa API.
8. **Idioma: una sola fuente y un solo selector.** El idioma activo es `es` / `en` / `both` y
   vive en UN sitio (el configurador), con UN solo selector visible (cabecera). Prohibido un
   segundo selector, un segundo almacén de idioma, o re-declarar el idioma en consumidores.
   Un cambio de idioma debe propagarse a **toda** la UI y a las respuestas de FLU, no solo a
   una parte. Las cadenas de UI se resuelven por una fuente única (diccionario / `t()`), no por
   ternarios dispersos por componente.

9. **Los ajustes de IA tienen UN dueno y viven en el configurador.** La creatividad
   (temperature) la resuelve `src/services/aiTemperature.ts` y los motores la reciben por
   `AIRequestOptions.temperature`; ningun adapter la relee por su cuenta. Prohibido crear
   una clave localStorage paralela a un ajuste del configurador (`integrationStore`):
   `flu-creativity` se retiro por eso: la escribia solo la restauracion de backup y la
   leia solo el adapter DeepSeek, mientras el configurador era la fuente real, asi que el
   ajuste llegaba a un motor y no al otro. Ver `tests/storageKeysAliveGuard.test.ts`.
10. **Una nota con lista es UN destino (`Super`), y sus items van al CONTENIDO.** Los
   items nunca se embeben en el nombre: la forma canonica es la nota `Super` con un item
   por linea en el `body`. Las etiquetas heredadas `Super: {items}` se absorben al body y
   los duplicados del mismo destino se funden en la fila mas antigua (ninguna lista se
   parte en dos). Definicion unica en `src/core/notes/superNoteTarget.ts`.
11. **El mandato empieza en la wake word.** La wake marca el inicio de la orden: lo
   anterior es habla de contexto (TV/sala) o residuo del ASR, y los parsers
   deterministas anclan sus regex al inicio, así que se descarta. Un solo dueño:
   `normalizeCommandForDeterministic` (audioMath.js) para el texto del mandato, y
   `extractFluVoiceCommand` para la compuerta de aceptación; ambos usan el splitter
   único `splitTranscriptAtWakeWord` (nunca un match de prefijo). Prohibido que un
   matcher anclado al inicio reciba la captura cruda con wake inline y ruido
   delante: el comando se pierde en silencio y responde la IA.

12. **Referencia de CONJUNTO vs item concreto (agenda).** Un cuantificador universal
   ("borra todas/todos ...") o un sustantivo en PLURAL resuelven el CONJUNTO del tipo:
   `label` va VACIO y el servicio opera sobre la serie entera del tipo (`findSeries`:
   `!target`), acotada al usuario. Un singular desnudo ("borra el recordatorio") NO
   arrastra el conjunto: se queda con el sustantivo canonico y no hace nada si no casa
   (evita destruir por ambiguedad). El plural vive en `KIND_NOUNS` (misma fuente que el
   kind): no se anaden listas de sinonimos.
13. **Una ORDEN DE ARRANQUE nunca es accion de partida (juegos).** El motor de
   un juego NO debe consumir la orden de arranque de SU PROPIO juego como
   respuesta: el nombre del juego puede ser tambien su frame interno (loteria:
   el grito "!LOTERIA!" == token 'loteria' dentro de "vamos a jugar loteria"), y
   consumirla declaraba ganador con UNA carta cantada. El criterio "es arranque"
   tiene dueno unico: `matchGameIntent` (frame de juego + alias), el mismo que la
   ruta sin partida activa; en `resolveGameCommandFromText` (paso 3b) resuelve
   `start`, nunca `turn`.
   DOS capas, ambas obligatorias: (1) el ROUTER (`resolveGameCommandFromText`)
   no enruta un arranque como turno; y (2) el MOTOR, que debe distinguirlo por si
   mismo (un arranque nunca puede declarar victoria ni consumirse como turno). El
   concepto "orden de arranque" tiene DUENO UNICO en la hoja `core/games/gameUtils`
   (`PLAY_INTENT_FRAMES` + `hasPlayOrderFrame`), consultable por catalogo y motores
   sin ciclo de imports. Muros: tests/gameStartRequestNotInGameAction.test.ts y la
   matriz (invariante 15).

14. **Comparadores de revision ASR: NO son duplicados.** `audioMath.spokenUtteranceRevision`
   (pela la wake, single-source por voiceSingleSourceGuard) y
   `conversationStream.isProgressiveExtension` (exige crecimiento) son reglas
   DISTINTAS a proposito. La dedupe de emision identica ya se intento y rompio
   turnos legitimos (tests/transcriptionDedupLoss.test.ts): NO se toca para
   "arreglar" repeticiones; el defecto real era la colision del punto 13.
**Guard verificable:** test que falle si N>1 criterios de deduplicación/commit de la misma
señal.

15. **MATRIZ DE SISTEMA derivada de los registros (no listas a mano).**
   `tests/systemMatrix.test.ts` GENERA sus celdas iterando las fuentes unicas:
   GAME_CATALOG x conductas (arrancar, orden-de-arranque, ciclo entrar/salir/
   re-entrar, cambiar, salir, menu, colision, diferencial de puertas),
   AGENDA_KINDS x acciones (crear, borrar-etiqueta, borrar-CONJUNTO,
   conservadurismo singular) sobre servicio real + DB en memoria,
   END_GAME_FRAMES/GAME_MENU_FRAMES y wakeWords de la config. Cierra con una
   GUARDIA ANTI-DERIVA: si un juego, un objeto, un frame o una wake del registro
   no quedo ejercitado, el test es ROJO. Anadir un juego, un objeto o un comando
   de voz sin cubrirlo es imposible por construccion.

16. **ALCANCE AFECTADO = consumidores TRANSITIVOS, no solo imports directos.**
   El alcance se dedujo grepando imports (`from '../src/<area>`) y dejo FUERA 21
   tests que MONTAN el pipeline (renderHook de useFluVoiceAssistant) y que SI
   ejercitan el cambio: el alcance por imports directos no ve consumidores
   transitivos. Regla: al tocar voz/juegos/agenda, incluir la CAPA DE COMPOSICION
   (todo test que monte el hook), porque ahi vive el defecto de "arreglado en un
   sitio y roto en otro".
17. **COBERTURA DERIVADA Y COBERTURA PENDIENTE (no confundir).**
   DERIVADO: GAME_CATALOG x conductas (G1), AGENDA_KINDS x acciones incl.
   modificar/completar/vaciar (G2), frames de fin/menu y wakeWords (G3),
   diferencial de puertas (G4), anti-deriva de registros (G5), SUPERFICIE DE
   COMANDOS DE LOS MOTORES -63 tablas publicadas como *_COMMAND_FRAMES- (G6) y
   VARIANTES DE RUIDO DEL ASR: eco, eco con wake, muletilla, truncado (G7).
   G6 exige ademas que ningun motor quede sin superficie publicada y que la
   superficie descubierta cubra TODO el catalogo: anadir un juego sin publicar sus
   comandos es ROJO. La higiene de entrada (eco y muletilla) tiene dueno unico en
   audioMath.normalizeSpokenCommand, que consumen agenda, notas y arbitro.
   PENDIENTE: superficies de NOTAS, CONFIG y ENTORNO (hoy son regex heterogeneas,
   no tablas: publicarlas como dato es rediseno, no algo mecanico), la partida
   completa hasta victoria por juego, y el DOM del panel.

18. **El último objeto de CADA TIPO del Pizarrón no se borra.** El Pizarrón convive con tres
   objetos de vida propia (video, imagen, respuesta/todo) y cada uno se reemplaza SOLO cuando
   el MISMO tipo produce uno nuevo. Un turno de otro tipo no los borra. Dueño único del tipo
   que produce un turno: `resolveTurnArtifactKind` (`src/lib/turnArtifactKind.ts`), que
   consumen la limpieza por turno de App (la imagen solo se limpia en un turno de imagen) y
   el foco del feed (un solo criterio, no dos copias). La restauración del Historial descarta
   POR TIPO: una generación de video (o una imagen en curso) no borra el último objeto
   restaurado de los otros tipos. Dentro de su tipo el descarte sigue siendo definitivo: una
   petición que termina sin resultado NO repinta el artefacto anterior (casos 2 y 4).
   EXCEPCIÓN declarada: una BÚSQUEDA nueva sí limpia la imagen viva generada, porque comparten
   la misma zona "Imágenes" del grid del feed.
   Muros: `tests/turnArtifactKindPerTurn.test.ts`, `tests/workspaceLastObjectPerType.test.tsx`,
   `tests/workspaceMediaResetOnRequest.test.tsx`, `tests/workspaceHubRestoreMedia.test.tsx`.

19. **Con partida ACTIVA, un turno AJENO no lo consume el motor: la partida queda EN PAUSA.**
   El tipo del turno lo decide su DUEÑO, no quien pide la jugada. Dueño único de esa pregunta:
   `isClaimedByOtherDomain` (`src/voice/lib/gameCommands.js`), que consulta al resolutor de cada
   dominio (agenda, notas, compras, diario, ambiente, configuración, navegación/generación,
   petición visual). Si otro dominio reclama el texto, NINGUNA orden de juego se ejecuta
   —tampoco la que pide la IA en `contract.juego`— y `applyGameAction` deja la partida
   SUSPENDIDA (`gameSessionStore.noteGameTurn`): sigue VIVA (estado, ronda y puntaje intactos)
   pero no consume respuestas abiertas ni vuelve a hablar mientras el usuario está en otro
   asunto. Se RETOMA con cualquier orden de juego (salir/menú/cambio, arranque del mismo juego o
   un comando del motor) sin reiniciar nada. Regla única para los 21 motores: sin ramas por
   juego. Defectos medidos en el log del dueño (2026-09-28): 16:24:36 "Okay flu Crea una cita
   para mañana a las 3 de la tarde con el doctor" → 16:24:42 FLU "La carta es: La muerte…" (la
   cita se creaba y el motor cantaba su carta igual); y 16:20:29/16:20:33 "Okay Flow genera una
   imagen" dos veces (el fast-path del juego escribía la SEGUNDA fila del mismo turno).
   **Guard verificable:** `tests/gameDoesNotHijackCommands.test.ts` (la orden ajena no habla, la
   partida queda en pausa y se retoma; tabla medida de que ninguna orden de juego la reclama
   otro dominio).

---
## Contrato de desenlace de partida (juegos)
Todo final de motor (`gameOver: true`) DEBE declarar `won` booleano: `true` SOLO si el
jugador logro el objetivo de ese turno (completar las rondas, acertar, cerrar el cuento);
`false` en agotamiento, rendicion, salto o salida. Motivo: `resolveGameSpeechOptions`
(`src/core/games/gameSpeech.ts`) grita victoria siempre que `gameOver` no traiga
`won === false`; con los motores terminando sin `won`, FLU celebraba cada derrota.
El desenlace se declara en el propio final, nunca se deriva del `animation` (`Dance`
acompaña tambien a "muy bien jugado" en derrota).
**Guard verificable:** `tests/gamePlaythrough.test.ts` (partida completa hasta victoria en
TODO el catalogo, victoria alcanzable en cada juego, cierre por la ruta REAL
`applyGameAction`, y guardia de fuente que falla si algun `gameOver: true` omite `won`).

---

**Fin.** Ninguna regla de este archivo se silencia: lo que no se pueda cumplir se detiene y
se pregunta.
