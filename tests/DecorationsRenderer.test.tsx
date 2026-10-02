// @vitest-environment jsdom
// ============================================================
// DecorationsRenderer - anclaje 3D de la decoracion estacional (0%).
// ------------------------------------------------------------
// El componente no pinta JSX: su unico efecto construye el grupo 3D de la
// decoracion y lo ancla al hueso 'head' (fallback 'root' -> objeto raiz).
// Se sustituye la frontera three.js por un doble propio con sondas y el
// store Zustand por vi.hoisted; el modulo bajo prueba NO se mockea y el
// catalogo real corre sobre el doble. Se cubren: guardas de entrada,
// eleccion de ancla, computo de posicion/cuaternion, fallback sin huesos
// y ciclo de vida (reemplazo, cambio de target, desmontaje).
// ============================================================
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({
    vectorApply: 0,
    worldToLocal: [] as Array<{ x: number; y: number; z: number }>,
    quatOps: [] as string[],
    updateMatrixWorld: 0,
    disposed: 0,
}));

const bunny = vi.hoisted(() => {
    const store = { activeDecoration: null as string | null };
    return {
        store,
        useBunnyStore: (selector: (s: typeof store) => unknown) => selector(store),
    };
});

vi.mock('../src/avatar/store/bunnyStore', () => ({ useBunnyStore: bunny.useBunnyStore }));

vi.mock('three', () => {
    class Matrix4 {
        elements: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    }
    class Vector3 {
        x: number;
        y: number;
        z: number;
        constructor(x = 0, y = 0, z = 0) {
            this.x = x;
            this.y = y;
            this.z = z;
        }
        set(x: number, y: number, z: number) {
            this.x = x;
            this.y = y;
            this.z = z;
            return this;
        }
        copy(v: Vector3) {
            this.x = v.x;
            this.y = v.y;
            this.z = v.z;
            return this;
        }
        applyMatrix4(_m: Matrix4) {
            probe.vectorApply += 1;
            return this;
        }
    }
    class Quaternion {
        x = 0;
        y = 0;
        z = 0;
        w = 1;
        copy(q: Quaternion) {
            probe.quatOps.push('copy');
            this.x = q.x;
            this.y = q.y;
            this.z = q.z;
            this.w = q.w;
            return this;
        }
        setFromRotationMatrix(_m: Matrix4) {
            probe.quatOps.push('fromMatrix');
            return this;
        }
        invert() {
            probe.quatOps.push('invert');
            return this;
        }
        multiply(_q: Quaternion) {
            probe.quatOps.push('multiply');
            return this;
        }
    }
    class Object3D {
        type = 'Object3D';
        name = '';
        visible = true;
        children: Object3D[] = [];
        parent: Object3D | null = null;
        position = new Vector3();
        quaternion = new Quaternion();
        scale = new Vector3(1, 1, 1);
        matrixWorld = new Matrix4();
        add(child: Object3D) {
            child.parent = this;
            this.children.push(child);
            return this;
        }
        remove(child: Object3D) {
            const i = this.children.indexOf(child);
            if (i >= 0) this.children.splice(i, 1);
            if (child.parent === this) child.parent = null;
            return this;
        }
        traverse(fn: (o: Object3D) => void) {
            fn(this);
            for (const c of this.children) c.traverse(fn);
        }
        updateMatrixWorld(_force?: boolean) {
            probe.updateMatrixWorld += 1;
        }
        localToWorld(v: Vector3) {
            return v;
        }
        worldToLocal(v: Vector3) {
            probe.worldToLocal.push({ x: v.x, y: v.y, z: v.z });
            return v;
        }
        getObjectByName(name: string): Object3D | undefined {
            if (this.name === name) return this;
            for (const c of this.children) {
                const found = c.getObjectByName(name);
                if (found) return found;
            }
            return undefined;
        }
    }
    class Group extends Object3D {}
    class Bone extends Object3D {
        constructor() {
            super();
            this.type = 'Bone';
        }
    }
    class Mesh extends Object3D {
        geometry: unknown;
        material: unknown;
        constructor(geometry: unknown = null, material: unknown = null) {
            super();
            this.geometry = geometry;
            this.material = material;
        }
    }
    class Geometry {
        dispose() {
            probe.disposed += 1;
        }
    }
    class Color {
        hex: string;
        constructor(hex = '#ffffff') {
            this.hex = hex;
        }
    }
    class MeshStandardMaterial {
        color: Color;
        emissive: Color | null = null;
        emissiveIntensity = 0;
        constructor(opts?: { color?: string }) {
            this.color = new Color(opts?.color ?? '#ffffff');
        }
        dispose() {
            probe.disposed += 1;
        }
    }
    return {
        Object3D,
        Group,
        Bone,
        Mesh,
        Vector3,
        Quaternion,
        Color,
        MeshStandardMaterial,
        SphereGeometry: Geometry,
        ConeGeometry: Geometry,
        CylinderGeometry: Geometry,
        TorusGeometry: Geometry,
        BoxGeometry: Geometry,
        OctahedronGeometry: Geometry,
        TetrahedronGeometry: Geometry,
    };
});

