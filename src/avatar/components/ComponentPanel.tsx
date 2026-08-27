// ============================================================
// ComponentPanel — Botones de Componentes Físicos de Bunny
// ============================================================
// Cada botón toggle muestra/oculta una parte del modelo 3D.
// Los nombres corresponden a los grupos reales del FBX:
//   Bunny_geo → Body, Face, Pants, Cap
// ============================================================

import { useBunnyStore } from '../store/bunnyStore';
import type { BunnyComponent } from '../types/bunny';

// -----------------------------------------------------------
// Definición de componentes con metadata visual
// Basado en la estructura real del FBX Bunny_full.fbx
// -----------------------------------------------------------

interface ComponentDef {
    id: BunnyComponent;
    label: string;
    icon: string;
    description: string;
    /** Grupo real en el FBX al que afecta */
    group: string;
    /** Sub-meshes específicos (opcional) */
    meshes?: string[];
}

const COMPONENTS: ComponentDef[] = [
    {
        id: 'Bunny_full',
        label: 'Bunny Full',
        icon: '🐰',
        description: 'Modelo completo (todos los grupos)',
        group: '',
    },
    {
        id: 'Bunny_body',
        label: 'Body',
        icon: '👕',
        description: 'Torso, cola y cuerpo principal (grupo Body)',
        group: 'Body',
    },
    {
        id: 'Bunny_face',
        label: 'Face',
        icon: '😊',
        description: 'Cara completa: ojos, boca, dientes, cejas, fleco (grupo Face)',
        group: 'Face',
    },
    {
        id: 'Bunny_eyes',
        label: 'Eyes',
        icon: '👀',
        description: 'Solo ojos (Eye_R, Eye_L dentro de Face)',
        group: 'Face',
        meshes: ['Eye_R', 'Eye_L'],
    },
    {
        id: 'Bunny_pants',
        label: 'Pants',
        icon: '👖',
        description: 'Pantalones y cinturones (grupo Pants)',
        group: 'Pants',
    },
    {
        id: 'Bunny_cap',
        label: 'Cap',
        icon: '🧢',
        description: 'Gorra (grupo Cap)',
        group: 'Cap',
    },
    {
        id: 'Bunny_glasses',
        label: 'Glasses',
        icon: '👓',
        description: 'Gafas (no presente en el modelo actual)',
        group: '',
    },
    {
        id: 'Bunny_ears',
        label: 'Ears',
        icon: '👂',
        description: 'Orejas (skinned al head, no toggleable independientemente)',
        group: '',
    },
];

// -----------------------------------------------------------
// ComponentPanel
// -----------------------------------------------------------

export default function ComponentPanel() {
    const components = useBunnyStore((s) => s.components);
    const toggleComponent = useBunnyStore((s) => s.toggleComponent);

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-icon">📦</span>
                <span className="panel-title">COMPONENTES</span>
            </div>
            <div className="panel-body">
                {COMPONENTS.map((comp) => {
                    const visible = components[comp.id];
                    const hasGroup = comp.group !== '';
                    return (
                        <button
                            key={comp.id}
                            className={`btn-component ${visible ? 'active' : ''} ${!hasGroup ? 'disabled' : ''}`}
                            onClick={() => toggleComponent(comp.id)}
                            title={comp.description}
                            data-component={comp.id}
                        >
                            <span className="btn-icon">{comp.icon}</span>
                            <span className="btn-label">{comp.label}</span>
                            <span className={`btn-status ${visible ? 'on' : 'off'}`}>
                                {visible ? 'ON' : 'OFF'}
                            </span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
