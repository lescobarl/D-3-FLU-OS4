# Issue #5 — Lista de comandos de voz precisos

> Documento de referencia con las frases EXACTAS que el motor reconoce hoy
> (determinista + catálogo + parsers), para las 10 acciones pedidas, más la
> lista complementaria de lo que falta. Cada frase está contrastada contra el
> código real (regex/patrones) para que funcione sin depender del LLM.

---

## 0. Cómo se activa la escucha (contexto)

- **Modo conversación (mic pulsado):** se escucha de forma continua. Se puede
  hablar sin palabra de activación.
- **Modo pasivo (palabra de activación):** se debe empezar con una wake word.
  Wake words reconocidas: `oye flu`, `ok flu`, `hey flu`, `oye flow`, `oye blue`,
  `oye flo`, `okay flu`, etc. (16 variantes).

Las frases de abajo funcionan en ambos modos; en pasivo, antepón la wake word
(ej. "oye flu, crea un video de un conejo saltando").

---

## 1. Las 10 acciones pedidas

### 1.1 Crear un video de un conejo saltando
Canal: **video** (generación de video explicativo).

Frases reconocidas (catálogo `generateVideo`):
- `crea un video de un conejo saltando`
- `genera un video de un conejo saltando`
- `generame un video de un conejo saltando`
- `crear video de un conejo saltando`
- `generar video de un conejo saltando`