import * as THREE from 'three';
import { DecorationsRenderer } from '../src/avatar/decorations/DecorationsRenderer';
import { HEAD_ANCHOR } from '../src/avatar/decorations/decorationsCatalog';

const bone = (name: string): THREE.Bone => {
    const b = new THREE.Bone();
    b.name = name;
    return b;
};

const decorationIn = (parent: THREE.Object3D, key: string): THREE.Object3D | undefined =>
    parent.children.find((c) => c.name === `decoration-${key}`);

beforeEach(() => {
    probe.vectorApply = 0;
    probe.worldToLocal.length = 0;
    probe.quatOps.length = 0;
    probe.updateMatrixWorld = 0;
    probe.disposed = 0;
    bunny.store.activeDecoration = null;
});

afterEach(() => {
    cleanup();
});

// ------------------------------------------------------------
// Bloque A: guardas de entrada
// ------------------------------------------------------------
describe('DecorationsRenderer - guardas de entrada', () => {
    it('sin target no construye decoracion ni toca matrices', () => {
        bunny.store.activeDecoration = 'crown';

        render(<DecorationsRenderer target={null} />);

        expect(probe.vectorApply).toBe(0);
        expect(probe.updateMatrixWorld).toBe(0);
    });

    it('sin decoracion activa no anade nada al target', () => {
        const target = new THREE.Object3D();
        const head = bone('head');
        target.add(head);

        render(<DecorationsRenderer target={target} />);

        expect(head.children).toHaveLength(0);
        expect(probe.disposed).toBe(0);
    });

    it('con una key desconocida el catalogo devuelve null y no ancla nada', () => {
        const target = new THREE.Object3D();
        const head = bone('head');
        target.add(head);
        bunny.store.activeDecoration = 'no-existe';

        render(<DecorationsRenderer target={target} />);

        expect(head.children).toHaveLength(0);
        expect(probe.worldToLocal).toHaveLength(0);
    });
});

