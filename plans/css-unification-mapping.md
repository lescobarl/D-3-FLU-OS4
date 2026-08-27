# CSS Unification Mapping - FLU OS4

## Current State Analysis

Multiple CSS systems coexist in FLU OS4:

1. **OS2 Legacy System**: `voice-bar__*`, `voice-profiles__*`, `voice-controls__*`
2. **OS3 New System**: `flu-btn`, `flu-settings-*`, `flu-shell-*`
3. **Avatar App System**: `bcc-*`, `btn-*`, `panel-*`
4. **Generic Components**: `upload-zone__*`, `frame-content__*`, `panel-frame__*`

## Unified Naming Convention

All components will use the `flu-` prefix with BEM-like structure:

### Pattern: `flu-[component]__[element]--[modifier]`

Examples:
- `flu-btn` (base button)
- `flu-btn--primary` (modifier)
- `flu-btn--danger`
- `flu-btn--ghost`
- `flu-btn--listening`

- `flu-settings-panel` (component)
- `flu-settings-panel__field` (element)
- `flu-settings-panel__field--stacked` (modifier)

- `flu-voice-bar` (component)
- `flu-voice-bar__button` (element)
- `flu-voice-bar__button--primary` (modifier)

## Migration Mapping Table

### Buttons
| Old Class | New Class | Status |
|-----------|-----------|--------|
| `voice-bar__button` | `flu-btn` | ✅ |
| `voice-bar__button--primary` | `flu-btn--primary` | ✅ |
| `voice-bar__button--stop` | `flu-btn--danger` | ✅ |
| `voice-bar__button--ghost` | `flu-btn--ghost` | ✅ |
| `voice-bar__button--flu-participa` | `flu-btn--participant` | ✅ |
| `voice-bar__button--toggle-idle` | `flu-btn--toggle` | ✅ |
| `upload-zone__btn` | `flu-btn` | ✅ |
| `upload-zone__btn--camera` | `flu-btn--camera` | ✅ |
| `upload-zone__btn--clear` | `flu-btn--danger` | ✅ |
| `btn-component` | `flu-component-btn` | 🔄 |
| `btn-control` | `flu-control-btn` | 🔄 |
| `btn-animation` | `flu-animation-btn` | 🔄 |
| `btn-signal` | `flu-signal-btn` | 🔄 |

### Layout Components
| Old Class | New Class | Status |
|-----------|-----------|--------|
| `flu-shell` | `flu-shell` | ✅ (keep) |
| `flu-shell__hero` | `flu-shell__hero` | ✅ (keep) |
| `flu-shell__tab-content` | `flu-shell__tab-content` | ✅ (keep) |
| `app-header` | `flu-header` | 🔄 |
| `app-avatar-column` | `flu-avatar-column` | 🔄 |
| `app-panels-column` | `flu-panels-column` | 🔄 |
| `bunny-viewer-container` | `flu-avatar-viewer` | 🔄 |
| `bcc-main` | `flu-avatar-main` | 🔄 |

### Settings Panel
| Old Class | New Class | Status |
|-----------|-----------|--------|
| `flu-settings-panel` | `flu-settings-panel` | ✅ (keep) |
| `flu-settings-image-config` | `flu-settings-section` | 🔄 |
| `flu-settings-image-config__summary` | `flu-settings-section__summary` | 🔄 |
| `flu-settings-image-config__field` | `flu-settings-field` | 🔄 |
| `flu-settings-image-config__field--stacked` | `flu-settings-field--stacked` | 🔄 |
| `flu-settings-image-config__field--slider` | `flu-settings-field--slider` | 🔄 |
| `flu-settings-image-config__field--checkbox` | `flu-settings-field--checkbox` | 🔄 |

### Voice Components
| Old Class | New Class | Status |
|-----------|-----------|--------|
| `voice-profiles__item` | `flu-voice-profiles__item` | 🔄 |
| `voice-profiles__name` | `flu-voice-profiles__name` | 🔄 |
| `voice-profiles__button` | `flu-btn` | 🔄 |
| `voice-profiles__actions` | `flu-voice-profiles__actions` | 🔄 |
| `voice-controls__input` | `flu-voice-input` | 🔄 |
| `voice-controls__send` | `flu-btn--send` | 🔄 |
| `voice-controls__mic` | `flu-btn--mic` | 🔄 |
| `voice-controls__transcript` | `flu-transcript` | 🔄 |

### Panel Components
| Old Class | New Class | Status |
|-----------|-----------|--------|
| `panel-frame` | `flu-panel` | 🔄 |
| `panel-frame__header` | `flu-panel__header` | 🔄 |
| `panel-frame__body` | `flu-panel__body` | 🔄 |
| `panel-frame__title` | `flu-panel__title` | 🔄 |
| `panel` | `flu-subpanel` | 🔄 |
| `panel-header` | `flu-subpanel__header` | 🔄 |
| `panel-body` | `flu-subpanel__body` | 🔄 |

## Implementation Strategy

### Phase 1: Create Unified CSS Definitions
1. Create `src/styles/unified.css` with all new class definitions
2. Update `src/index.css` to include unified styles
3. Keep backward compatibility with old classes during migration

### Phase 2: Migrate Components
1. Start with `VoiceAssistantBarWrapper.tsx` (highest impact)
2. Migrate `FluSettingsPanel.tsx` (already uses `flu-` prefix)
3. Migrate `FluAvatarVoiceBridge.tsx`
4. Migrate avatar app components

### Phase 3: Cleanup
1. Remove old CSS definitions
2. Update all component references
3. Run tests to ensure no visual regressions

## Risk Assessment
- **Low Risk**: CSS changes are visual only, no functional impact
- **Medium Risk**: Potential visual regressions if mapping incorrect
- **Mitigation**: Use both old and new classes during transition, test with E2E

## Timeline
- Phase 1: 1-2 hours
- Phase 2: III-4 hours
- Phase 3: 1-2 hours

Total: 6-8 hours for complete unification