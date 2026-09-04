# Propuesta — Cómo integrar la Agenda en el Pizarrón

> **Contexto:** definiste la pantalla en 3 secciones (Barra de comandos / Resultados / Cargas).
> Te falta la **agenda** (horario de clases, carnet médico IMSS).
> Principio que pides seguir: *"todo en un mismo objeto — Alexa, Siri, Google no usan pantalla y aun así tienen recordatorios, alarmas, etc. Nosotros tenemos pantalla y todo amontonado."*

---

## 0. Primero, confirmo que entendí tu pantalla (sin pestañas)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ SECCIÓN 1 · BARRA DE COMANDOS                                              │
│  [ 🔍 Ok flu, ... ]  →  WEB  |  IA  |  transcripción                       │
├────────────────────────────────────────────────────────────────────────────┤
│ SECCIÓN 2 · RESULTADOS  (matriz: origen × tipo)                            │
│                                                                             │
│               TODO          |  IMÁGENES        |  DOCUMENTO / VIDEO        │
│ ────────────────────────────┼──────────────────┼───────────────────────────│
│ 🟢 WEB   búsqueda web       |  imágenes WEB    |  video WEB                │
│ 🔵 IA    resultado IA       |  imágenes IA     |  documento / video IA     │
│ ⚪ OCR    análisis doc OCR   |  imagen escaneo  |  video doc. cargado       │
├────────────────────────────────────────────────────────────────────────────┤
│ SECCIÓN 3 · CARGAS                                                          │
│  [ ⬆ Subir archivo ]                                                       │
└────────────────────────────────────────────────────────────────────────────┘
```

Esto **ya no es pestañas**: es un **objeto único** (una sola estructura) presentado como una **matriz** donde cada celda es un resultado clasificado por su **origen** (fila) y su **tipo** (columna). Correcto.

---

## 1. El principio de Alexa/Siri, aplicado a una pantalla

Alexa/Siri **no amontonan** porque no tienen lienzo persistente. Su secreto es que separan **dos planos**:

| Plano | Qué es | Cómo lo manejan Alexa/Siri | Ejemplo |
|-------|--------|----------------------------|---------|
| **Reactivo** | Lo que TÚ pides ahora | Responden y se acaba | "¿qué tiempo hace?" → contestan |
| **Proactivo** | Lo que existe por tiempo, sin que lo pidas | **Suena solo** cuando toca | alarma, recordatorio, cita |

La agenda (horario, carnet, recordatorios) es **100% plano proactivo**: existe aunque no preguntes. Por eso en Alexa/Siri **no es un "resultado"** — es un **subsistema que habla solo**.

**El error de "todo amontonado"** ocurre cuando metemos el plano proactivo (agenda) dentro del plano reactivo (resultados de una consulta). La agenda no es la respuesta a "Ok flu, busca X" — es el estado permanente de tu día.

---

## 2. Conclusión de diseño: la agenda NO va en la matriz de resultados

La matriz de la Sección 2 clasifica **resultados de consultas** por origen×tipo. La agenda **no tiene origen** (no es WEB/IA/OCR) ni es un "resultado" — es **estado personal y temporal**.

Si la metes como columna o fila de la matriz, vuelves a amontonar: mezclas "lo que pediste" con "lo que siempre está ahí".

**Por eso la agenda vive en su propio plano visual, siempre visible, al lado de los resultados — no dentro de ellos.**

---

## 3. Propuesta visual (recomendada): franja lateral "Hoy" siempre presente

La agenda se integra como un **panel lateral derecho persistente** ("Hoy"), que coexiste con la matriz de resultados. Es el "canal proactivo" de FLU: siempre ahí, sin ocultar ni ser ocultado por los resultados.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ SECCIÓN 1 · BARRA DE COMANDOS                                                │
│  [ 🔍 Ok flu, ... ]  →  WEB | IA | transcripción                             │
├───────────────────────────────────────────────┬──────────────────────────────┤
│ SECCIÓN 2 · RESULTADOS                         │  AGENDA · HOY  (proactivo)  │
│                                                │  ┌────────────────────────┐ │
│      TODO   | IMÁGENES | DOC/VIDEO             │  │ 🕐 14:30 · Lun          │ │
│ ────────────┼──────────┼──────────             │  │                         │ │
│ 🟢 WEB  ... │ ...      │ ...                   │  │ ▶ Próxima clase         │ │
│ 🔵 IA   ... │ ...      │ ...                   │  │   Matemáticas · Aula 3  │ │
│ ⚪ OCR   ... │ ...      │ ...                   │  │   en 20 min             │ │
│                                                │  ├────────────────────────┤ │
│                                                │  │ 🏥 Carnet IMSS          │ │
│                                                │  │   Próx. cita: 17:00     │ │
│                                                │  │   (Dentista)            │ │
│                                                │  ├────────────────────────┤ │
│                                                │  │ ⏰ Recordatorios        │ │
│                                                │  │   ☑ Tomar medicamento  │ │
│                                                │  │   ☑ Junta 16:00        │ │
│                                                │  └────────────────────────┘ │
│                                                │  [ Ver horario completo ]   │
│                                                │  [ Ver carnet completo ]    │
├───────────────────────────────────────────────┴──────────────────────────────┤
│ SECCIÓN 3 · CARGAS  [ ⬆ Subir archivo ]                                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Por qué este panel es la respuesta a tu pregunta:**
- La agenda **siempre está visible** (plano proactivo), igual que una alarma de Alexa que siempre está "armada".
- **No compite** con los resultados: cada plano tiene su zona.
- Es **un mismo objeto**: el panel "Hoy" y la matriz leen el **mismo store**; la agenda es solo un **tipo distinto de ítem** (persistente/temporal) que se dibuja en otra región.

---

## 4. Qué muestra el panel "Hoy" (y de dónde sale cada dato)

| Bloque | Contenido | Fuente en el sistema |
|--------|-----------|----------------------|
| **Próxima clase** | Materia, aula, "en X min" | Horario de clases (recurrente semanal) |
| **Carnet IMSS** | Próxima cita, especialidad, pendientes | Carnet médico (citas, medicamentos) |
| **Recordatorios** | Alarmas, pendientes del día | Recordatorios / alarmas (plano proactivo) |

Cada bloque es **colapsable** y tiene su botón "Ver completo" que abre la vista detallada (horario semanal / carnet) **en el mismo panel**, sin salir del pizarrón ni crear pestañas.

---

## 5. Cómo se mantiene "un mismo objeto" (sin fragmentar)

```
integrationStore (UN solo estado)
├── resultados[]   →  se dibujan en la MATRIZ (Sección 2)
│     { origen: 'web'|'ia'|'ocr', tipo: 'texto'|'imagen'|'doc'|'video', ... }
└── agenda[]       →  se dibujan en el PANEL HOY (lateral)
      { clase: 'horario'|'carnet'|'recordatorio', cuando, ... }
