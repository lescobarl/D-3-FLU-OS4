// ============================================================
// bunnyTextures — Carga y caché de texturas del modelo Bunny
// ============================================================
// Las texturas siguen el patrón: {Part}_{Variant}_{Type}.png
// donde Type = D (diffuse), N (normal), R (roughness), M (metallic)
// ============================================================

import * as THREE from 'three';
import { logCaughtError } from '../../lib/caughtError';

// -----------------------------------------------------------
// Mapa de texturas: asocia nombre de malla a texturas
// -----------------------------------------------------------

export interface TextureSet {
    map: string;         // diffuse (D)
    normalMap: string;   // normal (N)
    roughnessMap: string; // roughness (R)
    metalnessMap: string; // metallic (M)
}

const TEXTURE_MAP: Record<string, TextureSet> = {
    Body: {
        map: '/textures/Bunny_Body_1_D.png',
        normalMap: '/textures/Bunny_Body_1_N.png',
        roughnessMap: '/textures/Bunny_Body_1_R.png',
        metalnessMap: '/textures/Bunny_Body_1_M.png',
    },
    Tail: {
        map: '/textures/Bunny_Body_1_D.png',
        normalMap: '/textures/Bunny_Body_1_N.png',
        roughnessMap: '/textures/Bunny_Body_1_R.png',
        metalnessMap: '/textures/Bunny_Body_1_M.png',
    },
    Face: {
        map: '/textures/Bunny_Face_1_D.png',
        normalMap: '/textures/Bunny_Face_1_N.png',
        roughnessMap: '/textures/Bunny_Face_1_R.png',
        metalnessMap: '/textures/Bunny_Face_1_M.png',
    },
    Pants: {
        map: '/textures/Bunny_Pants_1_D.png',
        normalMap: '/textures/Bunny_Pants_1_N.png',
        roughnessMap: '/textures/Bunny_Pants_1_R.png',
        metalnessMap: '/textures/Bunny_Pants_1_M.png',
    },
    Cap: {
        map: '/textures/Bunny_Cap_1_D.png',
        normalMap: '/textures/Bunny_Cap_1_N.png',
        roughnessMap: '/textures/Bunny_Cap_1_R.png',
        metalnessMap: '/textures/Bunny_Cap_1_M.png',
    },
};

// -----------------------------------------------------------
// Caché global de texturas (compartida entre instancias)
// -----------------------------------------------------------

const textureCache = new Map<string, THREE.Texture>();

export function getTexture(path: string): THREE.Texture {
    const cached = textureCache.get(path);
    if (cached) return cached;
    const loader = new THREE.TextureLoader();
    const tex = loader.load(path);
    tex.colorSpace = THREE.SRGBColorSpace;
    textureCache.set(path, tex);
    return tex;
}

// -----------------------------------------------------------
// Utilidad: determinar qué texture set usar para una malla
// -----------------------------------------------------------

export function getTextureSetForMesh(meshName: string): TextureSet | null {
    const lower = meshName.toLowerCase();
    if (lower.includes('body') || lower.includes('torso') || lower.includes('tail') || lower.includes('cola')) {
        return TEXTURE_MAP.Body;
    }
    if (lower.includes('face') || lower.includes('cara') || lower.includes('brows') || lower.includes('ceja') ||
        lower.includes('bangs') || lower.includes('fleco') || lower.includes('eye') || lower.includes('ojo') ||
        lower.includes('tongue') || lower.includes('lengua') || lower.includes('teeth') || lower.includes('diente') ||
        lower.includes('ear') || lower.includes('oreja')) {
        return TEXTURE_MAP.Face;
    }
    if (lower.includes('pants') || lower.includes('pantalon') || lower.includes('leg') || lower.includes('pierna') ||
        lower.includes('belt') || lower.includes('cinturon') || lower.includes('cinto')) {
        return TEXTURE_MAP.Pants;
    }
    if (lower.includes('cap') || lower.includes('gorra')) {
        return TEXTURE_MAP.Cap;
    }
    return null;
}

// -----------------------------------------------------------
// Aplicar texturas a un material
// -----------------------------------------------------------

export function applyTextures(material: THREE.MeshStandardMaterial, meshName: string): boolean {
    const texSet = getTextureSetForMesh(meshName);
    if (!texSet) return false;

    try {
        const diffuseTex = getTexture(texSet.map);
        material.map = diffuseTex;

        const normalTex = getTexture(texSet.normalMap);
        material.normalMap = normalTex;
        material.normalScale = new THREE.Vector2(1, 1);

        const roughnessTex = getTexture(texSet.roughnessMap);
        material.roughnessMap = roughnessTex;

        const metalnessTex = getTexture(texSet.metalnessMap);
        material.metalnessMap = metalnessTex;

        material.roughness = 1;
        material.metalness = 0;
        material.needsUpdate = true;
        return true;
    } catch (e) {
        logCaughtError(`[Textures] Error loading textures for ${meshName}:`, e);
        return false;
    }
}
