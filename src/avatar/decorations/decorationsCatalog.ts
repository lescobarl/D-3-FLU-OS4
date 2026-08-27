// ============================================================
// decorationsCatalog — Catálogo de decoraciones 3D estacionales
// ============================================================
// Fuente de verdad de las decoraciones 3D del avatar Bunny.
//
// ANCLAJE (medido con scripts/measure-bunny-head.mjs sobre
// Bunny_full.fbx normalizado a 2/maxDim, centrado en origen):
//   - Modelo: bbox min(-0.623,-1.000,-0.321) max(0.623,1.000,0.321)
//   - La corona de la cabeza (superficie de Cap_1) está en
//     y ≈ 0.602, x 0, z ≈ 0.02  →  HEAD_ANCHOR = [0, 0.60, 0.02]
//   - Las orejas suben a y ≈ 0.967 pero en x ±0.35, por lo que
//     las decoraciones CENTRALES pueden llegar a y ≈ 1.2 sin
//     colisionar. El rostro mira hacia +z.
//
// Las posiciones de cada elemento son RELATIVAS al ancla:
// y = 0 → superficie de la corona, y crece hacia arriba.
//
// El módulo solo depende de three (sin JSX de R3F) para poder
// testear el catálogo de forma determinista.
// ============================================================

import * as THREE from 'three';

/** Ancla de la decoración: corona de la cabeza [x, y, z] (mundo normalizado) */
export const HEAD_ANCHOR: readonly [number, number, number] = [0, 0.6, 0.02];

/** Tipos de geometría primitiva soportados */
export type DecorGeometryKind =
    | 'sphere'
    | 'cone'
    | 'cylinder'
    | 'torus'
    | 'box'
    | 'octahedron'
    | 'tetrahedron';

/** Elemento individual de una decoración (relativo al ancla) */
export interface DecorElement {
    kind: DecorGeometryKind;
    /** Posición relativa al ancla [x, y, z] */
    position: readonly [number, number, number];
    /** Color del material */
    color: string;
    /** Radio (esferas, conos, cilindros, toros, octaedros, tetraedros) */
    radius?: number;
    /** Escala no uniforme [x, y, z] */
    scale?: readonly [number, number, number];
    /** Rotación en radianes [x, y, z] */
    rotation?: readonly [number, number, number];
    /** Alto (conos, cilindros, cajas) */
    height?: number;
    /** Radio superior (cilindros) */
    radiusTop?: number;
    /** Radio inferior (cilindros) */
    radiusBottom?: number;
    /** Grosor del tubo (toros) */
    tube?: number;
    /** Ancho (cajas) */
    width?: number;
    /** Profundidad (cajas) */
    depth?: number;
    /** Metalicidad del material */
    metalness?: number;
    /** Color emisivo (brillo) */
    emissive?: string;
}

/** Definición de una decoración completa */
export interface DecorationDef {
    /** Nombre legible en español */
    label: string;
    /** Elementos que componen la decoración (relativos al ancla) */
    elements: readonly DecorElement[];
}

// ------------------------------------------------------------
// Catálogo
// ------------------------------------------------------------

