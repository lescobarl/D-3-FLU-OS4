# AGENTS.md — Reglas de ingeniería (fuente única y vinculante)

> Archivo ÚNICO de constraints. Se cumple íntegro antes de cualquier operación.
> No hay reglas duplicadas en otros archivos. Donde no pueda cumplirse una regla,
> el agente SE DETIENE y pregunta; nunca la silencia ni la maquilla.
> Si otra fuente (chat, README, `kilo.json`, comandos) contradice este archivo,
> prevalece la formulación más estricta de este archivo.

**Versión:** 8.0 · **Última actualización:** 2026-09-22

---

## Anexo 0 — Hechos del proyecto (dato verificable, no regla)

> Estos valores se ajustan por proyecto; las reglas de abajo son genéricas y se
> leen contra esta tabla. Ningún valor de esta tabla puede hardcodearse en el código.

| Hecho | Valor |
|-------|-------|
| Tipo | Frontend SPA/PWA. **Sin backend en este repo.** |
| Lenguaje/Build | TypeScript 6 estricto · Vite 8 · React 19 |
| Routing/Estado/DB | React Router v6 · Zustand 5 · Dexie 4 (IndexedDB) |
| Estilos | CSS propio (sin Tailwind) |
| Idioma | `es` / `en` / `both`, UN selector en la cabecera (`App.tsx`, `aria-label="Idioma"`); sin librería i18n |
| IA/Medios locales | `@huggingface/transformers`, Whisper WASM (workers), `tesseract.js`, `pdfjs-dist` |
| Testing | Vitest 3 + React Testing Library · Playwright (E2E) |
| Node | 20 (el de CI) |

**Comandos del proyecto (única fuente de verdad de los gates):**

| Acción | Comando |
|--------|---------|
| Dev | `npm run dev` |
| Tipos | `npm run typecheck` |
| Guards | `npm run lint` |
| ESLint | `npm run lint:eslint` |
| Test rápido (archivo tocado) | `npm run test:file <ruta>` |
| Suite completa (solo al cierre/CI) | `npm run test:full` |
| Gate de contrato (obligatorio) | `npm run gate` |
| Ledger de pendientes (leer) | `npm run ledger` |
| Ledger: sincronia vs git | `npm run ledger:check` |
| E2E | `npm run e2e` |
| Build | `npm run build` |

**Barrera real (no depende de buena voluntad):** `.git/hooks/pre-commit` -> `lint` + `typecheck`
(ligero, por commit, AGENTS.md seccion 5); `.github/workflows/ci.yml` -> `lint`, `typecheck`,
`test:full`, `build`, `e2e`. `npm run gate` es de **cierre de tarea** (valida UN contrato contra
su base), NO un gate de repo: no se ejecuta en CI ni en cada commit.

**Ledger de pendientes (fuente unica de lo que falta):** `plans/ledger.json` (git-tracked)
registra pendientes y cierres. El **chat y su resumen NO son fuente**: se compactan y
descartan, por eso un pendiente que solo vive en la conversacion se pierde. `scripts/task-ledger.mjs`
(`npm run ledger:check`) es la barrera: falla si un commit de cierre no esta en el ledger, si un
`done` apunta a un commit inexistente o si un pendiente no cita evidencia. Guard:
`tests/taskLedgerGuard.test.ts`. Toda sesion **empieza leyendo el ledger y `git log`**.

**Registro único de excepciones capturadas:** todo `catch` registra por
`logCaughtError(contexto, ...detalles)` (`src/lib/caughtError.ts`). Es la vía por
la que un `catch` deja de ser silencioso (§2.6). `console.*` **no** cuenta como
registro; `catchSilenciosoGuard` lo verifica. El helper no importa nada de forma
estática (carga el relay de forma diferida) para no cerrar el ciclo
`fluConfig -> sharedConfig -> caughtError -> clientLogRelay -> fluConfig`.

---

## 0. PROTOCOLO DE VERDAD Y EJECUCIÓN

**Principio:** mentir debe ser más caro que decir la verdad. Todo lo de abajo existe para eso:
no depende de la buena voluntad; vive en el repo y en comandos verificables.

### A. Conducta

1. **Dos niveles de "hecho" (no confundir):**
   - **DoD-técnico** (comando/gate): lo cierra el **agente**.
   - **DoD-producto** (pantalla/uso real): lo cierra **el usuario**.
   El agente **solo adjunta evidencia**; **nunca** declara el de producto. Sin
   confirmación del usuario el estado es: `en progreso: hice X, falta Y`.
2. **Toda afirmación cita su fuente:** comando + salida real copiada, o
   `archivo:línea`. **Sin fuente no se afirma nada.**
