// @vitest-environment jsdom
// ============================================================
// NotificationCenterBell - campana del centro de notificaciones.
// ------------------------------------------------------------
// Componente presentacional: todo entra por props, no toca stores ni
// red, por lo que NO se mockea nada. Se verifica la conducta REAL:
//
//   Bloque A - estado cerrado/abierto: aria-expanded, panel y toggles.
//   Bloque B - badge de no leidas con tope 99+.
//   Bloque C - agrupado (Hoy / Ayer / fecha) y orden por timestamp.
//   Bloque D - marcar leido / limpiar: habilitado segun estado y callback.
//   Bloque E - borrado manual opcional y cierre por clic fuera / Escape.
//
// Las etiquetas salen de FLU_CONFIG.notifications con fallback en el
// catalogo: hoy el bloque no declara claves de ui, asi que se usan los
// fallbacks (se comprueba el de la campana).
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { NotificationCenterBell, type NotificationCenterBellProps } from '../src/components/NotificationCenterBell';
import type { NotificationCenterItem } from '../src/hooks/useNotificationCenter';

const DAY = 86400000;

function item(over: Partial<NotificationCenterItem> = {}): NotificationCenterItem {
    return {
        id: 'n1',
        title: 'Titulo',
        body: 'Cuerpo',
        category: 'system',
        timestamp: Date.now(),
        read: false,
        ...over,
    };
}

function bell(over: Partial<NotificationCenterBellProps> = {}) {
    const props: NotificationCenterBellProps = {
        items: [],
        unread: 0,
        onMarkAllRead: vi.fn(),
        onClear: vi.fn(),
        ...over,
    };
    const utils = render(<NotificationCenterBell {...props} />);
    return { ...utils, props };
}

function open() {
    fireEvent.click(screen.getByTestId('notif-bell-trigger'));
}

function itemTitles(): string[] {
    return screen
        .getAllByTestId('notif-item')
        .map((el) => el.querySelector('.notif-bell__item-title')?.textContent ?? '');
}

