# Plan: Reorganización de la IU existente + Sistema de Ambientes (Rebranding por oficio)

- **Fecha:** 2026-08-27 (America/Mexico_City)
- **Estado:** Propuesta informativa — **SOLO INFORMATIVO, no se ejecutó ningún cambio de código.**
- **Alcance:** SOLO lo que ya existe + el sistema de **Ambientes** (rebranding por oficio). **NO** se integra nada de SEP ni features nuevas adicionales (ver sección 6 "Fuera de alcance").

---

## 1. Objetivo

1. **Reorganizar la IU que ya existe** para que sea muy simple, con el principio **"una pantalla = una tarea"** — sin crear arquitectura nueva ni pantallas nuevas.
2. **Permitir que el espacio de FLU se rebrandee por oficio/rol** (Ambientes): si le pedimos que actúe como **chef** y nos enseñe a cocinar, el espacio se transforma en una **cocina** (tema visual, escena 3D, avatar, voz y contenido). Todo se construye **sobre los sistemas de branding/decoraciones/voz que ya existen**.

---

## 2. Estado actual — lo que YA EXISTE (base sobre la que trabajamos)

| Sistema existente | Dónde | Qué aporta a los Ambientes |
|---|---|---|
| App monolítica con 5 pestañas `RightTab` ('workspace' | 'conversation' | 'minutes' | 'settings') + 'system'. | [`src/App.tsx:177`](src/App.tsx:177), tabs en [`src/App.tsx:2700`](src/App.tsx:2700) | Las pestañas/pantallas actuales que el Ambiente puede mostrar/ocultar. |
| Pestaña **Ajustes** con 10 paneles (Flu, Asistente, Recordatorios, Compras, Participantes, Materia gris, Hábitos, Ánimo, Contactos, Diario). | [`src/App.tsx:3069`](src/App.tsx:3069) | Los paneles que se agrupan/organizan; ahí vive el nuevo panel **Ambientes**. |
| **Branding estacional** existente (temporada activa, modo, cumpleaños, evento personalizado, celebración de logros) aplicado por configuración. | [`src/App.tsx:311`](src/App.tsx:311) y [`src/core/config/appConfig.ts`](src/core/config/appConfig.ts:383) | El `Ambiente` se suma al branding: ambiente = oficio (props del rol), temporada = festividad (decoración estacional). **Conviven.** |
| Catálogo de **decoraciones** + renderizador de escena 3D + `SeasonalEffects`. | [`src/avatar/decorations/decorationsCatalog.ts`](src/avatar/decorations/decorationsCatalog.ts:1), [`src/avatar/decorations/DecorationsRenderer.tsx`](src/avatar/decorations/DecorationsRenderer.tsx:1) | Props del oficio en la escena (cocina, huerto…) y **atuendo** del avatar (gorro de chef, sombrero de jardinero…). Ya se usan accesorios tipo sombrero/gorro. |
| Catálogo de **voz/personalidad** (velocidad, tono, timbre, rasgos). | [`src/core/config/voiceConfigCatalog.ts`](src/core/config/voiceConfigCatalog.ts:266) | Perfil de voz y rasgos del rol (chef instructivo, etc.). |
| **Navegación por voz** que ya cambia de pestaña. | [`src/hooks/useNavigationCommands.ts`](src/hooks/useNavigationCommands.ts:1) | Comandos de voz para **cambiar de Ambiente** ("actúa como chef", "modo cocina"). |
| **Proactividad** (sugerencias por silencio, seguimiento, agenda pendiente). | [`src/core/autonomy/proactiveEngine.ts`](src/core/autonomy/proactiveEngine.ts:24) | Sugerencias según el rol (a la hora de la cena propone receta). |
| PWA existente (manifest + service worker + registro). | [`public/manifest.webmanifest`](public/manifest.webmanifest:1), [`public/sw.js`](public/sw.js:12), [`src/main.tsx`](src/main.tsx:1) | Sin cambios en este plan (fuera de alcance). |

---

## 3. Reorganización de la IU existente (sin arquitectura nueva)

Se trabaja **sobre las pestañas y paneles actuales**, no se crea routing/lazy ni pantallas nuevas.

1. **Simplificar Ajustes (10 paneles):** agrupar los paneles **existentes** en sub-secciones navegables dentro de la misma pestaña (ej. un sub-menú "Mis datos" para Contactos/Diario/Ánimo/Hábitos), en vez de apilarlos todos en vertical. Son los **mismos componentes**, solo reorganizados.
2. **Layout móvil:** aprovechar el layout de 2 columnas existente ([`src/App.css:198`](src/App.css:198)) y el breakpoint actual ([`src/App.css:957`](src/App.css:957)) para que en pantallas angostas las pestañas se conviertan en navegación inferior simple. Sin rediseñar desde cero.
3. **"Una pantalla = una tarea":** cada pestaña actual ya tiene un propósito; se refuerza su claridad (títulos, íconos, menos ruido) sin agregar funcionalidad nueva.
4. **Panel "Ambientes"** nuevo en Ajustes: tarjetas para elegir el Ambiente activo (parte del sistema de Ambientes, sección 4).

