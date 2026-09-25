// ============================================================
// ControlsPanel — Botones de Controles del Rig (FK/IK)
// ============================================================
// Estos son los controles del rig original (Maya/Blender)
// que se usan para manipular el esqueleto del personaje
// mediante código (API de animación procedural).
// 
// Los nombres corresponden a los controles del rig:
//   Bunny_Ctrl_Hips, Bunny_Ctrl_Spine, etc.
// 
// Actualmente son placeholders para futura implementación
// de manipulación procedural del esqueleto.
// ============================================================

import { useBunnyStore } from '../store/bunnyStore';
import type { BunnyControl } from '../types/bunny';

// -----------------------------------------------------------
// Definición de controles del rig
// -----------------------------------------------------------

interface ControlDef {
    id: BunnyControl;
    label: string;
    icon: string;
    category: 'body' | 'arm_l' | 'arm_r' | 'leg_l' | 'leg_r' | 'effector';
    bone: string; // bone real en el FBX al que afectaría
}

const CONTROLS: ControlDef[] = [
    // Tronco
    { id: 'Bunny_Ctrl_Hips', label: 'Hips', icon: '🦴', category: 'body', bone: 'pelvis' },
    { id: 'Bunny_Ctrl_Spine', label: 'Spine', icon: '🦴', category: 'body', bone: 'spine_01' },
    { id: 'Bunny_Ctrl_Spine1', label: 'Spine1', icon: '🦴', category: 'body', bone: 'spine_02' },
    { id: 'Bunny_Ctrl_Spine2', label: 'Spine2', icon: '🦴', category: 'body', bone: 'spine_03' },
    { id: 'Bunny_Ctrl_Neck', label: 'Neck', icon: '🦴', category: 'body', bone: 'neck_01' },
    { id: 'Bunny_Ctrl_Head', label: 'Head', icon: '🦴', category: 'body', bone: 'head' },

    // Brazo izquierdo
    { id: 'Bunny_Ctrl_LeftShoulder', label: 'L Shoulder', icon: '💪', category: 'arm_l', bone: 'clavicle_l' },
    { id: 'Bunny_Ctrl_LeftArm', label: 'L Arm', icon: '💪', category: 'arm_l', bone: 'upperarm_l' },
    { id: 'Bunny_Ctrl_LeftForeArm', label: 'L Forearm', icon: '💪', category: 'arm_l', bone: 'lowerarm_l' },
    { id: 'Bunny_Ctrl_LeftHand', label: 'L Hand', icon: '✋', category: 'arm_l', bone: 'hand_l' },

    // Brazo derecho
    { id: 'Bunny_Ctrl_RightShoulder', label: 'R Shoulder', icon: '💪', category: 'arm_r', bone: 'clavicle_r' },
    { id: 'Bunny_Ctrl_RightArm', label: 'R Arm', icon: '💪', category: 'arm_r', bone: 'upperarm_r' },
    { id: 'Bunny_Ctrl_RightForeArm', label: 'R Forearm', icon: '💪', category: 'arm_r', bone: 'lowerarm_r' },
    { id: 'Bunny_Ctrl_RightHand', label: 'R Hand', icon: '✋', category: 'arm_r', bone: 'hand_r' },

    // Pierna izquierda
    { id: 'Bunny_Ctrl_LeftUpLeg', label: 'L Thigh', icon: '🦵', category: 'leg_l', bone: 'thigh_l' },
    { id: 'Bunny_Ctrl_LeftLeg', label: 'L Leg', icon: '🦵', category: 'leg_l', bone: 'calf_l' },
    { id: 'Bunny_Ctrl_LeftFoot', label: 'L Foot', icon: '🦶', category: 'leg_l', bone: 'foot_l' },

    // Pierna derecha
    { id: 'Bunny_Ctrl_RightUpLeg', label: 'R Thigh', icon: '🦵', category: 'leg_r', bone: 'thigh_r' },
    { id: 'Bunny_Ctrl_RightLeg', label: 'R Leg', icon: '🦵', category: 'leg_r', bone: 'calf_r' },
    { id: 'Bunny_Ctrl_RightFoot', label: 'R Foot', icon: '🦶', category: 'leg_r', bone: 'foot_r' },

    // Effectors (IK targets)
    { id: 'Bunny_Ctrl_ChestOriginEffector', label: 'Chest Origin', icon: '🎯', category: 'effector', bone: 'spine_01' },
    { id: 'Bunny_Ctrl_ChestEndEffector', label: 'Chest End', icon: '🎯', category: 'effector', bone: 'spine_03' },
    { id: 'Bunny_Ctrl_LeftWristEffector', label: 'L Wrist IK', icon: '🎯', category: 'effector', bone: 'hand_l' },
    { id: 'Bunny_Ctrl_RightWristEffector', label: 'R Wrist IK', icon: '🎯', category: 'effector', bone: 'hand_r' },
    { id: 'Bunny_Ctrl_LeftElbowEffector', label: 'L Elbow IK', icon: '🎯', category: 'effector', bone: 'lowerarm_l' },
    { id: 'Bunny_Ctrl_RightElbowEffector', label: 'R Elbow IK', icon: '🎯', category: 'effector', bone: 'lowerarm_r' },
    { id: 'Bunny_Ctrl_LeftShoulderEffector', label: 'L Shoulder IK', icon: '🎯', category: 'effector', bone: 'clavicle_l' },
    { id: 'Bunny_Ctrl_RightShoulderEffector', label: 'R Shoulder IK', icon: '🎯', category: 'effector', bone: 'clavicle_r' },
    { id: 'Bunny_Ctrl_HeadEffector', label: 'Head IK', icon: '🎯', category: 'effector', bone: 'head' },
    { id: 'Bunny_Ctrl_LeftHipEffector', label: 'L Hip IK', icon: '🎯', category: 'effector', bone: 'thigh_l' },
    { id: 'Bunny_Ctrl_RightHipEffector', label: 'R Hip IK', icon: '🎯', category: 'effector', bone: 'thigh_r' },
    { id: 'Bunny_Ctrl_LeftAnkleEffector', label: 'L Ankle IK', icon: '🎯', category: 'effector', bone: 'foot_l' },
    { id: 'Bunny_Ctrl_RightAnkleEffector', label: 'R Ankle IK', icon: '🎯', category: 'effector', bone: 'foot_r' },
    { id: 'Bunny_Ctrl_LeftKneeEffector', label: 'L Knee IK', icon: '🎯', category: 'effector', bone: 'calf_l' },
    { id: 'Bunny_Ctrl_RightKneeEffector', label: 'R Knee IK', icon: '🎯', category: 'effector', bone: 'calf_r' },
    { id: 'Bunny_Ctrl_LeftHandThumbEffector', label: 'L Thumb IK', icon: '🎯', category: 'effector', bone: 'thumb_03_l' },
    { id: 'Bunny_Ctrl_LeftHandIndexEffector', label: 'L Index IK', icon: '🎯', category: 'effector', bone: 'index_03_l' },
    { id: 'Bunny_Ctrl_LeftHandMiddleEffector', label: 'L Middle IK', icon: '🎯', category: 'effector', bone: 'middle_03_l' },
    { id: 'Bunny_Ctrl_LeftHandRingEffector', label: 'L Ring IK', icon: '🎯', category: 'effector', bone: 'ring_03_l' },
    { id: 'Bunny_Ctrl_RightHandThumbEffector', label: 'R Thumb IK', icon: '🎯', category: 'effector', bone: 'thumb_03_r' },
    { id: 'Bunny_Ctrl_RightHandIndexEffector', label: 'R Index IK', icon: '🎯', category: 'effector', bone: 'index_03_r' },
    { id: 'Bunny_Ctrl_RightHandMiddleEffector', label: 'R Middle IK', icon: '🎯', category: 'effector', bone: 'middle_03_r' },
    { id: 'Bunny_Ctrl_RightHandRingEffector', label: 'R Ring IK', icon: '🎯', category: 'effector', bone: 'ring_03_r' },
];