3. **Si no sabes: UNA pregunta con propuesta por defecto y paro.** Prohibido
   inventar; prohibido encadenar preguntas hasta paralizar.
4. **Parcial honesto:** `No lo hice; hice solo X parcial en [archivo:línea]`.
   Reportar parcial **nunca** se penaliza; disfrazarlo, sí.
5. **Si algo tuyo rompe:** revertir **ESE hito**, mostrar el `git diff` real y
   re-medir. Sin reverts silenciosos ni "ya lo arreglé" sin evidencia.
6. **Distinguir HECHO de SUPUESTO.** Etiquetar explícito: `HECHO` (con fuente) vs
   `SUPUESTO` (sin verificar). **Un supuesto no cierra nada.**
7. **Autonomía sin el usuario:** el sustituto de "mi pantalla" es **evidencia
   cruda** (log real, `curl`, fila real en DB, salida del gate), definida y
   aprobada por tarea. Si no hay sustituto, el hito queda **no validado**.
8. **Cierre en lugar inmutable:** commit/PR **y**, durante el trabajo,
   `.task/report` **append-only**. No basta el chat.

### B. Mecánica anti-maquillaje (lo que vuelve §A imposible de fingir)

9. **Contrato ANTES de tocar código**, con 4 campos: **objetivo único, DoD,
   alcance y guard**. Sin contrato, no se empieza.
10. **DoD = comando con valor esperado, no descripción.** Se registra el valor
    **ANTES** y **DESPUÉS**. Si el valor no cambió, **la tarea no está hecha**.
11. **Guard primero, EN ROJO.** Nace fallando mientras exista la duplicación
    (`N>1`) y enumera los duplicados **programáticamente** como
    `archivo:símbolo:línea`. **Si nace verde, la tarea no está definida.**
12. **Guard de COMPORTAMIENTO obligatorio.** Todo invariante crítico necesita
    **≥1 test que EJECUTE el flujo** (no solo conteo por nombre). Un guard de
    conteo **no cierra solo**.
13. **Tabla de invariantes obligatoria** (antes de empezar, aprobada por el usuario):

    | # | Invariante (una frase) | Comando (valor HOY) | META | Guard (hoy ROJO) |
    |---|------------------------|---------------------|------|------------------|
    | 1 | `<...>`                | `rg ... \| wc -l = N` | 0/1 | test que lista duplicados |

14. **Métrica, contrato y guard CONGELADOS por hash.** El agente **no** elige el
    comando de medición ni puede editarlo. **Enmienda formal:** declarar el
    cambio, re-aprobar el usuario, **nuevo hash** y **reiniciar el hito**.
15. **Baseline de fallos** capturado antes de tocar nada. Cierre = **0 fallos
    NUEVOS** (no "0 fallos"). Los preexistentes se documentan como **deuda** y no
    se "arreglan" salvo que el DoD lo pida, ni se usan como excusa.
16. **Alcance cerrado.** El contrato fija `allow` y `deny`. `.task/**` y el gate
    son **inmutables por el agente**. La **única fuente** del contrato es
    `.task/contract.json`; lo pegado en el chat **se ignora**.
17. **"Equivalente de mi pantalla" por tarea** (no visual): salida cruda de
    comando, fila real en DB, o salida del gate — **definido y aprobado** antes de
    empezar. Es el ground truth cuando no hay UI.
18. **Checkpoint / rollback.** Commit o backup **antes** de un hito riesgoso. Si
    el hito rompe: **revertir ESE hito** (mostrando el diff) y re-medir.
19. **Modo LIGHT vs FULL.**
    - **LIGHT** (docs, typos, formato): sin guard; cierre con `git diff`.
    - **FULL** (lógica, arquitectura, duplicación): todo este protocolo.
    El modo se declara en el contrato.
20. **La barrera vive en el repo, no en la buena voluntad:** pre-commit hook + job
    de CI que ejecutan el gate. Reglas en el chat son promesas; en el repo, son
    **imposibilidad de mentir**.
21. **Ledger de pendientes (fuente unica, no el chat).** Todo pendiente y todo
    hallazgo fuera de alcance se registra en `plans/ledger.json` **al detectarlo**,
    no al final. Toda sesion **empieza leyendo el ledger y `git log`**; el resumen
    del chat es contexto **no confiable** (se compacta y descarta). Prohibido
    afirmar "esto ya se hizo / esto no se hizo" sin citar el ledger o el commit.
    `npm run ledger:check` + `tests/taskLedgerGuard.test.ts` lo impiden.

### C. Contrato (formato mínimo)

