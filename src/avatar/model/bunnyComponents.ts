// ============================================================
// bunnyComponents — Manejo de visibilidad y colores de componentes
// ============================================================
// Controla qué partes del modelo 3D se muestran/ocultan.
// Basado en la estructura real del FBX Bunny_full.fbx:
//   Bunny_geo [Group]
//     Body [Group]   → Tail, Body (SkinnedMesh)
//     Face [Group]   → Tongue, Eye_R, Eye_L, Bangs, Teeth, Brows
//     Pants [Group]  → Belt_3/2/1, Pants
//     Cap [Group]    → Cap_3/2/1 (SkinnedMesh)
// ============================================================
//
// NOTA: SkinnedMesh extiende de Mesh, por lo que
// child instanceof THREE.Mesh también captura SkinnedMesh.
// Sin embargo, algunos FBX pueden tener los meshes de Cap
// sin un Group wrapper. Por eso aplicamos un fallback:
// si no se encuentra el Group, buscamos meshes por nombre.
// ============================================================

import * as THREE from 'three';

// -----------------------------------------------------------
// Mapa de grupos de componentes en el modelo FBX
// -----------------------------------------------------------
// Adaptado al conjunto de componentes actual del BunnyControlCenter:
// Bunny_glasses no existe en el modelo ('' → se omite) y Bunny_ears
// es parte de la malla del cuerpo (no se puede ocultar por separado).
// -----------------------------------------------------------

export const COMPONENT_GROUPS: Record<string, string> = {
    Bunny_full: '',          // toggle all
    Bunny_body: 'Body',
    Bunny_face: 'Face',
    Bunny_pants: 'Pants',
    Bunny_cap: 'Cap',
    Bunny_eyes: 'Face',      // Eye_R, Eye_L are inside Face group
    Bunny_glasses: '',       // no glasses in this model
    Bunny_ears: 'Face',      // ears are part of the head/face
};

// -----------------------------------------------------------
// Fallback: nombres de mesh para componentes sin Group
// -----------------------------------------------------------
// Algunos componentes (como Cap) pueden no tener un Group
// wrapper en ciertas versiones del FBX. Estos nombres de
// mesh se usan como fallback si findGroupByName() falla.
// -----------------------------------------------------------

const COMPONENT_MESH_FALLBACK: Record<string, string[]> = {
    Bunny_cap: ['Cap_3', 'Cap_2', 'Cap_1'],
    Bunny_body: ['Body', 'Tail'],
    Bunny_pants: ['Pants', 'Belt_3', 'Belt_2', 'Belt_1'],
    Bunny_face: ['Bangs', 'Teeth_lower', 'Teeth_upper', 'Tongue', 'Brows'],
    Bunny_eyes: ['Eye_R', 'Eye_L'],
};

/** Map of component → specific mesh names to toggle (for sub-face components) */
const COMPONENT_MESHES: Record<string, string[]> = {
    Bunny_eyes: ['Eye_R', 'Eye_L'],
};

/**
 * Aplica visibilidad a los componentes del modelo según el estado.
 * No depende de React state — opera directamente sobre el modelo.
 *
 * Primero busca el Group por nombre. Si no lo encuentra, usa
 * el fallback de nombres de mesh.
 */
export function applyComponentVisibility(
    model: THREE.Object3D,
    components: Record<string, boolean>,
): void {
    for (const [compKey, groupName] of Object.entries(COMPONENT_GROUPS)) {
        const isVisible = components[compKey];

        if (compKey === 'Bunny_full') {
            model.visible = isVisible;
            continue;
        }

        if (!groupName) continue;

        // Bunny_ears son parte de la malla del cuerpo — no se pueden
        // ocultar de forma independiente.
        if (compKey === 'Bunny_ears') {
            continue;
        }

        const targetGroup = findGroupByName(model, groupName);

        if (targetGroup) {
            // Group found — toggle specific meshes or all meshes inside it
            const specificMeshes = COMPONENT_MESHES[compKey];
            if (specificMeshes) {
                targetGroup.traverse((child: THREE.Object3D) => {
                    if (child instanceof THREE.Mesh && specificMeshes.includes(child.name)) {
                        child.visible = isVisible;
                    }
                });
            } else {
                targetGroup.traverse((child: THREE.Object3D) => {
                    if (child instanceof THREE.Mesh) {
                        child.visible = isVisible;
                    }
                });
            }
        } else {
            // Group not found — use fallback mesh names
            const fallbackMeshes = COMPONENT_MESH_FALLBACK[compKey];
            if (fallbackMeshes) {
                model.traverse((child: THREE.Object3D) => {
                    if (child instanceof THREE.Mesh && fallbackMeshes.includes(child.name)) {
                        child.visible = isVisible;
                    }
                });
            }
        }
    }
}

/**
 * Aplica un color personalizado a todos los meshes del grupo del componente.
 * Convierte el color (con o sin '#') a hex y actualiza el material.
 */
export function applyComponentColor(
    model: THREE.Object3D,
    component: string,
    color: string,
): void {
    const groupName = COMPONENT_GROUPS[component];
    if (!groupName) return;

    const targetGroup = findGroupByName(model, groupName);
    if (!targetGroup) return;

    // Parsear color hex
    const hexColor = color.startsWith('#') ? color : `#${color}`;
    const numericColor = parseInt(hexColor.replace('#', ''), 16);

    // Aplicar color a todas las mallas del grupo
    targetGroup.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Mesh && child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach((mat) => {
                    if (mat instanceof THREE.MeshStandardMaterial) {
                        mat.color.setHex(numericColor);
                        mat.needsUpdate = true;
                    }
                });
            } else if (child.material instanceof THREE.MeshStandardMaterial) {
                child.material.color.setHex(numericColor);
                child.material.needsUpdate = true;
            }
        }
    });
}

export function findGroupByName(root: THREE.Object3D, name: string): THREE.Object3D | null {
    let found: THREE.Object3D | null = null;
    root.traverse((child: THREE.Object3D) => {
        if (child instanceof THREE.Group && child.name === name) {
            found = child;
        }
    });
    return found;
}
