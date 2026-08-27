# Plan: Digitalización OCR en el Pizarrón — VERSIÓN SIMPLIFICADA

**Máxima simpleza.** Sin hooks nuevos, sin stores nuevos, sin interfaces nuevas.
Todo centralizado en `App.tsx`. Solo 5 archivos modificados.

## Pipeline

```
Usuario: arrastra / selecciona / toma foto
  → App.tsx: FileReader a base64
  → App.tsx: muestra preview + "🔍 Analizando..."
  → App.tsx: fetch POST /api/gemini/vision
  → geminiProxy.ts: /api/gemini/vision
  → gemini.js: analyzeImage() → Gemini Vision API con inlineData
  → Respuesta: { materia, problemas[], instrucciones, nivel, texto_extraido }
  → App.tsx: muestra resultado debajo de preview
  → App.tsx: inyecta en dialogueHistoryRef (FLU lo "recuerda")
```

## Archivos a modificar (solo 5)

| # | Archivo | Cambio |
|---|---------|--------|
| 1 | `src/voice/lib/gemini.js` | AGREGAR función `analyzeImage()` |
| 2 | `src/server/geminiProxy.ts` | AGREGAR endpoint `POST /api/gemini/vision` |
| 3 | `src/services/gemini.ts` | AGREGAR método `generateVisionAnalysis()` |
| 4 | `src/App.tsx` | AGREGAR UI drag-drop + cámara + file picker + análisis + inyección |
| 5 | `src/index.css` | AGREGAR ~20 líneas de estilos |

## Lo que NO se crea

- ❌ No nuevo hook
- ❌ No nuevo componente
- ❌ No nuevo estado en integrationStore (useState local en App.tsx)
- ❌ No nueva interfaz en IAIService (tipado inline)
- ❌ No botón "Analizar" (automático al subir)

## Orden de implementación

1. `gemini.js` → `analyzeImage()`
2. `geminiProxy.ts` → endpoint `/api/gemini/vision`
3. `gemini.ts` → `generateVisionAnalysis()`
4. `App.tsx` → UI + lógica
5. `index.css` → estilos
6. `npx tsc --noEmit` → verificar compilación
7. Pruebas e2e
