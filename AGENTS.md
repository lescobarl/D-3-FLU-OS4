# Reglas Absolutas de Ingeniería

> Archivo ÚNICO y vinculante de constraints. Se cumple íntegro antes de cualquier
> operación. No existen reglas duplicadas en otros archivos ni comandos.
> Donde una regla no pueda cumplirse, el agente SE DETIENE y pregunta. Nunca la silencia.

---

## 0. PROTOCOLO DE VERDAD Y EJECUCIÓN (par de trabajo)

> **Fuente canónica del protocolo de ejecución.** Donde solape con §1/§8/§9/§10,
> prevalece la formulación más estricta. Este protocolo funde conducta (§A),
> mecánica anti-maquillaje (§B), contrato (§C), paro (§D) y cierre (§E).

**Principio:** mentir debe ser más caro que decir la verdad. Todo lo de abajo
existe para eso: no depende de la buena voluntad del agente; vive en el repo y en
comandos verificables.

### §A. CONDUCTA

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
   cruda** (logs reales, `curl`, fila real en DB, salida del gate), definida por
   tarea en §B17. Si no hay sustituto, el hito queda **no validado**.
8. **Cierre en lugar inmutable:** commit/PR body **y**, durante el trabajo,
   `.task/report` **append-only**. No basta el chat.

### §B. MECÁNICA ANTI-MAQUILLAJE (lo que vuelve §A imposible de fingir)

9. **Contrato ANTES de tocar código**, con 4 campos: **objetivo único, DoD,
   alcance y guard**. Sin contrato, no se empieza.
10. **DoD = comando con valor esperado, no descripción.** Se registra el valor
    **ANTES** y **DESPUÉS**. Si el valor no cambió, **la tarea no está hecha**.
11. **Guard primero, EN ROJO.** Nace fallando mientras exista la duplicación
    (`N>1`) y enumera los duplicados **programáticamente** como
    `archivo:símbolo:línea`. **Si nace verde, la tarea no está definida.**
12. **Guard de COMPORTAMIENTO obligatorio.** Todo invariante crítico necesita
    **≥1 test que EJECUTE el flujo** (no solo conteo por nombre). Lección real: un
    guard `9/9` convivió con el sistema **roto**. Un guard de conteo **no cierra
    solo**.
13. **Tabla de invariantes obligatoria** (antes de empezar, aprobada por el usuario):

    | # | Invariante (una frase) | Comando (valor HOY) | META | Guard (hoy ROJO) |
    |---|------------------------|---------------------|------|------------------|
    | 1 | `<...>`                | `rg ... \| wc -l = N` | 0/1 | test que lista duplicados |

14. **Métrica, contrato y guard CONGELADOS por hash.** El agente **no** elige el
    comando de medición ni puede editarlo. **Enmienda formal:** declarar el
    cambio, re-aprobar el usuario, **nuevo hash** y **reiniciar el hito**.
    Prohibido editar a escondidas.
15. **Baseline de fallos** capturado antes de tocar nada. Cierre = **0 fallos
    NUEVOS** (no "0 fallos"). Los preexistentes se documentan como **deuda** y no
    se "arreglan" salvo que el DoD lo pida, ni se usan como excusa.
16. **Alcance cerrado.** El contrato fija `allow` y `deny`. `.task/**` y el gate
    son **inmutables por el agente**. La **única fuente** del contrato es
    `.task/contract.json`; lo pegado en el chat **se ignora**.
17. **"Equivalente de mi pantalla" por tarea** (no visual): salida cruda de
    `curl`, fila real en DB, o salida del gate — **definido y aprobado** antes de
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

### §C. CONTRATO (formato mínimo)

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

### §D. PARO (cuándo detenerse)

- **Falta información real** → 1 pregunta con propuesta por defecto → **paro**.
- **DoD no cumplible** → **PARAR y decirlo**; prohibido sustituir, ampliar o
  maquillar alcance; prohibido entregar una versión más fácil "de paso".
