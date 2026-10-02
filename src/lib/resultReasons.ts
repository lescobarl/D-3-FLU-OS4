// ============================================================
// resultReasons — vocabulario UNICO de motivos de resultado
// ============================================================
// Motivo de validacion compartido por los servicios de datos (entrada invalida).
// Evita repetir el literal en cada union reason?: ... y en cada retorno.
// ============================================================

export const INVALID_INPUT = 'invalid-input' as const;
export type InvalidInput = typeof INVALID_INPUT;
