// ============================================================
// bunnyMaterials - conducta REAL de reparación de materiales del
// modelo Bunny.
// ------------------------------------------------------------
// Frontera sustituida: three.js (Mesh, MeshStandardMaterial, Object3D,
// TextureLoader, Vector2, Color, SRGBColorSpace) mediante vi.mock('three').
// El colaborador REAL `bunnyTextures` NO se mockea: se ejercita de verdad,
// de modo que la carga/fallo de texturas se controla por el único borde
// (TextureLoader). Así el fallback de color por nombre de malla y la
// aplicación real de texturas son conducta observable del módulo.
// ============================================================
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const hoisted = vi.hoisted(() => ({
    failAll: false,
    failPaths: new Set<string>(),
    loads: [] as string[],
}));

vi.mock('three', () => {
    class Color {
        hex = 0xffffff;
        setHex(h: number) {
            this.hex = h;
            return this;
        }
        copy(c: { hex: number }) {
            this.hex = c.hex;
            return this;
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
    class TextureLoader {
        load(path: string) {
            hoisted.loads.push(path);
            if (hoisted.failAll || hoisted.failPaths.has(path)) {
                throw new Error('mock texture failure');
            }
            return { isTexture: true, path, colorSpace: null };
        }
    }
    class MeshStandardMaterial {
        roughness: number | undefined;
        metalness: number | undefined;
        color = new Color();
        emissive = new Color();
        emissiveMap: unknown = null;
        emissiveIntensity = 1;
        map: unknown = null;
        normalMap: unknown = null;
        roughnessMap: unknown = null;
        metalnessMap: unknown = null;
        normalScale: unknown = null;
        needsUpdate = false;
        constructor(opts: { roughness?: number; metalness?: number } = {}) {
            this.roughness = opts.roughness;
            this.metalness = opts.metalness;
        }
    }
    class Object3D {
        children: Object3D[] = [];
        name = '';
        add(child: Object3D) {
            this.children.push(child);
            return this;
        }
        traverse(cb: (o: unknown) => void) {
            cb(this);
            for (const child of this.children) child.traverse(cb);
        }
    }
    class Mesh extends Object3D {
        geometry: unknown;
        material: unknown;
        frustumCulled = true;
        constructor(geometry: unknown, material: unknown) {
            super();
            this.geometry = geometry;
            this.material = material;
        }
    }
    return { Color, Vector2, TextureLoader, MeshStandardMaterial, Object3D, Mesh, SRGBColorSpace: 'srgb' };
});

import * as THREE from 'three';
import { repairFBXMaterials } from '../src/avatar/model/bunnyMaterials';

type GeoLike = {
    attributes: Record<string, unknown>;
    index: unknown;
    computeVertexNormals: () => void;
};
type MatLike = {
    roughness: number | undefined;
    metalness: number | undefined;
    color: { hex: number };
    emissive: { hex: number };
    emissiveMap: unknown;
    emissiveIntensity: number;
    map: unknown;
    needsUpdate: boolean;
};
type MeshLike = {
    geometry: GeoLike | null;
    material: unknown;
    name: string;
    frustumCulled: boolean;
};
type ObjLike = {
    add(child: unknown): unknown;
    traverse(cb: (o: unknown) => void): void;
    material?: unknown;
    frustumCulled?: boolean;
};

const three = THREE as unknown as {
    Object3D: new () => ObjLike;
    Mesh: new (geometry: unknown, material: unknown) => MeshLike;
    MeshStandardMaterial: new (opts?: { roughness?: number; metalness?: number }) => MatLike;
};

type GeoHandle = { geo: GeoLike; compute: ReturnType<typeof vi.fn> };

const makeGeo = (opts: { attributes?: Record<string, unknown>; index?: unknown } = {}): GeoHandle => {
    const compute = vi.fn();
    return {
        geo: {
            attributes: opts.attributes ?? {},
            index: 'index' in opts ? opts.index : 0,
            computeVertexNormals: compute,
        },
        compute,
    };
};

const makeMesh = (geometry: GeoLike | null, material: unknown, name: string): MeshLike => {
    const mesh = new three.Mesh(geometry, material);
    mesh.name = name;
    return mesh;
};

const makeObject = (): ObjLike => new three.Object3D();

const repair = (obj: ObjLike) => repairFBXMaterials(obj as unknown as THREE.Object3D);

beforeEach(() => {
    hoisted.failAll = false;
    hoisted.failPaths.clear();
    hoisted.loads.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ------------------------------------------------------------
describe('repairFBXMaterials - traversal y geometría', () => {
    it('desactiva el frustum culling de cada malla recorrida', () => {
        const mesh = makeMesh(makeGeo().geo, {}, 'Wings');
        const obj = makeObject();
        obj.add(mesh);

        repair(obj);

        expect(mesh.frustumCulled).toBe(false);
    });

    it('calcula normales cuando faltan, o cuando la geometría no tiene índice', () => {
        const sinNormal = makeGeo({ attributes: {}, index: 0 });
        const sinIndice = makeGeo({ attributes: { normal: {} }, index: null });
        const meshA = makeMesh(sinNormal.geo, {}, 'Wings');
        const meshB = makeMesh(sinIndice.geo, {}, 'Wings');
        const obj = makeObject();
        obj.add(meshA);
        obj.add(meshB);

        repair(obj);

        expect(sinNormal.compute).toHaveBeenCalledTimes(1);
        expect(sinIndice.compute).toHaveBeenCalledTimes(1);
    });

    it('no recalcula normales si ya hay atributo normal e índice', () => {
        const handle = makeGeo({ attributes: { normal: {} }, index: 12 });
        const mesh = makeMesh(handle.geo, {}, 'Wings');
        const obj = makeObject();
        obj.add(mesh);

        repair(obj);

        expect(handle.compute).not.toHaveBeenCalled();
    });

    it('sin normal y sin índice recalcula dos veces (conducta real de la doble guarda)', () => {
        const handle = makeGeo({ attributes: {}, index: null });
        const mesh = makeMesh(handle.geo, {}, 'Wings');
        const obj = makeObject();
        obj.add(mesh);

        repair(obj);

        expect(handle.compute).toHaveBeenCalledTimes(2);
    });

    it('ignora los hijos que no son mallas', () => {
        const plain = makeObject() as ObjLike;
        plain.material = 'sin-tocar';
        plain.frustumCulled = true;
        const obj = makeObject();
        obj.add(plain);

        repair(obj);

        expect(plain.material).toBe('sin-tocar');
        expect(plain.frustumCulled).toBe(true);
    });

    it('no revienta con una malla sin geometría', () => {
        const mesh = makeMesh(null, {}, 'Wings');
        const obj = makeObject();
        obj.add(mesh);

        expect(() => repair(obj)).not.toThrow();
    });
});

// ------------------------------------------------------------
describe('repairFBXMaterials - material estándar', () => {
    it('reemplaza el material por MeshStandardMaterial rugoso, no metálico y marcado', () => {
        const original = { isMaterial: true };
        const mesh = makeMesh(makeGeo().geo, original, 'Wings');
        const obj = makeObject();
        obj.add(mesh);

        repair(obj);

        const mat = mesh.material as MatLike;
        expect(mesh.material).not.toBe(original);
        expect(mat instanceof three.MeshStandardMaterial).toBe(true);
        expect(mat.roughness).toBe(0.8);
        expect(mat.metalness).toBe(0);
        expect(mat.needsUpdate).toBe(true);
    });

    it('reemplaza cada material cuando el original es un arreglo', () => {
        const original = [{ id: 'a' }, { id: 'b' }];
        const mesh = makeMesh(makeGeo().geo, original, 'Wings');
        const obj = makeObject();
        obj.add(mesh);

        repair(obj);

        const mats = mesh.material as MatLike[];
        expect(Array.isArray(mats)).toBe(true);
        expect(mats).toHaveLength(2);
        expect(mats[0]).not.toBe(original[0]);
        expect(mats[1]).not.toBe(original[1]);
        expect(mats.every((m) => m instanceof three.MeshStandardMaterial)).toBe(true);
    });

    it('preserva el emissive del material original cuando trae emissiveMap', () => {
        const emissiveMap = { tex: 'emissive' };
        const original = new three.MeshStandardMaterial();
        original.emissiveMap = emissiveMap;
        original.emissive.hex = 0x112233;
        original.emissiveIntensity = 2.5;
        const mesh = makeMesh(makeGeo().geo, original, 'Wings');
        const obj = makeObject();
        obj.add(mesh);

        repair(obj);

        const mat = mesh.material as MatLike;
        expect(mat.emissiveMap).toBe(emissiveMap);
        expect(mat.emissive.hex).toBe(0x112233);
        expect(mat.emissiveIntensity).toBe(2.5);
    });

    it('no copia emissive cuando el material original no trae emissiveMap', () => {
        const original = new three.MeshStandardMaterial();
        original.emissive.hex = 0x445566;
        const mesh = makeMesh(makeGeo().geo, original, 'Wings');
        const obj = makeObject();
        obj.add(mesh);

        repair(obj);

        const mat = mesh.material as MatLike;
        expect(mat.emissiveMap).toBeNull();
        expect(mat.emissive.hex).toBe(0xffffff);
    });
});

// ------------------------------------------------------------
describe('repairFBXMaterials - texturas y color de respaldo', () => {
    it('usa el color de respaldo por nombre cuando las texturas no cargan', () => {
        hoisted.failAll = true;
        const casos: Array<[string, number]> = [
            ['Body', 0x88ccff],
            ['Cap', 0x335577],
            ['pants', 0x224466],
            ['face', 0xffccaa],
            ['pelo', 0x664422],
            ['Wings', 0x88ccff],
        ];

        for (const [nombre, hex] of casos) {
            const mesh = makeMesh(makeGeo().geo, {}, nombre);
            const obj = makeObject();
            obj.add(mesh);
            repair(obj);
            expect((mesh.material as MatLike).color.hex).toBe(hex);
        }
    });

    it('aplica las texturas reales a una malla conocida y sube roughness a 1', () => {
        const mesh = makeMesh(makeGeo().geo, {}, 'Body');
        const obj = makeObject();
        obj.add(mesh);

        repair(obj);

        const mat = mesh.material as MatLike;
        expect(mat.map).toBeTruthy();
        expect(mat.roughness).toBe(1);
        expect(mat.metalness).toBe(0);
        expect(hoisted.loads).toContain('/textures/Bunny_Body_1_D.png');
    });
});
