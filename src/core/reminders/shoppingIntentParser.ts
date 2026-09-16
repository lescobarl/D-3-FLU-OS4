// ============================================================
// src/core/reminders/shoppingIntentParser.ts
// Parser de la LISTA DE COMPRAS (separado del calendario).
// ------------------------------------------------------------
// Separado del calendario unificado (`agenda`) para que no arrastre la lista
// de compras. Una sola fuente de la gramática de "agrega/tacha/quita/muestra
// … la lista de compras".
// ============================================================

export type ShoppingIntentAction =
    | 'shopping.add'
    | 'shopping.toggle'
    | 'shopping.remove'
    | 'shopping.list';

export interface ShoppingIntentData {
    label?: string;
}

export interface ShoppingIntent {
    handled: boolean;
    action: ShoppingIntentAction | null;
    data?: ShoppingIntentData;
    reply: string;
}

const SHOPPING_ADD_ES =
    /^(?:agrega|añade|anade|anota|pon|pone|apunta)\s+(.+?)\s+(?:a\s+)?(?:la\s+lista\s+de\s+compras|el\s+listado\s+de\s+compras|la\s+lista|a\s+las\s+compras)\s*$/i;
const SHOPPING_ADD_EN =
    /^(?:add|put)\s+(.+?)\s+(?:to\s+)?(?:the\s+)?(?:shopping\s+)?(?:grocery\s+)?list\s*$/i;
const SHOPPING_TOGGLE_ES =
    /^(?:tacha|marca|cruza|chequea)\s+(.+?)\s+(?:como\s+comprad[oa]\s+)?(?:de\s+)?(?:la\s+)?(?:lista\s+de\s+compras|lista)\s*$/i;
const SHOPPING_TOGGLE_EN =
    /^(?:check|mark|tick)\s+(?:off\s+)?(.+?)\s+(?:off\s+)?(?:from\s+)?(?:the\s+)?(?:shopping\s+)?list\s*$/i;
const SHOPPING_REMOVE_ES =
    /^(?:quita|quitemos|borra|elimina)\s+(.+?)\s+(?:de\s+)?(?:la\s+)?(?:lista\s+de\s+compras|lista)\s*$/i;
const SHOPPING_REMOVE_EN =
    /^(?:remove|delete)\s+(.+?)\s+(?:from\s+)?(?:the\s+)?(?:shopping\s+)?list\s*$/i;
const SHOPPING_LIST_ES =
    /^(?:muestra|muéstrame|muestrame|mostrar|ver|abre|abrir|dime|enseñame|ensename)\s+(?:la\s+)?(?:lista\s+de\s+compras|lista|compras)\s*$|^lista\s+de\s+compras\s*$/i;
const SHOPPING_LIST_EN =
    /^(?:show|open|display)\s+(?:me\s+)?(?:the\s+)?(?:shopping\s+)?list\s*$|^(?:shopping\s+)?list\s*$/i;

function cleanLabel(raw: string): string {
    return String(raw || '').replace(/\s+/g, ' ').trim();
}

export function parseShoppingIntent(input: string): ShoppingIntent {
    const text = String(input || '').trim();
    if (!text) return { handled: false, action: null, reply: '' };

    const add = SHOPPING_ADD_ES.exec(text) || SHOPPING_ADD_EN.exec(text);
    if (add) return { handled: true, action: 'shopping.add', reply: '', data: { label: cleanLabel(add[1]) } };

    const toggle = SHOPPING_TOGGLE_ES.exec(text) || SHOPPING_TOGGLE_EN.exec(text);
    if (toggle) return { handled: true, action: 'shopping.toggle', reply: '', data: { label: cleanLabel(toggle[1]) } };

    const remove = SHOPPING_REMOVE_ES.exec(text) || SHOPPING_REMOVE_EN.exec(text);
    if (remove) return { handled: true, action: 'shopping.remove', reply: '', data: { label: cleanLabel(remove[1]) } };

    if (SHOPPING_LIST_ES.test(text) || SHOPPING_LIST_EN.test(text)) {
        return { handled: true, action: 'shopping.list', reply: '' };
    }

    return { handled: false, action: null, reply: '' };
}