- **Guard no nace rojo** → la tarea **no está definida**; no se empieza.
- **La métrica no baja** tras el hito → **revertir el hito** y re-planificar.
- **Algo validado se rompe** → revertir, mostrar `git diff`, corregir de raíz.
- **Se termina el alcance permitido** → parar y pedir enmienda (nuevo hash).

### §E. CIERRE (obligatorio)

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

## 1. VERDAD Y VALIDACIÓN (lo primero, siempre)

Núcleo anti-mentira. Cualquier otra regla se interpreta bajo esta sección.

1. **Nada se notifica como concluido sin validación real productiva.** Validar =
   pruebas funcionales + auditoría visual (captura de pantalla) + técnica, contra el
   sistema vivo. No basta compilar ni pasar tests.
2. **"Listo / hecho / funciona / resuelto / 100% / terminado / concluido / unificado / ya quedó"
   son palabras PROHIBIDAS para el agente.** Reemplazo obligatorio de cierre:
   `Cambios aplicados: [lista] · Validado contra: [qué y cómo] · No validado: [qué falta]`.
   Cuando no se hizo lo ordenado: `No lo hice; hice solo X parcial en [archivo:línea]`.
   Reportar un avance parcial honesto jamás se penaliza.
3. **"Listo" lo declara el USUARIO al verlo en su pantalla.** Sin su confirmación el
   estado es "en progreso: hice X, falta Y". La confirmación del usuario es condición
   necesaria para declarar entrega; la validación técnica no es suficiente.
4. **Toda afirmación cita su fuente**: comando + salida real copiada, o archivo:línea.
   Sin fuente no se afirma nada.
5. **La verdad es la pantalla del usuario, no los logs.** Si el usuario reporta que no
   coincide, se le cree y se re-investiga. Nunca insistir con el dato propio.
6. **Prohibido afirmar "funciona" validando solo con `TestClient`/mocks.**
   Validar SIEMPRE contra el backend real corriendo en `http://127.0.0.1:8000`
   (nunca `localhost`, que puede resolver a IPv6 `::1`) y contra la DB real del proceso.
7. **Evidencia estructural por hito**: `git diff` real + conteo ANTES/DESPUÉS de la
   invariante. Un hito sin evidencia NO existe: se revierte y se para.
8. **Si un cambio propio rompe**: se anuncia, se revierte mostrando el diff y se corrige
   de raíz. Prohibido esconderlo o declarar éxito falso. Cero disculpas: se corrige.

## 2. PROHIBICIONES ABSOLUTAS

1. **No entregas parciales**: toda tarea se entrega completa y validada según la solicitud.
2. **No hardcode**: toda configuración viene de variables de entorno, archivos de
   configuración o inyección de dependencias. Prohibidos valores quemados.
3. **No parches ni soluciones temporales**: todo error se corrige de fondo, en su causa
   raíz. Cero workarounds para casos de borde.
4. **No `new` en lógica de negocio**: toda dependencia se inyecta mediante interfaces.
5. **No commits directos a `main`/`master`**: flujo con ramas `feature/*`.
6. **No try-catch vacíos ni que silencien errores**: toda excepción se captura, registra
   en el log de auditoría y se propaga con contexto descriptivo.
7. **No modificar +2 archivos de dominio sin interfaz común**: primero se propone el
   diseño de interfaz que los unifica.
8. **No cambios temporales ni rutas dobles**: nada de archivos duplicados para prueba,
   comentarios de código legacy, implementaciones paralelas ni rutas en paralelo para el
   mismo recurso. Una única fuente de verdad por intención.
9. **No borrado físico en offline**: el borrado es lógico (`deleted: true`).
10. **No basura en el proyecto**: depuración diaria de código y archivos muertos,
    duplicados u obsoletos (`_time_*.py`, `probe_*.py`, outputs a `.txt`, backups).
    Git es el backup; no se crean copias manuales por iteración.
