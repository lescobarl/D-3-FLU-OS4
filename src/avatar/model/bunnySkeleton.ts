// ============================================================
// bunnySkeleton — Unificación de skeletons del modelo Bunny
// ============================================================
// El modelo Bunny_full.fbx tiene ~16 SkinnedMesh, cada uno con
// su propio skeleton que contiene instancias duplicadas de los
// mismos huesos. Esta función unifica todos los skeletons para
// que AnimationMixer funcione correctamente.
// ============================================================

import * as THREE from 'three';

export interface UnifyResult {
    success: boolean;
    masterSkeleton: THREE.Skeleton | null;
}

/**
 * Unifica todos los skeletons del modelo en uno solo (master).
 * 
 * 1. Identifica todos los skeletons únicos
 * 2. Elige el skeleton con más huesos como master
 * 3. Re-mapea skinIndex de cada SkinnedMesh al master
 * 4. NO elimina huesos IK/FK del scene graph (necesarios para animaciones)
 */
export function unifySkeletons(object: THREE.Object3D): UnifyResult {
    const skinnedMeshes: THREE.SkinnedMesh[] = [];
    object.traverse((child) => {
        if (child instanceof THREE.SkinnedMesh) {
            skinnedMeshes.push(child);
        }
    });

    if (skinnedMeshes.length === 0) {
        console.warn('[Skeleton] No SkinnedMesh found');
        return { success: false, masterSkeleton: null };
    }

    // Collect unique skeletons
    const uniqueSkeletons: Map<THREE.Bone[], THREE.Skeleton> = new Map();
    for (const sm of skinnedMeshes) {
        if (sm.skeleton) {
            const key = sm.skeleton.bones;
            if (!uniqueSkeletons.has(key)) {
                uniqueSkeletons.set(key, sm.skeleton);
            }
        }
    }


    if (uniqueSkeletons.size <= 1) {
        return { success: true, masterSkeleton: skinnedMeshes[0]?.skeleton || null };
    }

    // Pick master skeleton (most bones)
    let masterSkeleton: THREE.Skeleton | null = null;
    let maxBones = 0;
    for (const [, skel] of uniqueSkeletons) {
        if (skel.bones.length > maxBones) {
            maxBones = skel.bones.length;
            masterSkeleton = skel;
        }
    }

    if (!masterSkeleton) {
        console.error('[Skeleton] No master skeleton found');
        return { success: false, masterSkeleton: null };
    }


    // Build name→index map for master skeleton
    const masterBoneIndex = new Map<string, number>();
    for (let i = 0; i < masterSkeleton.bones.length; i++) {
        masterBoneIndex.set(masterSkeleton.bones[i].name, i);
    }

    // Remap skinIndex for each non-master SkinnedMesh
    for (const sm of skinnedMeshes) {
        if (sm.skeleton === masterSkeleton) continue;

        const oldSkeleton = sm.skeleton;
        if (!oldSkeleton) continue;

        const geo = sm.geometry;
        if (!geo) continue;

        const skinIndexAttr = geo.attributes.skinIndex;
        const skinWeightAttr = geo.attributes.skinWeight;
        if (!skinIndexAttr || !skinWeightAttr) continue;

        const oldBones = oldSkeleton.bones;
        const position = skinIndexAttr.array;
        const vertexCount = skinIndexAttr.count;
        const numInfluences = skinIndexAttr.itemSize;

        for (let v = 0; v < vertexCount; v++) {
            for (let i = 0; i < numInfluences; i++) {
                const idx = v * numInfluences + i;
                const oldBoneIdx = position[idx];
                if (oldBoneIdx >= 0 && oldBoneIdx < oldBones.length) {
                    const boneName = oldBones[oldBoneIdx].name;
                    const newBoneIdx = masterBoneIndex.get(boneName);
                    if (newBoneIdx !== undefined) {
                        position[idx] = newBoneIdx;
                    } else {
                        position[idx] = 0;
                        if (skinWeightAttr) {
                            skinWeightAttr.array[idx] = 0;
                        }
                    }
                }
            }
        }

        skinIndexAttr.needsUpdate = true;
        if (skinWeightAttr) skinWeightAttr.needsUpdate = true;

        sm.skeleton = masterSkeleton;

    }


    // -----------------------------------------------------------
    // Post-processing: Reparar SkinnedMesh sin datos de skinning.
    // Algunos meshes (ej. Cap_3, Cap_2, Cap_1) tienen todos los
    // skinIndex y skinWeight en cero en el FBX original. Esto hace
    // que Three.js los renderice en el origen (0,0,0).
    //
    // En lugar de convertirlos a Mesh (que los dejaría sin seguir
    // el skeleton), les asignamos peso completo al hueso "head"
    // para que sigan correctamente las animaciones.
    // -----------------------------------------------------------
    const headBoneIndex = masterBoneIndex.get('head');
    if (headBoneIndex !== undefined) {
        for (const sm of skinnedMeshes) {
            const geo = sm.geometry;
            if (!geo) continue;

            const skinWeightAttr = geo.attributes.skinWeight;
            const skinIndexAttr = geo.attributes.skinIndex;
            if (!skinWeightAttr || !skinIndexAttr) continue;

            const weights = skinWeightAttr.array;
            let hasWeight = false;
            for (let i = 0; i < weights.length; i++) {
                if (weights[i] > 0) {
                    hasWeight = true;
                    break;
                }
            }

            if (!hasWeight) {
                // Assign full weight to head bone for all vertices
                const numVerts = skinIndexAttr.count;
                const itemSize = skinIndexAttr.itemSize;
                for (let v = 0; v < numVerts; v++) {
                    const idx = v * itemSize;
                    skinIndexAttr.array[idx] = headBoneIndex;
                    skinWeightAttr.array[idx] = 1;
                    // Zero out remaining influences
                    for (let i = 1; i < itemSize; i++) {
                        skinIndexAttr.array[idx + i] = 0;
                        skinWeightAttr.array[idx + i] = 0;
                    }
                }
                skinIndexAttr.needsUpdate = true;
                skinWeightAttr.needsUpdate = true;

            }
        }
    } else {
        console.warn('[Skeleton] Bone "head" not found in master skeleton — cannot repair zero-weight meshes');
    }


    return { success: true, masterSkeleton };
}
