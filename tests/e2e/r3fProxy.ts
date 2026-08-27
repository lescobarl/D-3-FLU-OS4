// ============================================================
// r3fProxy.ts — Proxy de acceso al runtime @react-three/fiber
// ============================================================
// En R3F v9 la escena/root ya NO se expone vía `canvas.__r3f`
// ni `window.__R3F__`. El root se guarda en el Map interno
// `_roots` (clave = elemento <canvas>), exportado por el entry
// del bundle. Este módulo se sirve vía Vite (igual que
// threeProxy.ts) y resuelve `@react-three/fiber` al MISMO
// módulo pre-bundleado que usa la app -> mismas instancias,
// mismas claves.
//
// Uso (dentro de page.evaluate):
//   const R3F = (await import('/tests/e2e/r3fProxy.ts'));
//   const canvas = document.querySelector('.flu-bridge-container canvas');
//   const store  = R3F.r3fRoots.get(canvas).store;
//   const scene  = store.getState().scene;
// ============================================================
import * as R3F from '@react-three/fiber';

// `_roots` está exportado por el bundle principal de R3F v9.
// El acceso por índice evita dependencia del tipado público.
export const r3fRoots: Map<
    HTMLCanvasElement,
    { fiber: unknown; store: { getState(): any } }
> = (R3F as any)._roots;

export const r3f = R3F;
