// ============================================================
// Avatar Barrel Exports — Replaces 'flu-avatar' workspace alias
// ============================================================
// Provides the same exports that OS3 expected from 'flu-avatar'
// ============================================================

// ---- Store ----
export { useBunnyStore, ensureAvatarPantsVisible } from './store/bunnyStore';
export type { BunnyStore } from './store/bunnyStore';

// ---- Types ----
export type {
    BunnyComponent,
    BunnyAnimation,
    AvatarExpression,
    AvatarSignal,
    AvatarState,
    BunnyLogEntry,
    BunnyControlState,
} from './types/bunny';

// ---- Runtime lists (fuente de verdad canónica) ----
export { BUNNY_ANIMATIONS } from './types/bunny';

// ---- Components ----
export { default as BunnyViewer } from './components/BunnyViewer';
export { default as BunnyControlCenter } from './components/BunnyControlCenter';
export { default as ComponentPanel } from './components/ComponentPanel';
export { default as AnimationPanel } from './components/AnimationPanel';
export { default as ControlsPanel } from './components/ControlsPanel';
export { default as LogPanel } from './components/LogPanel';
export { default as SignalPanel } from './components/SignalPanel';

// ---- Decorations (3D estacionales) ----
export { DecorationsRenderer } from './decorations';

// ---- Expression Map (used by useAvatarVoiceSync) ----
// NOTE: The actual bunnyStore does NOT have EXPRESSION_MAP.
// OS3 code (useAvatarVoiceSync.ts) imports EXPRESSION_MAP from 'flu-avatar'.
// La fuente canónica vive en ./expressionMap.ts para romper la dependencia
// circular entre este barrel y bunnyStore (que consume EXPRESSION_MAP).
export { EXPRESSION_MAP } from './expressionMap';
