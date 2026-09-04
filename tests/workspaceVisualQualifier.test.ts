// ============================================================
// Tests para hasExplicitVisualQualifier y buildVisualAnchorBlock
// ============================================================
// El usuario puede pedir imágenes de forma explícita aunque la
// frase sea de explicación («háblame de los aviones con imágenes»).
// En ese caso el ancla DEBE forzar workspace.tipo = image_prompt y
// prompt_visual, no preguntar qué explicar.
// ============================================================
import { describe, it, expect } from 'vitest';
import {
  hasExplicitVisualQualifier,
  buildVisualAnchorBlock,
  buildBareVisualFallbackWorkspace,
  extractConversationTopic,
  isBareVisualRequest,
} from '../src/voice/lib/workspaceContract';

describe('hasExplicitVisualQualifier — calificador visual explícito', () => {
  it('detecta «con imágenes» en una frase de explicación', () => {
    expect(hasExplicitVisualQualifier('háblame de los aviones con imágenes')).toBe(true);
  });

  it('detecta «con fotos»', () => {
    expect(hasExplicitVisualQualifier('cuéntame sobre los planetas con fotos')).toBe(true);
  });

  it('detecta «con imagen de»', () => {
    expect(hasExplicitVisualQualifier('explícame el sistema solar con imagen de los planetas')).toBe(true);
  });

  it('detecta «incluye imágenes»', () => {
    expect(hasExplicitVisualQualifier('incluye imágenes de dinosaurios')).toBe(true);
  });

  it('NO detecta una petición sin calificador visual', () => {
    expect(hasExplicitVisualQualifier('háblame de los aviones')).toBe(false);
  });

  it('NO detecta texto vacío', () => {
    expect(hasExplicitVisualQualifier('')).toBe(false);
  });
});

describe('buildVisualAnchorBlock — ancla con calificador explícito', () => {
  it('fuerza image_prompt cuando el usuario pide «con imágenes»', () => {
    const anchor = buildVisualAnchorBlock('háblame de los aviones con imágenes', 'es');
    expect(anchor).toContain('image_prompt');
    expect(anchor).toContain('prompt_visual');
    expect(anchor).toContain('NO preguntes');
  });

  it('usa el ancla en inglés cuando el idioma es en', () => {
    const anchor = buildVisualAnchorBlock('tell me about planes with images', 'en');
    expect(anchor).toContain('image_prompt');
    expect(anchor).toContain('prompt_visual');
  });

  it('devuelve vacío para texto sin petición visual', () => {
    expect(buildVisualAnchorBlock('háblame de los aviones', 'es')).toBe('');
  });
});

describe('buildVisualAnchorBlock — petición visual sin sujeto (bare)', () => {
  it('devuelve ancla imperativa para «generame una imagen»', () => {
    const anchor = buildVisualAnchorBlock('generame una imagen', 'es');
    expect(anchor).toContain('image_prompt');
    expect(anchor).toContain('prompt_visual');
    // Debe ordenar generar desde el hilo, no preguntar qué imagen quiere.
    expect(anchor).toContain('hilo de conversación');
    expect(anchor).toContain('PROHIBIDO responder');
  });

  it('devuelve vacío para texto sin petición visual', () => {
    expect(buildVisualAnchorBlock('cuéntame un chiste', 'es')).toBe('');
  });
});

describe('extractConversationTopic — tema del hilo para petición visual sin sujeto', () => {
  const rabbitHistory = [
    { role: 'user', text: 'Platícame de los conejos que hablan' },
    { role: 'assistant', text: '¡Claro! Los conejos que hablan son una idea divertida...' },
  ];

  it('extrae el último turno de usuario sustancial', () => {
    expect(extractConversationTopic(rabbitHistory)).toContain('conejos');
  });

  it('limpia la frase de arranque conversacional del tema', () => {
    const topic = extractConversationTopic(rabbitHistory);
    // "Platícame de los conejos que hablan" → "los conejos que hablan"
    expect(topic).not.toContain('Platícame');
    expect(topic).not.toContain('platícame');
    expect(topic).toContain('conejos');
  });

  it('ignora turnos de usuario que son peticiones visuales vacías', () => {
    const history = [
      { role: 'user', text: 'Platícame de los conejos que hablan' },
      { role: 'assistant', text: '¡Claro!...' },
      { role: 'user', text: 'generame una imagen' },
    ];
    expect(extractConversationTopic(history)).toContain('conejos');
  });

  it('devuelve vacío si no hay turno de usuario con tema', () => {
    expect(extractConversationTopic([{ role: 'assistant', text: 'hola' }])).toBe('');
    expect(extractConversationTopic([])).toBe('');
  });
});

describe('buildBareVisualFallbackWorkspace — fallback determinista', () => {
  const rabbitHistory = [
    { role: 'user', text: 'Platícame de los conejos que hablan' },
    { role: 'assistant', text: '¡Claro! Los conejos que hablan son una idea divertida...' },
  ];

  it('construye workspace image_prompt cuando el hilo tiene tema', () => {
    const ws = buildBareVisualFallbackWorkspace('generame una imagen', rabbitHistory, 'es') as any;
    expect(ws).not.toBeNull();
    expect(ws.tipo).toBe('image_prompt');
    expect(ws.prompt_visual).toContain('conejos');
    expect(ws._respuestaVoz).toContain('conejos');
    // El sujeto se limpia de la frase de arranque ("Platícame de ...") para que
    // la respuesta suene natural: "Te genero una imagen sobre los conejos...".
    expect(ws._subject).not.toContain('Platícame');
    expect(ws._subject).not.toContain('platícame');
    expect(ws._respuestaVoz).not.toContain('Platícame');
  });

  it('devuelve null si el transcript no es una petición visual sin sujeto', () => {
    expect(buildBareVisualFallbackWorkspace('cuéntame un chiste', rabbitHistory, 'es')).toBeNull();
  });

  it('devuelve null si el hilo no tiene tema', () => {
    expect(buildBareVisualFallbackWorkspace('generame una imagen', [], 'es')).toBeNull();
  });

  it('usa el idioma en cuando se pide en', () => {
    // La detección de petición visual sin sujeto es en español; el idioma de
    // salida (respuesta_voz/prompt_visual) sí respeta el parámetro language.
    const ws = buildBareVisualFallbackWorkspace('generame una imagen', rabbitHistory, 'en') as any;
    expect(ws).not.toBeNull();
    expect(ws.tipo).toBe('image_prompt');
    // El sujeto se conserva tal cual del hilo (texto en español), pero la
    // plantilla de respuesta es la inglesa ("Done! I am generating...").
    expect(ws._respuestaVoz).toContain('Done!');
    expect(ws._respuestaVoz).toContain('conejos');
  });
});

describe('isBareVisualRequest — petición visual sin sujeto', () => {
  it('detecta «generame una imagen»', () => {
    expect(isBareVisualRequest('generame una imagen')).toBe(true);
  });

  it('NO detecta una petición con sujeto concreto', () => {
    expect(isBareVisualRequest('generame una imagen de un conejo')).toBe(false);
  });
});