// ------------------------------------------------------------
// Bloque B: anclaje al hueso 'head'
// ------------------------------------------------------------
describe('DecorationsRenderer - anclaje al hueso head', () => {
    it('ancla el grupo al hueso head y no al objeto raiz', () => {
        const target = new THREE.Object3D();
        const head = bone('head');
        target.add(head);
        bunny.store.activeDecoration = 'crown';

        render(<DecorationsRenderer target={target} />);

        expect(decorationIn(head, 'crown')).toBeTruthy();
        expect(decorationIn(target, 'crown')).toBeUndefined();
    });

    it('copia al grupo la posicion local resuelta (HEAD_ANCHOR via worldToLocal)', () => {
        const target = new THREE.Object3D();
        const head = bone('head');
        target.add(head);
        bunny.store.activeDecoration = 'crown';

        render(<DecorationsRenderer target={target} />);

        expect(probe.worldToLocal).toEqual([
            { x: HEAD_ANCHOR[0], y: HEAD_ANCHOR[1], z: HEAD_ANCHOR[2] },
        ]);
        const group = decorationIn(head, 'crown');
        expect(group?.position.x).toBeCloseTo(HEAD_ANCHOR[0], 5);
        expect(group?.position.y).toBeCloseTo(HEAD_ANCHOR[1], 5);
        expect(group?.position.z).toBeCloseTo(HEAD_ANCHOR[2], 5);
    });

    it('compensa la orientacion con el cuaternion del hueso y actualiza el mundo', () => {
        const target = new THREE.Object3D();
        target.add(bone('head'));
        bunny.store.activeDecoration = 'crown';

        render(<DecorationsRenderer target={target} />);

        expect(probe.vectorApply).toBe(1);
        expect(probe.updateMatrixWorld).toBeGreaterThan(0);
        expect(probe.quatOps).toContain('fromMatrix');
        expect(probe.quatOps).toContain('invert');
        expect(probe.quatOps).toContain('multiply');
        expect(probe.quatOps).toContain('copy');
    });

    it('ignora un head que no es Bone y cae al root', () => {
        const target = new THREE.Object3D();
        const plainHead = new THREE.Object3D();
        plainHead.name = 'head';
        const root = bone('root');
        target.add(plainHead);
        target.add(root);
        bunny.store.activeDecoration = 'crown';

        render(<DecorationsRenderer target={target} />);

        expect(decorationIn(plainHead, 'crown')).toBeUndefined();
        expect(decorationIn(root, 'crown')).toBeTruthy();
    });
});

// ------------------------------------------------------------
// Bloque C: fallback sin huesos (objeto raiz)
// ------------------------------------------------------------
describe('DecorationsRenderer - fallback sin huesos', () => {
    it('sin huesos ancla directamente al objeto raiz', () => {
        const target = new THREE.Object3D();
        bunny.store.activeDecoration = 'crown';

        render(<DecorationsRenderer target={target} />);

        expect(decorationIn(target, 'crown')).toBeTruthy();
        expect(probe.worldToLocal).toHaveLength(0);
    });
});

// ------------------------------------------------------------
// Bloque D: ciclo de vida
// ------------------------------------------------------------
describe('DecorationsRenderer - ciclo de vida', () => {
    it('al cambiar de decoracion retira y libera la anterior', () => {
        const target = new THREE.Object3D();
        const head = bone('head');
        target.add(head);
        bunny.store.activeDecoration = 'crown';
        const { rerender } = render(<DecorationsRenderer target={target} />);
        expect(decorationIn(head, 'crown')).toBeTruthy();

        bunny.store.activeDecoration = 'flag';
        rerender(<DecorationsRenderer target={target} />);

        expect(decorationIn(head, 'crown')).toBeUndefined();
        expect(decorationIn(head, 'flag')).toBeTruthy();
        expect(head.children).toHaveLength(1);
        expect(probe.disposed).toBeGreaterThan(0);
    });

    it('al desmontar retira y libera la decoracion', () => {
        const target = new THREE.Object3D();
        const head = bone('head');
        target.add(head);
        bunny.store.activeDecoration = 'crown';
        const { unmount } = render(<DecorationsRenderer target={target} />);
        expect(decorationIn(head, 'crown')).toBeTruthy();

        unmount();

        expect(head.children).toHaveLength(0);
        expect(probe.disposed).toBeGreaterThan(0);
    });

    it('al cambiar de target limpia el anterior y ancla en el nuevo', () => {
        const targetA = new THREE.Object3D();
        const headA = bone('head');
        targetA.add(headA);
        const targetB = new THREE.Object3D();
        const headB = bone('head');
        targetB.add(headB);
        bunny.store.activeDecoration = 'crown';
        const { rerender } = render(<DecorationsRenderer target={targetA} />);
        expect(decorationIn(headA, 'crown')).toBeTruthy();

        rerender(<DecorationsRenderer target={targetB} />);

        expect(decorationIn(headA, 'crown')).toBeUndefined();
        expect(decorationIn(headB, 'crown')).toBeTruthy();
        expect(probe.disposed).toBeGreaterThan(0);
    });
});