11. **No tests arbitrarios ni duplicados**: cada test cubre un caso real y único de la
    especificación. No se duplican coberturas ni se inventan pruebas.
12. **No grandes respuestas**: resumen claro y preciso; detalle solo cuando se pide.
13. **No errores de programación/lógica/implementación**: el código se entrega correcto,
    validado y sin defectos.
14. **No `timeout: null`** en comandos: rápidos ≤30s, instalaciones ≤120s. Servidores
    largos (vite, npm start, etc.): timeout de 15-30s solo para verificar arranque y
    luego verificar con otro comando. `timeout: null` bloquea el chat.
15. **No declarar verde con warnings `act()` ni tests dependientes de timing**:
    tests deterministas con `act()`, fake timers y sin depender de la carga de la máquina.
16. **No ignorar backend "vivo pero inaccesible" en Windows** (bug IocpProactor): puerto
    en LISTENING sin responder HTTP (curl → 000) = proceso zombie. Matar con
    `taskkill /PID <pid> /F` y reiniciar con `python run_dev.py`
    (fuerza `WindowsSelectorEventLoopPolicy`).

## 3. OBLIGACIONES ESTRICTAS

1. **Inyección de dependencias** por interfaces (refuerza prohibición 2.4).
2. **JSDoc en todo componente/método nuevo**: contrato de la interfaz, no implementación.
3. **Responsabilidad Única (SRP)**: cada archivo/clase tiene una única razón de cambio.
4. **Test de inmutabilidad** por pieza: valida que la arquitectura sigue agnóstica al
   negocio tras los cambios.
5. **Log de auditoría** inmutable para todo cambio de configuración.
6. **UUIDv4 en toda inserción**: prohibidas llaves numéricas secuenciales.
7. **Tupla de sincronización** en cada tabla: `[revision, updated_at, deleted]`;
   `revision` se incrementa atómicamente y `updated_at` se actualiza en UTC.
8. **Gestión de errores con contexto** (ver prohibición 2.6).
9. **Aislamiento de contexto de IA**: cada inferencia inicia contexto ciego aislado;
   purgar variables globales residuales antes de cada llamada.
10. **Circular Buffer en audio**: vaciado cíclico cada 30s contra fugas de memoria.
11. **requestAnimationFrame para 3D**: renderizado aislado; comunicación con IndexedDB
    vía `postMessage`.

## 4. STACK TECNOLÓGICO OBLIGATORIO

| Capa | Tecnología | Propósito |
|------|-----------|-----------|
| Lenguaje | TypeScript (estricto) | Tipado seguro |
| Build | Vite 5 + React 18 | Rapidez, HMR, PWA |
| Routing | React Router v6 | Navegación lazy |
| Estado | Zustand | Ligero, persistencia selectiva |
| DB Local | Dexie.js (IndexedDB) | Versioning, queries reactivas |
| Estilos | Tailwind CSS 3 | Utility-first, purge automático |
| PWA | vite-plugin-pwa | Service Worker, offline |
| Testing | Vitest + React Testing Library | Tests de inmutabilidad |
| 3D Avatar | Three.js + @react-three/fiber | Renderizado 3D offline |
| IA Local | WebLLM + Orama + Whisper WASM + Piper TTS + Rhubarb WASM | Edge computing |

## 5. CONVENCIONES DE CÓDIGO

- Archivos: `PascalCase` componentes, `camelCase` hooks/utils. Un componente por archivo.
- Estructura: `src/modules/[bloque]/[modulo]/Componente.tsx`.
- Interfaces con prefijo `I`; tipos sin prefijo. Tipos en `src/types/[dominio].ts`.

## 6. VALIDACIÓN, ITERACIÓN Y CI

### Iteración rápida (por cambio, no toda la suite)
- `npm test` → `vitest run --changed`; `npm run test:file <ruta>` para la tarea en curso;
  `npm run test:full` SOLO en el gate de entrega (CI/push), nunca por commit.
