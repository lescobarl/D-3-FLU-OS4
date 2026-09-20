// ============================================================
// AUTOCONOCIMIENTO DE FLU — Registro de capacidades compilado
// ------------------------------------------------------------
// Módulo TS puro (sin React), testeable. Compila el registro de
// capacidades de FLU desde las fuentes de datos reales (regla
// anti-hardcode (§2 de AGENTS.md): NUNCA se escriben labels ni
// frases a mano; se derivan de FLU_CONFIG / catálogos reales.
//
// CONTRATO PLAN §1.1 / §1.2 / §1.4:
//   - buildSelfKnowledgeSnapshot(config)
//   - findCapabilityByText(text, lang)
//   - capabilitiesByCategoria(snapshot)
//   - buildSelfManifesto(lang, config)
//   - buildSelfManifestoPrompt(lang)
//   - isSelfKnowledgeRequest(text, lang)
//
// IMPORTANTE: este archivo NO puede contener literales de URL
// (tests/hardcodeGuard.test.ts escanea src/ en busca de https?://
// y selfKnowledge.ts NO está en ALLOWED_CONFIG_FILES).
// ============================================================

import { FLU_CONFIG } from '../../voice/lib/fluConfig';
import { GAME_CATALOG } from '../games/gameCatalog';
import { WORKSPACE_TIPOS } from '../config/sharedConfig';
import { FLU_CAPABILITIES } from '../../services/capabilities';
import { BUILTIN_SEARCH_SITES, type SearchSite } from '../search/searchSiteTypes';
import { normalizeHost } from '../browser/browserSession';

/** Categorías del registro de capacidades (contrato §1.1). */
export type CategoriaCapacidad =
    | 'comando'
    | 'pagina'
    | 'juego'
    | 'sitio'
    | 'workspace'
    | 'busqueda'
    | 'contrato';

/** Capacidad de FLU compilada desde fuentes reales (contrato §1.1). */
export interface FluCapability {
    id: string;
    categoria: CategoriaCapacidad;
    labelEs: string;
    labelEn: string;
    descriptionEs: string;
    descriptionEn: string;
    triggerPhrases: string[];
    requiresApi: boolean;
}

/** Instantánea del autoconocimiento de FLU (contrato §1.1). */
export interface SelfKnowledgeSnapshot {
    capabilities: FluCapability[];
    comandos: string[];
    juegos: string[];
    sitiosPermitidos: string[];
    tiposWorkspace: string[];
    pestañas: string[];
    proveedoresBusqueda: string[];
    totalCapacidades: number;
}

/** Subtipo estructural de FLU_CONFIG usado por el registro (solo lo que lee). */
export interface SelfKnowledgeConfig {
    voiceCommands?: Record<string, unknown>;
    ui?: {
        tabs?: { items?: Array<{ id: string; label: string }> };
        workspace?: { typeLabels?: Record<string, string> };
    };
    browser?: {
        categories?: Record<string, string>;
        defaultProfile?: { allowlist?: string[] };
        search?: {
            providers?: Record<string, Array<{ id: string; label: string; enabled?: boolean }>>;
        };
    };
}

/** Bloques de voiceCommands que NO son comandos accionables (se omiten). */
const VOICE_COMMAND_SKIP_KEYS: ReadonlySet<string> = new Set([
    'listeningAckPhrases',
    'commandLogPreserveWake',
]);

/** Frases canónicas de CONOCER_FLU (§1.3.2) — fallback determinista hasta P1-C. */
const CONOCER_FLU_FALLBACK: readonly string[] = [
    'que sabes hacer',
    'que puedes hacer',
    'que sabe hacer flu',
    'que puedes hacer flu',
    'que haces',
    'que funciones tienes',
    'cuentame tus habilidades',
    'para que sirves',
    'what can you do',
    'what do you do',
    'what are your skills',
    'what can flu do',
];

/** Labels es/en de los tipos de búsqueda (web / imágenes / vídeo). */
const BUSQUEDA_TIPO_LABELS: Record<string, { es: string; en: string }> = {
    web: { es: 'web', en: 'web' },
    images: { es: 'imágenes', en: 'images' },
    video: { es: 'vídeo', en: 'video' },
};

