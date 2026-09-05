# Plan de Reestructura — FLU-OS4 como PLATAFORMA unificada

> **Concepto rector (una sola idea, aplicada a todo):**
> FLU no es un sistema de módulos sueltos, es una **PLATAFORMA**: un núcleo
> estable (la "suma algebraica fija") + funciones de valor agregado (los
> "términos cargo/abono"). Agregar una función = agregar un término, NUNCA
> reescribir el núcleo.
>
> Todos los comandos de voz salen de **UNA misma tubería** y apuntan a
> **distintos elementos de integración** (IA, WEB, IMAGEN, VIDEO, WORD). Los
> medios/resultados de integración SON esos objetos. La barra de navegación es
> el pivote y manda ("lo que se escriba ahí es la ley"). La última frase debe
> ser consistente. Las funciones generales (notas, citas, alarmas, horario
> escolar) son solo adiciones. Las conversaciones y minutas son explotación de
> información. La carga de archivos son insumos (OCR, PNG). El navegador
> funciona como Google. El configurador debe reducirse a solo APIs; lo demás lo
> gobierna la IA.

---

## 0. Estado de partida (baseline verificado)

- HEAD: `ead8ff0` (tras commitear los fixes de cita/nota/video + limpieza de
  test-output.txt).
- Suite completa: **138 archivos / 2617 tests, todos en verde**.
- `tsc` limpio (verificado en sesión previa).

## 1. Diagnóstico del "batidero" (la dispersión actual)

La intención + selección de canal está repartida en 4+ árbitros que NO se
hablan entre sí:

| Punto de decisión | Archivo | Cubre |
|---|---|---|
| `resolveDeterministicCommand` | [`deterministicArbiter.js`](../src/voice/lib/deterministicArbiter.js:59) | config/game/environment/horario/navigation |
| Bloque determinista en `onContractResolved` | [`App.tsx`](../src/App.tsx:1736) | cita/nota/diario/horario/recordatorio/temporal |
| `resolveFinalConversationAction` | [`audioMath.js`](../src/voice/lib/audioMath.js:618) | command vs flu (IA) |
| `evaluateDeterministicFastPaths` | [`useFluVoiceAssistant.js`](../src/voice/hooks/useFluVoiceAssistant.js:2913) | config/game/env fast-path |
| `resolveDeterministicSkipGeminiContract` | [`deterministicArbiter.js`](../src/voice/lib/deterministicArbiter.js:256) | skip-Gemini |

La separación de la wake word también está en 4+ lugares:
[`App.tsx:1736`](../src/App.tsx:1736), [`splitTranscriptAtWakeWord`](../src/voice/lib/audioMath.js:332),
[`stripWakeWordForDisplay`](../src/voice/lib/audioMath.js:1011),
[`extractFluVoiceCommand`](../src/voice/lib/audioMath.js:942).

**El patrón que SÍ funciona** (confirmado por el usuario) es
`"OK FLU PLATICAME DE XXX..."` → canal IA vía acción `flu`. Ese es el molde.

## 2. La meta estructural (a dónde llegar)

Un **único punto de entrada de voz** que:
1. Normaliza el mandato (quita wake word + colapsa eco ASR) — UNA vez.
2. Resuelve la intención contra un **árbitro unificado** que conoce TODOS los
   dominios (config, game, environment, horario, navigation, reminder, temporal,
   note, diary, IA/flu, web, video, documento).
3. Devuelve un **contrato de integración** con el canal destino (IA/WEB/VIDEO/
   WORD/IMAGEN + funciones-adición).
4. Despacha por `onContractResolved` (el pivote único de ejecución).

Agregar una función nueva = agregar un **término** al árbitro (un resolver de
dominio + su manejador), sin tocar el núcleo de la tubería.

## 3. Fases de ejecución (incrementales, suite siempre en verde)

### Fase A — Consolidar la normalización del mandato (1 punto)
- Extraer la lógica de "quitar wake word + colapsar eco ASR" que hoy vive
  inline en [`App.tsx:1736`](../src/App.tsx:1736) a una función pura reutilizable
  en `audioMath.js` (p. ej. `normalizeCommandForDeterministic`), y que el bloque
  de App la consuma. Elimina la duplicación conceptual con
  `splitTranscriptAtWakeWord`/`stripWakeWordForDisplay`.
- Test unitario dedicado.

### Fase B — Extender el árbitro unificado (el "hub")
- Ampliar [`deterministicArbiter.js`](../src/voice/lib/deterministicArbiter.js) para
  que `resolveDeterministicCommand` también reconozca los dominios de
  **función-adición** (reminder, temporal, note, diary) y los canales de
  **integración** (IA/flu, web, video, documento), reutilizando los parsers que
  ya existen (`parseReminderIntent`, `parseTemporalIntent`, parsers de nota/
  diario) y el patrón `flu` de `PLATICAME`.
- El árbitro devuelve `{ matched, domain, action, channel }` donde `channel`
  es el elemento de integración destino.
- Mantener `resolveStatefulDomains` y `resolveDeterministicSkipGeminiContract`
  intactos (no romper los tests existentes).

### Fase C — Unificar el despacho en `onContractResolved`
- Que el bloque determinista de [`App.tsx`](../src/App.tsx:1736) consulte el
  árbitro unificado en lugar de encadenar 5 manejadores a ciegas. Cada dominio
  matcheado despacha a su manejador; si ninguno matchea, cae a la IA (flu).
- Esto hace que "la última frase sea consistente": un solo camino de respuesta.

### Fase D — Limpiar el configurador (solo APIs)
- Auditar [`fluConfig.js`](../src/voice/lib/fluConfig.js) y los paneles de
  settings para identificar opciones que nadie tocará (p. ej. estacionales) y
  que la IA debe gobernar. Reducir el configurador a solo APIs/llaves que el
  usuario realmente configura; mover lo estacional a gobernanza por IA.

### Fase E — Mejorar la diarización (identificar al niño/creador)
- Mejorar la identificación del hablante para reconocer a Juan (niño que crea
  su usuario) o Luis (que crea el suyo), SIN introducir regresiones. Reforzar
  el vínculo entre el perfil creado y la voz que lo crea.

## 4. Reglas de ejecución
- Trabajar de noche, de forma autónoma y continua, sin detenerse a preguntar.
- Cada fase deja la suite en verde (138 archivos / 2617 tests) y `tsc` limpio.
- Commits pequeños y descriptivos por fase.
- NO reescribir el núcleo: solo agregar términos al árbitro y consolidar puntos
  duplicados.