```jsonc
{
  "id": "T-###",
  "mode": "full",                       // "light" | "full"
  "objective": "<una frase>",
  "dod":      { "command": "...", "expect": "valor o regex" },
  "guard":    { "command": "...", "expect": "0", "mustStartRed": true,
                "behavior": "tests/<flujo>.test.ts" },   // test que EJECUTA el flujo
  "groundTruth": { "command": "...", "expect": "..." },    // equivalente de "mi pantalla"
  "baseline": { "command": "...", "failPattern": "\\bFAIL\\b" },
  "invariants": [
    { "id": "I1", "statement": "<una frase>", "count": "rg ... | wc -l",
      "today": 3, "target": 1, "guard": "tests/<...>.test.ts" }
  ],
  "allow":    ["src/**", "tests/**"],
  "deny":     [".task/**", "scripts/task-gate.mjs"],
  "frozen":   { "contractHash": "<sha256>", "guardHash": "<sha256>" }
}
```

### D. Paro (cuándo detenerse)

- **Falta información real** → 1 pregunta con propuesta por defecto → **paro**.
- **DoD no cumplible** → **PARAR y decirlo**; prohibido sustituir, ampliar o
  maquillar alcance; prohibido entregar una versión más fácil "de paso".
- **Guard no nace rojo** → la tarea **no está definida**; no se empieza.
- **La métrica no baja** tras el hito → **revertir el hito** y re-planificar.
- **Algo validado se rompe** → revertir, mostrar `git diff`, corregir de raíz.
- **Se termina el alcance permitido** → parar y pedir enmienda (nuevo hash).

### E. Cierre (obligatorio)

Formato fijo, corto en el chat y en el lugar inmutable (commit/PR + `.task/report`):

```
Cambios aplicados: <lista>
Validado contra: <comando + salida cruda ANTES/DESPUÉS; guard; baseline y 0 nuevos>
No validado: <lo que falta — típicamente el DoD-producto, "pendiente del usuario">
```

Evidencia cruda: `git diff --stat` · salida del **DoD** ANTES y DESPUÉS · salida
del **guard** (rojo → verde) · **baseline** de fallos preexistentes y confirmación
de **0 nuevos**.

> El **DoD-producto** (pantalla del usuario) queda **reservado al usuario**. El
> agente cierra lo técnico; **no** declara lo de producto.

---

## 1. VERDAD Y VALIDACIÓN

1. **Nada se notifica como concluido sin validación real productiva.** Validar =
   pruebas funcionales + auditoría visual/técnica, contra el sistema vivo. No basta
   compilar ni pasar tests.
2. **Palabras PROHIBIDAS para el agente:** "listo / hecho / funciona / resuelto /
   100% / terminado / concluido / unificado / ya quedó". Reemplazo obligatorio de
   cierre: `Cambios aplicados · Validado contra · No validado`.
   Cuando no se hizo lo ordenado: `No lo hice; hice solo X parcial en [archivo:línea]`.
   Reportar un avance parcial honesto jamás se penaliza.
3. **"Listo" lo declara el USUARIO al verlo.** Sin su confirmación el estado es
   "en progreso". La validación técnica no es condición suficiente.
4. **Toda afirmación cita su fuente:** comando + salida real copiada, o `archivo:línea`.
5. **La verdad es la pantalla del usuario, no los logs.** Si el usuario reporta que
   no coincide, se le cree y se re-investiga. Nunca insistir con el dato propio.
6. **Prohibido validar solo con mocks.** Validar contra el artefacto real ejecutable
   del proyecto (ver Anexo 0). Un mock no cierra ningún DoD.
7. **Evidencia estructural por hito:** `git diff` real + conteo ANTES/DESPUÉS de la
   invariante. Un hito sin evidencia NO existe: se revierte y se para.
8. **Si un cambio propio rompe:** se anuncia, se revierte mostrando el diff y se
   corrige de raíz. Cero disculpas: se corrige.

## 2. PROHIBICIONES ABSOLUTAS

1. **No entregas parciales**: toda tarea se entrega completa y validada según la
   solicitud.
2. **No hardcode**: toda configuración viene de variables de entorno, archivos de
   configuración o inyección de dependencias.
3. **No parches ni soluciones temporales**: todo error se corrige de fondo, en su
   causa raíz. Cero workarounds para casos de borde.
4. **No `new` en lógica de negocio**: toda dependencia se inyecta por interfaces.
5. **No commits directos a `main`/`master`**: flujo con ramas `feature/*`.
6. **No try-catch vacíos** ni que silencien errores: toda excepción se captura, se
   registra en el log de auditoría y se propaga con contexto descriptivo.
7. **No modificar +2 archivos de dominio sin interfaz común**: primero se propone el
   diseño de interfaz que los unifica.
