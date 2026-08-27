// ============================================================
// Bunny — Tipos e Interfaces del Avatar FLU
// ============================================================
// Define los tipos para componentes físicos, animaciones,
// señales visuales y estados del avatar.
// ============================================================

/**
 * Componentes físicos del modelo Bunny que pueden
 * mostrarse/ocultarse individualmente.
 *
 * Basado en la estructura real del FBX exportado:
 *   Bunny_geo [Group]
 *     Body [Group]   → Tail, Body (SkinnedMesh)
 *     Face [Group]   → Tongue, Eye_R, Eye_L, Bangs, Teeth, Brows
 *     Pants [Group]  → Belt_3/2/1, Pants
 *     Cap [Group]    → Cap_3/2/1
 *   root [Bone]      → skeleton (pelvis, spine, arms, legs, etc.)
 */
export type BunnyComponent =
    | 'Bunny_full'
    | 'Bunny_body'
    | 'Bunny_cap'
    | 'Bunny_pants'
    | 'Bunny_face'
    | 'Bunny_eyes'
    | 'Bunny_glasses'
    | 'Bunny_ears';

/**
 * Controles del rig (FK/IK) del personaje.
 * Estos son los nombres de los controles del rig original
 * (Maya/Blender) que se usan para animación procedural.
 * No están exportados en el FBX, pero se usan como API
 * para manipular el esqueleto desde código.
 */
export type BunnyControl =
    | 'Bunny_Ctrl_Hips'
    | 'Bunny_Ctrl_Spine'
    | 'Bunny_Ctrl_Spine1'
    | 'Bunny_Ctrl_Spine2'
    | 'Bunny_Ctrl_Neck'
    | 'Bunny_Ctrl_Head'
    | 'Bunny_Ctrl_LeftShoulder'
    | 'Bunny_Ctrl_LeftArm'
    | 'Bunny_Ctrl_LeftForeArm'
    | 'Bunny_Ctrl_LeftHand'
    | 'Bunny_Ctrl_RightShoulder'
    | 'Bunny_Ctrl_RightArm'
    | 'Bunny_Ctrl_RightForeArm'
    | 'Bunny_Ctrl_RightHand'
    | 'Bunny_Ctrl_LeftUpLeg'
    | 'Bunny_Ctrl_LeftLeg'
    | 'Bunny_Ctrl_LeftFoot'
    | 'Bunny_Ctrl_RightUpLeg'
    | 'Bunny_Ctrl_RightLeg'
    | 'Bunny_Ctrl_RightFoot'
    | 'Bunny_Ctrl_ChestOriginEffector'
    | 'Bunny_Ctrl_ChestEndEffector'
    | 'Bunny_Ctrl_LeftWristEffector'
    | 'Bunny_Ctrl_RightWristEffector'
    | 'Bunny_Ctrl_LeftElbowEffector'
    | 'Bunny_Ctrl_RightElbowEffector'
    | 'Bunny_Ctrl_LeftShoulderEffector'
    | 'Bunny_Ctrl_RightShoulderEffector'
    | 'Bunny_Ctrl_HeadEffector'
    | 'Bunny_Ctrl_LeftHipEffector'
    | 'Bunny_Ctrl_RightHipEffector'
    | 'Bunny_Ctrl_LeftAnkleEffector'
    | 'Bunny_Ctrl_RightAnkleEffector'
    | 'Bunny_Ctrl_LeftKneeEffector'
    | 'Bunny_Ctrl_RightKneeEffector'
    | 'Bunny_Ctrl_LeftHandThumbEffector'
    | 'Bunny_Ctrl_LeftHandIndexEffector'
    | 'Bunny_Ctrl_LeftHandMiddleEffector'
    | 'Bunny_Ctrl_LeftHandRingEffector'
    | 'Bunny_Ctrl_RightHandThumbEffector'
    | 'Bunny_Ctrl_RightHandIndexEffector'
    | 'Bunny_Ctrl_RightHandMiddleEffector'
    | 'Bunny_Ctrl_RightHandRingEffector';

