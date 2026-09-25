// ============================================================
// navSettleFlag.test.ts — bandera compartida del settle de navegación.
// Es la que evita que el dedup de capturas descarte la CORRECCIÓN
// parcial→completo (que dejaba la búsqueda truncada).
// ============================================================
import { describe, it, expect } from 'vitest';
import {
    setNavSettlePending,
    isNavSettlePending,
} from '../src/voice/lib/navSettleFlag';

describe('navSettleFlag', () => {
    it('refleja el estado del settle pendiente', () => {
        setNavSettlePending(false);
        expect(isNavSettlePending()).toBe(false);
        setNavSettlePending(true);
        expect(isNavSettlePending()).toBe(true);
        setNavSettlePending(false);
        expect(isNavSettlePending()).toBe(false);
    });
});
