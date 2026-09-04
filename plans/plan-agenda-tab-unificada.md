# Plan — Convertir la pestaña "Horario" del pizarrón en "Agenda" (hub unificado)

## Objetivo

Cumplir el **Punto 1** de la petición del usuario:

> "si conecta todo y traelo aca y su titulo es Agenda solamente!"

Es decir: la pestaña del pizarrón (WorkspaceHub) que hoy se llama **"Horario de clases"** debe
convertirse en una pestaña **"Agenda"** que conecte y muestre las funcionalidades de
recordatorios / agenda / cuidado del adulto mayor que hoy viven únicamente en **Ajustes**:

- Recordatorios (`RemindersPanel`)
- Alarmas y temporizadores (`TemporalItemsPanel`)
- Diario (`DiaryPanel`)
- Compras (`ShoppingPanel`)
- Hábitos (`HabitsPanel`)
- Ánimo (`MoodPanel`)
- Contactos (`ContactsPanel`)
- Materia gris / reconocimiento (`MateriaGrisPanel`)

**Decisión de diseño confirmada con el usuario (Opción B):** el **calendario de clases**
(`HorarioPizarron`) se conserva como una **sección/opción dentro** de la pestaña "Agenda",
no se elimina. La pestaña "Agenda" es el hub unificado que contiene tanto el calendario de
clases como los paneles de agenda/cuidado.

## Decisiones arquitectónicas clave

### 1. Identificador interno de la pestaña: se conserva `'horario'`

El id interno de la pestaña **NO se renombra** a `'agenda'`. Razones:

- El contrato de voz y el auto-switch dependen de `workspaceArtifact.tipo === 'horario'`
  (ver [`computeAutoSwitchTarget()`](src/components/WorkspaceHub.tsx:119)).
- Muchos tests y el flujo de voz mapean comandos al tipo `'horario'`
  (p. ej. [`tests/simpleRequestDetection.test.ts`](tests/simpleRequestDetection.test.ts)).
- Renombrar el id rompería el contrato de voz, el auto-switch y decenas de tests sin
  beneficio funcional.

**Lo que cambia es solo la etiqueta visible** (el título de la pestaña) a **"Agenda"**,
vía una nueva clave de configuración `agendaTitle` en `FLU_CONFIG.ui.workspace`
(regla nº 1: nada hardcodeado).

> Nota: el tipo de artefacto `'horario'` del contrato (que representa "horario de clases")
> se mantiene intacto. Solo cambia la presentación de la pestaña.

### 2. Contenido de la pestaña: hub "Agenda" con calendario + paneles

El `case 'horario'` de [`renderContent()`](src/components/WorkspaceHub.tsx:579) deja de
renderizar solo `<HorarioPizarron>` y pasa a renderizar un layout "Agenda" que contiene:

1. **Calendario de clases** (`HorarioPizarron`) — sección plegable/opcional.
2. **Paneles de agenda/cuidado** (los 8 paneles de Ajustes), agrupados.

### 3. Prop drilling (patrón presentacional)

`WorkspaceHub` es un componente **presentacional**: todo el estado llega por props desde
`App.tsx`. Por tanto, para conectar los paneles hay que:

- Extender `WorkspaceHubProps` con un grupo de props `agenda` que transporte los estados
  de los hooks (participants, contacts, diary, mood, habits, reminders, temporals,
  shopping, materiaGris, remindersAuthor, pendingByAuthor, setRemindersAuthor).
- Pasar ese grupo desde el cableado de `<WorkspaceHub>` en
  [`App.tsx`](src/App.tsx:3629).

## Archivos a modificar

### A. `src/voice/lib/fluConfig.js` — etiqueta "Agenda"

En `FLU_CONFIG.ui.workspace` (junto a `horarioTitle` en la línea 1645) añadir:

```js
agendaTitle: { es: 'Agenda', en: 'Agenda' },
```

Se mantiene `horarioTitle` para uso interno del calendario de clases (subtítulo/sección).

### B. `src/components/WorkspaceHub.tsx` — props, etiqueta y contenido

