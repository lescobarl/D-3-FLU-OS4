# Contrato H7 — Una sola ruta para el estado de Buscar

> Trabajo autónomo (2026-09-10). Cierra el defecto "busco por voz y no devuelve
> nada de la web" (intermitente). Validación en vivo **pendiente** del usuario.

## 1. Objetivo único

El estado de Buscar (query + resultados) tiene **un solo decisor por turno**: si el
turno es una búsqueda, el FILL es el único que escribe; si no lo es, se limpia.

## 2. Diagnóstico (evidencia)

- Decisión de voz correcta: `navigation/BUSCAR`, `requested:true`, query
  `"como es que los ratones hacen sus nidos"` (log 05:50 y 06:03).
- El query llega a la barra.
- Proxy `/api/search/web` con `providers` devuelve resultados (replicado:
  `providers:2, ok:true, results:5`). Sin `providers` → `results:[]`.
- **Dos escritores desfasados** del mismo estado:
  - `App.tsx` → `dispatchFluResetSearch()` en **cada** resolución de turno.
  - `useNavigationCommands.ts` → `dispatchFluSearch(...)` **2800 ms después** (settle).
- Con revisiones ASR largas o cambio de hablante, el RESET cae después del FILL y
  borra lo pintado → barra con query, grilla vacía. Con locución corta y limpia,
  gana el FILL (por eso era intermitente).

## 3. Invariante y número

| Invariante | Comando | Antes | Meta | Guard |
|---|---|---|---|---|
| El turno BUSCAR no limpia su propio estado | `rg "dispatchFluResetSearch\(" src/App.tsx` sin gate | 1 incondicional | 0 incondicionales | `tests/searchSingleRouteGuard.test.ts` (G8) |

## 4. Guard G8 (nace ROJO)

`tests/searchSingleRouteGuard.test.ts`: falla si en `src/App.tsx` hay un
`dispatchFluResetSearch(` que no esté gateado por `isSearchFillTurn`. Lista
`archivo:línea`. Nació rojo (1 hallazgo) y pasó a verde con el fix.

## 5. Fix aplicado

`src/App.tsx` (bloque no-rawOnly):
```ts
const comandoNavegacion = String((navegacion as any)?.comando || '').toUpperCase();
const isSearchFillTurn = comandoNavegacion === 'BUSCAR' || comandoNavegacion === 'NAVEGAR';
if (!isSearchFillTurn) dispatchFluResetSearch();
```
Cubre ambos comandos que despachan búsqueda: `BUSCAR` (`useNavigationCommands:538`) y
`NAVEGAR` (`:456-458`), verificados en el código. En turnos que no son de búsqueda se
conserva el limpiado previo.

## 6. DoD (comando, no descripción)

- `npx vitest run tests/searchSingleRouteGuard.test.ts` → **1 passed** (G8 verde).
- `npx tsc -b` → 0 errores.
- `npm run lint` → 5 archivos / 29 tests verde (G8 incluido).
- `npm test` (changed) → `2732 passed | 6 failed`; los 6 son **el baseline**
  (`deterministicArbiter` ×3, `hoyPanel` ×3). **0 fallos nuevos.**

## 7. Pendiente (no validado)

- **Validación en vivo**: repetir "ok flu busca en la web …" y "ok flu navega a …" y
  verificar que la grilla muestra resultados aunque el ASR emita varias revisiones.
- Defecto aparte anotado: la frase se partió en dos filas ("hacen sus nidos" +
  frase completa) por cambio de hablante (`luis` → `Hablante 2`); es del pipeline
  de voz §9 y requiere su propio contrato con reproducción en vivo.
- Cierre de entrega (commit/CI) bloqueado por `.task/contract.json` + `.task/frozen.json`
  desactualizados; requiere autorización del usuario para re-congelar el criterio.
