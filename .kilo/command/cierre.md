---
description: "Cierre único de hito: auditoría estricta + typecheck + lint + git diff --stat, con salida cruda obligatoria."
---

Ejecuta estos comandos **EN ORDEN** y pega la salida **CRUDA** de cada uno tal
cual (prohibido resumir, parafrasear o "interpretar"):

1. `node scripts/auditoria.mjs --strict` — debe salir EXIT 0 (catalogo 25/25).
2. `npm run typecheck`
3. `npm run lint`
4. `git diff --stat`

Reglas del cierre:

- No hay cierre sin la salida cruda de los cuatro comandos.
- Si `--strict` sale distinto de 0, **NO cierres**: lista los hallazgos por
  encima de META (`ID(hoy>meta)`) y detente.
- Palabras prohibidas: "listo", "hecho", "funciona", "100%". Cierra con el
  formato fijo: `Cambios aplicados / Validado contra / No validado`.
