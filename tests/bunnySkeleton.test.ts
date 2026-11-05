// ============================================================
// bunnySkeleton - comportamiento REAL de unifySkeletons().
// Frontera three.js sustituida por dobles minimos via vi.mock('three')
// (Object3D, Group, Mesh, SkinnedMesh, Bone, Skeleton, BufferGeometry,
// BufferAttribute). El modulo bajo prueba NO se mockea.
// ============================================================
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('three', () => {
    class Object3D {
        children: any[];
        name: string;
        visible: boolean;
        parent: any;
        constructor() {
            this.children = [];
            this.name = '';
            this.visible = true;
            this.parent = null;
        }
        add(child: any) {
            child.parent = this;
            this.children.push(child);
            return this;
        }
        traverse(fn: (o: any) => void) {
            fn(this);
            for (const c of this.children) c.traverse(fn);
        }
    }
    class Group extends Object3D {}
    class Mesh extends Object3D {
        geometry: any;
        material: any;
        constructor(geometry: any = null, material: any = null) {
            super();
            this.geometry = geometry;
            this.material = material;
        }
    }
    class SkinnedMesh extends Mesh {
        skeleton: any;
        constructor(geometry: any = null, material: any = null) {
            super(geometry, material);
            this.skeleton = null;
        }
    }
    class Bone extends Object3D {}
    class Skeleton {
        bones: any[];
        constructor(bones: any[] = []) {
            this.bones = bones;
        }
    }
    class BufferAttribute {
        array: any;
        itemSize: number;
        count: number;
        needsUpdate: boolean;
        constructor(array: any, itemSize: number) {
            this.array = array;
            this.itemSize = itemSize;
            this.count = array.length / itemSize;
            this.needsUpdate = false;
        }
    }
    class BufferGeometry {
        attributes: Record<string, any>;
        constructor() {
            this.attributes = {};
        }
        setAttribute(name: string, attr: any) {
            this.attributes[name] = attr;
            return this;
        }
    }
    return { Object3D, Group, Mesh, SkinnedMesh, Bone, Skeleton, BufferAttribute, BufferGeometry };
});

import * as THREE from 'three';
import { unifySkeletons } from '../src/avatar/model/bunnySkeleton';

afterEach(() => {
    vi.restoreAllMocks();
});

// ------------------------------------------------------------
// Helpers de construccion de fixtures (dobles de la frontera)
// ------------------------------------------------------------
function bone(name: string): THREE.Bone {
    const b = new THREE.Bone();
    b.name = name;
    return b;
}

function makeSkeleton(names: string[]): THREE.Skeleton {
    return new THREE.Skeleton(names.map(bone));
}

function geometryWithSkin(index: number[], weights: number[], itemSize: number): THREE.BufferGeometry {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(Uint16Array.from(index), itemSize));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(Float32Array.from(weights), itemSize));
    return geo;
}

function skinned(skeleton: THREE.Skeleton, geometry: THREE.BufferGeometry): THREE.SkinnedMesh {
    const sm = new THREE.SkinnedMesh(geometry);
    sm.skeleton = skeleton;
    return sm;
}

function readAttr(mesh: THREE.SkinnedMesh, name: string): ArrayLike<number> {
    const attr = mesh.geometry.attributes[name] as THREE.BufferAttribute;
    return attr.array as unknown as ArrayLike<number>;
}

function attrOf(mesh: THREE.SkinnedMesh, name: string): THREE.BufferAttribute {
    return mesh.geometry.attributes[name] as THREE.BufferAttribute;
}

// ------------------------------------------------------------
// Casos sin trabajo real: modelos degenerados
// ------------------------------------------------------------
describe('unifySkeletons - modelos degenerados', () => {
    it('sin SkinnedMesh devuelve fallo y avisa por consola', () => {
        const model = new THREE.Group();
        model.add(new THREE.Mesh(geometryWithSkin([0], [1], 1)));
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const result = unifySkeletons(model);

        expect(result).toEqual({ success: false, masterSkeleton: null });
        expect(warn).toHaveBeenCalledWith('[Skeleton] No SkinnedMesh found');
    });

    it('con un solo skeleton unico devuelve exito y ese master sin re-mapear', () => {
        const skel = makeSkeleton(['root', 'head']);
        const model = new THREE.Group();
        model.add(skinned(skel, geometryWithSkin([0], [1], 1)));
        model.add(skinned(skel, geometryWithSkin([0], [1], 1)));

        const result = unifySkeletons(model);

        expect(result.success).toBe(true);
        expect(result.masterSkeleton).toBe(skel);
    });

    it('dos SkinnedMesh que comparten el MISMO array de huesos cuentan como un unico skeleton', () => {
        const bones = [bone('root'), bone('head')];
        const s1 = new THREE.Skeleton(bones);
        const s2 = new THREE.Skeleton(bones);
        const model = new THREE.Group();
        model.add(skinned(s1, geometryWithSkin([0], [1], 1)));
        model.add(skinned(s2, geometryWithSkin([0], [1], 1)));

        const result = unifySkeletons(model);

        // uniqueSkeletons usa la referencia del array como clave: size 1, early return.
        expect(result.masterSkeleton).toBe(s1);
    });

    it('edge: SkinnedMesh con skeleton nulo devuelve exito con master nulo', () => {
        const model = new THREE.Group();
        model.add(new THREE.SkinnedMesh(geometryWithSkin([0], [1], 1)));

        const result = unifySkeletons(model);

        // Comportamiento real: success true aunque no haya ningun skeleton que unificar.
        expect(result.success).toBe(true);
        expect(result.masterSkeleton).toBeNull();
    });
});

