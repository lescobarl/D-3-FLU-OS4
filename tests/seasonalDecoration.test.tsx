// @vitest-environment jsdom
// ============================================================
// SeasonalDecoration - decoracion 3D y senales del avatar (0%).
// ------------------------------------------------------------
// El componente no pinta nada: su unico efecto es traducir el branding
// (temporada / ambiente / cumpleanos) a acciones del bunnyStore. Se sustituye
// la frontera (el store Zustand del avatar) y se comprueba el mapeo REAL:
// decoracion estacional, precedencia del ambiente, eventos especiales y la
// animacion de cumpleanos disparada una sola vez.
// ============================================================
import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const bunny = vi.hoisted(() => {
    const store = {
        setSignal: vi.fn(),
        setDecoration: vi.fn(),
        playAnimation: vi.fn(),
    };
    return { store, useBunnyStore: { getState: () => store } };
});

vi.mock('../src/avatar/store/bunnyStore.js', () => ({ useBunnyStore: bunny.useBunnyStore }));

import { SeasonalDecoration } from '../src/core/branding/SeasonalDecoration';

/** Ultima senal aplicada al store (el efecto puede fijar varias). */
const senalFinal = (): unknown => {
    const llamadas = bunny.store.setSignal.mock.calls;
    return llamadas.length > 0 ? llamadas[llamadas.length - 1][0] : undefined;
};

beforeEach(() => {
    bunny.store.setSignal.mockClear();
    bunny.store.setDecoration.mockClear();
    bunny.store.playAnimation.mockClear();
});

// ------------------------------------------------------------
// Bloque: modo disabled (restaurar el estado base de la decoracion)
// ------------------------------------------------------------
describe('SeasonalDecoration - modo disabled', () => {
    it('sin decoracion de ambiente restaura senal NONE y decoracion nula', () => {
        render(
            <SeasonalDecoration mode="disabled" activeSeason="navidad" isBirthday={false} />,
        );

        expect(bunny.store.setDecoration).toHaveBeenCalledWith(null);
        expect(senalFinal()).toBe('NONE');
        expect(bunny.store.playAnimation).not.toHaveBeenCalled();
    });
});

// ------------------------------------------------------------
// Bloque: mapeo decoracion estacional -> senal (temporadas sin evento)
// ------------------------------------------------------------
describe('SeasonalDecoration - mapeo decoracion -> senal', () => {
    it('patrio aplica la bandera con senal HIGHLIGHT', () => {
        render(<SeasonalDecoration mode="auto" activeSeason="patrio" isBirthday={false} />);

        expect(bunny.store.setDecoration).toHaveBeenCalledWith('flag');
        expect(senalFinal()).toBe('HIGHLIGHT');
    });

    it('infantil aplica gorro de fiesta con senal CELEBRATE', () => {
        render(<SeasonalDecoration mode="auto" activeSeason="infantil" isBirthday={false} />);

        expect(bunny.store.setDecoration).toHaveBeenCalledWith('party-hat');
        expect(senalFinal()).toBe('CELEBRATE');
    });

    it('invierno aplica copo de nieve con senal NONE', () => {
        render(<SeasonalDecoration mode="auto" activeSeason="invierno" isBirthday={false} />);

        expect(bunny.store.setDecoration).toHaveBeenCalledWith('snowflake');
        expect(senalFinal()).toBe('NONE');
    });
});

