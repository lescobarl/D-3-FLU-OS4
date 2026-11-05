/**
 * pendingListKit — dependencias compartidas de los hooks de lista.
 *
 * Dueño único del conjunto de imports que repetían `useNotes` y
 * `useShoppingList` (mecánica de lista + wrapper de refresco).
 */
export { usePendingList, useCountedMutation, addSequentially, cleanLabels } from './pendingListCore'
export { useRefreshAction } from './refreshOnOk'