// ------------------------------------------------------------
// Eleccion del master entre varios skeletons
// ------------------------------------------------------------
describe('unifySkeletons - eleccion del master', () => {
    it('elige el skeleton con mas huesos y re-apunta el mesh subordinado', () => {
        const master = makeSkeleton(['root', 'spine', 'head']);
        const small = makeSkeleton(['root', 'tail']);
        const model = new THREE.Group();
        const masterMesh = skinned(master, geometryWithSkin([0, 0], [1, 1], 1));
        const otherMesh = skinned(small, geometryWithSkin([0, 1], [1, 1], 1));
        model.add(masterMesh);
        model.add(otherMesh);

        const result = unifySkeletons(model);

        expect(result.success).toBe(true);
        expect(result.masterSkeleton).toBe(master);
        expect(otherMesh.skeleton).toBe(master);
    });

    it('empate de tamano: gana el primero encontrado en el recorrido', () => {
        const s1 = makeSkeleton(['root', 'head']);
        const s2 = makeSkeleton(['a', 'b']);
        const model = new THREE.Group();
        model.add(skinned(s1, geometryWithSkin([0, 0], [1, 1], 1)));
        model.add(skinned(s2, geometryWithSkin([0, 0], [1, 1], 1)));

        const result = unifySkeletons(model);

        expect(result.masterSkeleton).toBe(s1);
    });
});

// ------------------------------------------------------------
// Re-mapeo de skinIndex por nombre de hueso
// ------------------------------------------------------------
describe('unifySkeletons - re-mapeo de skinIndex', () => {
    it('traduce indices por nombre y anula el peso de huesos desconocidos', () => {
        const master = makeSkeleton(['root', 'spine', 'head']);
        const old = makeSkeleton(['spine', 'ghost']);
        const model = new THREE.Group();
        model.add(skinned(master, geometryWithSkin([0, 1], [1, 1], 1)));
        const mesh = skinned(old, geometryWithSkin([0, 1, 1, 0], [1, 1, 1, 1], 1));
        model.add(mesh);

        unifySkeletons(model);

        // spine -> indice 1 del master; ghost no existe -> 0 y peso 0.
        expect(Array.from(readAttr(mesh, 'skinIndex'))).toEqual([1, 0, 0, 1]);
        expect(Array.from(readAttr(mesh, 'skinWeight'))).toEqual([1, 0, 0, 1]);
    });

    it('no toca el skinIndex del mesh que ya usa el master', () => {
        const master = makeSkeleton(['root', 'head']);
        const small = makeSkeleton(['x']);
        const model = new THREE.Group();
        const masterMesh = skinned(master, geometryWithSkin([0, 1], [1, 1], 1));
        model.add(masterMesh);
        model.add(skinned(small, geometryWithSkin([0], [1], 1)));

        unifySkeletons(model);

        expect(Array.from(readAttr(masterMesh, 'skinIndex'))).toEqual([0, 1]);
        expect(Array.from(readAttr(masterMesh, 'skinWeight'))).toEqual([1, 1]);
    });

    it('marca needsUpdate en los atributos re-mapeados', () => {
        const master = makeSkeleton(['root', 'head']);
        const old = makeSkeleton(['ghost', 'root']);
        const model = new THREE.Group();
        model.add(skinned(master, geometryWithSkin([0, 0], [1, 1], 1)));
        const mesh = skinned(old, geometryWithSkin([0, 1], [1, 1], 1));
        model.add(mesh);

        unifySkeletons(model);

        expect(attrOf(mesh, 'skinIndex').needsUpdate).toBe(true);
        expect(attrOf(mesh, 'skinWeight').needsUpdate).toBe(true);
    });

    it('edge: mesh no-master sin atributos de skin no se re-apunta al master', () => {
        const master = makeSkeleton(['root', 'head']);
        const small = makeSkeleton(['x']);
        const model = new THREE.Group();
        model.add(skinned(master, geometryWithSkin([0, 0], [1, 1], 1)));
        const mesh = skinned(small, new THREE.BufferGeometry());
        model.add(mesh);

        const result = unifySkeletons(model);

        // El `continue` por falta de atributos ocurre ANTES de sm.skeleton = master.
        expect(result.masterSkeleton).toBe(master);
        expect(mesh.skeleton).toBe(small);
    });
});

// ------------------------------------------------------------
// Post-proceso: reparacion de meshes con pesos a cero
// ------------------------------------------------------------
describe('unifySkeletons - reparacion de pesos a cero', () => {
    it('asigna peso completo al hueso head cuando todos los pesos son cero', () => {
        const master = makeSkeleton(['root', 'spine', 'head']);
        const small = makeSkeleton(['root']);
        const model = new THREE.Group();
        model.add(skinned(master, geometryWithSkin([0, 0], [1, 1], 1)));
        const zero = skinned(small, geometryWithSkin([0, 0, 0, 0], [0, 0, 0, 0], 4));
        model.add(zero);

        unifySkeletons(model);

        // head esta en el indice 2 del master.
        expect(Array.from(readAttr(zero, 'skinIndex'))).toEqual([2, 0, 0, 0]);
        expect(Array.from(readAttr(zero, 'skinWeight'))).toEqual([1, 0, 0, 0]);
        expect(zero.skeleton).toBe(master);
    });

    it('sin hueso head avisa y deja el mesh de pesos cero intacto', () => {
        const master = makeSkeleton(['root', 'spine']);
        const small = makeSkeleton(['root']);
        const model = new THREE.Group();
        model.add(skinned(master, geometryWithSkin([0, 1], [1, 1], 1)));
        const zero = skinned(small, geometryWithSkin([0, 0], [0, 0], 2));
        model.add(zero);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

        unifySkeletons(model);

        expect(warn).toHaveBeenCalledWith(expect.stringContaining('head'));
        expect(Array.from(readAttr(zero, 'skinWeight'))).toEqual([0, 0]);
    });
});
