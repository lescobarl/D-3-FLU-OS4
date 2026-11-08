# Anti rutas dobles — especificación de implementación

> **Para quién es este documento:** un agente (Claude, Kilo, OpenCode o cualquier
> herramienta) que debe IMPLEMENTAR esta solución en un proyecto nuevo o en un
> módulo nuevo. Es una especificación completa y autocontenida: piezas,
> contratos exactos (stdin/CLI/exit codes), formatos de datos, orden de
> instalación, validación y lecciones medidas del despliegue original
> (repositorio FLU-OS4, rama `main` `d5b69fe1` + `feature/ratchet-src-completo`
> `4ce180ba`, 2026-11-05/06).

---

## 1. Problema y límite declarado

**Problema.** Los agentes crean rutas dobles: una segunda función/archivo que
responde la misma pregunta de diseño que ya responde uno existente ("¿Cómo se
elige el motor ASR?", "¿Cómo se cierra una locución?", …). Cada duplicado
bifurca el criterio y deja dos sitios que pueden divergir.

**Solución: una barrera en tres puertas, con dueño único por pregunta.**

1. **Antes de escribir** (hook `PreToolUse` / plugin del host): una escritura
   nueva bajo `src/` que duplique responsabilidad se bloquea antes de tocar
   disco.
2. **En el commit** (hook `commit-msg`): un commit que añada funciones
   sospechosas sin declarar veredicto se bloquea.
3. **En el PR/CI** (paso `--diff`): la rama que traiga duplicados sin veredicto
   no mergea.

**Límite declarado (no fingir más de lo que hay).** La equivalencia semántica
no es decidible. La barrera NO demuestra que dos funciones hagan lo mismo: mide
similitud (pregunta, nombre, firma, clon del cuerpo) y OBLIGA a decidir
visiblemente antes de crear. La decisión la escribe el agente; la puerta la
exige y deja rastro, y el dueño humano la revisa. Los clones flagrantes
(cuerpo ≥ 90 % igual, ≥ 24 tokens) bloquean por sí solos sin admitir
declaración.

---

## 2. Principios de diseño

| Principio | Qué implica |
|---|---|
| **Un dueño por pregunta** | Cada pregunta de diseño tiene UN archivo dueño declarado. Editar al dueño, no crear uno paralelo. |
| **Falla cerrada** | Cualquier error de la puerta (input ilegible, git inaccesible, script ausente) BLOQUEA; nunca deja pasar. |
| **No retroactiva** | El gate no juzga la historia: si no existía en la base de comparación, se omite. La rama que introduce el gate no se bloquea a sí misma. |
| **Criterio desde la referencia** | Los casos y umbrales se leen del commit de referencia (HEAD en `--staged`, la base en `--diff`), no del árbol de trabajo: un cambio no puede debilitar el criterio que lo juzga. |
| **Ratchet solo sube** | Las líneas base (rutas dobles, nombres de función) solo pueden crecer o bajar techos; nunca aflojarse en el mismo cambio que las viola. |
| **Independiente del host** | La MISMA puerta sirve a Claude Code, Kilo y opencode: nombres de tool en cualquier capitalización, claves en variantes (`file_path`/`filePath`), payload por stdin. |
| **Sin `sh`** | Ninguna pieza depende de un shell: los hosts corren sobre Bun en Windows y `sh` no está en PATH. Lanza Node directamente. |
| **Node del PATH, no `process.execPath`** | En hosts Bun, `process.execPath` es el binario del host (kilo.exe/opencode.exe), no un intérprete. Usa `node` del PATH o la variable opcional `FLU_NODE`. |

---

## 3. Inventario de piezas

| Pieza | Rol | Puertas donde corre |
|---|---|---|
| `docs/OWNERS.md` | Mapa de dueños: pregunta → dueño → consumidor único → kill list | lo lee owner-gate; lo mantiene el agente |
| `scripts/owner-gate.mjs` | Bloquea archivos NUEVOS bajo `src/` sin fila en el mapa | PreToolUse `Write`, pre-commit `--staged`, CI `--diff` |
| `scripts/revisor-funciones.mjs` | Índice de funciones + CLI interactivo del revisor (candidatos + veredicto) | CLI manual antes de crear; motor compartido |
| `scripts/revisor-puertas.mjs` | Evaluación compartida: ¿bloquea? ¿veredicto declarado? informe | importado por las 3 puertas |
| `scripts/revisor-prehook.mjs` | Puerta PreToolUse: simula el Write/Edit y evalúa las funciones nuevas | hook del host |
| `scripts/revisor-git.mjs` | Puerta de git: compara índice/HEAD contra referencia | commit-msg `--staged --msg`, CI `--diff` |
| `scripts/revisor-plugin-adapter.mjs` | Adaptador ÚNICO para los plugins de host (normaliza + ejecuta + traduce bloqueo) | plugins de Kilo y opencode |
| `.kilo/plugin/revisor.js` | Plugin de Kilo Code (auto-registro) | `tool.execute.before` de Kilo |
| `.opencode/plugins/revisor.js` | Plugin NATIVO de opencode (sin terceros, sin sh) | `tool.execute.before` de opencode |
| `.claude/settings.json` | Hooks PreToolUse de Claude Code | `Write` → owner-gate; `Write\|Edit` → revisor-prehook |
| `.githooks/pre-commit` | Gate del commit: dueño + arquitectura + lint + tipos | git commit |
| `.githooks/commit-msg` | Gate del mensaje: revisor `--staged` | git commit |
| `scripts/install-hooks.mjs` | Activa `core.hooksPath=.githooks` (vía `prepare` de npm) | npm install |
| `.github/workflows/ci.yml` | Pasos de CI: owner-gate `--diff`, revisor `--diff`, guards, lint, tipos, tests | push y PR |
| `scripts/guard-files.mjs` | Lista `GUARD_FILES` (un DATO): los tests que corren en `lint:guards` y pre-commit | la importa vitest y el conteo |
| `vitest.guards.config.ts` | Config de vitest cuyo `include` es `GUARD_FILES` | `npm run lint:guards` |
| `scripts/rutas-dobles.mjs` + `scripts/rutas-dobles-baseline.json` | Guard de rutas dobles POR RESPONSABILIDAD (catálogo de casos con dueño) | `npm run lint` |
| `scripts/funciones-ratchet.mjs` + `scripts/voz-funciones-baseline.json` + `scripts/src-funciones-baseline.json` | Ratchet de NOMBRES de función (solo sube) | guards de ratchet en `lint:guards` |
| `.github/CODEOWNERS` + branch protection | El criterio/gate es inmutable sin aprobación del dueño | GitHub |
| `tests/revisor*.test.ts`, `tests/rutasDoblesGuard.test.ts`, `tests/vozFuncionesRatchetGuard.test.ts`, `tests/srcFuncionesRatchetGuard.test.ts` | Guards de comportamiento que blindan cada pieza | `lint:guards` |

---

## 4. Contratos exactos

### 4.1 `owner-gate.mjs` — gate de archivos nuevos

**Modos:**
- stdin (hook): `echo '{"tool_name":"Write","tool_input":{"file_path":"..."}}' | node scripts/owner-gate.mjs`
- `--staged`: valida el índice (`git diff --cached --diff-filter=AC`); el mapa se lee DEL ÍNDICE (`git show :docs/OWNERS.md`), no del árbol.
- `--diff <base>`: valida el rango `base..HEAD` en CI. No es retroactivo: si el commit que añadió el archivo no tenía este script en su árbol (`treeHasGate`) o el archivo se añadió antes del gate (`addedBeforeGate`), queda exento.

**Alcance:** archivos `.ts/.tsx/.js/.jsx/.mjs/.cjs` bajo `src/` (pathspec `:(icase)src/` — cierra el bypass de mayúsculas en sistemas insensibles a caso). Los tests van en `tests/` y NO pasan por este gate. Un archivo que YA existe en disco pasa (el gate es de archivos NUEVOS).

**Contrato del hook (stdin JSON):**
- Nombre de tool en cualquier capitalización (`Write`, `write`, …): solo `write` dispara; otra cosa → exit 0.
- Ruta en cualquiera de `tool_input` / `input` / `args`, claves `file_path` / `filePath` / `path` / `absolutePath`.
- Ruta fuera del repo o fuera de `src/` → exit 0.

**Salida:** `0` permite, `2` bloquea (stderr explica: lista de archivos sin dueño + instrucciones), `1` error de uso/entrada. El hook del host se configura `onFailure: block`: un fallo del gate no deja pasar la escritura.

### 4.2 `revisor-funciones.mjs` — índice y CLI

**Indexación.** Extrae funciones del fuente con TypeScript: nombre, `nombreCompleto`, parámetros, retorno, JSDoc, cuerpo. El índice del repo se construye desde `src/` completo.

**Búsqueda de candidatos.** Contra el índice, ordena por puntaje medible:
pregunta (el JSDoc sin la etiqueta `@revisor`, o el nombre), nombre (stopwords
ES/EN + diccionario de sinónimos: `ultima/ultimo`, `fila/linea/row`,
`cerrar/cierre/close/stop`, …), firma (número de parámetros, tipos como
desempate) y **clon normalizado del cuerpo**.

**Umbrales (constantes exactas):**
- `MIN_PUNTAJE = 0.25` — mínimo para listar un candidato.
- `CLON_MINIMO = 0.6`, `CLON_BLOQUEO = 0.9`, `MIN_TOKENS_CLON = 24` — un clon ≥ 90 % de un cuerpo ≥ 24 tokens **bloquea por sí solo**, aunque el nombre no comparta palabras, y no admite declaración.
- `UMBRAL_FUNCION = 0.7` — candidato-función que bloquea si no hay veredicto.
- `UMBRAL_CASO = 0.5` — candidato-caso (del catálogo de rutas dobles) que bloquea.
- `MIN_MOTIVO = 8` — la justificación debe tener ≥ 8 caracteres.

**CLI:**
```
node scripts/revisor-funciones.mjs --pregunta "..." --nombre "..." [opciones]
  --parametros N   --tipos a,b   --retorno T
  --borrador RUTA  (cuerpo propuesto; activa la detección de clones)
  --raiz DIR       (defecto: src)
  --casos RUTA     (defecto: scripts/rutas-dobles-baseline.json)
  --veredicto reusar|extender|crear   --destino A:L   --justificacion T
  --json
```
Salida: `0` veredicto declarado; **`3` falta veredicto** (el revisor no decide
por ti, pero no te deja avanzar sin haber mirado); `2` error de uso.

**Veredictos:** `REUSAR archivo:linea` · `EXTENDER archivo:linea` · `CREAR NUEVO`.
`REUSAR` no vale para una función nueva: si la respuesta es reusar, no se crea.

### 4.3 Declaración de veredicto (lo que exigen las puertas)

En el JSDoc de la función nueva:
```
/**
 * ...doc...
 * @revisor CREAR NUEVO — <justificación de ≥ 8 caracteres>
 */
```
También vale `@revisor EXTENDER — ...` (y el destino se documenta en el JSDoc).

O, en un commit, los trailers (los imprime el CLI):
```
Revisor-Funciones: CREAR NUEVO
Revisor-Motivo: <justificación de ≥ 8 caracteres>
```

### 4.4 `revisor-prehook.mjs` — puerta antes de escribir

**Stdin (lo entrega el harness del host):**
```json
{"tool_name":"Write","tool_input":{"file_path":"src/...","content":"..."}}
{"tool_name":"Edit","tool_input":{"file_path":"src/...","old_string":"...","new_string":"..."}}
```
Nombre de tool en cualquier capitalización, claves en variantes
(`file_path`/`filePath`/`path`, `old_string`/`oldString`,
`new_string`/`newString`, `replace_all`/`replaceAll`).

**Comportamiento:**
1. Solo `write`/`edit`; solo código bajo `src/`; si no aplica → exit 0.
2. **Simula el resultado** del tool: `Write` → `content`; `Edit` → aplica
   `old_string`→`new_string` (con `replace_all`) sobre el archivo actual. Si el
   `old_string` no aparece, evalúa el fragmento nuevo (el tool fallaría de todos
   modos; el aviso sigue siendo útil).
3. Indexa las funciones ANTES y DESPUÉS; las que aparecen por primera vez
   (`nombreCompleto` nuevo) se evalúan contra el índice del repo y el catálogo
   de casos. Sin funciones agregadas → exit 0.
4. Si alguna bloquea → informe en stderr (candidatos con puntajes y motivos) y
   **exit 2**; el host cancela el tool.

**Falla cerrada:** JSON ilegible o error interno → exit 2.

### 4.5 `revisor-git.mjs` — puertas de git

```
node scripts/revisor-git.mjs --staged [--msg .git/COMMIT_EDITMSG]   # commit-msg
node scripts/revisor-git.mjs --diff origin/main                     # CI
```
- `--staged`: compara el índice contra `HEAD` (viejo = contenido en `HEAD`,
  nuevo = contenido en el índice). El catálogo de casos se lee de `HEAD`
  (`casosEnCommit`).
- `--diff <base>`: compara `HEAD` contra la base. Si el gate no existía en la
  base (`existeGateEn` → `git ls-tree base scripts/revisor-git.mjs`), **se
  omite** (no se juzga la historia). El catálogo se lee de la BASE.
- Los renombrados puros (filter `AM`; `R` no se evalúa) no disparan: sus
  funciones ya existían.
- Salida: `0` permite, `2` bloquea, `1` error de uso. Falla cerrada.

### 4.6 `revisor-plugin-adapter.mjs` — dueño único de la adaptación de host

Los plugins de host NO reimplementan las puertas: solo traducen su evento a
`aplicarPuertasRevisor(tool, args)`. Contrato del adaptador:

```js
// Convierte los args del host al payload que leen las puertas.
export function normalizarEntrada(tool, args) {
  const entrada = args ?? {}
  return {
    tool_name: tool === 'edit' ? 'Edit' : 'Write',
    tool_input: {
      file_path: entrada.file_path ?? entrada.filePath ?? entrada.path ?? entrada.absolutePath,
      content: entrada.content,
      old_string: entrada.old_string ?? entrada.oldString,
      new_string: entrada.new_string ?? entrada.newString,
      replace_all: entrada.replace_all ?? entrada.replaceAll ?? false,
    },
  }
}

// Corre una puerta con el payload por stdin. status 0 → null; cualquier otra
// cosa (timeout, error de spawn, exit != 0) → stderr → el host cancela.
export function aplicarPuertasRevisor(tool, args) {
  const nombre = String(tool ?? '').toLowerCase()
  if (nombre !== 'write' && nombre !== 'edit') return
  const payload = normalizarEntrada(nombre, args)
  if (nombre === 'write') {           // dueño ANTES de crear el archivo
    const bloqueo = correrPuerta(OWNER_GATE, payload)
    if (bloqueo) throw new Error(bloqueo)
  }
  const bloqueo = correrPuerta(PREHOOK, payload)   // duplicados en write Y edit
  if (bloqueo) throw new Error(bloqueo)
}
```

Reglas del adaptador:
- `spawnSync(NODE, [script], { input: JSON.stringify(payload), cwd: ROOT, timeout: 30_000 })` — **sin shell**.
- `const NODE = process.env.FLU_NODE || 'node'` — nunca `process.execPath`.
- Lanzar `Error` cancela el tool en ambos hosts.

### 4.7 Plugins de host

**Kilo Code** — `.kilo/plugin/revisor.js` (los `.js` de `.kilo/plugin/` se
auto-registran al arrancar; Kilo crea su `package.json` con `@kilocode/plugin`):
```js
import { aplicarPuertasRevisor } from '../../scripts/revisor-plugin-adapter.mjs'
const servidor = async () => ({
  'tool.execute.before': async (input, output) => {
    // input.tool = nombre; los args MUTABLES viven en output.args.
    const args = output?.args ?? output?.input ?? input?.args ?? input?.input
    aplicarPuertasRevisor(input?.tool, args)
  },
})
export default { id: 'revisor-funciones', server: servidor }
```
Añadir `.kilo/.gitignore` con `node_modules/`, `package.json`,
`package-lock.json`, `pnpm-lock.yaml`, `bun.lock`, `yarn.lock` y `agent-manager.json`.

**opencode** — `.opencode/plugins/revisor.js` (plugin NATIVO; NO usar
`opencode-claude-hooks` ni `hooks.json`: ese ejecutor hardcodea
`Bun.spawn(["sh","-c",...])` y en Windows `sh` no está en PATH → ENOENT →
la puerta nunca corre):
```js
import { aplicarPuertasRevisor } from '../../scripts/revisor-plugin-adapter.mjs'
export const RevisorFuncionesPlugin = async () => ({
  'tool.execute.before': async (input, output) => {
    aplicarPuertasRevisor(input?.tool, output?.args)
  },
})
```

**Claude Code** — `.claude/settings.json` (los hooks reciben el evento por
stdin con `tool_name`/`tool_input`):
```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Write",
        "hooks": [{ "type": "command",
                    "command": "node \"${CLAUDE_PROJECT_DIR:-.}/scripts/owner-gate.mjs\"",
                    "shell": "bash", "timeout": 10, "onFailure": "block",
                    "statusMessage": "Verificando dueño del archivo nuevo..." }] },
      { "matcher": "Write|Edit",
        "hooks": [{ "type": "command",
                    "command": "node \"${CLAUDE_PROJECT_DIR:-.}/scripts/revisor-prehook.mjs\"",
                    "shell": "bash", "timeout": 30, "onFailure": "block",
                    "statusMessage": "Verificando funciones duplicadas..." }] }
    ]
  }
}
```

### 4.8 Hooks de git

`.githooks/pre-commit` (sh; el orden importa):
```sh
#!/bin/sh
# En worktrees vinculados git exporta GIT_DIR/GIT_INDEX_FILE a los hooks; se
# borran para que cada herramienta re-descubra el repo desde el cwd (si no,
# los commits reales de los tests de guards aterrizan en la rama del worktree).
unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE

node scripts/owner-gate.mjs --staged || exit 1
node scripts/guard-architecture.mjs --staged || exit 1
npm run lint || exit 1
npm run typecheck || exit 1
```

`.githooks/commit-msg`:
```sh
#!/bin/sh
node scripts/revisor-git.mjs --staged --msg "$1" || exit 1
```

Activación (repositorios git): `git config core.hooksPath .githooks`, vía
`scripts/install-hooks.mjs` invocado desde el script `prepare` de `package.json`
(no falla si no hay git):
```json
"scripts": { "prepare": "node scripts/install-hooks.mjs" }
```

### 4.9 CI (`.github/workflows/ci.yml`)

Job `quality` (Ubuntu, `actions/checkout@v4` con **`fetch-depth: 0`** — los
`--diff` necesitan la base), Node 22. Pasos en orden:

1. **Guard de dueños** — `node scripts/owner-gate.mjs --diff "$BASE"` donde
   `BASE` = `github.event.pull_request.base.sha` en PR, `github.event.before`
   en push; si no hay base o no existe (`0000…` / `rev-parse` falla), se omite.
2. `npm ci`.
3. **Revisor de funciones** — `node scripts/revisor-git.mjs --diff "$BASE"` (misma lógica de base).
4. `npm run guard:arch` → `npm run lint` → `npm run typecheck` →
   `npm run test:full` → `npm run build`.

`lint` debe encadenar: auditoría de duplicados + guard de duplicados + guard de
literales + guard de hardcodes + `lint:guards` + eslint. `lint:guards` =
`vitest run --config vitest.guards.config.ts`, cuyo `include` es la lista
`GUARD_FILES` importada de `scripts/guard-files.mjs`.

**Regla P9.22 (medida):** la lista de guards NO va dentro del script de
package.json (cmd.exe corta comandos en 8191 caracteres y la lista crece);
vive como dato en `scripts/guard-files.mjs` y la config la importa.

**Regla de registro:** TODO guard nuevo se añade a `GUARD_FILES` en el MISMO
commit, verificado con el conteo de tests de `lint:guards` (antes/después).
Un guard sin fila pasa en directo pero no es barrera.

### 4.10 `rutas-dobles.mjs` + catálogo de casos

Guarda por RESPONSABILIDAD declarada. Formato de
`scripts/rutas-dobles-baseline.json`:
```json
{
  "_nota": "El techo solo baja...",
  "minSources": 400,
  "cases": [
    {
      "id": "apertura-locucion",
      "owner": "src/voice/conversation/cierre.ts",
      "description": "El ensamblado de DatosApertura vive en el dueño; cada flujo tiene UN único sitio que lo pide.",
      "pattern": "abrirLocucion\\(\\s*\\{",
      "roots": ["src/voice/conversation"],
      "kind": "sites",
      "allowed": { "src/voice/conversation/texto.ts": 1, "src/voice/conversation/ingesta.ts": 1 },
      "goal": 2
    }
  ]
}
```
El guard falla (exit 1) si: aparece un fichero NUEVO que casa (ruta doble
nueva); un fichero permitido deja de casar (la lista solo se recorta); el total
supera `goal` (el techo solo baja); el escaneo lee menos fuentes que
`minSources` (medida vacua). `--report` lista casos y recuentos.

### 4.11 Ratchet de nombres de función

`funciones-ratchet.mjs` extrae nombres por archivo (fuente sin comentarios):
`function`, const-arrow, const-function y métodos de objeto/clase (sin contar
`async (` como método). Forma de línea base
(`scripts/voz-funciones-baseline.json`, `scripts/src-funciones-baseline.json`):
```json
{ "minSources": 129, "src/voice/conversation/fila.ts": ["ultimaFilaPorFin", "fusionarVoz", ...], ... }
```
El guard falla si aparece un nombre NO declarado en un archivo escaneado (el
ratchet solo sube: declararlo en la línea base va en el MISMO cambio); quitar
funciones no dispara; `minSources` anti-vacuidad.

### 4.12 Formato de `docs/OWNERS.md` (mapa de dueños)

- Una fila por pregunta de diseño: `| Pregunta | Dueño | Nota |`.
- El Dueño es la única celda que declara: `` `archivo.ts:90` `simbolo` `` (dentro
  del módulo basta el nombre de archivo; fuera, ruta completa). Una mención en
  la Nota no abre el gate.
- Declarar también: consumidor único y kill list.
- **Regla dura:** si el cambio reemplaza un dueño, el dueño viejo MUERE en el
  mismo commit. Si no puedes borrarlo ahora, no añadas el nuevo ahora.
- Fachada del módulo: fuera del módulo no se importa un archivo interno; la
  entrada pública es su `index.ts`.

### 4.13 Protección del criterio (`.github/CODEOWNERS` + branch protection)

El gate es INMUTABLE sin aprobación del dueño. CODEOWNERS cubre: `AGENTS.md`,
todos los `scripts/` del criterio (gate, revisor, ratchets, líneas base,
guard-files), `docs/OWNERS.md`, `.claude/settings.json`, `.githooks/`,
`vitest.guards.config.ts`, `package.json`, `/tests/*Guard*.test.ts(x)` y el
módulo protegido (`/src/voice/conversation/**`).

Branch protection en `main`: require pull request + 1 aprobación + dismiss de
aprobaciones obsoletas + **require review from Code Owners** + check requerido
("Unit + Lint + Build"). Nota medida: GitHub no permite aprobar tu propio PR
(422); cuando el autor ES el code owner, el requisito se auto-satisface.

### 4.14 Guardian — Puerta 1 de hosts SIN hooks (Cline y similares)

Los hosts con API de hooks pasan por el prehook ANTES de escribir. Los que no
la tienen (Cline) escriben directo al disco: la Puerta 1 no los intercepta. El
guardian cierra ese hueco alcanzándolos JUSTO DESPUÉS del Write.

- **`scripts/guardian.mjs`** vigila `src/` (fs.watch por directorio: el modo
  recursive no existe en Linux) y ante cada archivo de código NUEVO espera un
  debounce (el evento llega con el archivo a medio escribir) y corre las MISMAS
  dos puertas sobre el disco — no es una segunda implementación de la barrera:
  - `owner-gate --pretende-nuevo` — el flag nuevo de owner-gate evalúa el
    archivo como si el Write estuviera a punto de ocurrir aunque YA exista.
  - `revisor-prehook --desde-vacio` — el flag nuevo evalúa el contenido como si
    el archivo no existiera antes (todas sus funciones son agregadas).
- **Veredictos**: puerta exit 2 → el guardian BORRA el archivo y pega el
  informe del gate con el protocolo de reintento (el archivo bloqueado sale del
  censo para que el reintento del host vuelva a pasar por las puertas). Puerta
  0 → OK. Puerta FALLIDA sin veredicto (crash/timeout) → NO borra (destruir el
  trabajo del host por un fallo propio sería peor): avisa y pide verificación
  manual; commit y CI siguen interceptando aguas abajo.
- **CLI**: `npm run guardiano` (vigilar) y `npm run guardiano -- --una-vez
  <ruta>` (verificar un archivo ya escrito; exit 0 permite / 2 bloquea y
  borró). La función `verificarArchivoNuevo(rel, {soloRevisor, mapa})` se
  exporta para los tests.
- **`node` del PATH o `FLU_NODE`**, nunca `process.execPath` (§7.3).
- **`.clinerules`** en la raíz: el protocolo manual que el host sin hooks debe
  aplicar ANTES de cada escritura (dueño declarado, veredicto `@revisor`) +
  aviso de que el guardian puede borrarle archivos y no debe detenerlo.
- El guardian NO sustituye el protocolo manual ni las puertas 2/3: es la red
  que hace REAL la Puerta 1 donde no hay API de hooks.

---

## 5. Orden de implementación

### 5.1 Proyecto NUEVO (barrera completa)

1. **Escribir la política** en el equivalente de `AGENTS.md`: un archivo nuevo
   bajo `src/` es una parada obligatoria; una pregunta = un dueño; el revisor
   se corre antes de crear funciones.
2. **Crear `docs/OWNERS.md`** con el mapa de dueños del módulo inicial.
3. **Implementar el motor**: `revisor-funciones.mjs` (índice, stopwords +
   sinónimos del dominio, umbrales de §4.2), `revisor-puertas.mjs`
   (evaluación, veredicto, informe).
4. **Implementar las 3 puertas**: `owner-gate.mjs`, `revisor-prehook.mjs`,
   `revisor-git.mjs` (contratos de §4.1/4.4/4.5, con lectura del criterio
   desde la referencia y no-retroactividad).
5. **Catálogo de casos** `rutas-dobles-baseline.json` + `rutas-dobles.mjs`
   (§4.10) y **ratchets** `funciones-ratchet.mjs` + línea base inicial (§4.11)
   generada del árbol existente.
6. **Adaptador + plugins de host** (§4.6/4.7): adaptador compartido, plugin de
   Kilo, plugin nativo de opencode, hooks de Claude en `.claude/settings.json`.
   Sin `sh` en ninguna pieza.
7. **Guardian + `.clinerules`** (§4.14) para los hosts sin hooks: los dos flags
   nuevos (`--pretende-nuevo` en owner-gate, `--desde-vacio` en
   revisor-prehook), el watcher, el protocolo manual y el script `guardiano`.
8. **Hooks de git** (§4.8): pre-commit (con el `unset GIT_DIR` primero),
   commit-msg, `install-hooks.mjs` + `prepare`.
9. **Guard list**: `guard-files.mjs` + `vitest.guards.config.ts`; registrar
   TODO guard nuevo en el mismo commit.
10. **Tests de cada pieza** (§6), empezando por la reinyección del defecto.
11. **CI** (§4.9) y **CODEOWNERS + branch protection** (§4.13).
12. **Correr el gate completo una vez** (`npm run lint` + `lint:guards`) y
    verificar el conteo de tests.

### 5.2 Módulo NUEVO dentro del proyecto existente

1. Crear la sección del módulo en `docs/OWNERS.md`: una fila por pregunta, con
   dueño, consumidor único y kill list, ANTES de crear los archivos.
2. Para cada responsabilidad crítica, añadir un caso al catálogo de rutas
   dobles (`pattern` medible, `owner`, `allowed`, `goal`) o una fila de
   línea base en el ratchet, en el MISMO cambio que el código.
3. Correr el revisor antes de cada función nueva:
   `node scripts/revisor-funciones.mjs --pregunta ... --nombre ... --borrador <archivo>`.
   Con candidatos ≥ umbral: `REUSAR`/`EXTENDER` el dueño existente, o declarar
   `@revisor CREAR NUEVO — justificación` en el JSDoc.
4. Añadir los guards de comportamiento del módulo a `GUARD_FILES` y las rutas
   nuevas a `CODEOWNERS` (dueño del módulo).
5. Registrar la línea base nueva del ratchet si el módulo es nuevo territorio
   (`minSources` actualizado) en el mismo commit.

---

## 6. Validación (protocolo de reinyección, no solo suite verde)

1. **Pipe-test de cada puerta** con el payload real del host:
   - Claude: `echo '{"tool_name":"Write","tool_input":{"file_path":"src/zzz-nuevo.ts"}}' | node scripts/owner-gate.mjs` → exit 2.
   - Kilo/opencode: `{"tool_name":"write","tool_input":{"filePath":"src/zzz-nuevo.ts"}}` → exit 2 (misma puerta, claves camelCase y tool minúscula).
   - Clon: `Write` cuyo `content` es el cuerpo exacto de una función existente
     con OTRO nombre → revisor exit 2 (clon ≥ 90 %, ≥ 24 tokens, sin palabras compartidas).
   - Permisivos: tool no-escritura → 0; archivo ya existente en owner-gate → 0;
     archivo fuera de `src/` → 0.
2. **Mutación de cada línea base**: añadir un fichero que case en el catálogo de
   rutas dobles → ROJO; subir `goal` → ROJO; añadir un nombre no declarado en el
   ratchet → ROJO; quitar una función → verde (el ratchet no dispara al bajar).
3. **No-retroactividad**: `--diff` contra una base sin el gate → exit 0.
4. **Criterio desde la referencia**: modificar la línea base en el MISMO commit
   no afloja el criterio (se lee de HEAD/base).
5. **Hosts reales**: reiniciar el host y verificar que el plugin se carga
   (Kilo crea su `package.json` con `@kilocode/plugin`; opencode registra el
   plugin nativo). Probar un Write bloqueante real en cada host.
6. **Conteo de guards**: `lint:guards` debe incluir el guard nuevo (delta en el
   conteo de tests).
7. **En Windows, probar la cadena con `spawnSync`/el host real, NO con
   `sh -c` desde PowerShell 5.1**: PowerShell manglea `${VAR:-.}` al pasar el
   argumento y produce falsos negativos.
8. **Guardian por reinyección**: escribir un archivo sin dueño bajo `src/` y
   correr `node scripts/guardian.mjs --una-vez <ruta>` → exit 2 Y el archivo
   desaparece; en modo watcher, inyectar el archivo con el guardian corriendo
   → borrado en segundos con su informe. Pipe-test de los dos flags nuevos:
   owner-gate con el archivo ya escrito pasa SIN `--pretende-nuevo` (exit 0) y
   bloquea CON él (exit 2); revisor-prehook con el contenido ya en disco pasa
   SIN `--desde-vacio` (exit 0) y bloquea un clon CON él (exit 2).

---

## 7. Lecciones medidas del despliegue original (no repetirlas)

1. **El fix de un hueco de host se escribe contra la API nativa del host**
   (plugin propio), no parcheando el entorno. Parchear el PATH para que un
   plugin tercero encontrara `sh` funcionaba solo en UNA máquina; el plugin
   nativo de opencode eliminó la dependencia por completo.
2. **Un solo dueño para la adaptación de host**: la lógica de normalización +
   ejecución duplicada en dos plugins divergió (el de Kilo leyó los args del
   lugar equivocado). El adaptador compartido + un test de arquitectura que
   exige la delegación (los plugins NO importan `node:child_process`) lo
   blinda.
3. **`process.execPath` es el binario del host en Bun**, no Node. Usar `node`
   del PATH o `FLU_NODE`.
4. **Matchers y nombres de tool case-sensitive según el host**: opencode
   manda `write` minúscula y `filePath` camelCase; la puerta acepta todas las
   variantes y compara en minúscula, o queda muda en un host.
5. **Un guard sin fila en `guard-files.mjs` no es barrera** (pasaba en directo,
   `lint:guards` no lo corría: 2442 → 2447 tests al registrarlo).
6. **`GIT_DIR` en worktrees**: git exporta `GIT_DIR`/`GIT_INDEX_FILE` a los
   hooks y los commits reales de los tests de guards aterrizan en la rama del
   worktree. El `unset` al inicio del pre-commit lo evita; para cambios
   aislados, commitear en un clon normal.
7. **Tras resolver conflictos de listas por unión, grep de duplicados** (la
   misma entrada terminó dos veces en `GUARD_FILES` tras dos merges distintos).
8. **Los tests de la barrera deben existir en la rama bajo prueba**: probar el
   gate en `main` con un fixture que solo vive en la rama feature da exit 0
   falso.
9. **La lista de guards fuera de package.json** (límite de 8191 chars de
   cmd.exe).
10. **Suite completa solo en CI/por el dueño**; en local se valida el módulo
    tocado.
11. **Un host sin API de hooks no tiene Puerta 1**: los hooks de Claude, el
    plugin de Kilo y el nativo de opencode no interceptan a Cline. La puerta
    previa se hace REAL con el guardian (mismas puertas, flags `--pretende-nuevo`
    / `--desde-vacio`) + protocolo manual en `.clinerules`; sin guardian, la
    puerta la aplica el host A MANO.

---

## 8. DoD (definición de terminado)

- La reinyección del escenario real bloquea en las 3 puertas (antes/después
  demostrado).
- La mutación de cada línea base se vuelve ROJA y su reversión VERDE.
- `lint:guards` y el gate de pre-commit incluyen el guard nuevo (conteo
  verificado).
- El criterio (umbrales, catálogo, línea base) se lee de la referencia: el
  mismo cambio no lo debilita.
- La validación EN VIVO (host real, DoD del dueño) queda reservada al dueño.
