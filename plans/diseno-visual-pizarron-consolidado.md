# Diseño Visual — Pizarrón con Objeto Consolidado

> **Solicitud:** "haz un diseno de como se veria, cual seria el resultado final, yo como lo validaria"
> **Alcance:** EXCLUSIVAMENTE el pizarrón con **objetos consolidados** (Fase 2). Complementa el diseño técnico de [`plan-pizarron-objeto-consolidado.md`](plan-pizarron-objeto-consolidado.md:1).
> **Estado:** DISEÑO — no se ha aplicado ningún cambio de código.

---

## 1. Cómo se vería (wireframes)

El objeto consolidado (`workspaceTabs[]`) se ve de **dos formas** que leen el mismo estado. Ambas comparten la misma estética oscura del proyecto (fondo `#0d1117`, acentos cian `#00d4ff` / verde `#48bb78` / rojo `#ff4444`).

### Vista A — Pestañas derivadas (base)

Cada ítem con contenido es una pestaña. El punto de color indica actividad en segundo plano aunque no estés en esa pestaña.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  🧩 Pizarrón · workspaceTabs[]                                  3 ítems   │
├────────────────────────────────────────────────────────────────────────────┤
│  [📤 Subir] [💬 Respuesta●] [🖼 Imagen] [📄 Documento] [⚙ Generación●]    │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   💬 Respuesta de FLU                                        [🗑 Limpiar]  │
│   ┌────────────────────────────────────────────────────────────────────┐  │
│   │  Claro, aquí tienes el resumen de tu tarea de matemáticas. El      │  │
│   │  problema se resuelve despejando la incógnita y verificando...     │  │
│   │                                                                    │  │
│   │  [Despejar la incógnita] [Verificar el resultado] [Revisar unid.]  │  │
│   └────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│   ● = actividad en segundo plano (p. ej. generación en curso)             │
└────────────────────────────────────────────────────────────────────────────┘
```

**Estados de la pestaña (punto de color):**
- **Ámbar (parpadea)** = `cargando` — generación/análisis en curso.
- **Verde** = `listo` — contenido completo disponible.
- **Rojo** = `error` — con mensaje y botón reintentar.

### Vista B — Lienzo único (toggle opcional, la lectura más fiel a "un mismo objeto")

Todas las piezas **juntas**, ordenadas por tiempo, cada una colapsable. Es el "tablero de trabajo continuo": FLU responde, genera imagen, analiza documento y todo aparece en un solo lienzo.

```
┌────────────────────────────────────────────────────────────────────────────┐
│  🧩 Pizarrón · lienzo único                                    3 ítems   │
├────────────────────────────────────────────────────────────────────────────┤
│  ▾ 💬 Respuesta de FLU · 10:18:05                              [🗑]      │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Claro, aquí tienes el resumen de tu tarea de matemáticas...       │  │
│  │  [Despejar la incógnita] [Verificar el resultado]                  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ▾ 🖼 Imagen generada · 10:18:12                               [🗑]      │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  ┌──────────────────────────────┐                                  │  │
│  │  │   (imagen)                   │   [↻ Regenerar] [✨ Usar Gemini] │  │
│  │  │   prompt: un jardín al       │                                  │  │
│  │  │   atardecer con flores       │                                  │  │
│  │  └──────────────────────────────┘                                  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                            │
│  ▾ 📄 Análisis de documento · 10:18:20                         [🗑]      │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  [📄 reporte.xlsx] [xlsx]                                          │  │
│  │  Hoja de cálculo con 3 hojas: ventas, gastos y resumen. Se         │  │
│  │  detectaron 2 errores de fórmula.                                  │  │
│  │  [Ventas] [Gastos] [Resumen]                    [⬇ Descargar]     │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

### Estados visuales por ítem (comunes a ambas vistas)

| Estado | Pestaña (A) | Lienzo (B) | Acciones |
|--------|-------------|------------|----------|
| `idle` | no aparece | no aparece | — |
| `cargando` | punto ámbar ● | barra de progreso | — |
| `listo` | punto verde ● | contenido completo | Descargar / Regenerar / Limpiar |
| `error` | punto rojo ● | caja roja con mensaje | Reintentar / Eliminar |

---

## 2. Cuál sería el resultado final

### 2.1 Lo que el usuario ve
- **Un solo pizarrón** que se llena con lo que FLU produce, sin tarjetas vacías apiladas ni estado perdido.
- Puede alternar entre **pestañas** (compacto) y **lienzo único** (todo junto) sin perder nada, porque ambas vistas leen el mismo `workspaceTabs[]`.
- Ve **badges de actividad** cuando algo se genera en segundo plano.
- Puede **limpiar cada pieza por separado** (limpiar la respuesta no borra la imagen).

### 2.2 Lo que vive en el store (el "objeto consolidado")
Un solo array que describe todo el pizarrón de la sesión:

