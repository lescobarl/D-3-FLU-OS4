import * as THREE from 'three';
import { AnimationMixer } from 'three';

// ============================================================
// masterBinding — FIX del "congelamiento de baile" (MECANISMO C)
// ============================================================
// Problema: en three.js, PropertyBinding.findNode() resuelve el hueso de una
// track usando root.getObjectByName(nodeName), que devuelve el PRIMER objeto
// con ese nombre. Los huesos IK/FK clonados que ensureBones() añade al scene
// graph pueden "sombrear" a los huesos del skeleton maestro (mismos nombres),
// de modo que el pose se escribe en objetos Bone que el SkinnedMesh NO consume
// → el cuerpo se congela aunque el mixer avance (weight=1, bindings 100% OK).
//
// Solución (Capa 1): parchear THREE.PropertyBinding.create para que cualquier
// track cuyo nodeName pertenezca al skeleton maestro se vincule DIRECTAMENTE
// a ese hueso exacto (patrón estándar rootNode+nodeName que usa GLTFLoader).
// CLAVE: PropertyBinding resuelve this.node EAGERLY en su constructor
// (this.node = findNode(rootNode, nodeName)) con el rootNode ORIGINAL (model
// root) ANTES de que este parche fije binding.rootNode. Por eso, además de
// rootNode/parsedPath.rootNode, se asigna binding.node = huesoMaestro: el pose
// se escribe DIRECTAMENTE en el hueso del skin skeleton que consume el
// SkinnedMesh, sin depender de findNode/getObjectByName → inmunidad total al
// sombreado por duplicados IK/FK del scene graph.
//
// Capa 2: AnimationMixer._addInactiveBinding guarda bindings por el rootUuid
// del ACTION-root; pero _removeInactiveBinding lee propBinding.rootNode.uuid
// (que tras Capa 1 es el uuid del hueso maestro) → clave inexistente →
// TypeError en Object.keys(undefined) que corrompe el pool y aborta
// uncacheClip/uncacheRoot. Se registra binding.__mixerRootUuid en
// _addInactiveBinding para que la eliminación use la MISMA clave.
//
// Las tracks que apuntan a huesos IK/FK (NO presentes en el skeleton maestro)
// siguen resolviendo por getObjectByName() a los clones — comportamiento
// deseado (esos huesos solo existen como clones en el scene graph).
//
// Este fix aplica a TODAS las animaciones/emociones por igual, porque todo
// flujo pasa por el mismo createOrReuseAction → mixer.clipAction →
// PropertyBinding.create.

let masterSkeleton: THREE.Skeleton | null = null;
let installed = false;

/** Registra el skeleton maestro (el que consumen los SkinnedMesh). */
export function setMasterSkeleton(skel: THREE.Skeleton | null): void {
    masterSkeleton = skel;
}

/** Devuelve el skeleton maestro registrado (para diagnósticos). */
export function getMasterSkeleton(): THREE.Skeleton | null {
    return masterSkeleton;
}

/**
 * Instala (una sola vez) el parche sobre THREE.PropertyBinding.create.
 * No tiene efecto mientras masterSkeleton sea null (modelo aún no cargado).
 * Puede llamarse de forma segura múltiples veces (idempotente).
 */
export function installMasterBindingPatch(): void {
    if (installed) return;
    installed = true;

    const originalCreate = THREE.PropertyBinding.create;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (THREE.PropertyBinding as any).create = function (
        root: any,
        path: string,
        parsedPath?: any,
    ): any {
        const binding = originalCreate.call(this, root, path, parsedPath) as any;
        // Solo bindings directos (root Object3D, no AnimationObjectGroup).
        // Los Composite ya pasan por este mismo create para cada sub-binding.
        const parsed = binding?.parsedPath;
        if (parsed?.nodeName && masterSkeleton) {
            const bone = masterSkeleton.bones.find((b) => b.name === parsed.nodeName);
            if (bone) {
                // El constructor de PropertyBinding ya resolvió this.node con el
                // rootNode ORIGINAL (model root) → árbol con duplicados IK/FK.
                // Forzamos node = hueso maestro para que getValue/setValue
                // escriban DIRECTAMENTE en el hueso del skin skeleton.
                binding.node = bone;
                binding.rootNode = bone;
                binding.parsedPath.rootNode = bone;
            }
        }
        return binding;
    };

    // ------------------------------------------------------------
    // Capa 2: corregir la clave del cache de bindings del AnimationMixer.
    // ------------------------------------------------------------
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const origAddInactiveBinding = (AnimationMixer as any).prototype._addInactiveBinding;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AnimationMixer as any).prototype._addInactiveBinding = function (
        binding: any,
        rootUuid: string,
        trackName: string,
    ): any {
        if (binding) binding.__mixerRootUuid = rootUuid;
        return origAddInactiveBinding.call(this, binding, rootUuid, trackName);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (AnimationMixer as any).prototype._removeInactiveBinding = function (binding: any): void {
        const bindings = this._bindings;
        const propBinding = binding.binding;
        // Usar la clave con la que _addInactiveBinding GUARDÓ el binding.
        // Fallback al uuid del rootNode (comportamiento original de three.js).
        const rootUuid = binding.__mixerRootUuid || propBinding.rootNode.uuid;
        const trackName = propBinding.path;
        const bindingsByRoot = this._bindingsByRootAndName;
        const bindingByName = bindingsByRoot[rootUuid];

        const lastInactiveBinding = bindings[bindings.length - 1];
        const cacheIndex = binding._cacheIndex;

        lastInactiveBinding._cacheIndex = cacheIndex;
        bindings[cacheIndex] = lastInactiveBinding;
        bindings.pop();

        // Guard: si la clave no existía (rootUuid del hueso en vez del action
        // root) no lanzamos TypeError — ya se quitó el binding del pool arriba.
        if (bindingByName !== undefined) {
            delete bindingByName[trackName];
            if (Object.keys(bindingByName).length === 0) {
                delete bindingsByRoot[rootUuid];
            }
        }
    };
}
