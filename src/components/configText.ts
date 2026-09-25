// ============================================================
// configText — Lectura tipada de textos de FLU_CONFIG en componentes
// ============================================================
// El catálogo (src/voice/lib/fluConfig.js) es la fuente de verdad, pero un
// componente puede consumir una clave opcional que el catálogo aún no declare
// (con fallback). Este helper hace esa lectura sin recurrir a casts laxos:
// recibe el bloque como `unknown`, comprueba que sea objeto y devuelve el
// string sólo si existe. Los nodos anidados se recorren con `configChild`.
// ============================================================

/** Nodo de configuración: objeto indexable por clave string. */
export type ConfigNode = { readonly [key: string]: unknown };

/** Vista de nodo para un valor `unknown` (sólo si es objeto no nulo). */
export function asConfigNode(value: unknown): ConfigNode | undefined {
    return value !== null && typeof value === 'object' ? (value as ConfigNode) : undefined;
}

/** Texto de `key`: string no vacío, o `fallback` si falta/es de otro tipo. */
export function configText(node: unknown, key: string, fallback: string): string {
    const value = asConfigNode(node)?.[key];
    return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** Sub-nodo objeto de `key`, o undefined si falta/no es objeto. */
export function configChild(node: unknown, key: string): ConfigNode | undefined {
    return asConfigNode(asConfigNode(node)?.[key]);
}

/**
 * Etiqueta bilingüe de `key`: acepta `string` (se usa en ambos idiomas) u
 * objeto `{ es, en }`. Devuelve undefined si falta o no es texto.
 */
export function configLabel(
    node: unknown,
    key: string,
): { es?: string; en?: string } | undefined {
    const value = asConfigNode(node)?.[key];
    if (typeof value === 'string') return { es: value, en: value };
    const record = asConfigNode(value);
    if (!record) return undefined;
    const es = typeof record.es === 'string' ? record.es : undefined;
    const en = typeof record.en === 'string' ? record.en : undefined;
    if (es === undefined && en === undefined) return undefined;
    return { es, en };
}

/**
 * Copia a un `Record<string, string>` las entradas de texto de un nodo.
 * Permite consumir un bloque de etiquetas opcional (p. ej. ui.paletas) con
 * `mapa.clave || fallback` sin perder el origen config-driven.
 */
export function configTextMap(node: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(asConfigNode(node) ?? {})) {
        if (typeof value === 'string') out[key] = value;
    }
    return out;
}
