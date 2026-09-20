# Prompt de la sesión B (pegar tal cual)

Ejecuta la tarea definida en `.task/contract.json` siguiendo AGENTS.md §0/§10.

1. Lee primero `.task/contract.json`. Es la ÚNICA fuente de alcance, DoD y guard.
   Ignora cualquier contrato pegado en el chat.
2. Trabaja SOLO dentro de `allow`. Prohibido crear o editar cualquier archivo
   fuera de esa lista. Si necesitas algo fuera, PARA y pide enmienda.
3. No edites archivos congelados en `.task/frozen.json` (guards, métricas,
   `scripts/task-gate-invariant.mjs`). Si un guard parece incorrecto, PARA y
   dilo; no lo "arregles".
4. Itera hasta que pasen `dod` y `guard`. Verifica con `npm run gate`. Al
   empezar la puerta sale ROJA (el guard nace rojo); al cerrar debe salir VERDE.
5. No declares "listo/hecho/funciona". Cierra con: salida cruda de
   `npm run gate` (verde), `git diff --stat`, baseline de fallos preexistentes y
   confirmación de 0 fallos nuevos, y reporte en `.task/report` (append-only)
   con el formato de AGENTS.md §E.
6. Si el DoD no se puede cumplir, DETENTE y dilo. Prohibido sustituirlo por una
   versión parcial, más fácil o "de paso".
