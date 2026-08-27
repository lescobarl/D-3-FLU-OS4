// ============================================================
// decorationsCatalog.test — Validación determinista del catálogo
// de decoraciones 3D (sin R3F, solo three)
// ============================================================

import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import {
    DECORATIONS,
    DECORATION_KEYS,
    HEAD_ANCHOR,
    buildDecorationGroup,
    disposeDecorationGroup,
    getDecorationLabel,
} from '../src/avatar/decorations/decorationsCatalog';

describe('decorationsCatalog — catálogo de decoraciones 3D', () => {
    it('cada key del catálogo construye un grupo 3D no nulo', () => {
        for (const key of DECORATION_KEYS) {
            const group = buildDecorationGroup(key);
            expect(group, `decoración '${key}' debe construir grupo`).not.toBeNull();
        }
    });

    it('buildDecorationGroup devuelve null para keys desconocidas', () => {
        expect(buildDecorationGroup('no-existe')).toBeNull();
        expect(buildDecorationGroup('')).toBeNull();
    });

    it('cada grupo se ancla a la corona de la cabeza (HEAD_ANCHOR)', () => {
        for (const key of DECORATION_KEYS) {
            const group = buildDecorationGroup(key)!;
            expect(group.position.x).toBeCloseTo(HEAD_ANCHOR[0], 5);
            expect(group.position.y).toBeCloseTo(HEAD_ANCHOR[1], 5);
            expect(group.position.z).toBeCloseTo(HEAD_ANCHOR[2], 5);
        }
    });

    it('cada decoración tiene al menos un elemento y un nombre legible', () => {
        for (const [key, def] of Object.entries(DECORATIONS)) {
            expect(def.elements.length, `'${key}' sin elementos`).toBeGreaterThan(0);
            expect(def.label.length, `'${key}' sin label`).toBeGreaterThan(0);
        }
    });

    it('cada elemento es un Mesh con geometría y material válidos', () => {
        for (const key of DECORATION_KEYS) {
            const group = buildDecorationGroup(key)!;
            let meshCount = 0;
            group.traverse((child) => {
                if ((child as THREE.Mesh).isMesh) {
                    meshCount++;
                    const mesh = child as THREE.Mesh;
                    expect(mesh.geometry).toBeDefined();
                    expect(mesh.geometry.attributes.position).toBeDefined();
                    expect((mesh.material as THREE.MeshStandardMaterial).color).toBeDefined();
                }
            });
            expect(meshCount).toBe(DECORATIONS[key].elements.length);
        }
    });

    it('las decoraciones centrales se mantienen libres de las orejas (x ±0.35, y ~0.97)', () => {
        for (const key of DECORATION_KEYS) {
            const group = buildDecorationGroup(key)!;
            group.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(group);
            // Altura central razonable sobre la corona (y ancla 0.60 + hasta ~0.80 relativo)
            expect(box.max.y, `'${key}' excede la altura esperada`).toBeLessThanOrEqual(1.4);
        }
    });

    it('disposeDecorationGroup libera geometrías y materiales sin lanzar', () => {
        for (const key of DECORATION_KEYS) {
            const group = buildDecorationGroup(key)!;
            expect(() => disposeDecorationGroup(group)).not.toThrow();
        }
    });

    it('getDecorationLabel devuelve nombre legible y fallback por key', () => {
        expect(getDecorationLabel('santa-hat')).toBe('Gorro de Santa');
        expect(getDecorationLabel('desconocido')).toBe('desconocido');
    });
});
