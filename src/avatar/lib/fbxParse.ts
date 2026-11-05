import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { installDomShim } from './fbxDomShim';
import { REQUEST_TIMEOUT_DEFAULTS } from '../../core/config/sharedConfig';
import { fetchTextEngine } from '../../core/ai/httpClient';

/**
 * Parse de un buffer FBX FUERA del hilo principal.
 *
 * FBXLoader.parse() es 100% síncrono y bloquea el hilo donde se ejecuta. En
 * SwiftShader (WebGL por software) cada animación tarda ~10-20s en el main
 * thread → "el portal se cae" (freeze de ~11s, pérdida de transcripción).
 *
 * Este módulo se ejecuta DENTRO de un Web Worker (o como fallback en el main
 * thread) para descargar ese coste. BunnyViewer reconstruye el resultado con
 * THREE.ObjectLoader, por lo que aquí solo necesitamos el árbol THREE.
 *
 * @param buffer  contenido binario del archivo FBX.
 * @param url     ruta original (se usa como path base para texturas relativas;
 *                con el shim DOM las texturas son no-op).
 * @returns el grupo raíz parseado por FBXLoader.
 */
export function parseFbxBuffer(buffer: ArrayBuffer, url: string): THREE.Group {
  // El modelo (Bunny_full.fbx) referencia texturas → shim DOM (no-op). Las
  // animaciones no usan document. Instalar es idempotente y gratuito.
  installDomShim();
  return new FBXLoader().parse(buffer, url);
}

/**
 * Descarga un FBX y devuelve su arbol serializado (group.toJSON()).
 *
 * Orquestacion UNICA del flujo de carga: el worker la ejecuta fuera del hilo
 * principal y el respaldo main-thread dentro, pero el fetch, el chequeo HTTP,
 * el parse y el mensaje de error viven solo aqui. El mismo flujo copiado en
 * dos archivos es ruta doble aunque la intencion sea un respaldo (§7.7.b).
 *
 * El fetch lleva deadline: sin el, un servidor que no responde deja la carga
 * colgada para siempre (el camino de worker la acota con WORKER_MS, el respaldo
 * main-thread no tenia tope).
 *
 * @param url ruta publica del archivo FBX.
 * @returns representacion JSON del grupo raiz, apta para postMessage.
 */
export async function fetchFbxJson(url: string): Promise<unknown> {
  const response = await fetchTextEngine(url, {}, REQUEST_TIMEOUT_DEFAULTS.WORKER_MS);
  if (!response.ok) {
    throw new Error(`fetch FBX falló: HTTP ${response.status} para ${url}`);
  }
  const buffer = await response.arrayBuffer();
  return parseFbxBuffer(buffer, url).toJSON();
}