describe('NotificationCenterBell - Bloque A: abrir y cerrar', () => {
    it('cerrada por defecto: sin panel, aria-expanded false y etiqueta de catalogo', () => {
        bell();
        const trigger = screen.getByTestId('notif-bell-trigger');
        expect(trigger.getAttribute('aria-expanded')).toBe('false');
        // fallback del catalogo: 'Centro de notificaciones'.
        expect(trigger.getAttribute('aria-label')).toBe('Centro de notificaciones');
        expect(screen.queryByTestId('notif-bell-panel')).toBeNull();
    });

    it('el disparador abre y vuelve a cerrar el panel', () => {
        bell();
        open();
        expect(screen.getByTestId('notif-bell-panel')).toBeTruthy();
        expect(screen.getByTestId('notif-bell-trigger').getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(screen.getByTestId('notif-bell-trigger'));
        expect(screen.queryByTestId('notif-bell-panel')).toBeNull();
    });
});

describe('NotificationCenterBell - Bloque B: badge de no leidas', () => {
    it('sin no leidas no hay badge; con no leidas muestra el numero', () => {
        const first = bell();
        expect(screen.queryByTestId('notif-bell-badge')).toBeNull();
        first.unmount();

        bell({ unread: 5 });
        expect(screen.getByTestId('notif-bell-badge').textContent).toBe('5');
    });

    it('el badge topa en 99+', () => {
        bell({ unread: 150 });
        expect(screen.getByTestId('notif-bell-badge').textContent).toBe('99+');
    });
});

describe('NotificationCenterBell - Bloque C: agrupado y orden', () => {
    it('agrupa Hoy / Ayer / fecha y ordena por timestamp descendente', () => {
        const now = Date.now();
        bell({
            items: [
                item({ id: 'old', title: 'Viejo', timestamp: now - 3 * DAY }),
                item({ id: 't1', title: 'Reciente', timestamp: now - 1000 }),
                item({ id: 'y', title: 'De ayer', timestamp: now - DAY }),
                item({ id: 't2', title: 'Ultimo', timestamp: now }),
            ],
        });
        open();

        // Orden global: mas nuevo primero.
        expect(itemTitles()).toEqual(['Ultimo', 'Reciente', 'De ayer', 'Viejo']);

        // Cabeceras de grupo en orden: Hoy -> Ayer -> fecha.
        const heads = Array.from(document.querySelectorAll('.notif-bell__group-title')).map(
            (el) => el.textContent,
        );
        expect(heads).toHaveLength(3);
        expect(heads[0]).toBe('Hoy');
        expect(heads[1]).toBe('Ayer');
        expect(heads[2]).not.toBe('Hoy');
        expect(heads[2]).not.toBe('Ayer');
    });
});

describe('NotificationCenterBell - Bloque D: acciones sobre el historial', () => {
    it('un item no leido lleva la clase unread y uno leido no', () => {
        bell({
            items: [item({ id: 'u', title: 'Nueva', read: false }), item({ id: 'r', title: 'Leida', read: true, timestamp: Date.now() - 1 })],
            unread: 1,
        });
        open();
        const rows = screen.getAllByTestId('notif-item');
        const byTitle = (t: string) => rows.find((el) => el.textContent?.includes(t)) as HTMLElement;
        expect(byTitle('Nueva').classList.contains('notif-bell__item--unread')).toBe(true);
        expect(byTitle('Leida').classList.contains('notif-bell__item--unread')).toBe(false);
    });

    it('marcar leido se deshabilita sin no leidas y avisa con el callback', () => {
        const onMarkAllRead = vi.fn();
        const { rerender } = bell({ onMarkAllRead });
        open();
        expect((screen.getByTestId('notif-mark-read') as HTMLButtonElement).disabled).toBe(true);

        rerender(
            <NotificationCenterBell
                items={[item({ id: 'a' })]}
                unread={1}
                onMarkAllRead={onMarkAllRead}
                onClear={vi.fn()}
            />,
        );
        const btn = screen.getByTestId('notif-mark-read') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        fireEvent.click(btn);
        expect(onMarkAllRead).toHaveBeenCalledTimes(1);
    });

    it('limpiar se deshabilita sin items y avisa con el callback', () => {
        const onClear = vi.fn();
        const { rerender } = bell({ onClear });
        open();
        expect((screen.getByTestId('notif-clear') as HTMLButtonElement).disabled).toBe(true);

        rerender(
            <NotificationCenterBell
                items={[item({ id: 'a' })]}
                unread={0}
                onMarkAllRead={vi.fn()}
                onClear={onClear}
            />,
        );
        const btn = screen.getByTestId('notif-clear') as HTMLButtonElement;
        expect(btn.disabled).toBe(false);
        fireEvent.click(btn);
        expect(onClear).toHaveBeenCalledTimes(1);
    });

    it('lista vacia muestra el texto de vacio del catalogo', () => {
        bell({ items: [] });
        open();
        expect(within(screen.getByTestId('notif-bell-list')).getByText('Sin notificaciones')).toBeTruthy();
    });
});

describe('NotificationCenterBell - Bloque E: borrado y cierre', () => {
    it('el boton de borrar solo existe si onDismiss es funcion', () => {
        const first = bell({ items: [item({ id: 'a' })] });
        open();
        expect(screen.queryAllByTestId('notif-item-delete')).toHaveLength(0);
        first.unmount();

        const onDismiss = vi.fn();
        bell({ items: [item({ id: 'a', timestamp: Date.now() }), item({ id: 'b', timestamp: Date.now() - 1000 })], onDismiss });
        open();
        const deletes = screen.getAllByTestId('notif-item-delete');
        expect(deletes).toHaveLength(2);
        fireEvent.click(deletes[0]);
        // El elemento mas nuevo (a) va primero.
        expect(onDismiss).toHaveBeenCalledWith('a');
    });

    it('un clic fuera del panel lo cierra', () => {
        bell({ items: [item({ id: 'a' })] });
        open();
        expect(screen.getByTestId('notif-bell-panel')).toBeTruthy();
        fireEvent.mouseDown(document.body);
        expect(screen.queryByTestId('notif-bell-panel')).toBeNull();
    });

    it('Escape cierra el panel', () => {
        bell({ items: [item({ id: 'a' })] });
        open();
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(screen.queryByTestId('notif-bell-panel')).toBeNull();
    });
});
