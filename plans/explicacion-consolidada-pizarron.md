# Explicación Consolidada — El Pizarrón "Un Solo Objeto" (corregido)

> **Contexto:** corregiste dos cosas importantes y recortaste el alcance. Este documento es la
> explicación **visual y enfocada** que refleja TUS decisiones finales, sin inventar nada:
>
> ✅ **Corrección 1 — Los resultados NO son una matriz.** Son **pestañas** (Todo | Imágenes | Doc/Video)
> con un **feed consolidado**: todas las respuestas (WEB/IA/OCR) aparecen **juntas** en la misma lista,
> cada una con su **insignia de color** de origen. No hay filas por origen.
>
> ✅ **Corrección 2 — Bienestar/ánimo NO es sección aparte.** Se **pliega dentro del diario personal**.
>
> ✅ **Recortes:** fuera hábitos y metas, fuera agenda de contactos, fuera materia gris,
> lista de compras → **listado de notas**.
>
> ✅ **Se mantiene:** panel lateral estilo Outlook (te gustó), agenda (**horario genérico** — puede ser
> horario escolar, carnet médico, horario laboral, etc., NO hardcodeado a "IMSS"), diario guardable como
> conocimiento, y TODAS las conversaciones como base de conocimiento del perfil.

---

## 1. Tu pantalla, corregida (así la definiste)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SECCIÓN 1 · BARRA DE COMANDOS                                                │
│  [ 🔍 Ok flu, ... ]  →  WEB  |  IA  |  transcripción                         │
├───────────────────────────────────────────────┬──────────────────────────────┤
│ SECCIÓN 2 · RESULTADOS  (pestañas + feed)     │  PANEL · HOY (Outlook)       │
│                                               │  ┌──────────────────────────┐ │
│  [ Todo ] [ Imágenes ] [ Doc/Video ]          │  │ 📅 HOY · 14:30 · Lun     │ │
│  ─────────────────────────────────────         │  │  ▶ Matemáticas en 20 min│ │
│  🟢 WEB  "antónimos de gordo"  (texto)        │  │  🏥 Dentista 17:00       │ │
│  🔵 IA   "los gordos en la historia"          │  │  ⏰ Tomar medicamento    │ │
│  ⚪ OCR   análisis de la junta (doc)           │  ├──────────────────────────┤ │
│  🟢 WEB  imagen de referencia                 │  │ 📓 DIARIO (+ ánimo)      │ │
│  🔵 IA   imagen generada                       │  │  😊 4/5 · "Hoy me sentí" │ │
│  ⚪ OCR   escaneo del documento                │  │  (captura dinámica)      │ │
│                                               │  ├──────────────────────────┤ │
│  → TODAS juntas, cada una con su color.       │  │ 📝 NOTAS                │ │
│    La pestaña solo filtra por TIPO,           │  │  ☐ Comprar leche         │ │
│    nunca separa por origen.                   │  │  ☐ Leer cap. 3           │ │
│                                               │  ├──────────────────────────┤ │
│                                               │  │  (MEMORIA = INVISIBLE)   │ │
│                                               │  │  FLU la consulta por     │ │
│                                               │  │  dentro; la respuesta    │ │
│                                               │  │  llega a Resultados ↑    │ │
│                                               │  └──────────────────────────┘ │
├───────────────────────────────────────────────┴──────────────────────────────┤
│ SECCIÓN 3 · CARGAS  [ ⬆ Subir archivo ]                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

**La diferencia clave que corregiste:** en la matriz yo separaba por origen (fila WEB, fila IA, fila OCR).
Tú dijiste que **no**: todas las respuestas van al mismo feed y el origen es solo una **insignia de color**
sobre cada tarjeta. La pestaña superior (Todo/Imágenes/Doc-Video) solo filtra por **tipo de contenido**,
igual que hoy en el buscador — pero el feed está **consolidado**, no fragmentado.

---

## 2. El principio que ordena todo (Alexa/Siri sin amontonar)

Alexa/Siri no amontonan porque separan por **naturaleza temporal**, no por tipo. Tres naturalezas:

