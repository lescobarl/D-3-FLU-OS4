# Explicación — Bienestar, Diario y "todo se guarda como conocimiento"

> **Contexto:** te gustó el **panel lateral estilo Outlook** para la agenda. Ahora agregas:
> **bienestar/ánimo**, **diario personal** (guardable y consultable como base de conocimiento),
> y que **todas las conversaciones** se guarden con el perfil al cerrar, aunque no lo pidan.
> Ejemplo que das: *"dime cuándo fue la última vez que lloré?"*
>
> Este documento explica CÓMO encaja todo eso bajo el mismo principio, visual y enfocado.

---

## 1. El principio que ordena todo (no es "qué es", es "cómo se comporta en el tiempo")

Alexa/Siri no amontonan porque separan por **naturaleza temporal**, no por tipo. Hay **tres naturalezas**:

| Naturaleza | Qué es | Ejemplo | En pantalla |
|-----------|--------|---------|-------------|
| **Transitorio** | Lo que pides y se acaba | resultado de una búsqueda | Matriz de resultados (Sección 2) |
| **Programado** | Lo que existe por tiempo | horario, cita, recordatorio | Panel "Hoy" (proactivo) |
| **Acumulativo** | Lo que se guarda y se consulta después | diario, ánimo, conversaciones | **Base de conocimiento** |

Tu nueva petición es la **tercera naturaleza**: que el diario, el ánimo y TODAS las conversaciones se **acumulen** como conocimiento del perfil, para poder preguntarle a FLU después ("¿cuándo fue la última vez que lloré?").

**Ese es el "un mismo objeto" llevado a la memoria:** no solo el pizarrón vivo, sino el **historial personal completo y consultable**.

---

## 2. El panel lateral ya no es solo "Agenda" — es el riel de tu "Vida/Memoria"

Como en Outlook, el panel izquierdo es una **navegación sobre tus datos persistentes**. Cada sección es una **vista** sobre el mismo objeto (el store del perfil), no un compartimento que se oculta:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SECCIÓN 1 · BARRA DE COMANDOS                                                │
│  [ 🔍 Ok flu, ... ]  →  WEB | IA | transcripción                             │
├───────────────────────────────────────────────┬──────────────────────────────┤
│ SECCIÓN 2 · RESULTADOS (transitorio)          │  PANEL · MI VIDA (persistente)│
│  PESTAÑAS: Todo | Imágenes | Doc/Video        │  ┌──────────────────────────┐ │
│  🟢 WEB ...  🔵 IA ...  ⚪ OCR ...             │  │ 📅 HOY  (programado)     │ │
│                                                │  │  ▶ Matemáticas en 20 min │ │
│                                                │  │  🏥 Dentista 17:00       │ │
│                                                │  ├──────────────────────────┤ │
│                                                │  │ 💚 BIENESTAR (registro)  │ │
│                                                │  │  Hoy: 😊 4/5 · racha 6d  │ │
│                                                │  │  [ ¿Cómo te sientes? ]   │ │
│                                                │  ├──────────────────────────┤ │
│                                                │  │ 📓 DIARIO (narrativo)    │ │
│                                                │  │  Hoy: "Me sentí triste..."│ │
│                                                │  │  [ ✍ Escribir entrada ]  │ │
│                                                │  ├──────────────────────────┤ │
│                                                │  │ 🧠 MEMORIA (acumulativo) │ │
│                                                │  │  Minutas · Conversaciones│ │
│                                                │  │  [ 🔎 Preguntar a FLU ]  │ │
│                                                │  └──────────────────────────┘ │
├───────────────────────────────────────────────┴──────────────────────────────┤
│ SECCIÓN 3 · CARGAS  [ ⬆ Subir archivo ]                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

Cada sección del panel es **colapsable** y se expande a su detalle **dentro del mismo panel** (sin pestañas que oculten la matriz).

---

## 3. Cómo responde FLU a "¿cuándo fue la última vez que lloré?"

Esa pregunta **no es una búsqueda web ni una generación** — es una **consulta a la base de conocimiento** del perfil. FLU cruza las tres fuentes acumuladas:

```
"¿cuándo fue la última vez que lloré?"
        │
        ▼  FLU busca en la MEMORIA del perfil (Dexie)
┌──────────────────────────────────────────────────────────────┐
│  💚 moodCheckIns   →  días con ánimo bajo (1-2/5)            │
│  📓 diaryEntries   →  entradas con emoción "tristeza/lloré"  │
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
| Ánimo | [`useMood`](../src/hooks/useMood.ts:1) | `fluDb.moodCheckIns` |
| Conversaciones | `useConversationPersistence` | IndexedDB |

---

## 4. "Guardar todo al cerrar, con el perfil, aunque no lo pidan"

Hoy las conversaciones ya se persisten, pero **no se indexan como conocimiento consultable** (como sí lo hacen las minutas). La propuesta:

```
Al cerrar la sesión (o al terminar un tema):
  1. La conversación se resume (igual que una minuta)
  2. Se guarda como registro de conocimiento del PERFIL activo
  3. Queda consultable: "¿de qué hablamos el martes?", "¿cuándo lloré?"
```

Esto reutiliza el **mismo patrón de las minutas** ([`MinuteSummarySnapshot`](../src/hooks/useMinuteKnowledge.ts:19): titulo, resumen, acuerdos, pendientes) — la conversación se convierte en una "minuta automática" del perfil. **No es un sistema nuevo: es aplicar el patrón de minutas a toda conversación.**

---

## 5. Resumen del modelo (un solo objeto, tres naturalezas)

```
integrationStore / fluDb  (UN solo perfil, UN solo conocimiento)
├── transitorio  →  resultados[]      →  MATRIZ (Sección 2)
├── programado   →  agenda[]          →  PANEL · HOY
└── acumulativo  →  memoria[]         →  PANEL · BIENESTAR / DIARIO / MEMORIA
      ├── moodCheckIns   (ánimo)
      ├── diaryEntries   (diario)
      ├── minuteRecords  (minutas)
      └── conversationRecords (conversaciones auto-guardadas)
```

- **Un solo store** por perfil, **tres naturalezas**, **varias regiones visuales** que conviven.
- Sin `switch` que oculte: matriz + panel se ven a la vez.
- Todo lo acumulativo es **consultable por FLU** (base de conocimiento).

---

## 6. Decisiones que necesito de ti

1. **¿El panel "Mi Vida"** (Hoy + Bienestar + Diario + Memoria) **reemplaza** al panel "Hoy" que propuse, o el Bienestar/Diario/Memoria van en una **segunda columna** o **sub-pestañas del panel**?
2. **¿Guardar conversaciones** como "minuta automática" al cerrar **cada tema**, o solo al **cerrar la app**?
3. **¿El diario y el ánimo** se escriben **solo por voz** (FLU pregunta "¿cómo te sientes?") o también **por texto** en el panel?
4. ¿La consulta a memoria ("¿cuándo lloré?") se responde **en la matriz de resultados** (Sección 2) como un resultado más, o en el **panel**?
