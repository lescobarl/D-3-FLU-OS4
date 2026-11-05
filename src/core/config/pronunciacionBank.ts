// ============================================================
// pronunciacionBank - Banco CONFIGURABLE de palabras a pronunciar (P8.67).
// ------------------------------------------------------------
// Catalogo declarado (estilo musicCatalog): cada palabra con su ayuda de "como
// suena" y su NIVEL. El motor de pronunciacion lo consume; el nivel se elige por
// opcion de partida. Ajustar el banco es tocar ESTA tabla (una etiqueta, un sitio).
// ============================================================

export type PronunciacionNivel = 'basico' | 'intermedio' | 'avanzado';

export interface PronunciacionWord {
    word: string;
    pista: string;
    nivel: PronunciacionNivel;
}

export const PRONUNCIACION_BANK: readonly PronunciacionWord[] = Object.freeze([
    { word: 'water', pista: 'Suena como "uoter": agua.', nivel: 'basico' },
    { word: 'house', pista: 'Suena como "jaus": casa.', nivel: 'basico' },
    { word: 'three', pista: 'Suena como "zri": el numero tres.', nivel: 'basico' },
    { word: 'yellow', pista: 'Suena como "yelou": amarillo.', nivel: 'basico' },
    { word: 'juice', pista: 'Suena como "yus": jugo.', nivel: 'basico' },
    { word: 'world', pista: 'Suena como "uorld": mundo.', nivel: 'intermedio' },
    { word: 'think', pista: 'Suena como "zink": pensar.', nivel: 'intermedio' },
    { word: 'girl', pista: 'Suena como "guerl": nina.', nivel: 'intermedio' },
    { word: 'chocolate', pista: 'Suena como "chocolat": chocolate.', nivel: 'intermedio' },
    { word: 'island', pista: 'Suena como "ail-and": isla (la s NO se pronuncia).', nivel: 'intermedio' },
    { word: 'comfortable', pista: 'Suena como "comf-tabl": comodo.', nivel: 'avanzado' },
    { word: 'thorough', pista: 'Suena como "zoro": minucioso.', nivel: 'avanzado' },
    { word: 'entrepreneur', pista: 'Suena como "ontrupreneur": empresario.', nivel: 'avanzado' },
    { word: 'rhythm', pista: 'Suena como "ridem": ritmo.', nivel: 'avanzado' },
    { word: 'squirrel', pista: 'Suena como "scuirl": ardilla.', nivel: 'avanzado' },
]);

/**
 * Palabras del banco filtradas por nivel. Sin nivel (o desconocido) devuelve el
 * banco COMPLETO: el juego nunca se queda sin palabras por una opcion mal dicha.
 */
export function pronunciacionWordsByLevel(nivel?: string): PronunciacionWord[] {
    const value = String(nivel ?? '').trim().toLowerCase();
    if (!value) return [...PRONUNCIACION_BANK];
    const filtered = PRONUNCIACION_BANK.filter((item) => item.nivel === value);
    return filtered.length ? filtered : [...PRONUNCIACION_BANK];
}