---

## 4. Sistema de AMBIENTES — el rebranding por oficio (el único feature nuevo, solicitado)

### 4.1 Definición

> Un **Ambiente** es un perfil de personalización integral que transforma el espacio existente de FLU en un lugar temático coherente con un oficio o rol. No es un cambio de color: es un **rebranding completo del espacio** que combina tema visual, escena 3D, atuendo del avatar, voz/personalidad y qué pestañas/paneles se muestran. Se construye **sobre los sistemas de branding estacional, decoraciones, voz y navegación que ya existen.**

### 4.2 Las capas que se rebrandean (todas sobre lo existente)

| Capa | Qué cambia | Sistema existente que se reutiliza |
|---|---|---|
| **1. Tema visual** | Variables CSS (`data-ambiente="chef"` en la raíz): colores, acentos, fondos. | Refactor ligero de [`src/App.css`](src/App.css:1) a variables de tema. |
| **2. Escena 3D / decoración** | Props del oficio en la escena (cocina, huerto…), **combinados** con la decoración estacional actual (ambiente = oficio; temporada = festividad; ambos coexisten). | [`DecorationsRenderer.tsx`](src/avatar/decorations/DecorationsRenderer.tsx:1) + `decorationsCatalog`. |
| **3. Atuendo del avatar** | FLU se viste del oficio (gorro de chef + delantal, sombrero de jardinero…). | Mecanismo de accesorios/decoraciones del avatar (ya usa sombreros: corona, gorro navideño, etc.). |
| **4. Voz y personalidad** | Perfil de voz (tono, velocidad), rasgos de personalidad y frases propias del rol. | [`voiceConfigCatalog.ts`](src/core/config/voiceConfigCatalog.ts:266) + rasgos existentes. |
| **5. Pestañas/contenido** | Qué pestañas actuales son visibles y qué catálogos aplican; qué sugiere la proactividad. | Pestañas de [`src/App.tsx:2700`](src/App.tsx:2700) + `proactiveEngine`. |

### 4.3 Mecanismo técnico (sobre lo existente)

1. **`environmentRegistry.ts`** (nuevo, `src/core/environments/`) — catálogo **por datos** de ambientes: `id`, `nombre`, `tagline`, `icono`, `bienvenida`, `tema` (vars CSS + props + atuendo), `voz` (perfil/rasgos/frases), `pestañas` (mostrar/ocultar de las 5 actuales), `contenido` (catálogo + reglas de proactividad).
2. **`environmentStore`** (zustand + persistencia en IndexedDB, como los stores existentes) — guarda el Ambiente activo entre sesiones.
3. **`applyEnvironment(ambiente)`** — función central que:
   - inyecta las variables CSS del tema en la raíz (`document.documentElement.dataset.ambiente`),
   - conmuta props de escena + atuendo del avatar (reutilizando DecorationsRenderer/decoraciones),
   - aplica perfil de voz + rasgos + frases (reutilizando los mismos mecanismos que `applyConfigAction` en [`src/App.tsx:311`](src/App.tsx:311)),
   - muestra/oculta pestañas según el ambiente,
   - conmuta catálogo de contenido y reglas de proactividad.
4. **Activación por voz:** extender la navegación por voz existente ([`useNavigationCommands.ts`](src/hooks/useNavigationCommands.ts:1)) y el parser de intents con comandos del tipo "actúa como chef", "modo cocina", "vuelve a ser mi asistente" → `applyEnvironment(...)`.
5. **Activación por UI:** nuevo panel **Ambientes** en Ajustes (tarjetas con vista previa y botón "Activar").
6. **Transición:** animación suave del tema + mensaje de bienvenida del nuevo rol.

### 4.4 Catálogo inicial (piloto)

| Ambiente | Escena | Atuendo | Pestañas | Contenido |
|---|---|---|---|---|
| `asistente` (default) | La actual | El actual | Las 5 actuales | El actual (sin cambios) |
| `chef` (cocina) | **Cocina** (isla, utensilios, fuego) | Gorro + delantal | Conversation, Minutes (recetas/plan de comidas), Ajustes (+ panel Ambientes) | Recetas, técnicas, equivalencias, plan de comidas; proactividad a la hora de la cena |
| `jardinero` (huerto) | **Jardín/huerto** (macetas, verduras, tierra) | Sombrero de paja + guantes | Conversation, Minutes (calendario de siembra), Ajustes | Calendario de siembra, cuidados por planta, compost; proactividad en mañanas y fines de semana (riego/cosecha) |
| `bricolaje` (taller) | **Taller** (banco de trabajo, herramientas, maderas) | Overol + gafas | Conversation, Minutes (proyectos/materiales), Ajustes | Proyectos paso a paso, materiales y medidas, seguridad; proactividad los fines de semana (proyectos) |
| `bienestar` (salud) | **Rincón tranquilo** (plantas, luz cálida, cojines) | Suéter cómodo | Conversation, Minutes (rutinas de descanso), Ajustes + juegos de respiración | Respiraciones guiadas (reutiliza el juego `respiración`), Hábitos, Ánimo, recordatorios de hidratación/descanso; proactividad para pausas |