/** Normaliza texto para búsqueda de coincidencias (sin acentos, minúsculas). */
export function normalizeSelfText(text = ''): string {
    return String(text)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

/** Convierte una clave de config (camelCase/underscore) a label legible. */
function humanizeKey(key: string): string {
    const spaced = key
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/[_]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return spaced.length > 0 ? spaced.charAt(0).toUpperCase() + spaced.slice(1) : key;
}

/** Label es/en con fallback seguro (regla anti-hardcode §10). */
function pickLabel(es?: string, en?: string, fallback = ''): { labelEs: string; labelEn: string } {
    return {
        labelEs: es && es.trim().length > 0 ? es.trim() : fallback,
        labelEn: en && en.trim().length > 0 ? en.trim() : fallback,
    };
}

/** Frases únicas y no vacías (dedupe seguro para triggerPhrases). */
function uniqueNonEmpty(...phrases: string[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const phrase of phrases) {
        const trimmed = (phrase || '').trim();
        if (trimmed.length > 0 && !seen.has(trimmed)) {
            seen.add(trimmed);
            out.push(trimmed);
        }
    }
    return out;
}

/** Entrada `comando` por bloque de frases de voiceCommands (1 por bloque). */
function buildComandoEntries(config: SelfKnowledgeConfig): FluCapability[] {
    const voiceCommands = (config.voiceCommands as Record<string, unknown> | undefined) || {};
    const entries: FluCapability[] = [];

    for (const [key, value] of Object.entries(voiceCommands)) {
        if (VOICE_COMMAND_SKIP_KEYS.has(key)) continue;
        if (!Array.isArray(value)) continue;
        const phrases = (value as unknown[]).filter(
            (p): p is string => typeof p === 'string' && p.trim().length > 0,
        );
        const label = humanizeKey(key);
        entries.push({
            id: `comando:${key}`,
            categoria: 'comando',
            labelEs: label,
            labelEn: label,
            descriptionEs: `Comando de voz: ${label}`,
            descriptionEn: `Voice command: ${label}`,
            triggerPhrases: phrases,
            requiresApi: false,
        });
    }

    // CONOCER_FLU (§1.3.2): el bloque conocerFlu ya se compila de forma genérica
    // por el bucle de arriba (1 entrada por bloque de voiceCommands), igual que
    // NAVEGAR/BUSCAR. No hace falta un caso especial.

    return entries;
}

/** Entrada `pagina` por pestaña de FLU_CONFIG.ui.tabs.items. */
function buildPaginaEntries(config: SelfKnowledgeConfig): FluCapability[] {
    const items = (config.ui?.tabs?.items as Array<{ id: string; label: string }> | undefined) || [];
    return items
        .filter((tab) => tab && typeof tab.id === 'string' && tab.id.trim().length > 0)
        .map((tab): FluCapability => {
            const { labelEs, labelEn } = pickLabel(tab.label, undefined, tab.id);
            return {
                id: `pagina:${tab.id}`,
                categoria: 'pagina',
                labelEs,
                labelEn,
                descriptionEs: `Página de FLU: ${labelEs}`,
                descriptionEn: `FLU page: ${labelEn}`,
                triggerPhrases: uniqueNonEmpty(labelEs, labelEn, tab.id),
                requiresApi: false,
            };
        });
}

/** Entrada `juego` por elemento del GAME_CATALOG (aliases + id, flag requiresApi). */
function buildJuegoEntries(): FluCapability[] {
    return GAME_CATALOG.filter(
        (game) => game && typeof game.id === 'string' && game.id.length > 0,
    ).map((game): FluCapability => {
        const label = humanizeKey(game.id);
        const aliases = (game.aliases || []).filter(
            (a): a is string => typeof a === 'string' && a.trim().length > 0,
        );
        return {
            id: `juego:${game.id}`,
            categoria: 'juego',
            labelEs: label,
            labelEn: label,
            descriptionEs: `Juego de FLU: ${label}`,
            descriptionEn: `FLU game: ${label}`,
            triggerPhrases: uniqueNonEmpty(...aliases, game.id),
            requiresApi: Boolean(game.requiresApi),
        };
    });
}

/** Entrada `sitio` deduplicada por dominio: BUILTIN_SEARCH_SITES + allowlist. */
function buildSitioEntries(config: SelfKnowledgeConfig): FluCapability[] {
    const catalog = (BUILTIN_SEARCH_SITES as readonly SearchSite[]) || [];
    const allowlist = (config.browser?.defaultProfile?.allowlist as string[] | undefined) || [];
    const categories = (config.browser?.categories as Record<string, string> | undefined) || {};

    const byDominio = new Map<string, SearchSite>();
    for (const site of catalog) {
        if (site && typeof site.dominio === 'string' && site.dominio.length > 0) {
            const dominio = normalizeHost(site.dominio);
            if (!byDominio.has(dominio)) byDominio.set(dominio, { ...site, dominio });
        }
    }
    for (const raw of allowlist) {
        if (typeof raw !== 'string' || raw.trim().length === 0) continue;
        const dominio = normalizeHost(raw);
        if (!byDominio.has(dominio)) {
            byDominio.set(dominio, {
                dominio,
                label: dominio,
                categorias: [],
                idiomas: [],
                nivel: 'simple',
                aprobado: true,
            });
        }
    }

    const entries: FluCapability[] = [];
    byDominio.forEach((site) => {
        const label = site.label && site.label.trim().length > 0 ? site.label.trim() : site.dominio;
        const categoria = (site.categorias || [])[0] || '';
        const catEs = categories[categoria] || categoria;
        entries.push({
            id: `sitio:${site.dominio}`,
            categoria: 'sitio',
            labelEs: label,
            labelEn: label,
            descriptionEs: categoria
                ? `Sitio permitido (${catEs})`
                : 'Sitio permitido en el navegador',
            descriptionEn: categoria
                ? `Allowed site (${categoria})`
                : 'Allowed site in the browser',
            triggerPhrases: uniqueNonEmpty(label, site.dominio),
            requiresApi: false,
        });
    });
    return entries;
}

/** Entrada `workspace` por WORKSPACE_TIPOS + labels de FLU_CONFIG.ui.workspace.typeLabels. */
function buildWorkspaceEntries(config: SelfKnowledgeConfig): FluCapability[] {
    const typeLabels = (config.ui?.workspace?.typeLabels as Record<string, string> | undefined) || {};
    return WORKSPACE_TIPOS.filter((tipo) => typeof tipo === 'string' && tipo.length > 0).map(
        (tipo): FluCapability => {
            const { labelEs, labelEn } = pickLabel(typeLabels[tipo], undefined, tipo);
            return {
                id: `workspace:${tipo}`,
                categoria: 'workspace',
                labelEs,
                labelEn,
                descriptionEs: `Tipo de pizarra de trabajo: ${labelEs}`,
                descriptionEn: `Workspace type: ${labelEn}`,
                triggerPhrases: uniqueNonEmpty(labelEs, labelEn, tipo),
                requiresApi: false,
            };
        },
    );
}

/** Entrada `busqueda` por proveedor habilitado de FLU_CONFIG.browser.search.providers. */
function buildBusquedaEntries(config: SelfKnowledgeConfig): FluCapability[] {
    const providers =
        (config.browser?.search?.providers as
            | Record<string, Array<{ id: string; label: string; enabled?: boolean }>>
            | undefined) || {};
    const entries: FluCapability[] = [];

    for (const [type, list] of Object.entries(providers)) {
        const tipoLabels = BUSQUEDA_TIPO_LABELS[type] || { es: type, en: type };
        for (const provider of list || []) {
            if (!provider || provider.enabled === false) continue;
            const id = provider.id || '';
            if (id.length === 0) continue;
            const label = provider.label && provider.label.trim().length > 0 ? provider.label.trim() : id;
            entries.push({
                id: `busqueda:${id}`,
                categoria: 'busqueda',
                labelEs: label,
                labelEn: label,
                descriptionEs: `Búsqueda ${tipoLabels.es} vía ${label}`,
                descriptionEn: `${tipoLabels.en} search via ${label}`,
                triggerPhrases: uniqueNonEmpty(label, id),
                requiresApi: true,
            });
        }
    }
    return entries;
}

/** Entrada `contrato` por FLU_CAPABILITIES (catálogo estático existente). */
function buildContratoEntries(): FluCapability[] {
    return FLU_CAPABILITIES.filter(
        (cap) => cap && typeof cap.id === 'string' && cap.id.length > 0,
    ).map((cap): FluCapability => {
        const labelEs =
            cap.label && cap.label.trim().length > 0 ? cap.label.trim() : cap.id;
        return {
            id: `contrato:${cap.id}`,
            categoria: 'contrato',
            labelEs,
            labelEn: cap.id,
            descriptionEs: cap.descriptionEs || `Capacidad de FLU: ${labelEs}`,
            descriptionEn: cap.descriptionEn || `FLU capability: ${cap.id}`,
            triggerPhrases: uniqueNonEmpty(labelEs, cap.id),
            requiresApi: false,
        };
    });
}

/**
 * Compila la instantánea de capacidades desde las fuentes reales
 * (regla anti-hardcode §10): comandos, páginas, juegos, sitios,
 * workspaces, proveedores de búsqueda y capacidades de contrato.
 */
export function buildSelfKnowledgeSnapshot(
    config: SelfKnowledgeConfig = FLU_CONFIG as SelfKnowledgeConfig,
): SelfKnowledgeSnapshot {
    const capabilities: FluCapability[] = [
        ...buildComandoEntries(config),
        ...buildPaginaEntries(config),
        ...buildJuegoEntries(),
        ...buildSitioEntries(config),
        ...buildWorkspaceEntries(config),
        ...buildBusquedaEntries(config),
        ...buildContratoEntries(),
    ];

    return {
        capabilities,
        comandos: capabilities.filter((c) => c.categoria === 'comando').map((c) => c.labelEs),
        juegos: capabilities.filter((c) => c.categoria === 'juego').map((c) => c.labelEs),
        sitiosPermitidos: capabilities
            .filter((c) => c.categoria === 'sitio')
            .map((c) => c.id.replace(/^sitio:/, '')),
        tiposWorkspace: capabilities
            .filter((c) => c.categoria === 'workspace')
            .map((c) => c.id.replace(/^workspace:/, '')),
        pestañas: capabilities
            .filter((c) => c.categoria === 'pagina')
            .map((c) => c.id.replace(/^pagina:/, '')),
        proveedoresBusqueda: capabilities
            .filter((c) => c.categoria === 'busqueda')
            .map((c) => c.id.replace(/^busqueda:/, '')),
        totalCapacidades: capabilities.length,
    };
}

/** Agrupa las capacidades del snapshot por categoría. */
export function capabilitiesByCategoria(
    snapshot: SelfKnowledgeSnapshot,
): Record<CategoriaCapacidad, FluCapability[]> {
    const grouped: Record<CategoriaCapacidad, FluCapability[]> = {
        comando: [],
        pagina: [],
        juego: [],
        sitio: [],
        workspace: [],
        busqueda: [],
        contrato: [],
    };
    for (const cap of snapshot.capabilities) {
        grouped[cap.categoria].push(cap);
    }
    return grouped;
}

/**
 * Resuelve una capacidad por texto (id, label o frase de disparo).
 * Tolerante: coincide si el texto es igual a la capacidad o la contiene.
 */
export function findCapabilityByText(
    text: string,
    lang: 'es' | 'en' = 'es',
    config: SelfKnowledgeConfig = FLU_CONFIG as SelfKnowledgeConfig,
): FluCapability | null {
    const needle = normalizeSelfText(text);
    if (!needle) return null;

    const snapshot = buildSelfKnowledgeSnapshot(config);
    for (const cap of snapshot.capabilities) {
        const label = lang === 'es' ? cap.labelEs : cap.labelEn;
        for (const candidate of uniqueNonEmpty(cap.id, label, ...cap.triggerPhrases)) {
            const norm = normalizeSelfText(candidate);
            if (!norm) continue;
            if (needle === norm || needle.includes(norm)) return cap;
        }
    }
    return null;
}

/**
 * Manifiesto de FLU en 1ª persona, compilado desde el snapshot.
 * Nunca hardcodeado: las secciones se derivan de las capacidades reales.
 */
export function buildSelfManifesto(
    lang: 'es' | 'en' = 'es',
    config: SelfKnowledgeConfig = FLU_CONFIG as SelfKnowledgeConfig,
): string {
    const snapshot = buildSelfKnowledgeSnapshot(config);
    const byCat = capabilitiesByCategoria(snapshot);
    const es = lang === 'es';
    const label = (cap: FluCapability): string => (es ? cap.labelEs : cap.labelEn);

    const juegos = byCat.juego
        .map((g) =>
            g.requiresApi
                ? es
                    ? `${label(g)} (requieren IA)`
                    : `${label(g)} (require AI)`
                : label(g),
        )
        .join(', ');

    const secciones: string[] = [];
    if (byCat.comando.length > 0) {
        secciones.push(
            es
                ? `- Comandos de voz: ${byCat.comando.map(label).join(', ')}`
                : `- Voice commands: ${byCat.comando.map(label).join(', ')}`,
        );
    }
    if (byCat.pagina.length > 0) {
        secciones.push(
            es
                ? `- Páginas y pestañas: ${byCat.pagina.map(label).join(', ')}`
                : `- Pages and tabs: ${byCat.pagina.map(label).join(', ')}`,
        );
    }
    if (byCat.juego.length > 0) {
        secciones.push(es ? `- Juegos: ${juegos}` : `- Games: ${juegos}`);
    }
    if (byCat.sitio.length > 0) {
        secciones.push(
            es
                ? `- Sitios web permitidos: ${byCat.sitio.map(label).join(', ')}`
                : `- Allowed websites: ${byCat.sitio.map(label).join(', ')}`,
        );
    }
    if (byCat.workspace.length > 0) {
        secciones.push(
            es
                ? `- Tipos de workspace: ${byCat.workspace.map(label).join(', ')}`
                : `- Workspace types: ${byCat.workspace.map(label).join(', ')}`,
        );
    }
    if (byCat.busqueda.length > 0) {
        secciones.push(
            es
                ? `- Búsqueda en la web: ${byCat.busqueda.map(label).join(', ')}`
                : `- Web search: ${byCat.busqueda.map(label).join(', ')}`,
        );
    }
    if (byCat.contrato.length > 0) {
        secciones.push(
            es
                ? `- Capacidades: ${byCat.contrato.map(label).join(', ')}`
                : `- Capabilities: ${byCat.contrato.map(label).join(', ')}`,
        );
    }

    const intro = es
        ? 'Soy FLU, tu asistente de voz. Puedo hacer lo siguiente:'
        : 'I am FLU, your voice assistant. Here is what I can do:';

    return [intro, ...secciones].join('\n');
}

/** Bloque compacto para el system prompt (§1.2) — refuerza el manifiesto sin duplicarlo. */
export function buildSelfManifestoPrompt(lang: 'es' | 'en' = 'es'): string {
    const manifesto = buildSelfManifesto(lang);
    return lang === 'es'
        ? `AUTOCONOCIMIENTO DE FLU (si te preguntan qué puedes hacer, responde SOLO con esta lista):\n${manifesto}`
        : `FLU SELF-KNOWLEDGE (if asked what you can do, answer ONLY from this list):\n${manifesto}`;
}

/**
 * Intento local determinista (§1.4): true si el texto pide conocer a FLU.
 * Config-driven: lee FLU_CONFIG.voiceCommands.conocerFlu (P1-C) con fallback
 * canónico determinista (CONOCER_FLU_FALLBACK) para ser testeable desde P1-A.
 */
export function isSelfKnowledgeRequest(
    text: string,
    _lang: 'es' | 'en' = 'es',
    config: SelfKnowledgeConfig = FLU_CONFIG as SelfKnowledgeConfig,
): boolean {
    const rawPhrases =
        (config.voiceCommands?.conocerFlu as unknown[] | undefined) || CONOCER_FLU_FALLBACK;
    const phrases = rawPhrases.filter(
        (p): p is string => typeof p === 'string' && p.trim().length > 0,
    );
    const needle = normalizeSelfText(text);
    if (!needle) return false;

    return phrases.some((phrase) => {
        const norm = normalizeSelfText(phrase);
        return norm.length > 0 && (needle === norm || needle.includes(norm));
    });
}
