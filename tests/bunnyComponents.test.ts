// ============================================================
// bunnyComponents - comportamiento REAL de visibilidad, color y
// busqueda de grupos. Frontera three.js sustituida por dobles
// minimos via vi.mock('three') (Object3D, Group, Mesh,
// MeshStandardMaterial). El modulo bajo prueba NO se mockea.
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
    class Color {
        private hex: number;
        constructor(hex = 0xffffff) {
            this.hex = hex;
        }
        setHex(h: number) {
            this.hex = h;
            return this;
        }
        getHex() {
            return this.hex;
        }
    }
    class MeshStandardMaterial {
        color: Color;
        needsUpdate: boolean;
        constructor() {
            this.color = new Color();
            this.needsUpdate = false;
        }
    }
    return { Object3D, Group, Mesh, Color, MeshStandardMaterial };
});

import * as THREE from 'three';
import {
    applyComponentVisibility,
    applyComponentColor,
    findGroupByName,
    COMPONENT_GROUPS,
} from '../src/avatar/model/bunnyComponents';

afterEach(() => {
    vi.restoreAllMocks();
});

// ------------------------------------------------------------
// Fixtures
// ------------------------------------------------------------
type Model = {
    model: THREE.Group;
    body: THREE.Group;
    face: THREE.Group;
    bodyMesh: THREE.Mesh;
    tail: THREE.Mesh;
    eyeR: THREE.Mesh;
    eyeL: THREE.Mesh;
    tongue: THREE.Mesh;
    pantsMesh: THREE.Mesh;
    belt3: THREE.Mesh;
    cap3: THREE.Mesh;
};

function named<T extends { name: string }>(obj: T, name: string): T {
    obj.name = name;
    return obj;
}

function makeMesh(name: string): THREE.Mesh {
    return named(new THREE.Mesh(null as unknown as THREE.BufferGeometry, new THREE.MeshStandardMaterial()), name);
}

function makeGroup(name: string): THREE.Group {
    return named(new THREE.Group(), name);
}

function buildModel(): Model {
    const model = makeGroup('Bunny_geo');
    const body = makeGroup('Body');
    const bodyMesh = makeMesh('Body');
    const tail = makeMesh('Tail');
    body.add(bodyMesh);
    body.add(tail);
    const face = makeGroup('Face');
    const eyeR = makeMesh('Eye_R');
    const eyeL = makeMesh('Eye_L');
    const tongue = makeMesh('Tongue');
    face.add(eyeR);
    face.add(eyeL);
    face.add(tongue);
    const pants = makeGroup('Pants');
    const pantsMesh = makeMesh('Pants');
    const belt3 = makeMesh('Belt_3');
    pants.add(pantsMesh);
    pants.add(belt3);
    const cap = makeGroup('Cap');
    const cap3 = makeMesh('Cap_3');
    cap.add(cap3);
    model.add(body);
    model.add(face);
    model.add(pants);
    model.add(cap);
    return { model, body, face, bodyMesh, tail, eyeR, eyeL, tongue, pantsMesh, belt3, cap3 };
}

// Estado base con TODO visible para aislar el efecto bajo prueba.
function visibleAll(overrides: Record<string, boolean> = {}): Record<string, boolean> {
    const base: Record<string, boolean> = {
        Bunny_full: true,
        Bunny_body: true,
        Bunny_face: true,
        Bunny_pants: true,
        Bunny_cap: true,
        Bunny_eyes: true,
        Bunny_glasses: false,
        Bunny_ears: true,
    };
    return { ...base, ...overrides };
}

function hexOf(mesh: THREE.Mesh, index?: number): number {
    if (index === undefined) {
        return (mesh.material as THREE.MeshStandardMaterial).color.getHex();
    }
    return (mesh.material as THREE.MeshStandardMaterial[])[index].color.getHex();
}

// ------------------------------------------------------------
// Mapa de grupos (contrato de nombres)
// ------------------------------------------------------------
describe('bunnyComponents - mapa COMPONENT_GROUPS', () => {
    it('asocia componentes a grupos y deja vacios los no soportados', () => {
        expect(COMPONENT_GROUPS['Bunny_body']).toBe('Body');
        expect(COMPONENT_GROUPS['Bunny_face']).toBe('Face');
        expect(COMPONENT_GROUPS['Bunny_eyes']).toBe('Face');
        expect(COMPONENT_GROUPS['Bunny_pants']).toBe('Pants');
        expect(COMPONENT_GROUPS['Bunny_cap']).toBe('Cap');
        expect(COMPONENT_GROUPS['Bunny_full']).toBe('');
        expect(COMPONENT_GROUPS['Bunny_glasses']).toBe('');
    });
});

