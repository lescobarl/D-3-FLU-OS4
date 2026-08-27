// ============================================================
// DecorationsRenderer — Renderiza la decoración 3D estacional
// ============================================================
// Se monta DENTRO del grupo raíz del modelo Bunny y recibe el
// objeto 3D del FBX como target. La decoración se ancla al HUESO
// 'head' del esqueleto (fallback 'root' → target), de modo que
// hereda la transformación COMPLETA: el root-motion vive en el
// hueso 'root' (hijo directo del grupo FBX) y el hueso 'head'
// hereda de pelvis→spine→neck→head. Anclar al objeto raíz
// (estático) haría "flotar" la decoración durante Jump_while_run.
//
// La posición y rotación locales se calculan EN RUNTIME con las
// matrices de mundo vivas: anchorWorld = target.localToWorld(
// HEAD_ANCHOR) → local = bone.worldToLocal(anchorWorld); y el
// cuaternión local = inversa(quat_mundo_hueso) × quat_mundo_target
// (el hueso 'root' tiene -90° en X en bind, por lo que la
// compensación de orientación es obligatoria). Así se preserva
// exactamente la posición de la corona de la cabeza.
//
// No renderiza nada visual en React: opera directamente sobre el
// Object3D del modelo mediante useEffect, siguiendo la misma
// filosofía de BunnyModel (refs + three, sin re-renders).
// ============================================================

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useBunnyStore } from '../store/bunnyStore';
import { buildDecorationGroup, disposeDecorationGroup, HEAD_ANCHOR } from './decorationsCatalog';

interface DecorationsRendererProps {
    /** Objeto 3D raíz del modelo FBX al que se ancla la decoración */
    target: THREE.Object3D | null;
}

/**
 * Hueso de anclaje óptimo para la decoración.
 * 'head' ofrece la mayor fidelidad (sigue la cabeza y hereda el
 * root-motion de pelvis→spine→neck→head); 'root' es el hueso que
 * transporta el root-motion. Devuelve null si no hay hueso.
 */
function findAnchorBone(target: THREE.Object3D): THREE.Bone | null {
    for (const name of ['head', 'root']) {
        const found = target.getObjectByName(name);
        if (found && found.type === 'Bone') return found as THREE.Bone;
    }
    return null;
}

export function DecorationsRenderer({ target }: DecorationsRendererProps) {
    const activeDecoration = useBunnyStore((s) => s.activeDecoration);
    const groupRef = useRef<THREE.Group | null>(null);

    useEffect(() => {
        if (!target) return;

        // 1. Retirar y liberar la decoración anterior (si existe)
        if (groupRef.current) {
            groupRef.current.parent?.remove(groupRef.current);
            disposeDecorationGroup(groupRef.current);
            groupRef.current = null;
        }

        // 2. Sin decoración activa → terminar
        if (!activeDecoration) return;

        // 3. Construir la nueva decoración
        const group = buildDecorationGroup(activeDecoration);
        if (!group) return;

        // 4. Anclar al hueso 'head' (fallback 'root' → target).
        //    El anclaje se calcula EN RUNTIME con las matrices de
        //    mundo vivas para preservar la corona de la cabeza.
        target.updateMatrixWorld(true);
        const anchor = findAnchorBone(target);
        if (!anchor) {
            // Sin hueso disponible: ancla al objeto raíz (comportamiento previo).
            target.add(group);
        } else {
            const anchorWorld = new THREE.Vector3(HEAD_ANCHOR[0], HEAD_ANCHOR[1], HEAD_ANCHOR[2])
                .applyMatrix4(target.matrixWorld);
            group.position.copy(anchor.worldToLocal(anchorWorld));
            const boneQuat = new THREE.Quaternion().setFromRotationMatrix(anchor.matrixWorld);
            const targetQuat = new THREE.Quaternion().setFromRotationMatrix(target.matrixWorld);
            group.quaternion.copy(boneQuat.invert()).multiply(targetQuat);
            anchor.add(group);
        }
        groupRef.current = group;
    }, [activeDecoration, target]);

    // Liberación al desmontar
    useEffect(() => {
        return () => {
            if (groupRef.current) {
                groupRef.current.parent?.remove(groupRef.current);
                disposeDecorationGroup(groupRef.current);
                groupRef.current = null;
            }
        };
    }, [target]);

    // No renderiza JSX: la decoración vive en el Object3D del modelo
    return null;
}