| Naturaleza | Qué es | Ejemplo | Dónde vive en tu pantalla |
|-----------|--------|---------|---------------------------|
| **Transitorio** | Lo que pides y se acaba | resultado de búsqueda / IA / OCR | Sección 2 · Resultados |
| **Programado** | Lo que existe por tiempo, suena solo | horario, cita, recordatorio | Panel · HOY |
| **Acumulativo** | Lo que se guarda y se consulta después | diario, notas, conversaciones | Panel · DIARIO / NOTAS (la memoria es invisible, la consulta FLU por dentro) |

Tu petición de "todo en un mismo objeto" se resuelve así: **un solo store por perfil**, y cada región
visual dibuja un **tipo de ítem** según su naturaleza. Nada se oculta entre sí — conviven.

---

## 3. El panel lateral (Outlook) — qué secciones quedan tras el recorte

| Sección | Naturaleza | Contenido | Fuente en el sistema |
|---------|-----------|-----------|----------------------|
| **📅 HOY** | Programado | Próxima clase, **horario genérico** (escolar / carnet médico / laboral…), recordatorios/alarmas | [`useHorario`](../src/hooks/useHorario.ts:1), [`useReminders`](../src/hooks/useReminders.ts:1) |
| **📓 DIARIO** (+ ánimo) | Acumulativo | Entrada narrativa + escala de ánimo del día | [`useDiary`](../src/hooks/useDiary.ts:1) + [`useMood`](../src/hooks/useMood.ts:1) |
| **📝 NOTAS** | Acumulativo | Listado de notas (reemplaza lista de compras) | nuevo sobre patrón de [`useShoppingList`](../src/hooks/useShoppingList.ts:1) |

**La MEMORIA NO es una sección visible del panel.** Es **invisible**: FLU la consulta por dentro (vía la
base de conocimiento de minutas) y la respuesta llega a los Resultados (Sección 2). Ver §5bis del
[`analisis-riesgos-ejecucion-pizarron.md`](analisis-riesgos-ejecucion-pizarron.md) — la pestaña de minutas
ya implementa este patrón y hay que **extenderla**, no crear una sección nueva.

**Fuera del panel (recortado):** ❌ hábitos y metas · ❌ agenda de contactos · ❌ materia gris ·
❌ bienestar como sección aparte (se pliega en el diario).

---

## 4. El diario con ánimo integrado (una sola entrada, no dos sistemas)

Antes proponía Bienestar y Diario como bloques separados. Tú lo corregiste: **el ánimo es parte del diario**.

```
📓 DIARIO · entrada del día
┌────────────────────────────────────────────┐
│  Fecha: 3 de septiembre                    │
│  😊 4/5                                     │   ← escala de ánimo (1-5)
│  ────────────────────────────────────────  │
│  "Hoy me sentí bien en clase, pero         │
│   me puse triste al recordar a mi abuela"  │   ← texto narrativo
│  [ 💾 Guardar entrada ]                    │
└────────────────────────────────────────────┘
```

**Por qué se pliega:** el ánimo es un **dato corto** (un número) que acompaña a la **narrativa** del día.
No necesita su propia sección — es un **campo** de la entrada del diario. Así una sola consulta
("¿cuándo lloré?") encuentra el ánimo bajo Y el texto triste **en el mismo registro**, sin cruzar dos tablas.

**Nada se pregunta ni se fuerza:** no hay un prompt fijo tipo "¿Cómo te sientes hoy?". FLU **no pregunta**;
simplemente **captura de forma dinámica** lo que el usuario dice o escribe. Si el usuario menciona su ánimo
("hoy estoy triste", "me siento bien"), eso se registra como el campo de ánimo de la entrada. Si no lo dice,
la entrada queda solo con su texto. Todo es dinámico, sin guiones ni preguntas hardcodeadas.

---

## 5. Cómo responde FLU a "¿cuándo fue la última vez que lloré?"

Esa pregunta **no es búsqueda web ni generación** — es una **consulta a la base de conocimiento** del perfil.
FLU cruza las fuentes acumuladas:

```
"¿cuándo fue la última vez que lloré?"
        │
        ▼  FLU busca en la MEMORIA del perfil (Dexie)
┌──────────────────────────────────────────────────────────────┐
│  📓 diaryEntries   →  entradas con ánimo bajo (1-2/5)         │
│                     y/o texto con "triste / lloré / abuela"  │
│  💬 conversaciones →  transcripciones donde dijiste "lloré"  │
└──────────────────────────────────────────────────────────────┘
        │  cruza fechas y encuentra la más reciente
        ▼
"La última vez fue el 12 de agosto. Ese día registraste ánimo 2/5
 y escribiste en tu diario: 'Me sentí muy triste por...'."
```

