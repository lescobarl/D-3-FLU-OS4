// ============================================================
// bunnyMaterials — Reparación de materiales del modelo Bunny
// ============================================================
// Convierte materiales del FBX a MeshStandardMaterial con
// texturas reales desde PNG. Si no hay textura para una malla,
// asigna un color plano según el nombre de la malla.
// ============================================================

import * as THREE from 'three';
import { applyTextures } from './bunnyTextures';

/**
 * Recorre el modelo y reemplaza todos los materiales con
 * MeshStandardMaterial, aplicando texturas donde sea posible.
 */
export function repairFBXMaterials(object: THREE.Object3D): void {
    object.traverse((child) => {
        if (child instanceof THREE.Mesh) {
            child.frustumCulled = false;

            const geo = child.geometry;
            if (geo) {
                if (!geo.attributes.normal) {
                    geo.computeVertexNormals();
                }
                if (geo.index === null) {
                    geo.computeVertexNormals();
                }
            }

            const meshName = child.name || 'unnamed';

            const processMaterial = (originalMat: THREE.Material): THREE.Material => {
                const newMat = new THREE.MeshStandardMaterial({
                    roughness: 0.8,
                    metalness: 0.0,
                });

                const texturesApplied = applyTextures(newMat, meshName);

                if (!texturesApplied) {
                    // Fallback: flat color by mesh name
                    const name = meshName.toLowerCase();
                    if (name.includes('body') || name.includes('torso')) {
                        newMat.color.setHex(0x88ccff);
                    } else if (name.includes('tail') || name.includes('cola')) {
                        newMat.color.setHex(0x88ccff);
                    } else if (name.includes('cap') || name.includes('gorra')) {
                        newMat.color.setHex(0x335577);
                    } else if (name.includes('pants') || name.includes('pantalon') || name.includes('leg') || name.includes('pierna')) {
                        newMat.color.setHex(0x224466);
                    } else if (name.includes('belt') || name.includes('cinturon') || name.includes('cinto')) {
                        newMat.color.setHex(0x553322);
                    } else if (name.includes('eye') || name.includes('ojo')) {
                        newMat.color.setHex(0xffffff);
                    } else if (name.includes('tongue') || name.includes('lengua')) {
                        newMat.color.setHex(0xff8888);
                    } else if (name.includes('teeth') || name.includes('diente') || name.includes('dental')) {
                        newMat.color.setHex(0xeeeeee);
                    } else if (name.includes('brows') || name.includes('ceja')) {
                        newMat.color.setHex(0x553322);
                    } else if (name.includes('bangs') || name.includes('fleco') || name.includes('pelo') || name.includes('hair')) {
                        newMat.color.setHex(0x664422);
                    } else if (name.includes('face') || name.includes('cara')) {
                        newMat.color.setHex(0xffccaa);
                    } else if (name.includes('ear') || name.includes('oreja')) {
                        newMat.color.setHex(0x66aadd);
                    } else {
                        newMat.color.setHex(0x88ccff);
                    }
                }

                // Preserve emissive if present
                if (originalMat instanceof THREE.MeshStandardMaterial && originalMat.emissiveMap) {
                    newMat.emissiveMap = originalMat.emissiveMap;
                    newMat.emissive.copy(originalMat.emissive);
                    newMat.emissiveIntensity = originalMat.emissiveIntensity;
                }

                newMat.needsUpdate = true;
                return newMat;
            };

            if (Array.isArray(child.material)) {
                child.material = child.material.map((m) => processMaterial(m as THREE.Material));
            } else {
                child.material = processMaterial(child.material as THREE.Material);
            }
        }
    });
}
