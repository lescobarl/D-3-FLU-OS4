# Bugs de producto — 11 casos (2026-09-14)

Síntoma → causa raíz (evidencia) → regla/DoD. **Constraints obligatorios abajo.**

## Casos

1. **Agenda del día incompleta.** `dailyAgenda.ts:86,175` + `App.tsx:1728-1748` juntan sólo minutas + recordatorios.
   DoD: “ok flu, ¿qué hay para hoy?” lista **citas, juntas, recordatorios, alarmas y notas** del día. Fuente única; acción determinista (no depender del LLM para el listado).

2. **No limpia la imagen anterior.** `useWorkspaceImage.ts:150-154` no limpia `imageUrl`; `clearWorkspace()` existe (`integrationStore.ts:217`).
   DoD: al pedir imagen nueva, se limpia la anterior; sólo se pinta la nueva al llegar.

3. **Minuta del día anterior no se guarda.** `App.tsx:4490` llama `handleGenerateSummary`, que sólo crea **draft** (`useMinuteHandlers.ts:169-170`) y `App.tsx:4492` marca el día cerrado igual.
   DoD: al primer ingreso de un día nuevo, si hay conversación de ayer sin minuta → **se genera y se guarda** la minuta (y se marca el día sólo si se guardó).

4. **No limpia el video anterior.** `App.tsx:2437-2455` sin reset.
   DoD: al pedir video nuevo, se limpia el anterior; sólo se pinta el nuevo al llegar.

5. **Carta: contenido como título → TTS vacío.** Mapeo `workspace.titulo`/`contenido` (`App.tsx:2382-2401,2453-2455`).
   DoD: documento con **body no vacío** y título corto; el TTS local narra el body. Normalizar si el contenido llega en `titulo`.

6. **Alarma de mañana no se crea (“ya existe”).** El texto es del modelo; no hay parseo determinista de “mañana” para alarmas; dedup por hora.
   DoD: “alarma mañana 11:25” crea una alarma para mañana (no dice “ya existe”); dedup por **datetime completo**.

7. **Alarma vuelve a sonar tras “detener”.** `audioAlert.ts:102-105,112-132` programa todos los beeps y `stop()` sólo corta los presentes; carrera en `useReminders.runTick:144-165`.
   DoD: un vencido suena **una sola vez**; “detener” cancela y no hay nuevo `play()` posterior.

8. **Quitar campo COLOR** de “ver horario completo”. `HorarioPizarron.tsx:596-598`.
   DoD: el campo Color no aparece en esa vista.

9. **Junta no se crea + petición duplicada sin hablante.** `horarioIntentParser` no reconoce “junta/reunión” (`:64,74,82`) → lo maneja Gemini, que alucina éxito. Duplicación a las 11:27:00.
   DoD: “crea una junta … para hoy a las 12:00” crea **1** entrada en horario/temporal con **1** fila y hablante asignado; sin rutas dobles de ingreso.

10. **“borra la nota del súper” → “Gemini: respuesta inválida”.** No existe `notes.remove` (`deterministicArbiter.js:94` sólo `notes.add`).
    DoD: acción determinista `notes.remove` (borrado lógico). “borra la nota X” ⇒ 1 nota `deleted`, 0 llamadas a IA.

11. **“en la nota del súper incluye cloro” no agrega.** El parser espera **verbo primero** (`noteIntentParser.js:111-117`); la frase real pone el destino primero → cae a Gemini y alucina.
    DoD: cubrir el orden “en la {destino} {verbo} {ítem}”. “en la nota del súper incluye X” ⇒ 1 nota renombrada con X (append), 0 llamadas a IA.

## Constraints (obligatorios, no negociables)

- **Sin rutas dobles**: una sola fuente por intención. Reusar el árbitro/parsers/servicios existentes; prohibido crear un segundo camino para la misma señal.
- **Sin hardcode**: todo configurable va a `FLU_CONFIG` (o parámetro inyectado). Cero literales de negocio.
- **Sin parches**: causa raíz, no workaround. Nada de flags temporales ni código muerto.
- **Estructura**: SRP, JSDoc en lo nuevo, TypeScript tipado (prohibido `: any`, `as any`, `@ts-ignore`, `eslint-disable`).
- **Guard por caso** (donde sea automatizable): test de comportamiento que falle ANTES y pase DESPUÉS. Prohibido editar tests existentes (salvo envolver en `act()`).
- **Verde obligatorio tras cada caso**: `npm run typecheck`, `npm run test:full`, `npm run lint` (incluye `lint:eslint --max-warnings=0`), `node scripts/auditoria.mjs --strict`.
- **Un commit por caso**. Si un caso no se puede cerrar sin cambiar comportamiento, **parar y reportarlo**, no maquillarlo.