- Guard estructural: `frontend/src/test/protocolGuard.test.ts`.
- Puerta de tipos `tsc -b`/`--noEmit` en cada iteración; un error de tipos es error de entrega.
- Commit por hito funcional en verde; cambios independientes en paralelo en un mismo turno;
  diffs sobre bloques ya mapeados sin re-leer archivos.

### Gates
- Pre-commit LIGERO: lint-staged + typecheck incremental. Nunca la suite completa.
- Push/PR = entrega: CI ejecuta suite completa frontend + backend (`pytest -n auto` con
  cobertura, workers con DB temporal propia). Antes de declarar entrega, el CI DEBE estar
  en verde (o suite completa corrida una vez en el cierre).

### Rendimiento de suite
- Tests de lógica pura en proyecto Vitest `environment: 'node'`; solo componentes usan
  `jsdom`. Cero warnings `act()`. Medir antes de optimizar. Cache de transform compartido.
  Carga perezosa de dependencias pesadas (`axe-core` dentro de la función que la usa).
  `"incremental": true` + `tsBuildInfoFile` en caché para typecheck caliente.

### Ahorro de tokens (contexto mínimo)
- Leer solo fragmentos necesarios; no re-leer lo ya mapeado. Modelo adecuado por tarea
  (ligero para refactors triviales, docs y búsquedas). Razonar antes de ejecutar; prohibido
  lanzar comandos a ciegas. Mantener output de tests limpio. No arrastrar contexto de
  tareas previas terminadas.

### Windows
- `lint-staged`/`prettier`: "command line is too long" con muchos archivos → partir commits
  en lotes menores. `--no-verify` solo en consolidaciones puntuales ya validadas, nunca
  como práctica habitual.

## 7. ENTREGA Y FOCO (reglas del usuario)

1. **Criterio de aceptación por escrito antes de tocar código** (1-2 líneas de qué verá el
   usuario cuando esté bien). Sin criterio aceptado no se modifica nada. Un "adelante /
   valida / ejecuta" sobre tarea descrita cuenta como aceptación.
2. **Una sola tarea a la vez, sin desvíos.** Hallazgo fuera de alcance → se anota al final
   (`archivo:línea`) y se sigue la tarea. Correcciones extra solo tras aceptar la principal.
3. **Tarea grande/riesgosa** → se parte en pasos escritos y se pide OK por paso. Nunca
   reemplazar en silencio por una parte fácil ni abandonar la tarea ante la dificultad.
4. **"No afectar lo validado" se demuestra con tests** que cubren el cambio; no es excusa
   para evitar el cambio ordenado.
5. **"Ejecuta / hazlo" = primera tool call en esa misma respuesta, sin texto previo.**
   Antes: máximo 1 línea. La explicación va DESPUÉS. Prohibido en la respuesta de
   ejecución: análisis del error, mea culpa, "¿lo hago?". Excepción única: falta
   información real → una pregunta y stop.
6. **No detenerse ante complejidad**: con diagnóstico + localización, se ejecuta completo
   ahora; la validación visual la hace el usuario después. Prohibido "es delicado, ¿sigo?"
   o usar la regla 1.3 para no ejecutar. La regla 1.3 prohíbe DECLARAR listo, no ejecutar.
7. **Cumplir el objetivo completo** (no basta "compila / pasan tests"). Cada cambio se
   anuncia ANTES (archivo + intención) y se muestra DESPUÉS con `git diff` real. Sin
   decisiones ocultas ni reverts silenciosos.

## 8. EVIDENCIA ESTRUCTURAL (anti-cascada de parches)

La unificación NO es fase final: es una invariante que debe decrecer en cada hito.

1. **Criterio de aceptación NUMÉRICO, no visual** (verificable con un comando, p. ej.
   `grep -c 'handleContract' src` = 1). Sin criterio verificable la tarea no se define ni
   se empieza. Lo visual es complementario, nunca sustituto.