**Esto ya es posible con la infraestructura actual** — solo hay que **unificar la consulta**:

| Fuente | Ya existe | Se guarda en |
|--------|-----------|--------------|
| Minutas (base de conocimiento) | [`useMinuteKnowledge`](../src/hooks/useMinuteKnowledge.ts:1) | `fluDb` (Dexie) |
| Diario | [`useDiary`](../src/hooks/useDiary.ts:1) | `fluDb.diaryEntries` |
| Ánimo (campo del diario) | [`useMood`](../src/hooks/useMood.ts:1) | `fluDb.moodCheckIns` |
| Conversaciones | persistencia de conversación | IndexedDB |

---

## 6. "Guardar todo al cerrar, con el perfil, aunque no lo pidan"

Hoy las conversaciones ya se persisten, pero **no se indexan como conocimiento consultable**
(como sí lo hacen las minutas). La propuesta reutiliza el **mismo patrón de minutas**
([`MinuteSummarySnapshot`](../src/hooks/useMinuteKnowledge.ts:19): titulo, resumen, acuerdos, pendientes).

**Aclaración del guardado "al vuelo" (decisión del usuario):** hay DOS capas distintas:

```
Capa 1 · Transcripto crudo  →  YA se guarda solo, turno a turno
        (useConversationPersistence → fluDb.conversations)
        → INMUNE a apagones: si el cel se apaga, nada se pierde.

Capa 2 · Resumen de memoria  →  se genera UNA vez al cerrar la app
        (registro kind: 'conversacion' | 'diario', igual que una minuta)
        → un apagón abrupto pierde SOLO este resumen, nunca el transcripto.
```

**No se agrega lógica de resumen durante la conversación** (se descartó resumir en cada silencio por
ser pesado). El resumen se intenta una sola vez al cerrar, reutilizando el pipeline de
`handleGenerateSummary` + `addMinute` con campo `kind`. El usuario aceptó explícitamente que un cierre
abrupto pierda el resumen de esa sesión, porque el transcripto crudo ya sobrevive y FLU puede releerlo.

**No es un sistema nuevo: es aplicar el patrón de minutas a toda conversación.** Cada conversación
se convierte en una "minuta automática" del perfil, con su fecha y su resumen.

---

## 7. Resumen del modelo (un solo objeto, tres naturalezas)

```
integrationStore / fluDb  (UN solo perfil, UN solo conocimiento)
├── transitorio  →  resultados[]   →  SECCIÓN 2 · pestañas + feed consolidado
│     { origen: web|ia|ocr, tipo: texto|imagen|doc|video }  ← insignia de color
├── programado   →  agenda[]       →  PANEL · HOY
│     { clase: horario|recordatorio, cuando }   ← horario genérico (escolar/carnet/laboral)
└── acumulativo  →  memoria[]      →  PANEL · DIARIO / NOTAS  (la memoria es INVISIBLE)
      ├── diaryEntries   (diario + campo ánimo)
      ├── noteItems      (listado de notas)
      └── knowledgeRecords (minutas + conversaciones auto-guardadas)
            └── un solo registro con campo kind: 'minuta' | 'conversacion' | 'diario'
```

- **Un solo store** por perfil, **tres naturalezas**, **varias regiones visuales** que conviven.
- Sin `switch` que oculte: resultados + panel se ven a la vez.
- Todo lo acumulativo es **consultable por FLU** (base de conocimiento).

---

## 8. Todo debe ser LEÍDO por FLU, platicado y entendido (el pizarrón es su contexto)

Este es el principio más importante y el que hace que "un solo objeto" no sea solo visual:
**FLU no es un espectador de la pantalla — el pizarrón es su contexto.** Todo lo que se dibuja
(resultados, HOY, diario, notas, memoria) debe poder **leerse**, **platicarse** y **entenderse** por FLU.

### Cómo "ve" FLU hoy (y qué le falta)

FLU "ve" por su **contexto**: lo que se inyecta en su prompt LLM. Hoy:

