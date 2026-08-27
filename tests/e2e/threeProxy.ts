// ============================================================
// Proxy de depuración para specs e2e.
//
// En page.evaluate el navegador NO puede resolver un import a
// pelo de 'three' (el bare specifier solo lo reescribe Vite en
// módulos que transforma). Este módulo se sirve por Vite en
// /tests/e2e/threeProxy.ts, de modo que su `import * as THREE`
// interno SÍ se resuelve al build optimizado de 'three'.
//
// Uso en specs:
//   // @ts-ignore
//   const THREE = (await import('/tests/e2e/threeProxy.ts')).THREE;
// ============================================================
import * as THREE from 'three';

export { THREE };