```jsonc
// integrationStore.workspaceTabs
[
  {
    "id": "respuesta-1",
    "tipo": "respuesta",
    "estado": "listo",
    "payload": { "entry": { "respuesta": "...", "puntos_clave": ["..."] } },
    "updatedAt": "10:18:05"
  },
  {
    "id": "imagen-1",
    "tipo": "imagen",
    "estado": "listo",
    "payload": { "imageUrl": "blob:...", "promptVisual": "un jardín..." },
    "updatedAt": "10:18:12"
  },
  {
    "id": "documento-1",
    "tipo": "documento",
    "estado": "listo",
    "payload": { "artifact": { "nombre": "reporte.xlsx", "resumen": "..." } },
    "updatedAt": "10:18:20"
  }
]
```

### 2.3 Lo que NO cambia (para no romper nada)
- Los productores (Gemini contract, `analyzeFile`, `analyzeApp`, `generateDocument`, `assembleVideo`) y el efecto FLU_EVENTS.
- Los paneles presentacionales (`DocumentResultPanel`, `AppAnalysisPanel`, `GenerationProgressPanel`, `WorkspaceSearch`, `HorarioPizarron`) y sus selectores E2E.
- La Regla #1 (sin hardcode): labels desde `FLU_CONFIG` con fallback.

---

## 3. Cómo lo validarías tú

### 3.1 Validación funcional (comportamiento)

| # | Prueba | Resultado esperado |
|---|--------|--------------------|
| 1 | Hablas con FLU y pides algo | Su respuesta aparece como ítem `respuesta` con sus `puntos_clave` |
| 2 | FLU genera una imagen | Aparece ítem `imagen` con su prompt; puedes Regenerar / Usar Gemini / Limpiar |
| 3 | Subes un documento y lo analizas | Aparece ítem `documento` con resumen, hojas y errores; puedes Descargar |
| 4 | Analizas una app | Aparece ítem `app` con pantallas y flujos |
| 5 | Pides generar un documento/video | Aparece ítem `generacion` con barra de progreso (estado `cargando` → `listo`) |
| 6 | Mientras algo se genera, cambias de pestaña | La pestaña de generación muestra punto ámbar aunque no estés en ella |
| 7 | Limpias la respuesta | La imagen y el documento **siguen ahí** (limpieza independiente) |
| 8 | Abres el inspector del store | Todo vive en un solo `workspaceTabs[]`, no repartido en hooks locales |

### 3.2 Validación visual

| # | Qué miras | Resultado esperado |
|---|-----------|--------------------|
| 1 | Pizarrón vacío al inicio | Solo la pestaña/placeholder "Subir archivo"; **ninguna tarjeta vacía apilada** |
| 2 | Vista A (pestañas) | Cada ítem con contenido es una pestaña; el activo ocupa todo el panel |
| 3 | Vista B (lienzo) | Todas las piezas juntas, ordenadas por tiempo, colapsables |
| 4 | Estados | cargando = ámbar, listo = verde, error = rojo con mensaje y reintentar |
| 5 | Recargar la página | Los metadatos sobreviven; las imágenes/resultados se regeneran (no se guardan URLs `blob:` en `localStorage`) |

### 3.3 Validación técnica (no romper lo existente)

| # | Comando / selector | Resultado esperado |
|---|--------------------|--------------------|
| 1 | `npx tsc --noEmit` | Sin errores de tipos |
| 2 | `npx vitest run tests/workspaceTabs.test.ts tests/workspaceHub.test.ts tests/documentGenerationStore.test.ts` | Pasan (el último actualizado **a propósito**) |
| 3 | `npx playwright test tests/e2e/generacion-documentos.spec.ts` | Selectores `.document-analysis__*`, `.generation-panel__*`, `accept*=".txt"` y eventos `flu:generate-document` intactos |
| 4 | `npx playwright test tests/e2e/horario-pizarron.spec.ts` | Selectores de horario intactos |
| 5 | Verificación visual programática (estilo `os3-visual-audit.spec.ts`) | Geometría del pizarrón correcta: pestañas visibles, sin tarjetas vacías |

---

## 4. Nota sobre el mockup interactivo

Este documento es la especificación visual en Markdown. Para verlo **en vivo e interactivo** (con botones que simulan acciones de FLU, toggle entre Vista A/B y un inspector del objeto consolidado), se debe crear un archivo HTML (`plans/mockup-pizarron-objeto-consolidado.html`) en **modo Code**, siguiendo la estética del mockup existente [`mockup-pizarron-ux.html`](mockup-pizarron-ux.html:1). El contenido HTML ya está diseñado y listo para pegarse.

---

## 5. Decisiones abiertas

1. **¿Vista A, Vista B, o ambas con toggle?** (Recomendado: ambas — mismo objeto, dos presentaciones).
2. **¿Persistencia de metadatos al recargar?** (Recomendado: sí, sin URLs `blob:`/`data:`).
3. **¿Búsqueda y archivo subido entran al objeto consolidado o quedan como estado transitorio?**
