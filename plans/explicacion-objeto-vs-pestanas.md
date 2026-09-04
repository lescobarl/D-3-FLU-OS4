# Explicación técnica: por qué "objeto consolidado" ≠ "pestañas"

> **Solicitud:** "explícame porque vuelves a repetir mal algo que se está definiendo claramente, quiero la explicación técnica"
> Este documento explica, con el código real, la diferencia entre lo que pediste (un **objeto consolidado**) y lo que se implementó (pestañas), y por qué mis diseños anteriores seguían cayendo en pestañas.

---

## 1. Qué pediste (y qué significa técnicamente)

> "La respuesta de FLU, el browser, las imágenes, documento/video quedaran **unificadas en un mismo objeto**"

Técnicamente, "un mismo objeto" significa que **todo el contenido del pizarrón vive en UNA sola estructura de datos** (un único estado), y que la **UI muestra ese objeto completo de una vez**, no lo trocea en compartimentos que se ocultan entre sí.

La palabra clave es **unificado**: las piezas conviven en el mismo espacio visual, como un tablero. No se esconden unas a otras.

---

## 2. Qué se implementó (pestañas) — y por qué es lo contrario

Mira el código real en [`WorkspaceHub.tsx`](../src/components/WorkspaceHub.tsx:44):

```ts
export type WorkspaceHubTabId =
    | 'buscar'      // browser
    | 'respuesta'   // respuesta de FLU
    | 'horario'
    | 'documento'
    | 'app'
    | 'generacion'  // documento/video
    | 'archivos';
```

Y el render (líneas 771-790):

```tsx
<nav className="workspace-hub__tabs">
    {tabsDisponibles.map((tab) => ( ... ))}   // barra de pestañas
</nav>
<div className="workspace-hub__body" role="tabpanel">
    {renderContent()}                          // SOLO la pestaña activa
</div>
```

**El problema técnico:** `renderContent()` (línea 498) hace un `switch (activeTab)` y renderiza **UN solo caso**. Es decir:

```
switch (activeTab) {
    case 'respuesta':  return <Respuesta/>;   // ← solo esto se ve
    case 'documento':  return <Documento/>;   // ← lo demás queda OCULTO
    ...
}
```

Esto es **excluyente por diseño**: si ves la respuesta de FLU, NO ves el documento; si ves el documento, NO ves la imagen. Cada pieza está en un **compartimento** que se oculta cuando activas otro. Eso es exactamente lo contrario de "un mismo objeto unificado".

---

## 3. La diferencia en una tabla

| Aspecto | Pestañas (lo implementado) | Objeto consolidado (lo que pediste) |
|---------|----------------------------|--------------------------------------|
| Estado | Cada pieza es un **slot separado** (`workspaceArtifact`, `documentArtifact`, `appAnalysisArtifact`, `generationJob`) + hooks locales | **Un solo array** `workspaceTabs[]` que contiene todas las piezas |
| UI | `switch` que muestra **una** pieza y oculta el resto | Renderiza **todas** las piezas del array, una tras otra |
| Relación entre piezas | **Excluyente** (ver A oculta B) | **Coexistente** (A y B se ven juntas) |
| Metáfora | Carpeta con pestañas (abres una, cierras las demás) | **Pizarra/tablero** (todo escrito a la vez) |

---

## 4. Por qué mis diseños seguían cayendo en pestañas (el error)

Mi error fue de **confusión de capas**. Hay dos cosas distintas que se llaman parecido:

1. **Unificación de la UI** (Fase 1, ya hecha): juntar las 7 tarjetas apiladas en un solo componente `WorkspaceHub`. Esto se hizo **con pestañas** porque era lo de menor riesgo (no toca el store).
2. **Consolidación del objeto** (lo que pediste): que el **estado** sea un solo objeto Y que la **vista** muestre ese objeto completo.

Cuando diseñé la "Vista A — pestañas derivadas", seguí pensando en la **capa 1** (la UI de pestañas que ya existe) y solo cambié la **capa de estado** por debajo. Pero tú no quieres que la UI siga siendo pestañas: quieres que la **vista** también sea un objeto único visible.

**En resumen:** yo estaba "consolidando el estado pero dejando la vista en pestañas", y tú quieres consolidar **ambas**: un solo estado Y una sola vista continua (lienzo), sin compartimentos que se oculten.

---

## 5. Cómo se vería el objeto consolidado de verdad (sin pestañas)

El estado es un solo array:

```ts
// integrationStore.workspaceTabs — UN solo objeto
[
  { tipo: 'respuesta',  estado: 'listo', payload: { entry: { respuesta: '...' } } },
  { tipo: 'imagen',     estado: 'listo', payload: { imageUrl: 'blob:...' } },
  { tipo: 'documento',  estado: 'listo', payload: { artifact: { nombre: 'reporte.xlsx' } } },
  { tipo: 'generacion', estado: 'cargando', payload: { job: { progreso: 60 } } }
]
```

Y la UI **recorre el array y renderiza todo**, sin `switch` ni pestañas:

```tsx
// En vez de: switch(activeTab) { case 'respuesta': ... }
workspaceTabs
  .sort((a, b) => b.updatedAt - a.updatedAt)
  .map((item) => <Piece key={item.id} item={item} />)   // TODAS visibles
```

Resultado visual: un **lienzo continuo** donde la respuesta de FLU, la imagen, el documento y la generación aparecen **apilados y visibles a la vez**, como un tablero de trabajo. Nada se oculta.

```
┌──────────────────────────────────────────────────────────────┐
│  💬 Respuesta de FLU                                         │
│  Claro, aquí tienes el resumen de tu tarea...                │
│  [Despejar la incógnita] [Verificar el resultado]            │
├──────────────────────────────────────────────────────────────┤
│  🖼 Imagen generada                                          │
│  [imagen]  ·  prompt: un jardín al atardecer                 │
├──────────────────────────────────────────────────────────────┤
│  📄 Documento analizado: reporte.xlsx                        │
│  Hoja de cálculo con 3 hojas...  [⬇ Descargar]              │
├──────────────────────────────────────────────────────────────┤
│  ⚙ Generación en curso · 60%  ▓▓▓▓▓▓░░░░                     │
└──────────────────────────────────────────────────────────────┘
```

---

## 6. Conclusión

- **Pestañas** = estado fragmentado + vista excluyente (`switch` que oculta).
- **Objeto consolidado** = un solo estado (`workspaceTabs[]`) + vista inclusiva (recorre el array y muestra todo junto).

Mi error fue consolidar solo el estado y dejar la vista en pestañas. Lo que pides es que **la vista también sea un lienzo único** que muestre el objeto completo, sin compartimentos que se oculten entre sí.