1. **Imports**: añadir los 8 paneles:
   - `ContactsPanel`, `DiaryPanel`, `MoodPanel`, `HabitsPanel`
   - `RemindersPanel`, `TemporalItemsPanel`, `ShoppingPanel`, `MateriaGrisPanel`
   - y los tipos de props/registros necesarios (o reutilizar los tipos ya exportados).

2. **`WorkspaceHubProps`** (línea 144): añadir un grupo `agenda` con la forma:

```ts
agenda: {
    participants: ParticipantRecord[];
    contacts: ContactRecord[];
    birthdayNear: BirthdayContact[];
    diaryEntries: DiaryEntryRecord[];
    moods: MoodRecord[];
    moodSummary: MoodSummary;
    habitsStats: GoalStats[];
    reminders: ReminderRecord[];
    remindersPendingCount: number;
    remindersAuthor: string;
    remindersAuthorPending: ReminderRecord[];
    onRemindersAuthorChange: (v: string) => void;
    alarms: TemporalItemRecord[];
    timers: TemporalItemRecord[];
    shoppingItems: ShoppingItemRecord[];
    shoppingRemainingCount: number;
    materiaGrisLeaderboard: LeaderboardRow[];
    materiaGrisHistory: MateriaGrisRecord[];
    loading: {
        contacts: boolean; diary: boolean; mood: boolean; habits: boolean;
        reminders: boolean; temporals: boolean; shopping: boolean; materiaGris: boolean;
    };
    // callbacks
    onAddContact: (i: ContactInput) => Promise<void>;
    onRemoveContact: (id: string) => Promise<void>;
    onAddDiary: (i: DiaryEntryInput) => Promise<void>;
    onRemoveDiary: (id: string) => Promise<void>;
    onLogMood: (i: LogMoodInput) => Promise<void>;
    onRemoveMood: (id: string) => Promise<void>;
    onAddHabit: (i: NewGoalInput) => Promise<void>;
    onCheckInHabit: (goalId: string, date: string, done: boolean) => Promise<void>;
    onStatusHabit: (id: string, status: GoalStatus) => Promise<void>;
    onRemoveHabit: (id: string) => Promise<void>;
    onAddReminder: (i: { text: string; dueAt: number }) => Promise<void>;
    onCompleteReminder: (id: string) => Promise<void>;
    onDismissReminder: (id: string) => Promise<void>;
    onRemoveReminder: (id: string) => Promise<void>;
    onAddTemporal: (i: NewTemporalItemInput) => Promise<void>;
    onCancelTemporal: (id: string) => Promise<void>;
    onRemoveTemporal: (id: string) => Promise<void>;
    onAddShopping: (label: string) => Promise<void>;
    onToggleShopping: (id: string) => Promise<void>;
    onRemoveShopping: (id: string) => Promise<void>;
    onClearShopping: () => Promise<void>;
    onAwardMateriaGris: (i: AwardInput) => Promise<void>;
}
```

3. **`allDefs`** (línea 340): cambiar la etiqueta del def `horario` para usar `agendaTitle`:

```ts
horario: {
    id: 'horario',
    icon: '📅',
    label: pickLabel(ws.agendaTitle, language, 'Agenda'),
    available: true,
    priority: 4,
},
```

4. **`renderContent()`** (`case 'horario'`, línea 579): renderizar el layout "Agenda":

```tsx
case 'horario':
    return (
        <div className="workspace-hub__tab-content workspace-hub__tab-content--horario">
            <div className="agenda-hub">
                {/* Sección: Calendario de clases (opción) */}
                <details className="agenda-hub__section" open>
                    <summary>{/* label calendario de clases */}</summary>
                    <HorarioPizarron ... />
                </details>

                {/* Sección: Recordatorios y agenda */}
                <RemindersPanel ... />
                <TemporalItemsPanel ... />

                {/* Sección: Cuidado diario */}
                <DiaryPanel ... />
                <MoodPanel ... />
                <HabitsPanel ... />
                <ContactsPanel ... />

                {/* Sección: Compras y reconocimiento */}
                <ShoppingPanel ... />
                <MateriaGrisPanel ... />
            </div>
        </div>
    );
```

