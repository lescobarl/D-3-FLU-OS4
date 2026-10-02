// ============================================================
// bunnyTextures - comportamiento REAL de resolucion de textura por
// clave, cache y aplicacion a material. Frontera three.js sustituida
// por dobles minimos via vi.mock('three') (TextureLoader, Vector2,
// MeshStandardMaterial, SRGBColorSpace). Modulo bajo prueba NO mockeado.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockState = vi.hoisted(() => ({
    loadCalls: [] as string[],
    failPaths: new Set<string>(),
}));

vi.mock('three', () => {
    class TextureLoader {
        load(path: string) {
            mockState.loadCalls.push(path);
            if (mockState.failPaths.has(path)) {
                throw new Error('mock texture load failure');
            }
            return { isTexture: true, path, colorSpace: null as string | null };
        }
    }
    class Vector2 {
        x: number;
        y: number;
        constructor(x = 0, y = 0) {
            this.x = x;
            this.y = y;
        }
    }
    class MeshStandardMaterial {
        map: any;
        normalMap: any;
        roughnessMap: any;
        metalnessMap: any;
        normalScale: any;
        roughness: number;
        metalness: number;
        needsUpdate: boolean;
        constructor() {
            this.map = null;
            this.normalMap = null;
            this.roughnessMap = null;
            this.metalnessMap = null;
            this.normalScale = null;
            this.roughness = 1;
            this.metalness = 1;
            this.needsUpdate = false;
        }
    }
    return { TextureLoader, Vector2, MeshStandardMaterial, SRGBColorSpace: 'srgb' };
});

import * as THREE from 'three';
import { getTexture, getTextureSetForMesh, applyTextures } from '../src/avatar/model/bunnyTextures';

beforeEach(() => {
    mockState.loadCalls.length = 0;
    mockState.failPaths.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ------------------------------------------------------------
// Resolucion de texture set por nombre de malla
// ------------------------------------------------------------
describe('getTextureSetForMesh - resolucion por clave', () => {
    it('Body resuelve el set completo D/N/R/M del cuerpo', () => {
        const set = getTextureSetForMesh('Body');
        expect(set).not.toBeNull();
        expect(set?.map).toBe('/textures/Bunny_Body_1_D.png');
        expect(set?.normalMap).toBe('/textures/Bunny_Body_1_N.png');
        expect(set?.roughnessMap).toBe('/textures/Bunny_Body_1_R.png');
        expect(set?.metalnessMap).toBe('/textures/Bunny_Body_1_M.png');
    });

    it('reconoce cuerpo por Body/torso/tail/cola', () => {
        const bodyMap = getTextureSetForMesh('Body')?.map;
        for (const name of ['TAIL', 'Torso', 'cola', 'BODY_mesh']) {
            expect(getTextureSetForMesh(name)?.map).toBe(bodyMap);
        }
    });

    it('reconoce cara por sus sub-mallas (ojos, lengua, cejas, orejas)', () => {
        const faceMap = getTextureSetForMesh('Face')?.map;
        for (const name of ['Face', 'brows', 'Eye_R', 'Tongue', 'Bangs', 'oreja', 'diente']) {
            expect(getTextureSetForMesh(name)?.map).toBe(faceMap);
        }
    });

    it('reconoce pantalon por pants/pantalon/leg/belt', () => {
        const pantsMap = getTextureSetForMesh('Pants')?.map;
        for (const name of ['Pants', 'pantalon', 'Leg_L', 'Belt_3', 'cinturon']) {
            expect(getTextureSetForMesh(name)?.map).toBe(pantsMap);
        }
    });

    it('reconoce gorra por cap/gorra', () => {
        const capMap = getTextureSetForMesh('Cap')?.map;
        for (const name of ['Cap_1', 'gorra']) {
            expect(getTextureSetForMesh(name)?.map).toBe(capMap);
        }
    });

    it('devuelve null con clave desconocida o vacia', () => {
        expect(getTextureSetForMesh('Wings')).toBeNull();
        expect(getTextureSetForMesh('Hat')).toBeNull();
        expect(getTextureSetForMesh('')).toBeNull();
    });

    it('edge: la primera coincidencia decide (Body gana a Cap)', () => {
        expect(getTextureSetForMesh('Body_Cap')?.map).toBe('/textures/Bunny_Body_1_D.png');
    });
});

// ------------------------------------------------------------
// Cache de texturas
// ------------------------------------------------------------
describe('getTexture - cache y colorSpace', () => {
    it('misma ruta devuelve la MISMA instancia y carga una sola vez', () => {
        const path = '/textures/cache_only_D.png';
        const first = getTexture(path);
        const second = getTexture(path);

        expect(second).toBe(first);
        expect(mockState.loadCalls.filter((p) => p === path)).toHaveLength(1);
    });

    it('rutas distintas producen instancias distintas', () => {
        const a = getTexture('/textures/distinct_a_D.png');
        const b = getTexture('/textures/distinct_b_D.png');

        expect(a).not.toBe(b);
        expect(mockState.loadCalls).toEqual(['/textures/distinct_a_D.png', '/textures/distinct_b_D.png']);
    });

    it('asigna colorSpace SRGB a la textura cargada', () => {
        const tex = getTexture('/textures/test_only_D.png');
        expect(tex.colorSpace).toBe(THREE.SRGBColorSpace);
    });
});

// ------------------------------------------------------------
// Aplicacion de texturas a material
// ------------------------------------------------------------
describe('applyTextures - aplicacion a material', () => {
    it('devuelve false y no toca el material con una malla desconocida', () => {
        const material = new THREE.MeshStandardMaterial();

        const ok = applyTextures(material, 'Wings');

        expect(ok).toBe(false);
        expect(material.map).toBeNull();
        expect(material.needsUpdate).toBe(false);
    });

    it('Body: asigna D/N/R/M, normalScale(1,1), roughness 1, metalness 0 y needsUpdate', () => {
        const material = new THREE.MeshStandardMaterial();

        const ok = applyTextures(material, 'Body');

        expect(ok).toBe(true);
        expect(material.map).toBe(getTexture('/textures/Bunny_Body_1_D.png'));
        expect(material.normalMap).toBe(getTexture('/textures/Bunny_Body_1_N.png'));
        expect(material.roughnessMap).toBe(getTexture('/textures/Bunny_Body_1_R.png'));
        expect(material.metalnessMap).toBe(getTexture('/textures/Bunny_Body_1_M.png'));
        expect(material.normalScale.x).toBe(1);
        expect(material.normalScale.y).toBe(1);
        expect(material.roughness).toBe(1);
        expect(material.metalness).toBe(0);
        expect(material.needsUpdate).toBe(true);
    });

    it('edge: si falla la carga devuelve false y reporta por consola', () => {
        const failPath = '/textures/Bunny_Cap_1_D.png';
        mockState.failPaths.add(failPath);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const material = new THREE.MeshStandardMaterial();

        const ok = applyTextures(material, 'Cap');

        expect(ok).toBe(false);
        expect(material.map).toBeNull();
        expect(material.needsUpdate).toBe(false);
        expect(error).toHaveBeenCalled();
    });
});