| Región | ¿FLU la lee? | Cómo |
|--------|-------------|------|
| **Conversación** (lo que se dice) | ✅ Sí | `conversationHistory` → `dialogueHistoryRef` → contexto Gemini |
| **Minutas** (al generarlas) | ✅ Sí | se resumen y se hablan por voz |
| **Resultados** (feed Sección 2) | ⚠️ Parcial | solo la última respuesta entra al contexto |
| **HOY** (agenda/horario/recordatorios) | ❌ No | es solo estado de UI, no se inyecta |
| **DIARIO / NOTAS** | ❌ No | se guardan en Dexie pero no se leen al conversar |
| **MEMORIA (minutas)** | ✅ Sí | [`getMinuteKnowledgeBase`](../src/App.tsx:1478) → KB inyectada en el contexto Gemini |

**El hueco:** si preguntas *"¿qué tengo mañana?"* o *"¿qué anoté ayer?"*, FLU **no puede responder**
desde el panel, porque ese estado no está en su contexto. La pantalla lo muestra, pero FLU no lo "ve".

### El principio: cada región se vuelve un "bloque de contexto" legible

Para que FLU lea, platique y entienda TODO, cada región debe exponer un **resumen estructurado**
que se inyecta en el contexto de FLU cuando corresponde:

```
contexto de FLU (lo que FLU "ve" y entiende)
├── 💬 conversación actual        (ya existe)
├── 📅 HOY → "Hoy 14:30 Matemáticas, 17:00 Dentista, 1 recordatorio pendiente"
├── 📓 DIARIO → "Última entrada: 3 sep, ánimo 4/5, 'me sentí bien en clase...'"
├── 📝 NOTAS → "3 notas pendientes: leche, cap. 3, ..."
└── 🟢🔵⚪ RESULTADOS → "Última consulta: antónimos de gordo → 5 resultados"
```

**La MEMORIA no es un bloque visible aparte:** ya entra por dentro vía la **base de conocimiento de
minutas** ([`buildMinuteKnowledgeBase2`](../src/lib/minuteKnowledgeHelpers.ts:223)), que FLU lee
internamente. El gap (ver §5bis del análisis de riesgos) es que esa KB hoy solo cubre minutas
estructuradas; hay que **generalizarla con un campo `kind`** para que diario y conversaciones también
se lean por dentro y la respuesta aterrice en Resultados (Sección 2).

Así, cuando el usuario dice algo, FLU **ya sabe** qué hay en cada región y puede:
- **Leerlo:** "ve" el estado del panel y los resultados como parte de su contexto.
- **Platicarlo:** responder *"mañana tienes Matemáticas a las 8 y Dentista a las 17:00"*.
- **Entenderlo:** cruzar regiones, p. ej. *"tu ánimo bajó el día que tenías examen"*.

### No es hardcode: es un "resumen vivo" generado de los datos

