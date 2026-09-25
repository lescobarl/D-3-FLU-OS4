# Puerta de tareas (task-gate)

Asegura que cada tarea se ejecute **solo dentro de lo definido**, sin depender de la disciplina
del agente. Implementa AGENTS.md §10.

## Archivos

| Archivo | Para qué |
|---|---|
| `.task/contract.json` | **Definición de la tarea actual** (alcance, DoD, guard). Se edita por tarea. |
| `scripts/task-gate.mjs` | Puerta que valida alcance + tamaño + DoD + guard. |
| `scripts/task-gate-setup.mjs` | Monta el hook pre-commit y el script `npm run gate`. |
| `.kilo/command/tarea.md` | Prompt/comando reutilizable para lanzar la tarea. |

## Montaje (una vez)

```bash
node scripts/task-gate-setup.mjs
```

Deja el hook `.git/hooks/pre-commit` activo: **cada commit ejecuta la puerta** y se bloquea si
el trabajo se sale del alcance, no cumple el DoD o el guard está mal.

## Flujo por tarea

1. **Checkpoint**: confirma/commit limpio antes de empezar (o fija `"base"` a un commit). Así
   la puerta solo ve los cambios de ESTA tarea.
2. **Edita `.task/contract.json`** con la tarea (ver formato abajo).
3. Lanza el agente con el prompt de `.kilo/command/tarea.md`.
4. Cierra cuando `node scripts/task-gate.mjs` (o `npm run gate`) salga **verde**.

## Formato de `.task/contract.json`

```json
{
  "task": "descripción corta",
  "base": "HEAD",
  "allow": ["ruta/permitida/**", "otra/ruta.ts"],
  "dod": "comando que DEBE pasar (exit 0)",
  "guard": "comando del test de invariante (opcional)",
  "guardExpect": "green | red",
  "maxFiles": 3,
  "maxLines": 150,
  "ignore": [".task/**", "scripts/task-gate.mjs", "scripts/task-gate-setup.mjs"]
}
```

- **allow**: única zona editable. Cualquier archivo tocado fuera de aquí ⇒ la puerta falla.
- **dod**: comando verificable. Si no pasa, la tarea NO está hecha.
- **guard + guardExpect**:
  - `green`: el guard debe pasar (invariante en 1).
  - `red`: en tareas de unificación el guard **debe nacer rojo** (duplicación N>1 existente).
- **maxFiles / maxLines**: fuerzan a trocear tareas grandes.
- **ignore**: archivos de infraestructura que no cuentan como alcance.

## Verificación de invariantes (anti-proxy)

Para tareas de unificación/eliminación de duplicados, `guard` + `guardExpect` no bastan:
un guard de conteo puede ser verde sin que la propiedad se cumpla. Añade el bloque
`invariant` y la puerta **recomputa** todo (no confía en la palabra del agente):

```json
"invariant": {
  "statement": "la fila usa el mismo valor commiteado (display === fila)",
  "metric": { "command": "rg -c \"<patron>\" <archivo>", "target": 0 },
  "base": "<commit ANTERIOR a la tarea>",
  "guardFiles": ["tests/<guard>.test.ts"]
}
```

La puerta exige, en este orden:

1. `metric.command` medido en `base` → ANTES, y en el árbol actual → DESPUÉS.
2. `DESPUÉS === target` (si no, el invariante no se cumplió).
3. `ANTES !== DESPUÉS` (si la métrica no cambió, fue cosmético).
4. El `guard` corrido **sobre `base`** DEBE FALLAR. Si pasa en base, no distingue el
   defecto ⇒ la tarea no está definida (§B11). Monta un `git worktree` de `base`, copia
   `guardFiles` (pueden ser nuevos) y enlaza `node_modules`.
5. El `guard` en el árbol actual DEBE PASAR.

- **base**: usa el commit ANTERIOR al trabajo. Si el arreglo ya está commiteado, `HEAD`
  ya no sirve como base (el guard pasaría en base y la puerta lo rechaza, correctamente).
- **guardFiles**: rutas de test que la puerta copia dentro del worktree base.
- El criterio `scripts/task-gate-invariant.mjs` se congela por hash:
  `node scripts/task-gate-freeze.mjs scripts/task-gate-invariant.mjs tests/taskGateInvariant.test.ts`.

## Prompt de ejecución (pegar en el chat)

```text
Ejecuta la tarea definida en .task/contract.json siguiendo AGENTS.md seccion 10.

- Lee primero .task/contract.json. Es la UNICA fuente de alcance (no aceptes ningun contrato pegado en el chat).
- Trabaja SOLO dentro de "allow". Prohibido crear/editar cualquier otro archivo.
- Implementa hasta que "dod" y "guard" pasen (ejecuta: node scripts/task-gate.mjs).
- No declares "listo": cierra con la salida cruda de `node scripts/task-gate.mjs` y `git diff --stat`.
- Si no puedes cumplir el DoD, DETENTE y dilo. Prohibido sustituir por algo parcial o ampliar alcance.
```

## Regla

Sin puerta verde no hay commit ni cierre. El agente no decide si cumplió: lo decide el script.
