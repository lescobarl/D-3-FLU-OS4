/**
 * P6.6 — Rutas del panel derecho (extraido de App.tsx).
 *
 * La tabla de rutas y sus dos conversores son logica pura: no necesitan
 * React ni el componente. App.tsx usa solo RightTab, tabFromPath y
 * pathForTab; TAB_ROUTES y DEFAULT_TAB se quedan dentro.
 */

// ============================================================
// Tipo para las pestañas del panel derecho
// ============================================================
export type RightTab = 'workspace' | 'conversation' | 'minutes' | 'settings' | 'system';

// ============================================================
// Rutas por tab — React Router v6 (Fase 3: code-split por tab)
// ============================================================
const TAB_ROUTES: ReadonlyArray<{ tab: RightTab; path: string }> = [
    { tab: 'workspace', path: '/workspace' },
    { tab: 'conversation', path: '/conversation' },
    { tab: 'minutes', path: '/minutes' },
    { tab: 'settings', path: '/settings' },
    { tab: 'system', path: '/system' },
];

const DEFAULT_TAB: RightTab = 'workspace';

export function tabFromPath(pathname: string): RightTab {
    const match = TAB_ROUTES.find((r) => r.path === pathname);
    return match ? match.tab : DEFAULT_TAB;
}

export function pathForTab(tab: RightTab): string {
    return TAB_ROUTES.find((r) => r.tab === tab)?.path || `/${tab}`;
}