export const DECORATIONS: Record<string, DecorationDef> = {
    'santa-hat': {
        label: 'Gorro de Santa',
        elements: [
            { kind: 'cone', position: [0, 0.3, 0], color: '#d32f2f', radius: 0.21, height: 0.6 },
            { kind: 'torus', position: [0, 0.03, 0], color: '#f5f5f5', radius: 0.22, tube: 0.05 },
            { kind: 'sphere', position: [0, 0.62, -0.03], color: '#f5f5f5', radius: 0.1 },
        ],
    },
    'party-hat': {
        label: 'Gorro de fiesta',
        elements: [
            { kind: 'cone', position: [0, 0.27, 0], color: '#ffd54f', radius: 0.19, height: 0.54, emissive: '#ffe082' },
            { kind: 'torus', position: [0, 0.02, 0], color: '#4fc3f7', radius: 0.19, tube: 0.035 },
            { kind: 'sphere', position: [0, 0.58, 0], color: '#ff4081', radius: 0.09 },
        ],
    },
    marigold: {
        label: 'Cempasúchil',
        elements: [
            // Flor central
            { kind: 'sphere', position: [0, 0.22, 0], color: '#ffb300', radius: 0.1 },
            { kind: 'sphere', position: [0, 0.22, 0.17], color: '#ff6f00', radius: 0.08 },
            { kind: 'sphere', position: [0.147, 0.22, 0.085], color: '#ff6f00', radius: 0.08 },
            { kind: 'sphere', position: [0.147, 0.22, -0.085], color: '#ff6f00', radius: 0.08 },
            { kind: 'sphere', position: [0, 0.22, -0.17], color: '#ff6f00', radius: 0.08 },
            { kind: 'sphere', position: [-0.147, 0.22, -0.085], color: '#ff6f00', radius: 0.08 },
            { kind: 'sphere', position: [-0.147, 0.22, 0.085], color: '#ff6f00', radius: 0.08 },
            // Flor izquierda
            { kind: 'sphere', position: [-0.2, 0.18, 0.02], color: '#ffa000', radius: 0.08 },
            { kind: 'sphere', position: [-0.2, 0.18, 0.15], color: '#ff8f00', radius: 0.06 },
            { kind: 'sphere', position: [-0.087, 0.18, 0.115], color: '#ff8f00', radius: 0.06 },
            { kind: 'sphere', position: [-0.087, 0.18, -0.045], color: '#ff8f00', radius: 0.06 },
            { kind: 'sphere', position: [-0.2, 0.18, -0.11], color: '#ff8f00', radius: 0.06 },
            { kind: 'sphere', position: [-0.313, 0.18, -0.045], color: '#ff8f00', radius: 0.06 },
            { kind: 'sphere', position: [-0.313, 0.18, 0.115], color: '#ff8f00', radius: 0.06 },
            // Flor derecha
            { kind: 'sphere', position: [0.2, 0.18, 0.02], color: '#ffa000', radius: 0.08 },
            { kind: 'sphere', position: [0.2, 0.18, 0.15], color: '#ff8f00', radius: 0.06 },
            { kind: 'sphere', position: [0.313, 0.18, 0.115], color: '#ff8f00', radius: 0.06 },
            { kind: 'sphere', position: [0.313, 0.18, -0.045], color: '#ff8f00', radius: 0.06 },
            { kind: 'sphere', position: [0.2, 0.18, -0.11], color: '#ff8f00', radius: 0.06 },
            { kind: 'sphere', position: [0.087, 0.18, -0.045], color: '#ff8f00', radius: 0.06 },
            { kind: 'sphere', position: [0.087, 0.18, 0.115], color: '#ff8f00', radius: 0.06 },
        ],
    },
    flag: {
        label: 'Bandera patria',
        elements: [
            { kind: 'cylinder', position: [0, 0.35, 0], color: '#9e9e9e', radiusTop: 0.015, radiusBottom: 0.018, height: 0.7 },
            // Franja verde
            { kind: 'box', position: [0.045, 0.62, 0], color: '#1b5e20', width: 0.09, height: 0.16, depth: 0.02 },
            // Franja blanca
            { kind: 'box', position: [0.135, 0.62, 0], color: '#f5f5f5', width: 0.09, height: 0.16, depth: 0.02 },
            // Franja roja
            { kind: 'box', position: [0.225, 0.62, 0], color: '#d32f2f', width: 0.09, height: 0.16, depth: 0.02 },
            { kind: 'sphere', position: [0, 0.72, 0], color: '#ffd700', radius: 0.025, metalness: 0.6 },
        ],
    },
    crown: {
        label: 'Corona',
        elements: [
            { kind: 'cylinder', position: [0, 0.05, 0], color: '#ffd700', radiusTop: 0.18, radiusBottom: 0.21, height: 0.1, metalness: 0.8 },
            { kind: 'cone', position: [0, 0.16, 0.17], color: '#ffd700', radius: 0.05, height: 0.16, metalness: 0.8 },
            { kind: 'cone', position: [0.162, 0.16, 0.053], color: '#ffd700', radius: 0.05, height: 0.16, metalness: 0.8 },
            { kind: 'cone', position: [0.1, 0.16, -0.138], color: '#ffd700', radius: 0.05, height: 0.16, metalness: 0.8 },
            { kind: 'cone', position: [-0.1, 0.16, -0.138], color: '#ffd700', radius: 0.05, height: 0.16, metalness: 0.8 },
            { kind: 'cone', position: [-0.162, 0.16, 0.053], color: '#ffd700', radius: 0.05, height: 0.16, metalness: 0.8 },
            { kind: 'sphere', position: [0, 0.05, 0.1], color: '#e53935', radius: 0.035, metalness: 0.4, emissive: '#ff1744' },
        ],
    },
    sparkle: {
        label: 'Destellos',
        elements: [
            { kind: 'octahedron', position: [0, 0.3, 0], color: '#fff176', radius: 0.1, emissive: '#fff59d' },
            { kind: 'octahedron', position: [-0.15, 0.45, 0.1], color: '#fff9c4', radius: 0.07, emissive: '#fff9c4' },
            { kind: 'octahedron', position: [0.18, 0.2, -0.08], color: '#ffd54f', radius: 0.06, emissive: '#ffe082' },
            { kind: 'octahedron', position: [0.05, 0.55, -0.1], color: '#fff176', radius: 0.05, emissive: '#fff59d' },
            { kind: 'octahedron', position: [-0.2, 0.18, -0.05], color: '#ffd54f', radius: 0.06, emissive: '#ffe082' },
        ],
    },
    heart: {
        label: 'Corazón',
        elements: [
            { kind: 'sphere', position: [-0.085, 0.1, 0], color: '#e91e63', radius: 0.085 },
            { kind: 'sphere', position: [0.085, 0.1, 0], color: '#e91e63', radius: 0.085 },
            { kind: 'cone', position: [0, 0.05, 0], color: '#e91e63', radius: 0.1, height: 0.15, rotation: [Math.PI, 0, 0] },
            { kind: 'torus', position: [0, 0.2, 0.02], color: '#f48fb1', radius: 0.03, tube: 0.015 },
        ],
    },
    flower: {
        label: 'Flor',
        elements: [
            { kind: 'cylinder', position: [0, 0.12, 0], color: '#4caf50', radiusTop: 0.015, radiusBottom: 0.015, height: 0.24 },
            { kind: 'sphere', position: [0, 0.27, 0.14], color: '#f06292', radius: 0.08 },
            { kind: 'sphere', position: [0.121, 0.27, 0.07], color: '#f06292', radius: 0.08 },
            { kind: 'sphere', position: [0.121, 0.27, -0.07], color: '#f06292', radius: 0.08 },
            { kind: 'sphere', position: [0, 0.27, -0.14], color: '#f06292', radius: 0.08 },
            { kind: 'sphere', position: [-0.121, 0.27, -0.07], color: '#f06292', radius: 0.08 },
            { kind: 'sphere', position: [-0.121, 0.27, 0.07], color: '#f06292', radius: 0.08 },
            { kind: 'sphere', position: [0, 0.27, 0], color: '#ffd54f', radius: 0.07 },
            { kind: 'sphere', position: [0.1, 0.1, 0], color: '#66bb6a', radius: 0.05 },
        ],
    },
    clover: {
        label: 'Trébol',
        elements: [
            { kind: 'cylinder', position: [0, 0.07, 0], color: '#388e3c', radiusTop: 0.012, radiusBottom: 0.012, height: 0.14 },
            { kind: 'sphere', position: [-0.06, 0.17, -0.06], color: '#4caf50', radius: 0.055 },
            { kind: 'sphere', position: [0.06, 0.17, -0.06], color: '#4caf50', radius: 0.055 },
            { kind: 'sphere', position: [-0.06, 0.17, 0.06], color: '#4caf50', radius: 0.055 },
            { kind: 'sphere', position: [0.06, 0.17, 0.06], color: '#4caf50', radius: 0.055 },
        ],
    },
    leaf: {
        label: 'Hoja de otoño',
        elements: [
            { kind: 'box', position: [0, 0.16, 0], color: '#ef6c00', width: 0.3, height: 0.02, depth: 0.12, rotation: [0, 0, 0.35] },
            { kind: 'cylinder', position: [0, 0.05, 0], color: '#795548', radiusTop: 0.012, radiusBottom: 0.012, height: 0.1 },
            { kind: 'box', position: [-0.06, 0.1, -0.02], color: '#e65100', width: 0.16, height: 0.02, depth: 0.08, rotation: [0, 0, -0.6] },
        ],
    },
    sun: {
        label: 'Sol',
        elements: [
            { kind: 'sphere', position: [0, 0.16, 0], color: '#ffeb3b', radius: 0.14, emissive: '#ffea00' },
            { kind: 'sphere', position: [0, 0.16, 0.22], color: '#ffa726', radius: 0.05 },
            { kind: 'sphere', position: [0.156, 0.16, 0.156], color: '#ffa726', radius: 0.05 },
            { kind: 'sphere', position: [0.22, 0.16, 0], color: '#ffa726', radius: 0.05 },
            { kind: 'sphere', position: [0.156, 0.16, -0.156], color: '#ffa726', radius: 0.05 },
            { kind: 'sphere', position: [0, 0.16, -0.22], color: '#ffa726', radius: 0.05 },
            { kind: 'sphere', position: [-0.156, 0.16, -0.156], color: '#ffa726', radius: 0.05 },
            { kind: 'sphere', position: [-0.22, 0.16, 0], color: '#ffa726', radius: 0.05 },
            { kind: 'sphere', position: [-0.156, 0.16, 0.156], color: '#ffa726', radius: 0.05 },
        ],
    },
    pumpkin: {
        label: 'Calabaza',
        elements: [
            { kind: 'sphere', position: [0, 0.12, 0], color: '#ff8f00', radius: 0.19, scale: [1, 0.85, 1] },
            { kind: 'sphere', position: [-0.16, 0.12, 0], color: '#fb8c00', radius: 0.12 },
            { kind: 'sphere', position: [0.16, 0.12, 0], color: '#fb8c00', radius: 0.12 },
            { kind: 'cylinder', position: [0, 0.3, 0], color: '#33691e', radiusTop: 0.015, radiusBottom: 0.025, height: 0.1 },
            { kind: 'sphere', position: [0.05, 0.32, 0], color: '#66bb6a', radius: 0.04 },
        ],
    },
    snowflake: {
        label: 'Copo de nieve',
        elements: [
            { kind: 'box', position: [0, 0.14, 0], color: '#e3f2fd', width: 0.42, height: 0.02, depth: 0.02 },
            { kind: 'box', position: [0, 0.14, 0], color: '#e3f2fd', width: 0.42, height: 0.02, depth: 0.02, rotation: [0, 0, Math.PI / 3] },
            { kind: 'box', position: [0, 0.14, 0], color: '#e3f2fd', width: 0.42, height: 0.02, depth: 0.02, rotation: [0, 0, (2 * Math.PI) / 3] },
            { kind: 'sphere', position: [0.21, 0.14, 0], color: '#90caf9', radius: 0.035 },
            { kind: 'sphere', position: [0.182, 0.14, 0.105], color: '#90caf9', radius: 0.035 },
            { kind: 'sphere', position: [0.182, 0.14, -0.105], color: '#90caf9', radius: 0.035 },
            { kind: 'sphere', position: [-0.21, 0.14, 0], color: '#90caf9', radius: 0.035 },
            { kind: 'sphere', position: [-0.182, 0.14, -0.105], color: '#90caf9', radius: 0.035 },
            { kind: 'sphere', position: [-0.182, 0.14, 0.105], color: '#90caf9', radius: 0.035 },
            { kind: 'sphere', position: [0, 0.14, 0], color: '#42a5f5', radius: 0.045 },
        ],
    },
};