// ------------------------------------------------------------
// Visibilidad por estado
// ------------------------------------------------------------
describe('applyComponentVisibility - visibilidad por estado', () => {
    it('Bunny_full alterna la visibilidad del modelo completo', () => {
        const { model } = buildModel();

        applyComponentVisibility(model, visibleAll({ Bunny_full: false }));
        expect(model.visible).toBe(false);

        applyComponentVisibility(model, visibleAll({ Bunny_full: true }));
        expect(model.visible).toBe(true);
    });

    it('Bunny_body oculta los meshes del grupo Body sin tocar Face', () => {
        const { model, bodyMesh, tail, eyeR } = buildModel();

        applyComponentVisibility(model, visibleAll({ Bunny_body: false }));

        expect(bodyMesh.visible).toBe(false);
        expect(tail.visible).toBe(false);
        expect(eyeR.visible).toBe(true);
    });

    it('Bunny_face oculta todos los meshes del grupo Face', () => {
        const { model, eyeR, eyeL, tongue, bodyMesh } = buildModel();

        // Bunny_eyes corre DESPUES de Bunny_face y reabre los ojos: se apaga
        // tambien para observar el efecto completo de Bunny_face.
        applyComponentVisibility(model, visibleAll({ Bunny_face: false, Bunny_eyes: false }));

        expect(eyeR.visible).toBe(false);
        expect(eyeL.visible).toBe(false);
        expect(tongue.visible).toBe(false);
        expect(bodyMesh.visible).toBe(true);
    });

    it('Bunny_eyes oculta SOLO Eye_R/Eye_L dentro de Face', () => {
        const { model, eyeR, eyeL, tongue } = buildModel();

        applyComponentVisibility(model, visibleAll({ Bunny_eyes: false }));

        expect(eyeR.visible).toBe(false);
        expect(eyeL.visible).toBe(false);
        expect(tongue.visible).toBe(true);
    });

    it('el orden de claves hace que Bunny_eyes reabra lo que Bunny_face cerro', () => {
        const { model, eyeR, eyeL, tongue } = buildModel();

        applyComponentVisibility(model, visibleAll({ Bunny_face: false, Bunny_eyes: true }));

        expect(eyeR.visible).toBe(true);
        expect(eyeL.visible).toBe(true);
        expect(tongue.visible).toBe(false);
    });

    it('Bunny_ears se ignora: no reabre el grupo Face', () => {
        const { model, tongue, eyeR } = buildModel();

        applyComponentVisibility(model, visibleAll({ Bunny_face: false, Bunny_eyes: false, Bunny_ears: true }));

        expect(tongue.visible).toBe(false);
        expect(eyeR.visible).toBe(false);
    });

    it('edge: lista vacia deja visible en undefined (clave ausente)', () => {
        const { model, bodyMesh, tongue } = buildModel();

        applyComponentVisibility(model, {});

        expect(model.visible).toBeUndefined();
        expect(bodyMesh.visible).toBeUndefined();
        expect(tongue.visible).toBeUndefined();
    });
});

// ------------------------------------------------------------
// Fallback por nombre de mesh (sin grupo)
// ------------------------------------------------------------
describe('applyComponentVisibility - fallback sin grupos', () => {
    it('usa nombres de mesh cuando no existe el grupo contenedor', () => {
        const model = makeGroup('Bunny_geo');
        const cap3 = makeMesh('Cap_3');
        const belt3 = makeMesh('Belt_3');
        const tail = makeMesh('Tail');
        const tongue = makeMesh('Tongue');
        model.add(cap3);
        model.add(belt3);
        model.add(tail);
        model.add(tongue);

        applyComponentVisibility(
            model,
            visibleAll({ Bunny_cap: false, Bunny_pants: false, Bunny_body: false, Bunny_face: false }),
        );

        expect(cap3.visible).toBe(false);
        expect(belt3.visible).toBe(false);
        expect(tail.visible).toBe(false);
        expect(tongue.visible).toBe(false);
    });
});

// ------------------------------------------------------------
// findGroupByName
// ------------------------------------------------------------
describe('findGroupByName', () => {
    it('encuentra un grupo anidado y devuelve null si no existe', () => {
        const { model, face } = buildModel();

        expect(findGroupByName(model, 'Face')).toBe(face);
        expect(findGroupByName(model, 'NoExiste')).toBeNull();
    });
});

// ------------------------------------------------------------
// Color por componente
// ------------------------------------------------------------
describe('applyComponentColor', () => {
    it('aplica el hex (con #) a todos los meshes del grupo Body', () => {
        const { model, bodyMesh, tail } = buildModel();

        applyComponentColor(model, 'Bunny_body', '#ff0000');

        expect(hexOf(bodyMesh)).toBe(0xff0000);
        expect(hexOf(tail)).toBe(0xff0000);
        expect((bodyMesh.material as THREE.MeshStandardMaterial).needsUpdate).toBe(true);
    });

    it('acepta color sin # y no hace nada con componente desconocido o vacio', () => {
        const { model, bodyMesh } = buildModel();

        applyComponentColor(model, 'Bunny_body', '00ff00');
        expect(hexOf(bodyMesh)).toBe(0x00ff00);

        applyComponentColor(model, 'Bunny_glasses', '#123456');
        applyComponentColor(model, 'Bunny_no_existe', '#123456');
        expect(hexOf(bodyMesh)).toBe(0x00ff00);
    });

    it('aplica color a materiales en array e ignora materiales no estandar', () => {
        const { model, body } = buildModel();
        const matA = new THREE.MeshStandardMaterial();
        const matB = new THREE.MeshStandardMaterial();
        const arrayMesh = named(new THREE.Mesh(null as unknown as THREE.BufferGeometry, [matA, matB] as unknown as THREE.Material), 'ArrayPart');
        body.add(arrayMesh);
        const plain = { color: { setHex: (): void => undefined } } as unknown as THREE.Material;
        const plainMesh = named(new THREE.Mesh(null as unknown as THREE.BufferGeometry, plain), 'PlainPart');
        body.add(plainMesh);

        applyComponentColor(model, 'Bunny_body', '#0000ff');

        expect(hexOf(arrayMesh, 0)).toBe(0x0000ff);
        expect(hexOf(arrayMesh, 1)).toBe(0x0000ff);
    });

    it('Bunny_eyes colorea todo el grupo Face (no solo los ojos)', () => {
        const { model, eyeR, tongue } = buildModel();

        applyComponentColor(model, 'Bunny_eyes', '#abcdef');

        expect(hexOf(eyeR)).toBe(0xabcdef);
        expect(hexOf(tongue)).toBe(0xabcdef);
    });
});