> Los paneles ya usan internamente `<details className="flu-settings-image-config" open>`
> (acordeones), por lo que se pueden apilar directamente. Se recomienda envolverlos en un
> contenedor `.agenda-hub` con CSS de scroll vertical (el pizarrón ya tiene scroll).

### C. `src/App.tsx` — pasar el grupo `agenda` a WorkspaceHub

En el cableado de `<WorkspaceHub>` (línea 3629) añadir la prop `agenda={{ ... }}`
mapeando desde los hooks ya existentes (declarados en 1092-1134) y desde
`remindersAuthor`/`pendingByAuthor`/`setRemindersAuthor` (1184-1202). Los callbacks
replican exactamente los que hoy se pasan a los paneles en Ajustes (3951-4081).

### D. `src/App.css` — estilos del hub Agenda

Añadir estilos para `.agenda-hub` y sus secciones (scroll, espaciado, separadores),
reutilizando las clases existentes de los paneles (`flu-settings-image-config`,
`flu-settings-section__body`, etc.) para no duplicar estilos.

## Tests a actualizar

Los tests que verifican la **etiqueta** o el **contenido** de la pestaña `'horario'`
deben revisarse porque el título visible pasa a "Agenda":

- [`tests/workspaceHub.test.ts`](tests/workspaceHub.test.ts) — verifica
  `computeAvailableTabs`/`computeAutoSwitchTarget` con `'horario'`. El id NO cambia, por lo
  que estos tests **siguen pasando** (solo se revisa que no dependan del label).
- [`tests/e2e/workspace-hub-visual.spec.ts`](tests/e2e/workspace-hub-visual.spec.ts) —
  usa `data-tab="horario"` y `.workspace-hub__tab-content--horario`. El id y la clase se
  conservan, así que **siguen pasando**. Revisar si algún selector depende del texto
  "Horario de clases".
- [`tests/e2e/horario-pizarron.spec.ts`](tests/e2e/horario-pizarron.spec.ts) — E2E del
  HorarioPizarron. Como el calendario se conserva dentro de la pestaña, **sigue pasando**;
  revisar que el HorarioPizarron siga visible en el DOM de la pestaña.
- [`tests/e2e/pizarron-funcionalidades.spec.ts`](tests/e2e/pizarron-funcionalidades.spec.ts)
  y [`tests/e2e/verify-pizarron-ux.spec.ts`](tests/e2e/verify-pizarron-ux.spec.ts) —
  revisar selectores de texto de la pestaña.

> Los tests de dominio (`horarioService`, `useHorario`, `workspaceContractHorario`,
> `simpleRequestDetection`) prueban el dominio "horario" y el contrato de voz, NO la
> etiqueta de la pestaña, por lo que **no se ven afectados**.

## Verificación manual

1. `npm run dev` (ya activo en Terminal 1).
2. Abrir el pizarrón y comprobar que la pestaña 📅 ahora dice **"Agenda"**.
3. Dentro de "Agenda": ver el calendario de clases y los 8 paneles (recordatorios,
   alarmas/temporizadores, diario, compras, hábitos, ánimo, contactos, materia gris).
4. Probar alta/borrado en cada panel y confirmar que persiste (mismos hooks que Ajustes).
5. Comprobar que el auto-switch por voz a "horario" sigue funcionando (id intacto).
6. Confirmar que los paneles siguen funcionando también en Ajustes (no se duplican estados:
   ambos usan los mismos hooks de App.tsx).

## Riesgos y mitigaciones

- **Rendimiento**: renderizar 8 paneles + calendario en una pestaña puede ser pesado.
  Mitigación: los paneles son acordeones `<details>`; se pueden dejar cerrados por defecto
  (excepto el calendario) para no montar todo el contenido a la vez. Si es necesario, usar
  `React.lazy` para cargar los paneles bajo demanda.
- **Duplicación visual**: los paneles ya existen en Ajustes. No se eliminan de Ajustes
  salvo que el usuario lo pida; se "conectan" también en el pizarrón. Ambos comparten los
  mismos hooks, por lo que no hay doble estado.
- **Regresión de tests**: mitigado al conservar el id `'horario'` y la clase
  `--horario`. Solo cambia el label visible.