8. **No cambios temporales ni rutas dobles**: nada de archivos duplicados, comentarios
   legacy, implementaciones paralelas ni rutas en paralelo para el mismo recurso.
   Una única fuente de verdad por intención.
   **OJO:** una *cadena de respaldo* (proveedor 1 → 2 → 3, ordenada, en config, con un
   solo orquestador) **NO es una ruta doble**: es resiliencia y se conserva. Ver §7.7.
9. **No borrado físico en offline**: el borrado es lógico (`deleted: true`).
10. **No basura en el proyecto**: depuración de código y archivos muertos, duplicados
    u obsoletos. Git es el backup; no se crean copias manuales por iteración.
11. **No tests arbitrarios ni duplicados**: cada test cubre un caso real y único.
12. **No grandes respuestas**: resumen claro y preciso; detalle solo cuando se pide.
13. **No errores de programación/lógica/implementación**: el código se entrega
    correcto, validado y sin defectos.
14. **No `timeout: null`** en comandos: rápidos ≤30s, instalaciones ≤120s. Servidores
    largos: timeout de 15-30s solo para verificar arranque y luego verificar con otro
    comando. `timeout: null` bloquea el chat.
15. **No declarar verde con warnings `act()`** ni tests dependientes de timing: tests
    deterministas (fake timers, `act()`), sin depender de la carga de la máquina.
16. **No dejar procesos largos colgados**: identificar el PID exacto y terminar ese PID.
    Nunca `pkill`/`taskkill` por palabra genérica.

## 3. OBLIGACIONES ESTRICTAS

1. **Inyección de dependencias** por interfaces.
2. **JSDoc en todo componente/método nuevo**: contrato de la interfaz, no implementación.
3. **Responsabilidad Única (SRP)**: cada archivo/clase con una única razón de cambio.
4. **Test de inmutabilidad** por pieza: la arquitectura sigue agnóstica al negocio.
5. **Log de auditoría** inmutable para todo cambio de configuración.
6. **UUIDv4 en toda inserción**: prohibidas llaves numéricas secuenciales.
7. **Tupla de sincronización** en cada tabla: `[revision, updated_at, deleted]`;
   `revision` incrementa atómicamente y `updated_at` se actualiza en UTC.
8. **Gestión de errores con contexto** (ver §2.6).
9. **Aislamiento de contexto de IA**: cada inferencia inicia contexto ciego; purgar
   estado global residual antes de cada llamada.
10. **Circular Buffer en audio**: vaciado cíclico cada 30s contra fugas de memoria.
11. **requestAnimationFrame para 3D**: renderizado aislado; comunicación con IndexedDB
    vía `postMessage`.

## 4. CONVENCIONES DE CÓDIGO

- Archivos: `PascalCase` componentes, `camelCase` hooks/utils. Un componente por archivo.
- Estructura: `src/modules/[bloque]/[modulo]/Componente.tsx`.
- Interfaces con prefijo `I`; tipos sin prefijo. Tipos en `src/types/[dominio].ts`.
- EOL: conserva la del fichero. El repo es mixto (`core.autocrlf=false`, sin `.gitattributes`): hay blobs en LF y en CRLF. Cambiar la clase EOL hace que git marque TODO el fichero como modificado y que el diff del gate reviente por tamaño. El `eolGuard` lo pilla respecto al índice, pero tras commitear el flip deja de verlo: no te fíes de un diff de miles de líneas.

## 5. VALIDACIÓN, ITERACIÓN Y CI

### Iteración rápida (por cambio, no toda la suite)
- `npm test` ejecuta SOLO los tests del cambio (`--changed`); la suite completa es
  `npm run test:full`, reservada al gate de entrega (CI/push), nunca por commit.
- `npm run test:file <ruta>` para el archivo en curso.
- E2E acotado al bloque: `npm run e2e:plan` (dry-run) y `npm run e2e:scoped`
  (ejecuta) corren SOLO los specs tocados, usando el reparto declarado en
  `.task/contract.json -> e2eScope`. Si un fichero de `src/` cambia y no declara
  qué spec lo cubre, el runner FALLA: nunca corre a ciegas ni recorta en silencio.
  La suite E2E completa queda para el gate de entrega, igual que `test:full`.
- EOL: el trinquete (`tests/eolGuard.test.ts`) compara el árbol con el índice de
  git. Los editores pueden cambiar la clase EOL de un fichero al guardarlo; si eso
  pasa, se normaliza al índice; no se "arregla" el guard.
- Puerta de tipos (`npm run typecheck`) en cada iteración; un error de tipos es error
  de entrega.
- Guard estructural del protocolo: `tests/protocolGuard.test.ts`.
- Commit por hito funcional en verde; cambios independientes en paralelo en un mismo turno.