```

- **Un solo store**, dos **tipos de ítem** (resultado vs agenda), dos **regiones visuales**.
- No hay `switch` que oculte: la matriz y el panel "Hoy" **se ven a la vez**.
- La agenda **no se pierde** al cambiar de consulta (es persistente), igual que una alarma de Alexa no se borra porque preguntes otra cosa.

---

## 6. Alternativa (si prefieres menos superficie)

En vez de panel lateral fijo, una **franja superior "Ahora"** colapsable sobre los resultados:

```
┌──────────────────────────────────────────────────────────────┐
│ ⏰ AHORA · 14:30 · ▶ Matemáticas en 20 min · 🏥 Dentista 17:00 │  ← colapsable
├──────────────────────────────────────────────────────────────┤
│ SECCIÓN 2 · RESULTADOS ...                                    │
```

Muestra solo lo **inmediato** (próxima clase / próxima cita) y un botón para expandir el detalle. Ocupa menos espacio, pero la agenda completa queda a un clic.

---

## 7. Decisión que necesito de ti

1. **¿Panel lateral "Hoy" (recomendado)** o **franja superior "Ahora"**?
2. ¿El horario completo y el carnet se abren **dentro del mismo panel** (sin pestañas) o en una **vista de detalle** que reemplaza temporalmente la matriz?
3. ¿La agenda entra como **ítem persistente** en el store (sobrevive a recargas) o solo en sesión?