/**
 * Animaciones disponibles del personaje.
 * Nombres exactos extraídos de Animations.zip.
 */
export type BunnyAnimation =
    | 'Bind-pose'
    | 'Cap_back'
    | 'Cap_front'
    | 'Dance'
    | 'Emo_blink'
    | 'Emo_mouth_open'
    | 'Emo_neutral'
    | 'Idle_1'
    | 'Idle_2'
    | 'Idle_3'
    | 'Jump_in_place'
    | 'Jump_while_run'
    | 'MouthMove'
    | 'Palabra'
    | 'Run'
    | 'Walk'
    | 'Walk_sneaky';

/**
 * Lista canónica en runtime de las animaciones del avatar.
 * Fuente de verdad para validar labels directos (Cap_back, Emo_blink, Walk…)
 * en el post-processing del transcript.
 */
export const BUNNY_ANIMATIONS: readonly BunnyAnimation[] = [
    'Bind-pose', 'Cap_back', 'Cap_front', 'Dance',
    'Emo_blink', 'Emo_mouth_open', 'Emo_neutral',
    'Idle_1', 'Idle_2', 'Idle_3',
    'Jump_in_place', 'Jump_while_run',
    'MouthMove', 'Palabra', 'Run', 'Walk', 'Walk_sneaky',
] as const;

/**
 * Expresiones faciales del avatar.
 * Mapea a nombres de expresiones usados por EXPRESSION_MAP y el EmotionEngine.
 */
export type AvatarExpression = string;

/**
 * Señales visuales overlay sobre el avatar.
 */
export type AvatarSignal =
    | 'WAVE'
    | 'THINK'
    | 'HIGHLIGHT'
    | 'ALERT'
    | 'CELEBRATE'
    | 'NONE';

/**
 * Estados de la máquina de estados del avatar.
 */
export type AvatarState =
    | 'IDLE'
    | 'LISTENING'
    | 'THINKING'
    | 'SPEAKING'
    | 'ERROR'
    | 'SLEEPING'
    | 'CELEBRATING'
    | 'COMPUTING';

/**
 * Metadatos de un log de evento.
 */
export interface BunnyLogEntry {
    timestamp: string;
    type: 'component' | 'animation' | 'signal' | 'state' | 'system' | 'decoration';
    action: string;
    detail: string;
}

/**
 * Configuración de visibilidad de componentes.
 * key = BunnyComponent, value = visible
 */
export type ComponentVisibility = Record<BunnyComponent, boolean>;

/**
 * Estado global del BunnyControlCenter.
 */
export interface BunnyControlState {
    /** Componentes visibles */
    components: ComponentVisibility;
    /** Colores personalizados por componente */
    componentColors: Record<BunnyComponent, string | undefined>;
    /** Animación actualmente reproduciéndose */
    currentAnimation: BunnyAnimation | null;
    /** Señal visual activa */
    currentSignal: AvatarSignal;
    /** Estado actual del avatar */
    currentState: AvatarState;
    /** Logs habilitados */
    logsEnabled: boolean;
    /** Historial de logs */
    logs: BunnyLogEntry[];
    /** Animación está en reproducción */
    isPlaying: boolean;
    /** Expresión facial actual (OS3 integration) */
    currentExpression: string | null;
    /** Cola de animaciones para blend (OS3 integration) */
    blendQueue: BunnyAnimation[];
    /** Slots de blend (OS3 integration) */
    blendSlots: { id: string; label: string; body: BunnyAnimation; face: BunnyAnimation; enabled: boolean }[];
    /** Slot de blend activo (OS3 integration) */
    activeBlendSlot: string | null;
    /** Velocidad de reproducción de animaciones (multiplicador de timeScale) */
    animationSpeed: number;
    /** Decoración estacional 3D activa (key del catálogo de decoraciones) */
    activeDecoration: string | null;
}