// ------------------------------------------------------------
// Bloque: precedencia del ambiente sobre la temporada
// ------------------------------------------------------------
describe('SeasonalDecoration - precedencia del ambiente', () => {
    it('la decoracion del ambiente gana sobre la estacional (crown sobre primavera)', () => {
        render(
            <SeasonalDecoration
                mode="auto"
                activeSeason="primavera"
                isBirthday={false}
                environmentDecoration="crown"
            />,
        );

        expect(bunny.store.setDecoration).toHaveBeenCalledWith('crown');
        expect(senalFinal()).toBe('HIGHLIGHT');
    });

    it('una decoracion de ambiente desconocida se ignora y cae a la paleta', () => {
        render(
            <SeasonalDecoration
                mode="auto"
                activeSeason="primavera"
                isBirthday={false}
                environmentDecoration="no-existe"
            />,
        );

        // primavera -> flower (senal NONE)
        expect(bunny.store.setDecoration).toHaveBeenCalledWith('flower');
        expect(senalFinal()).toBe('NONE');
    });

    it('con modo disabled una decoracion de ambiente valida sigue aplicandose', () => {
        render(
            <SeasonalDecoration
                mode="disabled"
                activeSeason="primavera"
                isBirthday={false}
                environmentDecoration="flag"
            />,
        );

        expect(bunny.store.setDecoration).toHaveBeenCalledWith('flag');
        expect(senalFinal()).toBe('HIGHLIGHT');
        expect(bunny.store.playAnimation).not.toHaveBeenCalled();
    });
});

// ------------------------------------------------------------
// Bloque: eventos especiales que disparan animacion al cambiar de temporada
// ------------------------------------------------------------
describe('SeasonalDecoration - eventos especiales de temporada', () => {
    it('navidad reproduce Dance y fija senal CELEBRATE', () => {
        render(<SeasonalDecoration mode="auto" activeSeason="navidad" isBirthday={false} />);

        expect(bunny.store.playAnimation).toHaveBeenCalledWith('Dance');
        expect(senalFinal()).toBe('CELEBRATE');
    });

    it('san_valentin reproduce Dance y fija senal HIGHLIGHT', () => {
        render(<SeasonalDecoration mode="auto" activeSeason="san_valentin" isBirthday={false} />);

        expect(bunny.store.playAnimation).toHaveBeenCalledWith('Dance');
        expect(senalFinal()).toBe('HIGHLIGHT');
    });

    it('halloween reproduce Jump_in_place y fija senal HIGHLIGHT', () => {
        render(<SeasonalDecoration mode="auto" activeSeason="halloween" isBirthday={false} />);

        expect(bunny.store.playAnimation).toHaveBeenCalledWith('Jump_in_place');
        expect(senalFinal()).toBe('HIGHLIGHT');
    });

    it('el evento especial solo se dispara al cambiar de temporada', () => {
        const { rerender } = render(
            <SeasonalDecoration mode="auto" activeSeason="navidad" isBirthday={false} />,
        );
        expect(bunny.store.playAnimation).toHaveBeenCalledTimes(1);

        rerender(<SeasonalDecoration mode="auto" activeSeason="navidad" isBirthday={false} />);
        expect(bunny.store.playAnimation).toHaveBeenCalledTimes(1);
    });
});

// ------------------------------------------------------------
// Bloque: animacion de cumpleanos (una sola vez por activacion)
// ------------------------------------------------------------
describe('SeasonalDecoration - cumpleanos', () => {
    it('al activarse el cumpleanos reproduce Dance y fija CELEBRATE', () => {
        render(
            <SeasonalDecoration mode="auto" activeSeason="default" isBirthday celebrandoA="Ana" />,
        );

        expect(bunny.store.playAnimation).toHaveBeenCalledWith('Dance');
        expect(senalFinal()).toBe('CELEBRATE');
    });

    it('no repite la animacion si el cumpleanos no cambia', () => {
        const { rerender } = render(
            <SeasonalDecoration mode="auto" activeSeason="default" isBirthday />,
        );
        expect(bunny.store.playAnimation).toHaveBeenCalledTimes(1);

        rerender(<SeasonalDecoration mode="auto" activeSeason="default" isBirthday />);
        expect(bunny.store.playAnimation).toHaveBeenCalledTimes(1);
    });

    it('en modo disabled el cumpleanos no dispara animacion', () => {
        render(<SeasonalDecoration mode="disabled" activeSeason="default" isBirthday />);

        expect(bunny.store.playAnimation).not.toHaveBeenCalled();
    });
});