**Qué es cada ambiente (explicación):**
- **chef (cocina):** FLU enseña a cocinar. La escena se vuelve una cocina, FLU usa gorro y delantal, las minutas se orientan a recetas/plan de comidas y la proactividad propone la cena a las 18:00.
- **jardinero (huerto):** FLU cuida plantas y enseña jardinería. Escena de huerto con macetas, sombrero de paja + guantes, minutas como calendario de siembra/cuidados y proactividad para riego y cosecha en mañanas y fines de semana.
- **bricolaje (taller):** FLU acompaña proyectos y reparaciones. Escena de taller con banco de trabajo, overol + gafas, minutas de proyectos/materiales/medidas y proactividad de proyectos los fines de semana.
- **bienestar (salud):** FLU acompaña en hábitos y descanso. Rincón tranquilo con suéter cómodo; **reutiliza los sistemas que ya existen**: el juego de **respiración** ([`src/core/games/respiracion.ts`](src/core/games/respiracion.ts:1)), junto con Ánimo, Hábitos y Recordatorios; proactividad para pausas e hidratación.

> El catálogo es **por datos**: cada ambiente es una entrada del registry (id, escena, atuendo, voz, pestañas, contenido y reglas de proactividad). Agregar otro oficio (música, mascotas, arte…) = agregar una entrada con sus props/atuendo/catálogo, **sin tocar el núcleo**. El piloto incluye 5 ambientes; el resto queda como extensión futura.

### 4.5 Ejemplo concreto — Modo Chef

1. Usuario: *"FLU, actúa como chef y enséñame a cocinar."*
2. Intent resuelto → `applyEnvironment('chef')`.
3. FLU: *"¡A la cocina! Hoy prepararemos algo delicioso. ¿Qué te gustaría cocinar?"*
4. Cambios: paleta cálida, escena 3D de cocina, FLU con gorro/delantal.
5. Pestañas: Conversación y Minutas orientadas a recetas; la proactividad sugiere cena a las 18:00.
6. Usuario: *"Vuelve a ser mi asistente"* → `applyEnvironment('asistente')`, todo regresa al estado general (conservando la temporada estacional activa).

> El mismo flujo aplica a **cualquier ambiente**: *"actúa como jardinero"* → huerto; *"modo taller"* → bricolaje; *"modo bienestar"* → respiraciones guiadas. Solo cambia la entrada del catálogo (por datos, sin tocar el núcleo).

---

## 5. Fases (solo existente + ambientes)

| Fase | Alcance | Entregable |
|---|---|---|
| **A — Reorganizar IU existente** | Agrupar los 10 paneles de Ajustes en sub-secciones, navegación inferior en móvil, refactor ligero de [`src/App.css`](src/App.css:1) a variables de tema. Sin cambio funcional. | IU simple, misma funcionalidad, mismos tests pasando. |
| **B — Sistema de Ambientes** | `environmentRegistry` + `environmentStore` + `applyEnvironment` + integración con DecorationsRenderer/atuendo/voz + panel Ambientes + comandos por voz + piloto de 5 ambientes (`asistente`, `chef`, `jardinero`, `bricolaje`, `bienestar`). | **FLU rebrandable por oficio** (demo: cocina/chef, huerto/jardinero, taller/bricolaje, bienestar) sobre lo existente. |

---

## 6. Fuera de alcance (NO se integra en este plan)

- **SEP:** Estudiantes/Grupos (pase de lista), Planeación/Evaluación, Reportes, Sistemas, edición SEP de pantallas.
- **Features nuevas adicionales:** nuevas pantallas, routing/lazy-loading nuevo, `catalogRepository`/`workflowEngine` nuevos, modo multijugador adicional, empaquetado/publicación como APP (ya se explicó aparte, no se implementa aquí).
- Nada de esto se toca; el plan se limita a **lo existente + Ambientes**.

---

## 7. Criterios de éxito

1. La IU existente queda reorganizada y simple (Ajustes sin 10 paneles apilados; móvil navegable) **sin agregar funcionalidad nueva** y sin regresiones en los tests actuales (1268).
2. **Demo de rebranding:** decir *"actúa como chef"* transforma el espacio en una cocina (tema, escena, avatar, voz, pestañas, contenido) y *"vuelve a ser mi asistente"* lo restaura.
3. Todo se construye reutilizando los sistemas existentes (branding estacional, decoraciones, voz, navegación por voz, proactividad); el Ambiente **coexiste** con la temporada estacional.
4. El catálogo de ambientes es extensible **por datos** (agregar un oficio no requiere tocar el núcleo).

---

> ⚠️ **NOTA:** Este documento es **solo informativo**. No se ejecutó ningún cambio de código ni se modificó ningún archivo de `src/`, `tests/` o configuración. El respaldo full de hoy está en [`backups/2026-08-27/seq-1/`](backups/2026-08-27/seq-1/MANIFEST.md) como punto seguro antes de cualquier implementación futura.