> El motor abre el generador de video y usa el resto de la frase ("un conejo
> saltando") como tema. Si no se incluye el tema, FLU pregunta qué video crear.

### 1.2 Crear una carta de 1 página sobre un conejo saltando
Canal: **documento** (generación de documento).

Frases reconocidas (catálogo `generateDocument`, incluye frases de carta):
- `genera una carta sobre un conejo saltando`
- `genera carta sobre un conejo saltando`
- `generame una carta sobre un conejo saltando`
- `escribe una carta sobre un conejo saltando`
- `redacta una carta sobre un conejo saltando`
- `crea un documento sobre un conejo saltando`
- `generar documento sobre un conejo saltando`

> La longitud (1 página) se ajusta en el generador de documento (tema +
> extensión). El motor abre el generador con el tema "un conejo saltando".

### 1.3 Búsqueda web sobre cómo saltan los conejos (pestañas Todo/Imagen/Video)
Canal: **web** (buscador con pestañas).

Frases reconocidas (catálogo `buscar`):
- `busca en la web cómo saltan los conejos`
- `buscar en la web cómo saltan los conejos`
- `busca en internet cómo saltan los conejos`
- `busca información sobre cómo saltan los conejos`
- `busca sobre cómo saltan los conejos`
- `búscame cómo saltan los conejos`
- `busca en google cómo saltan los conejos`

> El buscador abre con la consulta "cómo saltan los conejos" y muestra las
> pestañas **Todo / Imágenes / Video** con resultados en cada una (el buscador
> ya separa por tipo: web, images, video).

### 1.4 Crear una cita para mañana a las 10
Canal: **flu** (recordatorio/cita → `reminder.add`).

Frases reconocidas (parser de citas `CITA_TRIGGER_ES`):
- `crea una cita para mañana a las 10`
- `agenda una cita para mañana a las 10`
- `programa una cita para mañana a las 10`
- `ponme una cita para mañana a las 10`
- `quiero crear una cita para mañana a las 10`

> Las citas se modelan como recordatorios. El parser resuelve "mañana" +
> "a las 10" a un timestamp. Si quieres persona: `crea una cita con el doctor
> para mañana a las 10`.

### 1.5 Crear una alarma a las 11:23
Canal: **flu** (temporal → `alarm.add`).

Frases reconocidas (parser temporal `ALARM_ADD_ES`):
- `pon una alarma a las 11:23`
- `ponme una alarma a las 11:23`
- `configura una alarma a las 11:23`
- `crea una alarma a las 11:23`
- `activa una alarma a las 11:23`
- `despiértame a las 11:23`
- `alarma a las 11:23`

> El parser extrae la hora "11:23". También acepta "once y veintitrés" si el
> ASR lo transcribe como hora. Para repetir: `pon una alarma a las 7 los lunes`.

### 1.6 Dictar el diario de hoy
Canal: **flu** (diario → `diary.addEntry`).

Frases reconocidas (handler de diario):
- `escribe en el diario hoy fui al parque y vi un conejo`
- `guarda en el diario hoy fui al parque y vi un conejo`
- `anota en el diario hoy fui al parque y vi un conejo`
- `diario: hoy fui al parque y vi un conejo`
- `diario hoy fui al parque y vi un conejo`

> El contenido tras el marcador se guarda como entrada de HOY (fecha actual).

### 1.7 Crear una nota super lista
Canal: **flu** (nota → `notes.add`).

Frases reconocidas (handler de nota, patrón "para el super"):
- `crea una nota para el super`
- `crea una nota para el supermercado`
- `nota para el super`
- `nota para ir al super`
- `nota para el super comprar zanahorias y lechuga`

> Si se añade contenido tras el marcador, se guarda como "Super: {contenido}".
> Sin contenido, se crea la nota "Super".

### 1.8 Crear un recordatorio de medicamento a las 12
Canal: **flu** (recordatorio → `reminder.add`).

Frases reconocidas (parser de recordatorios `REMINDER_TRIGGERS_ES`):
- `recuérdame tomar el medicamento a las 12`
- `recuerdame tomar el medicamento a las 12`
- `recuerda tomar el medicamento a las 12`
- `no olvides tomar el medicamento a las 12`
- `acordate de tomar el medicamento a las 12`

> El parser separa el texto ("tomar el medicamento") de la cláusula de tiempo
> ("a las 12") y agenda el recordatorio.

### 1.9 Cambiar el ambiente a más verde y guardarlo como nueva estación "estación verde"
**ESTADO ACTUAL — PARCIAL (ver §2.9):**
- **Activar un ambiente verde existente (el "Jardinero" es el más verde):**
  - `actua como jardinero`
  - `modo huerto`
  - `modo jardin`
  - `ensename a cultivar`
- **Volver al asistente (reset):** `vuelve al asistente` / `modo asistente`.

> **GAP:** No existe un ambiente "estación verde" ni un comando de voz para
> **crear/guardar una nueva estación**. El registro de ambientes solo existe por
> la UI (panel Ambientes → "nueva estación"). No hay frase de voz que llame a
> `registerAmbiente`. Ver §2.9 para la propuesta de complemento.

### 1.10 Tomar una foto
**ESTADO ACTUAL — NO SOPORTADO (ver §2.10):**
- No existe ningún comando de voz ni handler de cámara/foto.
- `useDeviceActions` solo maneja llamadas/contactos (`tel:`, `wa.me`, `sms:`,
  `mailto:`), NO captura de foto.

> **GAP:** No hay forma de "tomar una foto" por voz. Ver §2.10.

---

## 2. Lista complementaria (lo que falta / aclaraciones)

### 2.1 Wake words (para modo pasivo)
`oye flu`, `ok flu`, `hey flu`, `oye flow`, `oye blue`, `oye flo`, `okay flu`
(+ variantes). 16 en total.

### 2.2 Abrir/cerrar escucha
- Abrir: `escucha`, `empieza a escuchar`, `ponte a escuchar`, `abre el micro`.
- Cerrar: `deja de escuchar`, `para de escuchar`, `cállate`, `silencio`.

### 2.3 Iniciar conversación
`hablemos`, `conversemos`, `empecemos a conversar`, `charlar`.

### 2.4 Generar minuta / resumen
- Minuta: `genera la minuta`, `generar minuta`, `crea la minuta`.
- Resumen: `genera un resumen`, `resume la conversación`.

### 2.5 Analizar documento / app
- Documento: `analiza este documento`, `analizar documento`.
- App: `analiza esta app`, `analizar aplicación`.

### 2.6 Guardar minuta
`guarda la minuta`, `guardar minuta`, `guarda esta minuta`.

### 2.7 Navegación web
`navegar a wikipedia`, `abrir wikipedia`, `buscar en wikipedia`, `ir a youtube`,
etc. (catálogo `navigate`).

### 2.8 Conocer a FLU
`quien eres`, `que puedes hacer`, `presentate`, `conocer flu`.

### 2.9 GAP — Crear/guardar una nueva estación por voz
No hay comando de voz para `registerAmbiente`. Para cumplir "guardarlo como
nueva estación 'estación verde'" se necesita:
1. Un comando de voz tipo `crea una estación verde` / `guarda este ambiente
   como estación verde` que capture el tema actual (o un preset verde) y llame
   a `registerAmbiente` con un nuevo `EnvironmentDefinition`.
2. Añadir la frase de activación al nuevo ambiente para poder invocarlo después
   por voz (p. ej. `activa la estación verde`).

### 2.10 GAP — Tomar foto por voz
No hay captura de foto. Para soportarlo se necesitaría:
1. Un handler de cámara (getUserMedia → captura de imagen) o integración con la
   cámara del dispositivo.
2. Un comando de voz tipo `toma una foto` / `saca una foto` que dispare la
   captura y guarde la imagen (p. ej. en el workspace o como adjunto).

### 2.11 GAP — Longitud de documento "1 página"
El generador de documento acepta el tema pero la extensión/páginas se controla
en el generador. Para fijar "1 página" por voz se necesitaría un parámetro de
longitud (p. ej. `una carta de una página sobre...`).

---

## 3. Resumen ejecutivo

| # | Acción | ¿Soportado? | Frase canónica |
|---|--------|-------------|----------------|
| 1 | Video conejo saltando | ✅ | `crea un video de un conejo saltando` |
| 2 | Carta 1 página conejo | ✅ (tema) | `genera una carta sobre un conejo saltando` |
| 3 | Búsqueda web (Todo/Img/Video) | ✅ | `busca en la web cómo saltan los conejos` |
| 4 | Cita mañana a las 10 | ✅ | `crea una cita para mañana a las 10` |
| 5 | Alarma 11:23 | ✅ | `pon una alarma a las 11:23` |
| 6 | Diario de hoy | ✅ | `escribe en el diario {contenido}` |
| 7 | Nota super lista | ✅ | `crea una nota para el super` |
| 8 | Recordatorio medicamento 12 | ✅ | `recuérdame tomar el medicamento a las 12` |
| 9 | Ambiente verde + guardar estación | ⚠️ parcial | `actua como jardinero` (activar); guardar = GAP |
| 10 | Tomar foto | ❌ | GAP — no soportado |

**Complementos necesarios (para cerrar los 3 gaps):**
1. Comando de voz para crear/guardar una nueva estación (`registerAmbiente`).
2. Comando de voz + handler de cámara para "tomar una foto".
3. Parámetro de longitud de página en la generación de documentos.
