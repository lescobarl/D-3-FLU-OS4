// @vitest-environment jsdom
/**
 * ShoppingPanel - panel de la lista de compras (0%).
 *
 * POR QUE ESTE TEST: 179 lineas presentacionales del panel de la compra, con una
 * regla visible para el usuario: PENDIENTES y COMPRADOS son listas separadas, y la
 * de comprados (con su "vaciar") solo aparece si hay algo comprado. Se prueba
 * tambien el alta (recorte, limpieza tras guardar, boton deshabilitado sin texto,
 * doble submit frenado) y que el contador de pendientes sale del estado recibido.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShoppingPanel } from '../src/components/ShoppingPanel.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const ui = (FLU_CONFIG.shopping as unknown as Record<string, unknown>).ui as Record<string, string>;

const ficha = (id: string, checked: boolean, label = id) => ({ id, checked, label });

const montar = (over: Partial<Record<string, unknown>> = {}) => {
    const onAdd = (over.onAdd as ReturnType<typeof vi.fn>) ?? vi.fn(async () => {});
    const onToggle = (over.onToggle as ReturnType<typeof vi.fn>) ?? vi.fn(async () => {});
    const onRemove = (over.onRemove as ReturnType<typeof vi.fn>) ?? vi.fn(async () => {});
    const onClearChecked = (over.onClearChecked as ReturnType<typeof vi.fn>) ?? vi.fn(async () => {});
    render(
        <ShoppingPanel
            items={(over.items as never) ?? ([] as never)}
            loading={(over.loading as boolean) ?? false}
            remainingCount={(over.remainingCount as number) ?? 0}
            onAdd={onAdd as never}
            onToggle={onToggle as never}
            onRemove={onRemove as never}
            onClearChecked={onClearChecked as never}
        />,
    );
    return { onAdd, onToggle, onRemove, onClearChecked };
};

const entrada = () => screen.getByTestId('shopping-add-input') as HTMLInputElement;
const boton = () => screen.getByTestId('shopping-add-submit') as HTMLButtonElement;
const enviar = () => fireEvent.submit(boton().closest('form')!);

describe('ShoppingPanel - estado y listas', () => {
    it('etiquetas y contador salen de la config y del estado recibido', () => {
        montar({ remainingCount: 3 });

        expect(screen.getByText(ui.panelTitle)).toBeTruthy();
        expect(boton().textContent).toBe(ui.addLabel);
        expect(screen.getByText(`${ui.pendingLabel}: 3`)).toBeTruthy();
    });

    it('cargando: puntos suspensivos y sin lista', () => {
        montar({ loading: true });

        expect(screen.queryByTestId('shopping-pending-list')).toBeNull();
        expect(screen.getByText('…')).toBeTruthy();
    });

    it('lista vacia: mensaje de la config', () => {
        montar();

        expect(screen.getByText(ui.emptyState)).toBeTruthy();
        expect(screen.queryByTestId('shopping-clear-checked')).toBeNull();
    });

    it('pendientes y comprados van en listas separadas, y el "vaciar" solo con comprados', () => {
        montar({ items: [ficha('a', false, 'leche'), ficha('b', true, 'pan')] });

        const pendientes = screen.getByTestId('shopping-pending-list');
        expect(pendientes.textContent).toContain('leche');
        expect(pendientes.textContent).not.toContain('pan');
        expect(screen.getByText('pan')).toBeTruthy();
        expect(screen.getByTestId('shopping-clear-checked').textContent).toBe(ui.clearCheckedLabel);
    });

    it('sin pendientes pero con comprados NO se pinta el mensaje de vacio', () => {
        montar({ items: [ficha('b', true, 'pan')] });

        expect(screen.queryByText(ui.emptyState)).toBeNull();
        expect(screen.getByTestId('shopping-pending-list').children.length).toBe(0);
    });

    it('marcar, borrar y vaciar llaman con el id correcto', async () => {
        const { onToggle, onRemove, onClearChecked } = montar({
            items: [ficha('a', false, 'leche'), ficha('b', true, 'pan')],
        });

        await act(async () => {
            fireEvent.click(screen.getByTestId('shopping-toggle-a'));
            fireEvent.click(screen.getByTestId('shopping-remove-a'));
            fireEvent.click(screen.getByTestId('shopping-toggle-b'));
            fireEvent.click(screen.getByTestId('shopping-remove-b'));
            fireEvent.click(screen.getByTestId('shopping-clear-checked'));
        });

        expect(onToggle.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
        expect(onRemove.mock.calls.map((c) => c[0])).toEqual(['a', 'b']);
        expect(onClearChecked).toHaveBeenCalledTimes(1);
    });

    it('el check de un pendiente se pinta desmarcado y el de comprado marcado', () => {
        montar({ items: [ficha('a', false, 'leche'), ficha('b', true, 'pan')] });

        expect((screen.getByTestId('shopping-toggle-a') as HTMLInputElement).checked).toBe(false);
        expect((screen.getByTestId('shopping-toggle-b') as HTMLInputElement).checked).toBe(true);
    });
});

describe('ShoppingPanel - alta', () => {
    it('el boton espera a un texto de verdad', () => {
        montar();

        expect(boton().disabled).toBe(true);
        fireEvent.change(entrada(), { target: { value: '   ' } });
        expect(boton().disabled).toBe(true);

        fireEvent.change(entrada(), { target: { value: 'leche' } });
        expect(boton().disabled).toBe(false);
    });

    it('el alta manda el texto recortado y limpia el campo', async () => {
        const { onAdd } = montar();
        fireEvent.change(entrada(), { target: { value: '  leche  ' } });

        await act(async () => {
            enviar();
        });

        expect(onAdd).toHaveBeenCalledWith('leche');
        await vi.waitFor(() => {
            expect(entrada().value).toBe('');
        });
    });

    it('sin texto no llama al alta', () => {
        const { onAdd } = montar();

        enviar();

        expect(onAdd).not.toHaveBeenCalled();
    });

    it('un doble envio seguido agrega UNA sola vez', () => {
        const onAdd = vi.fn(() => new Promise<void>(() => {}));
        montar({ onAdd });
        fireEvent.change(entrada(), { target: { value: 'leche' } });

        enviar();
        enviar();

        expect(onAdd).toHaveBeenCalledTimes(1);
        expect(entrada().disabled).toBe(true);
    });

    it('tras el alta, el boton vuelve a quedar disponible', async () => {
        montar();
        fireEvent.change(entrada(), { target: { value: 'leche' } });

        await act(async () => {
            enviar();
        });

        await vi.waitFor(() => {
            expect(entrada().disabled).toBe(false);
        });
        expect(boton().disabled).toBe(true); // sin texto, otra vez en espera
    });
});