Cada bloque NO es un texto fijo escrito a mano (Rule #1: NO HARDCODE). Es un **resumen vivo**
que se construye **dinámicamente** desde el store del perfil (Dexie) en el momento en que FLU
necesita contexto — igual que hoy se genera la minuta desde la conversación. Si no hay datos,
el bloque simplemente no aparece; FLU nunca inventa ni pregunta por lo que no existe.

### El flujo completo (leer → entender → platicar)

```
Usuario: "¿cuándo fue la última vez que lloré?"
   │
   ▼ FLU arma su contexto (bloques legibles del perfil)
   │   📓 diario + 💬 conversaciones  →  busca "triste / lloré / ánimo bajo"
   ▼ FLU entiende y responde por voz y en resultados
   "La última vez fue el 12 de agosto. Ese día registraste ánimo 2/5
    y escribiste en tu diario: 'Me sentí muy triste por...'."
```

**En una frase:** el pizarrón consolidado no es solo "todo a la vista" — es **todo legible por FLU**.
Cada región es un bloque de contexto que FLU puede leer, entender y platicar, construido de forma
dinámica desde los datos del perfil, sin preguntas ni textos hardcodeados.

### El "radar" de FLU — inventario definitivo de lo que FLU DEBE leer

Para que la ejecución no olvide nada, este es el **checklist único** de bloques de contexto que FLU
debe leer en el pizarrón consolidado, con su fuente real, su punto de inyección y su estado HOY.
Todo se inyecta en un solo lugar: [`requestFluContract`](../src/voice/hooks/useFluVoiceAssistant.js:1025)
dentro de [`useFluVoiceAssistant.js`](../src/voice/hooks/useFluVoiceAssistant.js:1).

| # | Bloque que FLU lee | Qué contiene | Fuente real (Dexie/store) | Punto de inyección HOY | Estado |
|---|--------------------|--------------|---------------------------|------------------------|--------|
| 1 | 💬 **Conversación actual** | transcripto del turno en curso | `conversationHistory` → `dialogueHistoryRef` | `history` ([`useFluVoiceAssistant.js:1034`](../src/voice/hooks/useFluVoiceAssistant.js:1034)) | ✅ YA lee |
| 2 | 🧠 **Persona / conocimiento base** | identidad y reglas de FLU | config estática | `knowledgeBase` ([`useFluVoiceAssistant.js:1035`](../src/voice/hooks/useFluVoiceAssistant.js:1035)) | ✅ YA lee |
| 3 | 🗂️ **MEMORIA (minutas)** | todas las minutas del perfil | `fluDb.minutes` | `knowledgeBase2` SOLO si `knowledgeMode==='minutes'` ([`useFluVoiceAssistant.js:1036`](../src/voice/hooks/useFluVoiceAssistant.js:1036)) | ⚠️ Parcial (solo minutas, solo en modo minutes) |
| 4 | 📅 **Agenda del día (HOY)** | pendientes de minutas + recordatorios | [`getDailyAgenda`](../src/App.tsx:1485) → `buildDailyAgenda` + `mergeRemindersIntoAgenda` | `agendaText` ([`useFluVoiceAssistant.js:1042`](../src/voice/hooks/useFluVoiceAssistant.js:1042)) | ⚠️ Parcial (solo pendientes/recordatorios, NO el horario del día) |
| 5 | 🪞 **Autoconocimiento** | manifiesto 1ª persona de FLU | [`getSelfManifesto`](../src/App.tsx:1509) → `buildSelfManifesto` | `selfKnowledgeText` SOLO si `isSelfKnowledgeRequest` ([`useFluVoiceAssistant.js:1043`](../src/voice/hooks/useFluVoiceAssistant.js:1043)) | ✅ YA lee (condicional) |
| 6 | 🟢🔵⚪ **Resultados (Sección 2)** | última consulta y su feed | `workspaceArtifact` / `latestResponse` | ❌ NO se inyecta | ❌ FALTA |
| 7 | 📓 **DIARIO (+ ánimo)** | última entrada del perfil | `fluDb.diaryEntries` + `fluDb.moodCheckIns` | ❌ NO se inyecta | ❌ FALTA |
| 8 | 📝 **NOTAS** | notas pendientes del perfil | nuevo store de notas | ❌ NO se inyecta | ❌ FALTA |
| 9 | 📅 **Horario del día (HOY)** | **horario genérico** de hoy (escolar / carnet médico / laboral…) | `fluDb.horario` (registros con `tipo` libre) | ❌ NO se inyecta | ❌ FALTA |

**Lectura del radar:** los bloques 1, 2 y 5 ya se leen. El 3 (memoria) y el 4 (agenda) se leen **parcial**
— el 3 solo cubre minutas y solo en modo `minutes`; el 4 cubre pendientes/recordatorios pero **no** el
horario del día. Los bloques 6, 7, 8 y 9 **no se leen hoy**: son el hueco real que la implementación
debe cerrar para que "todo sea leído por FLU".

**Regla de oro del radar:** cada bloque se construye **dinámicamente** desde su fuente (Rule #1: NO
HARDCODE) y devuelve `''` si no hay datos — así FLU nunca inventa ni pregunta por lo que no existe, y el
límite de contexto (`CONTEXT_HISTORY_LIMIT = 12`) se respeta porque los bloques son resúmenes cortos
(top-N), no volcados completos. Detalle de riesgos y mitigación en §4 del
[`analisis-riesgos-ejecucion-pizarron.md`](analisis-riesgos-ejecucion-pizarron.md).

### El horario es GENÉRICO (no "carnet IMSS" hardcodeado)

El bloque 9 (HOY) **no es un concepto fijo "IMSS"**. Es un **horario genérico** que puede representar
cualquier tipo de agenda recurrente: horario escolar, carnet médico (IMSS u otro), horario laboral,
rutina de gimnasio, etc. Cada registro de `fluDb.horario` lleva un campo **`tipo` libre** (p. ej.
`'escuela'`, `'medico'`, `'trabajo'`) y el bloque HOY se construye **dinámicamente** desde esos datos
(Rule #1: NO HARDCODE). El usuario no configura "IMSS" en ningún lado: simplemente sube o dicta su
horario y FLU lo lee y lo muestra. Si mañana es un horario de natación, es el mismo mecanismo.

### Digitalizar una imagen de horario → se vuelve el HOY (no solo un OCR en Resultados)

Cuando el usuario **sube/carga una imagen de horario** (p. ej. el horario escolar), el flujo NO se
queda solo como un resultado OCR en la Sección 2. La imagen se **digitaliza y se convierte en datos
estructurados** que pueblan la región HOY (bloque 9) y quedan guardados en `fluDb.horario`:

```
Usuario sube "horario_escolar.jpg"
   → OCR/visión extrae la tabla (día, hora, materia/lugar)
   → se parsea a registros { dia, horaInicio, horaFin, titulo, tipo:'escuela' }
   → se guardan en fluDb.horario  (persistente, por perfil)
   → HOY (bloque 9) los lee y muestra: "Hoy 14:30 Matemáticas, 16:00 Historia"
   → FLU ya puede platicarlos: "¿qué tengo mañana?"
```

Así, **digitalizar = sembrar datos**, no solo "ver el documento". La imagen original sigue apareciendo
como resultado OCR en la Sección 2 (transitorio), pero su **contenido estructurado** pasa a la región
HOY (programado) y a la memoria consultable. El usuario confirma el parseo antes de guardar (nada se
escribe sin su visto bueno), y el mismo mecanismo sirve para cualquier tipo de horario.

---

## 9. Decisiones YA resueltas (y el hallazgo de la pestaña de minutas)

Las 3 preguntas abiertas quedaron **resueltas**:

1. **Panel lateral = riel colapsable** (estilo Outlook): HOY + DIARIO + NOTAS como columna lateral que
   colapsa a iconos. **MEMORIA NO es sección visible** — es invisible.
2. **Guardar conversaciones = SOLO al cerrar la app** — aclarado: esto aplica SOLO al **resumen** de
   memoria (registro `kind`). El transcripto crudo YA se guarda turno a turno (`useConversationPersistence`,
   inmune a apagones). El resumen se genera UNA vez al cerrar; un apagón abrupto pierde solo el resumen,
   nunca el transcripto. Sin lógica de resumen durante la conversación (ver §6).
3. **La consulta a memoria se responde en los Resultados (Sección 2)**, como una tarjeta más con su
   insignia — no en el panel.

### Hallazgo clave: la pestaña de minutas YA es la "memoria invisible"

Al analizar la pestaña de minutas ([`App.tsx:3979`](../src/App.tsx:3979)) se confirmó que **ya implementa
el patrón** que pedimos para la memoria invisible:

| Etapa | Cómo lo hace hoy la pestaña de minutas |
|-------|----------------------------------------|
| **Persistir** | [`useMinuteKnowledge.addMinute`](../src/hooks/useMinuteKnowledge.ts:211) → `fluDb.minutes` por perfil |
| **Leer KB** | [`getMinuteKnowledgeBase`](../src/App.tsx:1478) → [`buildMinuteKnowledgeBase2`](../src/lib/minuteKnowledgeHelpers.ts:223) inyecta todas las minutas al contexto Gemini |
| **Consultar** | [`resolveMinuteLookup`](../src/App.tsx:1510) → [`resolveMinuteQuery`](../src/lib/minuteKnowledgeHelpers.ts:409) |
| **Responder** | [`onContractResolved`](../src/App.tsx:1691) → [`selectMinuteForLookup`](../src/lib/minuteKnowledgeHelpers.ts:260) aterriza la respuesta en el workspace/Resultados |

**El gap:** hoy solo cubre **minutas estructuradas**. Para que sea la memoria invisible del pizarrón
(conversaciones + diario también guardados y consultados), hay que **generalizar el registro** con un
campo `kind` ('minuta'|'conversacion'|'diario') y ampliar la KB y la consulta — NO crear un sistema
paralelo. Detalle completo en §5bis del
[`analisis-riesgos-ejecucion-pizarron.md`](analisis-riesgos-ejecucion-pizarron.md).
