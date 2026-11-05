# 🛍️ LAE PlayStore Teens — Perfil de tienda de apps curada para jóvenes

> **Documento de diseño y arquitectura** para el perfil `playstore_joven` (PlayStore Teens).
> Estado: **propuesta / diseño** — aún no implementado en código.
> Principio rector: **sin hardcode, sin parches** (Regla #1 de CLAUDE.md). Todo se gestiona por configuración.

---

## 1. Visión y objetivo

El perfil **PlayStore Teens** (`playstore_joven`) es un **modo de tienda de aplicaciones curada** pensado para usuarios jóvenes (niños/as y adolescentes). En lugar de un navegador abierto, el usuario ve una **galería visual tipo "app store"** con:

- **Apps y juegos curados** (los juegos ya existentes del sistema + sitios aprobados).
- **Navegación segura forzada** (safeSearch y supervisión siempre activos, no desactivables por el usuario).
- **Control parental** (límite diario de uso, categorías permitidas, allowlist).
- **Estética juvenil** (tiles tipo tienda, paleta de colores viva, avatar expresivo).

**Objetivo principal:** dar a los jóvenes una experiencia de descubrimiento de contenido **visual, segura y gamificada**, sin exponerlos a la web abierta ni a búsquedas sin filtro.

> **Nota sobre el nombre:** el usuario pidió el documento como `lae_playstore_teens.md`. El perfil interno se llamará `playstore_joven` (clave de rol) y la experiencia de usuario se mostrará como **"PlayStore Teens"**.

---

## 2. Estado actual del código (punto de partida)

El perfil **no existe** en el código (0 resultados al buscar `playstore_joven`). Lo que sí existe y se reutilizará:

| Pieza | Archivo | Rol en el plan |
|---|---|---|
| Roles y defaults por rol | [`src/voice/lib/fluConfig.js`](../src/voice/lib/fluConfig.js:772) (`defaultsByRole`) | Añadir el rol `playstore_joven` |
| Mapeo de tipo de persona → rol | [`fluConfig.js`](../src/voice/lib/fluConfig.js:651) (`multiuser.kindToRole`) | Mapear "joven/teen/adolescente" → `playstore_joven` |
| Resolución de perfil (manual > rol > default) | [`src/core/browser/browserProfileService.ts`](../src/core/browser/browserProfileService.ts:109) | Extender con campos de seguridad |
| Catálogo de sitios (CRUD + persistencia) | [`src/components/SearchCatalogPanel.tsx`](../src/components/SearchCatalogPanel.tsx:294) | Patrón a reutilizar para el catálogo de apps |
| Tipos de sitio y tiles | [`src/core/search/searchSiteTypes.ts`](../src/core/search/searchSiteTypes.ts:27) | Reutilizar `SearchSite` / `deriveTiles` |
| Seguridad efectiva (safeSearch/supervised) | [`src/core/search/searchConfigOverrides.ts`](../src/core/search/searchConfigOverrides.ts:71) (`mergeSearchConfig`) | Forzar `effectiveSafe = true` |
| Juegos del sistema | [`fluConfig.js`](../src/voice/lib/fluConfig.js:1713) (`games`) | Exponerlos como "apps" del catálogo |
| Grupos de ajustes | [`src/App.tsx`](../src/App.tsx:270) (`SETTINGS_GROUPS`) | Añadir panel en grupo "Gestión" |
| Base de datos (Dexie) | [`src/core/db/fluDatabase.ts`](../src/core/db/fluDatabase.ts:526) | Nueva tabla `AppCatalogRecord` con `SyncTuple` |

---

## 3. Funcionalidades del perfil

### 3.1 Catálogo de apps/juegos curado
- Galería visual de **apps** (sitios aprobados) y **juegos** (los del sistema: `simonDice`, `adivinaNumero`, `calculoMental`, `ahorcado`, `trivia`, `cuentoColaborativo`, `karaoke`, etc.).
- Cada app tiene: `id`, `título`, `descripción`, `categoría`, `tipo` (`site` | `game`), `dominio` (si es sitio), `gameId` (si es juego), `icono`/`color`, `aprobado`.
- El catálogo es la **fuente de verdad** para la allowlist y los tiles del perfil (mismo contrato que `deriveAllowlist`/`deriveTiles`).

### 3.2 Navegación curada + búsqueda segura forzada
- El usuario solo navega dentro de la **allowlist** derivada del catálogo aprobado.
- `safeSearch` y `supervised` quedan **forzados a `true`** para este rol (no desactivables).
- En `mergeSearchConfig`, si el rol es `playstore_joven`, `effectiveSafe = true` siempre.

### 3.3 Control parental
- **Límite diario de uso** (`dailyLimit`) configurable por el adulto.
- Categorías permitidas y allowlist editables **solo por el adulto** (modo gestión).
- Registro de auditoría de actividad (reutiliza `addAuditLog`).

### 3.4 Juegos del sistema expuestos como apps
- Los juegos existentes se registran como entradas del catálogo con `tipo: 'game'` y `gameId`.
- Al tocar el tile se lanza el juego correspondiente (mismo flujo que `applyGameAction`).

---

## 4. Aspectos visuales

### 4.1 Tiles tipo tienda
- Rejilla de tiles grandes con **icono, color de acento y etiqueta** (patrón `SearchSiteTile` + estética de app store).
- Categorías con colores diferenciados (Educación, Juegos, Cuentos, Música).

### 4.2 Tema juvenil
- Paleta viva y contrastada (se apoya en el sistema de paletas existente `PaletaCatalogRecord`).
- Tipografía amigable, bordes redondeados, animaciones suaves al seleccionar.

### 4.3 Avatar expresivo
- Reutiliza el avatar existente con expresiones alegres/curiosas al descubrir contenido.

---

## 5. Arquitectura de gestión (config-driven)

### 5.1 Nuevo rol en `fluConfig.js`
```js
defaultsByRole: {
  // ... existentes
  playstore_joven: {
    categories: ['educacion', 'juegos', 'cuentos'],
    allowlist: ['wikipedia.org', 'educ.ar'],
    readingLevel: 'simple',
    language: 'es',
    homeTiles: ['educacion', 'juegos', 'cuentos'],
    safeSearch: true,
    supervised: true,
    dailyLimit: 60, // minutos
  },
}
```

### 5.2 Mapeo en `kindToRole`
```js
kindToRole: {
  // ... existentes
  joven: 'playstore_joven',
  teen: 'playstore_joven',
  adolescente: 'playstore_joven',
}
```

### 5.3 Nueva tabla `AppCatalogRecord` en `fluDatabase.ts`
- Interfaz con `SyncTuple` (obligatorio por CLAUDE.md §6).
- Campos: `id`, `title`, `description`, `category`, `type` (`site`|`game`), `domain?`, `gameId?`, `icon?`, `color?`, `approved`, `sync`.
- Registro en el constructor de `FluDatabase` con versión y `SyncTuple` sincronizado.

### 5.4 Servicio y hook
- `appCatalogService.ts`: CRUD + auditoría (patrón `browserProfileService`).
- `useAppCatalog.ts`: hook de estado (patrón `useBrowserProfiles`).

### 5.5 Panel `AppStorePanel.tsx`
- Se añade al grupo **"Gestión"** de `SETTINGS_GROUPS` en [`App.tsx`](../src/App.tsx:270).
- Permite al adulto: gestionar el catálogo, fijar límite diario, y ver el estado de seguridad del perfil.

### 5.6 Extensión de `browserProfileService.ts`
- Ampliar `RoleBrowserDefaults` con `safeSearch`, `supervised`, `dailyLimit`.
- `resolveForSession` los resuelve con la misma prioridad `manual > rol > default`.

### 5.7 Forzado de seguridad en `mergeSearchConfig`
- Si el rol resuelto es `playstore_joven`, `effectiveSafe = true` y `dailyLimit` aplicado.

---

## 6. Plan de implementación por fases

### Fase 1 — Rol y seguridad forzada
1. Añadir `playstore_joven` a `defaultsByRole` y `kindToRole` en `fluConfig.js`.
2. Extender `RoleBrowserDefaults` y `resolveForSession` en `browserProfileService.ts`.
3. Forzar `effectiveSafe` en `mergeSearchConfig`.
4. Tests: `browserProfileService.test.ts`, `searchConfigOverrides.test.ts`.

### Fase 2 — Catálogo de apps
1. Nueva tabla `AppCatalogRecord` + `SyncTuple` en `fluDatabase.ts`.
2. `appCatalogService.ts` (CRUD + auditoría).
3. `useAppCatalog.ts`.
4. Sembrado inicial desde `fluConfig.js` (juegos + sitios aprobados).
5. Tests: `appCatalogService.test.ts`, `useAppCatalog.test.ts`.

### Fase 3 — Panel visual de tienda
1. `AppStorePanel.tsx` en grupo "Gestión".
2. Tiles tipo tienda + tema juvenil.
3. Lanzamiento de juegos desde tiles (`applyGameAction`).
4. Tests E2E: `pwa-playstore-teens.spec.ts`.

---

## 7. Validación (pre-commit)

- `npx tsc -b` → sin errores.
- `npm run test` (vitest run) → todos los tests en verde.
- **Sin hardcode**: todos los textos, roles, categorías y catálogo en `fluConfig.js` / base de datos.
- **Sin parches**: no `try-catch` vacíos, no `any` sin necesidad.
- **SyncTuple**: toda tabla nueva con tupla de sincronización.
- **Regla 0.1**: verificación visual antes de dar por terminado (el modelo no ve imágenes; se valida por tests E2E y DOM).

---

## 8. Resumen de decisiones

| Decisión | Opción elegida |
|---|---|
| Nombre interno del rol | `playstore_joven` |
| Nombre de experiencia | PlayStore Teens |
| Catálogo | Tabla `AppCatalogRecord` (Dexie) + siembra desde `fluConfig.js` |
| Seguridad | Forzada (`effectiveSafe = true`) para este rol |
| Control parental | `dailyLimit` + categorías/allowlist editables solo por adulto |
| Juegos | Expuestos como apps con `tipo: 'game'` |
| Panel de gestión | `AppStorePanel` en grupo "Gestión" |
| Persistencia | `SyncTuple` obligatorio (CLAUDE.md §6) |
