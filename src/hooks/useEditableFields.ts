/**
 * useEditableFields — estado de campos de un formulario de edicion.
 *
 * DUENO UNICO (auditoria de codigo 2026-10-02): los dos formularios de editor
 * (ambiente y paleta) tenian el MISMO setter de patch parcial sobre su estado de
 * campos; solo cambiaba el tipo del patch, que en runtime no existe. Al ser un
 * patron de estado (no de presentacion), vive una sola vez aqui.
 *
 * @param seed Estado inicial (se clona con `clone` para no compartir referencias).
 * @param clone Clonado profundo del estado inicial (cada formulario anida distinto).
 * @returns `{ fields, setFields, setField }`: el estado, el setter total y el parcial.
 */
import { useState } from 'react';

export interface EditableFields<T> {
    fields: T;
    setFields: (next: T | ((prev: T) => T)) => void;
    setField: (patch: Partial<T>) => void;
}

export function useEditableFields<T extends object>(seed: T, clone: (seed: T) => T): EditableFields<T> {
    const [fields, setFields] = useState<T>(() => clone(seed));

    const setField = (patch: Partial<T>) => {
        setFields((prev) => ({ ...prev, ...patch }));
    };

    return { fields, setFields, setField };
}
