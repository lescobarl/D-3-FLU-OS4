# Backlog de upgrade — LAE

**Fecha:** 2026-11-20  
**Rama:** `mejoradoble`  
**Commits base:** `3b20c4d4` (Configuración/Contactos/límpieza) · `01f03c2c` (rotación `debug.log`)  
**Estado:** Configuración y Contactos cerrados; CI remoto pendiente.

---

## Ancla de alcance

**Incluye**
- Estudio de documentos: documento activo, chunks, búsqueda por sección/página, preguntas con cita, seguimiento de lectura y minuta de estudio.
- Inglés conversacional: práctica, corrección de gramática/vocabulario y avance desde minutas.
- i18n completo: inventario de cadenas, diccionario único, selector `es/en/both` y barrido E2E.
- Un dueño por responsabilidad, sin rutas ni almacenes duplicados.
- Pruebas focalizadas, guards y E2E de los flujos tocados.

**Excluye**
- Cambios de alto riesgo en voz (watchdog, hash de claves, ASR) sin sesión real.
- Pronunciación/acento y evaluación fonética mientras no exista motor dedicado.
- Currículo completo de inglés con certificación en esta fase.
- Suite completa en local; esa corre en CI.
- Módulos, juegos o pantallas fuera del alcance LAE.
- Parches, hardcodes nuevos, copias de datos o segundas rutas de UI.

Toda tarea que no esté en **Incluye** se rechaza o se mueve a otra fase.

---

## Lo que falta (pendiente)

- `<` Documento activo por id estable.
- `<` Chunks persistidos del documento, no solo el resumen.
- `<` Recuperación por sección/página (RAG o índice local).
- `<` Seguimiento de lectura: página, sección y párrafo actual.
- `<` Comandos “explícame esta sección”, “resume lo leído”, “siguiente página”.
- `<` Citas de página/sección en las respuestas.
- `<` Minuta de estudio etiquetada con documento y área.
- `<` Currículo de inglés por nivel y plan de lección.
- `<` Ejercicios con respuesta esperada y corrección determinista.
- `<` Pronunciación, acento y puntuación fonética.
- `<` Evaluación inicial y progreso por dominio (no solo sesiones).
- `<` Vocabulario con repetición espaciada y tareas.
- `<` Integración de una guía/documento subido con la clase de inglés.
- `<` Inventario completo de cadenas visibles de UI.
- `<` Diccionario único y eliminación de textos duros/ternarios `isEn`.
- `<` Traducción de fechas, números, plurales, errores, onboarding y toasts.
- `<` Barrido E2E en `en` que falle si queda texto en español.

---

## 1. Pendientes técnicos actuales

- **CI remoto:** ambos commits están en `origin/mejoradoble`; falta consultar el resultado de `.github/workflows/ci.yml` (lint, typecheck, `test:full`, build y E2E).
- **Voz de alto riesgo (no tocar sin sesión real):**
  - `src/voice/hooks/useFluVoiceAssistant.js:2556`: periodo del watchdog con ref no reactivo.
  - `src/voice/lib/speakerDirectory.js:353`: hash de clave de voz con riesgo de colisión.
- **Warnings de build:** `INEFFECTIVE_DYNAMIC_IMPORT` del worker de voz y chunks >500 kB.
- **`motoro.ts`:** pestaña vieja del editor; el archivo no existe ni está en Git. No es código.
- **Suite completa:** no se corre en local; queda para CI.

---

## 2. Estudiar un PDF con FLU

### Caso de uso

1. El usuario sube un PDF (o Word/PowerPoint/Excel/CSV/TXT/Markdown).
2. Pide: “ayúdame a estudiar el documento X”.
3. Se pone en una sección (ej. Matemáticas) y lee.
4. FLU lo va siguiendo y responde preguntas mientras avanza.
5. Al final, la sesión puede quedar como minuta/asistencia de estudio.

### Lo que existe hoy

- Carga y análisis de documentos en `useDocumentAnalysis`.
- Parser de PDF/DOCX/PPTX/XLSX/CSV/TXT/MD y OCR local para PDF escaneado.
- Análisis por chunks con el LLM (`documentAnalysis`, map-reduce).
- `DocumentContract` con `resumen`, `puntos_clave`, `qa_context`.
- El `qa_context` o el resumen se inyecta como mensaje de sistema en la conversación (`App.tsx:3197-3211`).
- Historial de documentos cargados (`useDocuments`).

### Lo que falta para el caso completo

- **Documento activo por id**: hoy no se puede decir “el documento X” si hay varios.
- **Chunks persistidos y recuperables**: hoy se guarda un contexto condensado, no el documento completo.
- **Búsqueda por sección/página (RAG o índice local)**: falta recuperar el fragmento exacto.
- **Seguimiento de lectura**: FLU no sabe en qué página, sección o párrafo va el usuario.
- **Comandos de estudio**: “explícame esta sección”, “resume lo que acabo de leer”, “siguiente página”, “hazme preguntas”.
- **Citas de página/sección** en las respuestas.
- **Integración con minutas**: etiquetar la sesión como estudio de un área/documento.
- **Control de ventana de contexto**: el documento grande se truncará si no hay recuperación.