/** Lista inmutable de claves de decoración (fuente de verdad canónica) */
export const DECORATION_KEYS: readonly string[] = Object.freeze(Object.keys(DECORATIONS));

/** Nombre legible de una decoración por su key */
export function getDecorationLabel(key: string): string {
    return DECORATIONS[key]?.label ?? key;
}

// ------------------------------------------------------------
// Construcción
// ------------------------------------------------------------

function buildElement(el: DecorElement): THREE.Mesh {
    let geometry: THREE.BufferGeometry;
    switch (el.kind) {
        case 'sphere':
            geometry = new THREE.SphereGeometry(el.radius ?? 0.1, 24, 16);
            break;
        case 'cone':
            geometry = new THREE.ConeGeometry(el.radius ?? 0.1, el.height ?? 0.3, 24);
            break;
        case 'cylinder':
            geometry = new THREE.CylinderGeometry(
                el.radiusTop ?? el.radius ?? 0.05,
                el.radiusBottom ?? el.radius ?? 0.05,
                el.height ?? 0.3,
                20,
            );
            break;
        case 'torus':
            geometry = new THREE.TorusGeometry(el.radius ?? 0.2, el.tube ?? 0.04, 12, 32);
            break;
        case 'box':
            geometry = new THREE.BoxGeometry(el.width ?? 0.1, el.height ?? 0.1, el.depth ?? 0.1);
            break;
        case 'octahedron':
            geometry = new THREE.OctahedronGeometry(el.radius ?? 0.1);
            break;
        case 'tetrahedron':
            geometry = new THREE.TetrahedronGeometry(el.radius ?? 0.1);
            break;
    }

    const material = new THREE.MeshStandardMaterial({
        color: el.color,
        metalness: el.metalness ?? 0,
        roughness: el.metalness ? 0.35 : 0.7,
    });
    if (el.emissive) {
        material.emissive = new THREE.Color(el.emissive);
        material.emissiveIntensity = 0.5;
    }

    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(el.position[0], el.position[1], el.position[2]);
    if (el.rotation) mesh.rotation.set(el.rotation[0], el.rotation[1], el.rotation[2]);
    if (el.scale) mesh.scale.set(el.scale[0], el.scale[1], el.scale[2]);
    return mesh;
}

/**
 * Construye el grupo 3D de una decoración, anclado a la corona de
 * la cabeza (HEAD_ANCHOR). Devuelve null si la key no existe.
 */
export function buildDecorationGroup(decoration: string): THREE.Group | null {
    const def = DECORATIONS[decoration];
    if (!def) return null;

    const group = new THREE.Group();
    group.name = `decoration-${decoration}`;
    group.position.set(HEAD_ANCHOR[0], HEAD_ANCHOR[1], HEAD_ANCHOR[2]);
    for (const el of def.elements) {
        group.add(buildElement(el));
    }
    return group;
}

/** Libera geometrías y materiales de un objeto de decoración (evita fugas de memoria) */
export function disposeDecorationGroup(group: THREE.Object3D): void {
    group.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) {
            material.forEach((m) => m.dispose());
        } else if (material) {
            material.dispose();
        }
    });
}