2. **Evidencia por hito**: (a) `git diff` real y (b) conteo ANTES/DESPUÉS de la invariante.
   Si el conteo no bajó, el hito es cosmético: se rechaza aunque se vea perfecto.
3. **La invariante se mide en CADA hito**, no al final.
4. **Cada 2-3 hitos el USUARIO re-ejecuta la misma medición** y la compara. Aprobaciones
   previas no son evidencia de la siguiente fase.
5. **Hito sin evidencia → revertir ESE hito y parar** hasta que el conteo baje.
   Alcance corto por hito (ej. "2 archivos + 1 grep"); si se alarga sin reducir la
   invariante, detenerse y re-planificar en voz alta.
6. **Guard automatizado** en toda unificación/refactor de raíz (patrón
   `tests/hardcodeGuard.test.ts`) que falle si hay N>1 implementaciones del símbolo/ruta.
   Un guard que falla solo es la ÚNICA barrera que el agente no puede maquillar.

## 9. PIEDRA INAMOVIBLE — TUBERÍA DE VOZ/TRANSCRIPCIÓN

Invariantes del usuario sobre la conversación por voz. Cualquier cambio en escucha,
transcripción, bitácora, burbuja del avatar, barra de búsqueda o query a la IA debe
CUMPLIR las 7 reglas y se verifica con el criterio numérico de §8 en cada hito:

1. **La escucha debe ser centralizada**: UNA sola instancia de reconocimiento
   (`speechRecognitionLocal`) para el flujo principal. Prohibido instanciar escucha en
   otros componentes (ej. onboarding) mientras la principal esté activa.
2. **Ningún otro elemento debe tener tratamiento sobre la escucha/transcripción**:
   normalización, deduplicación y commit de la frase viven en UN solo lugar (el motor de
   voz). Prohibido re-normalizar la frase en consumidores (App, views, memoria LLM).
3. **Lo que se ve tal cual en la "última frase" debe verse en la transcripción de la zona
   de FLU**: burbuja del avatar, bitácora y phrase-display se alimentan de la MISMA frase
   canónica. Prohibidas cascadas de respaldo distintas por componente
   (`a||b||c` con orden distinto en cada vista).
4. **El único wake word es el configurado** en `FLU_CONFIG.voiceCommands.wakeWords`
   (`fluConfig.js`). Prohibido hardcodear wake words ("ok flu", etc.) fuera de config;
   hoy es "ok flu" pero puede cambiar.
5. **La barra de búsqueda debe mostrar lo mismo que la transcripción**, solo sin la wake
   word y solo los comandos: recibe la misma frase canónica y le quita la wake word de
   config (`splitTranscriptAtWakeWord`) ÚNICAMENTE para presentación, nunca para decidir
   contenido.
6. **Lo que escucha FLU debe ser lo mismo que la transcripción**: la `question` enviada a
   Gemini se deriva de la MISMA frase canónica commiteada. Prohibido que la query pase
   por limpiezas/parseos distintos a los que producen la fila visible.