### Criterios de aceptación

- Subir un PDF y asignarle un id estable.
- Decir “estudia el documento X” y que FLU use ese documento, no otro.
- Preguntar por una sección concreta y recibir respuesta con página/sección.
- Leer en voz alta y que FLU responda dudas sobre lo leído sin perder el hilo.
- Guardar una minuta de estudio con área y documento.

### Implementación propuesta

1. Persistir chunks por documento (misma DB, un solo dueño; sin tabla duplicada).
2. Índice de recuperación (embeddings locales o búsqueda por texto) con tope de contexto.
3. Estado de **documento activo** y sección/página actual.
4. Inyectar solo los fragmentos relevantes en la conversación, con presupuesto de tokens.
5. Comandos de voz de estudio y citas de origen.
6. Minuta etiquetada con área (`tutoring_area`) y referencia al documento.
7. E2E real: subir PDF → preguntar por una sección → verificar respuesta y cita.

### Barreras anti-rutas-dobles

- Un solo dueño de documentos (`documents`/Dexie) y un solo servicio de análisis.
- No crear un segundo almacén de chunks ni un segundo “documento activo”.
- Una sola ruta de carga: `processAnyFile`/`processDocumentFile`.
- Un solo contexto de conversación: el insumo del documento entra por `addSystemMessage`, no por un segundo prompt paralelo.

---

## 3. Clases de inglés

### Lo que existe hoy

- Área `Inglés` en `tutoringModel` (con alias `english`).
- Regla pedagógica `buildTutoringRule` inyectada en `capabilities.ts:137`:
  - averiguar nivel con una pregunta;
  - explicar en pasos cortos;
  - pedir práctica y esperar;
  - corregir en una línea con el por qué;
  - cerrar con un siguiente paso.
- Práctica conversacional y corrección textual/gramatical/vocabulario por LLM.
- Avance y repaso derivados de minutas (`tutoringProgress`, `tutoringReview`).
- Selector de idioma y TTS/ASR.

### Lo que falta para una clase formal

- Currículo por nivel y plan de lección.
- Ejercicios con respuesta esperada y corrección determinista.
- Pronunciación: el ASR entrega texto, no puntuación fonética.
- Evaluación inicial y progreso por dominio, no solo por número de sesiones.
- Vocabulario con repetición espaciada.
- Tareas, material de práctica y seguimiento.
- Integración con una guía/documento subido.

### Criterios de aceptación

- El alumno puede practicar inglés conversacional y recibir correcciones claras.
- Cada sesión queda en minuta y alimenta el avance del área.
- No se promete pronunciación ni certificación mientras no exista motor fonético.

**Estado actual:** conversación y corrección básica **sí**; curso estructurado y pronunciación **no**.

---

## 4. Pasar todas las pantallas a inglés

### Lo que existe hoy

- `UI_STRINGS` (~104 cadenas) y `pickText`/`pickLabel`.
- Selector de idioma `es` / `en` / `both` en la cabecera.
- Algunas pantallas ya usan config/diccionario.
- Hay ~73 usos de lógica de idioma en componentes y muchos textos duros en español.

### Lo que falta

- Inventariar **todas** las cadenas visibles: botones, títulos, ayudas, errores, aria-labels, placeholders, toasts, onboarding, minutas, juegos, configuración, sistema y avatar.
- Moverlas a una única fuente (`UI_STRINGS`/`FLU_CONFIG.ui`); prohibido re-declarar idioma en consumidores.
- Eliminar ternarios `isEn` dispersos.
- Definir el comportamiento de `both` en la UI (hoy normalmente resuelve a español).
- Traducir fechas, números, plurales y contenido dinámico.
- Alinear comandos de voz, wake words, TTS y prompts de IA con el idioma.
- Actualizar tests, snapshots y E2E que buscan textos en español.
- Verificación E2E: seleccionar `en` y comprobar que no queda texto español visible.

### Criterios de aceptación

- Cambiar a `en` traduce toda la interfaz sin recargar.
- No hay cadenas visibles hardcodeadas en español.
- La voz, la IA y los errores responden en el idioma seleccionado.
- `both` tiene una regla declarada y probada.

---

## 5. Conversación en inglés con corrección

**Sí, parcialmente ya.**

- Con el idioma en inglés, el prompt de tutoría se inyecta en inglés y el método incluye corregir en una línea con el porqué.
- Funciona para gramática, vocabulario y naturalidad en la conversación.
- No hay corrección fonética ni puntuación de pronunciación: el ASR solo entrega texto.
- La calidad depende del proveedor de IA y de la transcripción del ASR.
- El avance se deriva de las minutas, no de un examen formal.

---

## 6. Orden recomendado

1. Cerrar CI y validar el resultado remoto.
2. Documento activo + chunks + recuperación por sección (estudio de PDF).
3. Minuta de estudio con documento y área.
4. Currículo mínimo de inglés (lecciones, ejercicios, evaluación).
5. i18n completo por superficies, con barrido E2E de textos en español.
6. Voz de alto riesgo solo con sesión real y evidencia.