### Gates
- Pre-commit LIGERO (nunca la suite completa): `npm run lint` (guards) + `npm run typecheck`.
  El hook vive versionado en `.githooks/pre-commit` y se activa con `core.hooksPath`
  (script `prepare`); antes existia solo en `.git/hooks`, asi que no viajaba con el repo.
- Gate de contrato: `npm run gate` es la barrera de CIERRE de una tarea. Requiere un
  contrato activo (`.task/contract.json`) con su base declarada, por lo que NO corre por
  commit ni en CI: fallaria en cuanto el arbol avanza respecto a esa base.
- CI (`.github/workflows/ci.yml`): `npm run lint`, `npm run typecheck`, `npm run test:full`,
  `npm run build`, `npm run e2e`. La cobertura de repo la dan guards, tipos y suite.
  `npm run test:full`, `npm run build`, `npm run e2e`.
- Antes de declarar entrega, el CI DEBE estar en verde (o suite completa corrida una vez
  en el cierre).

### Rendimiento de suite
- Tests de lógica pura en `environment: 'node'`; solo componentes usan `jsdom`. Cero
  warnings `act()`. Carga perezosa de dependencias pesadas. `"incremental": true` +
  `tsBuildInfoFile` en caché para typecheck caliente.

### Ahorro de tokens (contexto mínimo)
- Leer solo fragmentos necesarios; **prohibida la re-lectura** de lo ya mapeado en la
  sesión. Si falta un dato exacto, se lee solo el fragmento/línea nuevo. Modelo adecuado
  por tarea. Razonar antes de ejecutar; prohibido lanzar comandos a ciegas. No arrastrar
  contexto de tareas terminadas.

## 6. ENTREGA Y FOCO

1. **Criterio de aceptación por escrito antes de tocar código** (1-2 líneas de qué verá
   el usuario cuando esté bien). Un "adelante / valida / ejecuta" sobre tarea descrita
   cuenta como aceptación.
2. **Una sola tarea a la vez, sin desvíos.** Hallazgo fuera de alcance → se anota al final
   (`archivo:línea`) y se sigue la tarea.
3. **"No afectar lo validado" se demuestra con tests**; no es excusa para evitar el cambio.
4. **"Ejecuta / hazlo" = primera tool call en esa misma respuesta, sin texto previo**
   (máx. 1 línea). La explicación va DESPUÉS. Excepción única: falta información real →
   una pregunta y stop.
5. **No detenerse ante complejidad**: con diagnóstico + localización, se ejecuta completo
   ahora; la validación visual la hace el usuario después.
6. **Cumplir el objetivo completo** (no basta "compila / pasan tests"). Cada cambio se
   anuncia ANTES (archivo + intención) y se muestra DESPUÉS con `git diff` real. Sin
   decisiones ocultas ni reverts silenciosos.

## 7. EVIDENCIA ESTRUCTURAL (anti-cascada de parches)

1. **Criterio de aceptación NUMÉRICO, no visual** (verificable con un comando). Lo visual
   es complementario, nunca sustituto.
2. **Evidencia por hito:** (a) `git diff` real y (b) conteo ANTES/DESPUÉS de la invariante.
   Si el conteo no bajó, el hito es cosmético: se rechaza aunque se vea perfecto.
3. **La invariante se mide en CADA hito**, no al final.
4. **Cada 2-3 hitos el USUARIO re-ejecuta la misma medición.** Aprobaciones previas no son
   evidencia de la siguiente fase.
5. **Hito sin evidencia → revertir ESE hito y parar.** Alcance corto por hito; si se alarga
   sin reducir la invariante, detenerse y re-planificar en voz alta.
6. **Guard automatizado** en toda unificación/refactor que falle si hay N>1 implementaciones
   del símbolo/ruta. Un guard que falla solo es la única barrera que el agente no puede
   maquillar.
