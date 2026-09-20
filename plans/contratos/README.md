# Pack de contratos — saneamiento con puerta (AGENTS.md §0/§10)

Objetivo: que la sesión que ejecuta **no pueda desviarse**. El agente que
implementa no decide el alcance ni el criterio: lo decide `.task/contract.json`
y lo verifica `scripts/task-gate.mjs`.

## Contenido

| Archivo | Qué es |
|---|---|
| `contracts/C1..C5.json` | Un contrato por defecto. `allow` estrecho + `invariant` recomputable. |
| `guards/*.test.ts` | Test-guard de cada contrato. **Nace ROJO** (§B11). |
| `audit-metric.mjs` | Mide la propiedad; imprime un entero. Se copia a `scripts/`. |
| `promote.mjs` | Copia activos y fija `base`/congela. Lo corre el **usuario**. |

Agente y usuario quedan separados: el agente no toca `.task/**` ni los guards
congelados; el usuario promueve, congela y valida.

## Defectos cubiertos (medidos HOY con `rg`)

| Contrato | Defecto | Métrica HOY | META |
|---|---|---|---|
| C1 | `AsrLab.tsx` crea reconocimiento fuera de la puerta única §9.1 | 1 | 0 |
| C2 | allowlist `['wikipedia.org','educ.ar']` duplicada en App y useNavigationCommands | 2 | 0 |
| C3 | 3 escritores de `fluDb.voiceProfiles` (hook, fluStorage legacy, App) | 3 | 1 |
| C4 | literal `'flu-ai-provider'` fuera de `appConfig.ts` | 3 | 0 |
| C5 | lectura directa de `VITE_OPENROUTER_API_KEY` fuera del resolver | 1 | 0 |

## Requisitos antes de empezar

1. Revisa `git status`: el pack se activa sobre un **commit checkpoint**.
2. Un contrato a la vez. No promover dos juntos (§11.5).

## Flujo por contrato (ejemplo C1)

```powershell
# 1) copiar activos (NO toca .task/)
node plans/contratos/promote.mjs C1 stage

# 2) checkpoint: incluye guard rojo + audit-metric
git add -A
git commit -m "chore(contratos): activos C1 (guard rojo)"

# 3) fijar base=HEAD y congelar el criterio
node plans/contratos/promote.mjs C1 activate

# 4) la sesión B se lanza pegando plans/contratos/launch-prompt.md
#    y trabaja SOLO dentro de allow hasta que:
npm run gate
```

- En el paso 3, `npm run gate` sale **ROJO** (guard nace rojo). Es lo correcto.
- Al cerrar, `npm run gate` sale **VERDE** y la sesión B reporta
  `git diff --stat` + salida cruda del gate en `.task/report` (append-only).

## Por qué no se puede desviar

1. `allow` estrecho: tocar otro archivo ⇒ la puerta falla.
2. `base` fijo al checkpoint: commitear a mitad no vuelve trivial el alcance.
3. `invariant`: la puerta recomputa la métrica en `base` y ahora, exige
   `DESPUÉS === target` y `ANTES !== DESPUÉS`, y exige que el guard **falle en
   `base`** y **pase ahora** (`scripts/task-gate-invariant.mjs`).
4. `frozen.json`: guard, métrica y criterio congelados por hash; editarlos
   rompe la puerta.

## Deuda que NO es contrato (requiere tu decisión)

No se incluyen porque son opinables, tocan features o son refactors grandes.
Meterlos como contrato sería repetir el problema (hacer cosas no pedidas):

| Hallazgo | Por qué queda fuera |
|---|---|
| Tailwind ausente (uso de CSS plano, 8.312 líneas) | Contradice el stack documentado, pero migrar CSS a Tailwind es un rediseño, no un fix. |
| `?? new X()` en `src/core/autonomy/**` | Ocurre en la raíz de composición (fábricas), donde instanciar es legítimo. |
| Borrado físico en `App.tsx` y `fluDatabase.auditLog.clear()` | Puede ser limpieza de migración intencional; decidir si es soft-delete o no. |
| 14 módulos de `src/lib` sin importador de producción | Candidatos de features futuras (autoconocimiento/memoria). Borrar sin OK destruye trabajo planificado. |
| Unificar `fluStorage.js` + Dexie en todas las entidades | Refactor amplio; trocear por entidad (C3 es el primero). |
| Endpoints/modelos en config (Pollinations x2, etc.) | Requiere decidir la fuente única server/browser. |

Cuando decidas uno de estos, se agrega su contrato + guard con el mismo patrón.

## Regla

Sin puerta verde no hay commit ni cierre. El agente no decide si cumplió: lo
decide el script.