// -----------------------------------------------------------
// ControlsPanel
// -----------------------------------------------------------

export default function ControlsPanel() {
    const addLog = useBunnyStore((s) => s.addLog);
    const logsEnabled = useBunnyStore((s) => s.logsEnabled);

    const handleControlClick = (control: ControlDef) => {
        if (logsEnabled) {
        }
        addLog({
            timestamp: new Date().toISOString(),
            type: 'component',
            action: 'control_select',
            detail: `${control.id} (${control.label}) → bone: ${control.bone}`,
        });
    };

    const categories = [
        { key: 'body', label: 'Tronco', color: '#ff6b6b' },
        { key: 'arm_l', label: 'Brazo Izquierdo', color: '#4ecdc4' },
        { key: 'arm_r', label: 'Brazo Derecho', color: '#45b7d1' },
        { key: 'leg_l', label: 'Pierna Izquierda', color: '#96ceb4' },
        { key: 'leg_r', label: 'Pierna Derecha', color: '#ffeaa7' },
        { key: 'effector', label: 'IK Effectors', color: '#dfe6e9' },
    ];

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-icon">🎮</span>
                <span className="panel-title">CONTROLS (RIG)</span>
                <span className="panel-badge">API</span>
            </div>
            <div className="panel-body">
                {categories.map((cat) => {
                    const catControls = CONTROLS.filter((c) => c.category === cat.key);
                    return (
                        <div key={cat.key} className="control-category">
                            <div className="control-category-label" style={{ color: cat.color }}>
                                {cat.label}
                            </div>
                            <div className="control-grid">
                                {catControls.map((control) => (
                                    <button
                                        key={control.id}
                                        className="btn-control"
                                        onClick={() => handleControlClick(control)}
                                        title={`${control.id}\nBone: ${control.bone}\n${control.label}`}
                                        data-control={control.id}
                                    >
                                        <span className="btn-icon">{control.icon}</span>
                                        <span className="btn-label">{control.label}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