7. **Rutas dobles vs. cadenas de respaldo (NO confundir — prohibido borrar respaldos).**

   | | **Ruta doble (MALO)** | **Cadena de respaldo (BUENO, se conserva)** |
   |---|---|---|
   | Qué es | La MISMA responsabilidad implementada N veces | N proveedores **distintos** con roles **distintos** |
   | Riesgo | Pueden divergir (estado inconsistente) | Degradación controlada ante fallo |
   | Ejemplo real aquí | `normalizeForMatch` en 2 sitios; `resolveGeminiApiKey` en 2; allowlist `['wikipedia.org','educ.ar']` copiada en consumidores | Búsqueda web **Tavily → OpenRouter web → Wikipedia** (keyless) |
   | Dónde vive | Copias dispersas por consumidor | **Un** orquestador + orden en **config** |

   **Ejemplos verificados en este repo (HECHO, se conservan):**
   - Búsqueda web: cadena declarada en `src/voice/lib/fluConfig.js:1171` (`Tavily (1) →
     OpenRouter web (2) → Wikipedia (3)`), resuelta por **un solo** orquestador
     `resolveSearchProviders` (`src/core/search/searchSession.ts:148`), consumido por el
     proxy (`src/server/searchProxy.ts:172`).
   - Imagen: `pollinations` (primario) → `OpenRouter image` (respaldo servidor) → `localSvg`
     (último recurso, gobernado por `shouldUseLocalSvgOnError`), orquestado en
     `src/voice/lib/imageGeneration.js` y declarado en `src/voice/lib/visualConfig.js`
     (`errorFallback: 'localSvg'`).
   - Avatar: `fbxWorkerClient` usa worker con `runMainThreadFallback` (mismo resultado, no
     un segundo parser).

   **Regla de decisión (una frase):** si los N caminos producen *lo mismo por el mismo
   motivo*, es ruta doble → se unifica a 1. Si producen *lo mismo por motivos distintos y en
   orden de prioridad ante fallo*, es respaldo → se conserva.

   **Requisitos de una cadena de respaldo válida** (si falta uno, es parche y se corrige):
   1. **Un solo orquestador** que recorre el orden; el consumidor no ve proveedores.
   2. Orden y proveedores en **config** (no literales dispersos por consumidor).
   3. Cada eslabón con **rol y fallo distintos** (no la misma llamada repetida).
   4. **Finita y explícita**: último recurso declarado (p. ej. `localSvg` / Wikipedia keyless).
   5. Test que fija el **orden** y que el fallo del eslabón 1 pasa al 2.

   **Prohibido:** eliminar o "unificar" un eslabón de respaldo como si fuera duplicado.
   Antes de tocar cualquier candidato, clasificarlo con esta tabla y decirlo al usuario.

   **7.7.b — Respaldo mal implementado = ruta doble.** Un respaldo legítimo **en la intención**
   sigue siendo ruta doble **si la orquestación está copiada**. Si el mismo `fetch` + mismo
   chequeo + mismo `parse` + **mismo literal de error** están escritos en 2 archivos en vez de
   en **una** función compartida, es ruta doble: se extrae la función y ambos caminos la llaman.
   Conteo de orquestaciones: **2 → 1**. (Caso real: worker FBX vs fallback main-thread en
   `src/avatar/workers/`.)

   **7.7.c — Un dominio, un almacén.** La misma entidad persistida en **dos sistemas** (Dexie +
   localStorage, o Dexie + store en memoria) **no es respaldo**: es ruta doble de datos y produce
   divergencia. Un almacén es **de registro**; los demás solo se justifican como **caché con
   caducidad** o **copia de seguridad explícita**, y en esos casos se declara cuál es la fuente
   y cómo se reconcilia. Prohibido que un "backup" escriba en un almacén derivado y **no** en el
   de registro mientras devuelve `true` (mentira de respaldo).

   **7.7.d — El guard mide IMPLEMENTACIONES, no literales.** Un guard que cuenta un literal
   (`/speechSynthesis/`) en vez de la implementación (los sitios que construyen la salida) es
   **teatro**: se satisface con otro identificador, otro `case`, otro archivo o una fachada.
   Obligatorio: (1) el patrón debe alcanzar **todas** las formas reales del símbolo
   (`new SpeechSynthesisUtterance`, `getSpeechEngine`, `synth.speak(...)`), no una sola;
   (2) **case-insensitive** cuando el lenguaje lo permita; (3) alcance **todo** `src`, sin
   excluir la carpeta donde vive el duplicado; (4) **prueba de mutación**: se inyecta el
   duplicado y el guard DEBE ponerse ROJO; si sigue verde, el guard no sirve y se rehace.
   Caso real: `ttsPuntoUnicoGuard` + `audit-metric.mjs` midieron `/speechSynthesis/` (1 archivo,
   verde) mientras existían **2** puntos de síntesis (`fluSpeech.js`,
   `src/services/localTts.ts`) — invisibles por mayúsculas y por delegación del motor.

   **7.7.e — Clasificación pura: no la fuerces por el gate.** Si un item pide *clasificar* N
   símbolos (no unificarlos), su métrica es "sin clasificar" y puede estar YA en 0 cuando el item
   se abre: la clasificación se hizo en commits anteriores y el ledger nunca la cerró (item
   fantasma). Compruébalo antes de escribir código (`node scripts/auditoria.mjs --only D0`). Dos
   hechos aprendidos midiendo:
   (1) el gate **copia** los `guardFiles` al worktree base. Un veredicto que vive *dentro* del
   guard no distingue base de actual (métrica base=0 actual=0, y el guard pasa en base): el
   veredicto tiene que vivir en el código medido, no en el guard.
   (2) Sin reducción disponible, se cierra como **medición** (tabla por símbolo + comando
   reproducible) citando el commit donde la clasificación aterrizó. Empujarlo por el gate produce
   un hito cosmético que §7.2/§7.5 rechazan.
   (3) Los catálogos y medidores (`scripts/auditoria.mjs`, `audit-metric.mjs`) **no** los corre el
   gate: una clasificación que solo vive ahí es prosa, no barrera. Si lo que quieres es una
   barrera, la lista tiene que estar donde el gate mira (`lint:guards`) y sobre el código medido.

   **7.7.f — Un guard fuera de `lint:guards` no es una barrera: se pudre.** Medido en esta
   sesión: `tsStrictGuard` (C49) y `dexieSchemaGuard` (C46) existían, estaban ROJOS en HEAD y
   nadie lo veía, porque la barrera solo corre los ficheros listados en `lint:guards`. Daño
   real: P1.4 movió el esquema a `DEXIE_VERSIONS` y dejó su propio guard leyendo llamadas
   `.stores({...})` que ya no existen; el guard resolvía **0** tablas, así que "no hay legacy
   vivas" pasaba por **vaciedad** (`undefined !== 'declared'`) mientras el otro test fallaba
   con `undefined`. En el mismo sitio, la misma unificación dejó un `as unknown as` que C49
   prohibe. Cuatro reglas:
   (1) Todo guard que exista se lista en `lint:guards` o se borra: un guard que nadie corre es
   prosa con sintaxis de test. Antes de dar por verde una sesión, busca huérfanos
   (`tests/*Guard*.test.ts` contra `package.json`).
   (2) **Anti-vaciedad explícita.** Además de "no veo el defecto", el guard debe exigir que ve
   la FUENTE (`resuelve >15 tablas`) y que el defecto EXISTIÓ (`declared` y después `deleted`).
   Sin eso, un detector sordo pasa el mismo test que un código limpio.
   (3) **Reparar un detector no cabe en la maquinaria de invariante.** Si el código ya está
   bien y lo roto es el criterio, no hay 1→0 que medir en `src`, y el guard nuevo pasaría
   también en `base` (el gate copia el guard al worktree base): eso es un **contrato sin
   `invariant`**, y su evidencia es el antes/después del detector (0 → 26 tablas) más las
   exigencias anti-vaciedad, nunca una métrica forzada. Endurecer el criterio permite actualizar
   su hash en `frozen.json` en el mismo commit.
   (4) Al parchear ficheros con script, respeta su EOL: `eolGuard` detecta el "mixed" (salta al
   insertar con `\n` en un fichero CRLF) y el gate no cierra. Normaliza antes de commitear.
   (5) **Un detector de higiene también SOBRECUENTA: mide el falso positivo antes de "arreglarlo".**
   Medido en P6.9: los "91 TODO" de `src` eran la palabra española TODO/TODOS ("Se listan TODOS
   los estados"), y cuatro `plans/*.md` aparecían con "mojibake" que era arte ASCII legítimo
   (`├──`, `│`, `─┐`). En los dos casos, el defecto era el detector del audit, no el código
   señalado: cerrar el hallazgo sin medirlo habría reescrito código sano. Un hallazgo se cierra
   midiendo; si es falso positivo, lo que se corrige es el DETECTOR, y su prueba es que ve el
   defecto y NO marca lo legítimo (C53 lo hace por los dos lados).
   (6) **No escribas código con no-ASCII desde un heredoc de PowerShell**: llega a disco roto y
   deja mojibake. Medido: 12 ficheros versionados arrastraban 130 secuencias de UTF-8 mal
   decodificado, incluidas cuatro cadenas que FLU **pronuncia** por TTS (la de "Navegación
   curada" y la de "¿Qué querés que busque?" entre ellas). El daño se ve como parejas de
   caracteres de caja y griegos donde debería haber una vocal acentuada o una raya. Usa una
   herramienta que garantice UTF-8 (o escapes `\uXXXX`), y para reparar mide el codepage real
   en vez de suponerlo: aquí el que apareció fue **cp437**, no cp850 (el byte 0xE2 da la gamma
   en cp437 y una O acentuada en cp850). C53 vigila el residuo, así que este propio documento
   no puede citar las secuencias rotas en crudo: se describen por su code point.

## 8. CONTRATO DE TAREA Y VERIFICACIÓN POR COMANDO (anti-sustitución)

Toda tarea se ejecuta contra un contrato escrito ANTES de tocar código. Sin contrato no se
empieza. El contrato tiene 4 campos obligatorios: objetivo único, DoD, alcance y guard.

1. **DoD = comando, no descripción.** Cierre con la salida cruda del comando ANTES y
   DESPUÉS. Si el valor no cambió, la tarea NO está hecha.
2. **Guard primero, en ROJO.** Nace fallando mientras exista la duplicación (N>1) y pasa
   cuando queda en 1. Su mensaje lista los duplicados (`archivo:símbolo:línea`). Si el guard
   no nace rojo, la tarea no está definida.
3. **Baseline de fallos.** Antes de tocar nada se registra la lista de tests que YA fallan.
   La puerta de cierre es **0 fallos NUEVOS**, no "0 fallos". Los preexistentes se documentan
   como deuda y NO se "arreglan" salvo que el DoD lo pida.
4. **Prohibida la sustitución de alcance.** No se reemplaza la tarea pedida por una versión
   más fácil o parcial. Si el DoD no se puede cumplir, el agente SE DETIENE y lo dice.
5. **Alcance cerrado.** El contrato fija los archivos que se PUEDEN tocar y prohíbe el resto.
   Todo hallazgo fuera de alcance se ANOTA al final (`archivo:línea`) y se sigue la tarea.

**Cierre obligatorio:** (a) `git diff --stat` · (b) comando DoD ANTES y DESPUÉS · (c) salida
del guard · (d) baseline de fallos preexistentes y confirmación de 0 nuevos.

## 9. RECETA DE INVARIANTES (replicable en cualquier proyecto)

Para convertir un pedido difuso ("unifícalo", "una sola fuente") en algo verificable, el
agente DEBE producir, ANTES de tocar código:

1. **Intención en una frase.**
2. **Sustantivos contables**, no adjetivos: cuántos almacenes, decisiones, queries,
   productores. **Un eslabón de una cadena de respaldo NO cuenta como productor duplicado**
   (§7.7): primero se clasifica, luego se cuenta.
3. **Número HOY y META**: comando que lo cuenta (`rg -n ...`) y valor actual; meta natural
   `1` (unificar) o `0` (eliminar). Prohibidos umbrales inventados.
4. **Guard que nace ROJO** por invariante, listando `archivo:símbolo:línea`.
5. **Hito = 1 invariante:** `git diff --stat` + conteo ANTES/DESPUÉS; si el conteo no baja,
   el hito se revierte.
6. **Cierre:** guard verde + 0 fallos nuevos.

Plantilla para pedirlo (pegable):

```
Antes de tocar código, dame un contrato con:
1) objetivo en una frase;
2) por cada duplicación: comando que la cuenta, valor HOY y META (0 o 1);
3) por cada invariante, un guard que HOY falle y liste archivo:línea;
4) DoD = comando ejecutable con valor esperado;
5) un invariante por turno, con conteo ANTES/DESPUÉS;
6) no cerrar sin guard verde y 0 fallos nuevos;
7) congelar el criterio (hash del guard) para que no se cambie en silencio.
```

Regla corta: **cada duplicación con un número; cada número con un guard que nace rojo.**

## 10. VELOCIDAD DE INTERACCIÓN

1. **Evidencia en el primer mensaje.** Toda petición trae: entrada cruda + salida real
   observada + resultado esperado. Si falta, el agente hace UNA pregunta con propuesta por
   defecto y para.
2. **Prohibido volcar contexto completo.** Nunca leer ni pegar un archivo, log o listado
   entero si basta un fragmento. Se lee la línea/bloque nuevo.
3. **Ventana mínima de logs.** De un log se lee SOLO la marca o línea relevante; jamás el
   buffer completo.
4. **Verificación por niveles.** (a) test del archivo tocado; (b) typecheck incremental;
   (c) gate/suite completa SOLO al cierre. No correr todo por cada edición.
5. **No re-verificar lo ya verde.** Prohibido repetir un comando ya verde sin que el código
   haya cambiado.
6. **Delegar lo instrumental.** Búsquedas, exploración de símbolos y lectura de logs se
   delegan a subagentes (en paralelo cuando son independientes); el principal sintetiza.
7. **Instrumentación puntual, no trazas masivas.** Marcas concretas y apagadas por defecto.
   Un log que inunda es un defecto.
8. **Modelo/razonamiento proporcional a la tarea.** Ligero para cambios mecánicos; profundo
   solo para diagnóstico o diseño.
9. **Salida corta y de formato fijo** (ver §0.E). Sin narrar el proceso, sin repetir el diff
   en prosa.
10. **Cerrar antes de abrir.** Ningún hito queda "pendiente de validar" mientras se empieza
    otro; se cierra con su guard verde.
11. **Ante ambigüedad costosa, decidir y avanzar** con el default declarado; el usuario
    corrige después.

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

**Guard verificable:** test que falle si N>1 criterios de deduplicación/commit de la misma
señal.

---

**Fin.** Ninguna regla de este archivo se silencia: lo que no se pueda cumplir se detiene y
se pregunta.