7. (La lista original del usuario numeró 1-4,6,7; la regla 5 de arriba es la "barra de
   búsqueda", quedando esta nota solo como referencia del mapeo.)

**Invariante verificable por hito**: una frase hablada → UNA fila visible en bitácora Y
UNA query a la IA con el mismo texto. Guard: test que falle si N>1 criterios de
deduplicación/commit de la misma señal (patrón §8.6).

## 10. CONTRATO DE TAREA Y VERIFICACIÓN POR COMANDO (anti-sustitución)

Toda tarea se ejecuta contra un contrato escrito ANTES de tocar código. Sin contrato no
se empieza. El contrato tiene 4 campos obligatorios: objetivo único, DoD, alcance y guard.

1. **DoD = comando, no descripción.** El criterio de "hecho" es un comando ejecutable con
   valor esperado. Prohibido cerrar con frases ("funciona", "quedó bien"): se cierra con la
   salida cruda del comando ANTES y DESPUÉS. Si el valor no cambió, la tarea NO está hecha;
   se reporta `No lo hice; hice solo X parcial en [archivo:línea]`.

2. **Guard primero, en ROJO.** Toda tarea de unificación/refactor/eliminación de duplicados
   nace con un test-guard que FALLA mientras exista la duplicación (N>1) y PASA cuando queda
   en 1. Su mensaje lista los duplicados (`archivo:símbolo:línea`). Si el guard no nace rojo,
   la tarea no está definida.

3. **Baseline de fallos.** Antes de tocar nada se registra la lista de tests que YA fallan
   (fallos preexistentes). La puerta de cierre es **0 fallos NUEVOS**, no "0 fallos". Los
   preexistentes se excluyen del criterio, se documentan como deuda y NO se "arreglan" en
   esta tarea salvo que el DoD lo pida. Prohibido declarar verde ignorando el baseline o
   usarlo como excusa para no entregar.

4. **Prohibida la sustitución de alcance.** No se puede reemplazar la tarea pedida por una
   versión más fácil, parcial o "de paso". Si el DoD no se puede cumplir, el agente SE DETIENE
   y lo dice. Un avance parcial honesto se reporta como parcial; nunca como cumplido.

5. **Alcance cerrado.** El contrato fija los archivos que se PUEDEN tocar y prohíbe el resto.
   Todo hallazgo fuera de alcance se ANOTA al final (`archivo:línea`) y se sigue la tarea.

6. **Una tarea por instrucción.** No se agrupan varios hitos en un turno; el lote es lo que
   permite posponer lo importante. Un turno = un contrato.

**Cierre obligatorio (salida cruda, sin resúmenes):**
(a) `git diff --stat` · (b) comando DoD ANTES y DESPUÉS · (c) salida del guard ·
(d) baseline de fallos preexistentes y confirmación de 0 nuevos.

## 11. RECETA DE INVARIANTES (replicable en cualquier proyecto)

Para convertir un pedido difuso ("unifícalo", "una sola fuente") en algo verificable, el
agente DEBE producir, ANTES de tocar código:

1. **Intención en una frase**: "X se entrega igual a todos" / "una sola fuente para Y".
2. **Sustantivos contables**, no adjetivos: cuántos almacenes, cuántas decisiones, cuántas
   queries, cuántos productores.
3. **Número HOY y META**: comando que lo cuenta (`rg -n ...`) y valor actual; meta natural
   `1` (unificar) o `0` (eliminar duplicado). Prohibidos umbrales inventados.
4. **Guard que nace ROJO** por invariante (§8.6/§10.2), listando `archivo:símbolo:línea`.
5. **Hito = 1 invariante**: `git diff --stat` + conteo ANTES/DESPUÉS; si el conteo no baja,
   el hito se revierte (§8.5).
6. **Cierre**: salida cruda del guard en verde + 0 fallos nuevos (§10).

Plantilla para pedirlo (pegable):

    Antes de tocar código, dame un contrato con:
    1) objetivo en una frase;
    2) por cada duplicación: comando que la cuenta, valor HOY y META (0 o 1);
    3) por cada invariante, un guard que HOY falle y liste archivo:línea;
    4) DoD = comando ejecutable con valor esperado;
    5) un invariante por turno, con conteo ANTES/DESPUÉS;
    6) no cerrar sin guard verde y 0 fallos nuevos;
    7) congelar el criterio (hash del guard) para que no se cambie en silencio.

Regla corta: **cada duplicación con un número; cada número con un guard que nace rojo.**

---

**Última actualización**: 2026-09-10
**Versión del documento**: 7.1
**Cambio clave**: §11 Receta de invariantes (intención → número HOY/META → guard rojo →
hito con conteo ANTES/DESPUÉS; plantilla pegable y regla corta).