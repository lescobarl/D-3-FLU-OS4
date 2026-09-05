// ============================================================
// deterministicArbiter — Árbitro determinista UNIFICADO (puro)
// ------------------------------------------------------------
// §3A del plan de afinado estructural (2026-09-04). Blinda el §2A:
// dado un texto de voz, el árbitro puro `resolveDeterministicCommand`
// devuelve `{ matched, domain, action }` correcto para cada dominio
// (config, juego, ambiente, navegación) y NO depende de Gemini.
//
// Regla #1: sin hardcode — las frases de activación se contrastan contra
// los catálogos reales (configCommands / gameCatalog / environmentRegistry /
// voiceCommands). Cada expectativa refleja el comportamiento REAL del módulo.
// ============================================================
import { describe, expect, it } from 'vitest';
import {
  resolveDeterministicCommand,
  resolveDeterministicCourtesySpeech,
  resolveDeterministicSkipGeminiContract,
  resolveStatefulDomains,
  ARBITER_DOMAINS,
} from '../src/voice/lib/deterministicArbiter';

describe('deterministicArbiter — resolveDeterministicCommand', () => {
  it('resuelve el dominio de configuración (branding off)', () => {
    const result = resolveDeterministicCommand('desactiva la temporada');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('config');
    expect(result.action).toEqual({
      accion: 'set_branding',
      componente: 'branding',
      clave: 'mode',
      valor: 'disabled',
    });
  });

  it('resuelve el dominio de configuración (idioma)', () => {
    const result = resolveDeterministicCommand('pon el idioma en inglés');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('config');
    expect(result.action).toMatchObject({ clave: 'language', valor: 'en' });
  });

  it('resuelve el dominio de juego (inicio de adivinanzas)', () => {
    const result = resolveDeterministicCommand('juguemos a las adivinanzas');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('game');
    expect(result.action).toMatchObject({ gameId: 'adivinanzas', action: 'start' });
  });

  it('resuelve el dominio de ambiente (activar chef)', () => {
    const result = resolveDeterministicCommand('actúa como chef');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('environment');
    expect(result.action).toEqual({ tipo: 'activar', ambienteId: 'chef' });
  });

  it('resuelve el dominio de ambiente (reset asistente)', () => {
    const result = resolveDeterministicCommand('vuelve a ser mi asistente');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('environment');
    expect(result.action).toEqual({ tipo: 'reset', ambienteId: 'asistente' });
  });

  it('resuelve el dominio de navegación (iniciar conversación)', () => {
    const result = resolveDeterministicCommand('iniciar conversación');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('navigation');
    expect(result.action).toBe('INICIAR_CONVERSACION');
  });

  it('resuelve el dominio de navegación (búsqueda web "Busca en la web")', () => {
    // §2D — la búsqueda web se resuelve por fast-path determinista (BUSCAR),
    // no depende de que Gemini decida.
    const result = resolveDeterministicCommand('Busca en la web');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('navigation');
    expect(result.action).toBe('BUSCAR');
  });

  it('resuelve el dominio de navegación (búsqueda web con consulta)', () => {
    const result = resolveDeterministicCommand('busca en la web capital de Francia');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('navigation');
    expect(result.action).toBe('BUSCAR');
  });

  it('resuelve el dominio de navegación (búsqueda web en inglés)', () => {
    const result = resolveDeterministicCommand('search the web for Paris', {
      language: 'en',
    });
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('navigation');
    expect(result.action).toBe('BUSCAR');
  });

  it('resuelve el dominio de horario (agregar por dictado)', () => {
    const result = resolveDeterministicCommand('agrega matemáticas el lunes a las 8');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('horario');
    expect(result.action).toMatchObject({
      handled: true,
      action: 'horario.add',
      data: { materia: 'matemáticas', dia: 1, inicio: '08:00' },
    });
  });

  it('resuelve el dominio de horario (consulta por dictado)', () => {
    const result = resolveDeterministicCommand('qué clases tengo mañana');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('horario');
    expect(result.action).toMatchObject({
      handled: true,
      action: 'horario.query',
    });
  });

  it('resuelve el dominio de horario (quitar por dictado)', () => {
    const result = resolveDeterministicCommand('quita historia del viernes');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('horario');
    expect(result.action).toMatchObject({
      handled: true,
      action: 'horario.remove',
      data: { materia: 'historia', dia: 5 },
    });
  });

  it('no matchea horario cuando falta la hora (aclaración, no acción accionable)', () => {
    // "agrega matemáticas el lunes" sin hora → el parser pide aclaración
    // (action === null). El árbitro NO lo marca como match determinista para
    // no robar el turno de aclaración conversacional.
    const result = resolveDeterministicCommand('agrega matemáticas el lunes');
    expect(result.matched).toBe(false);
    expect(result.domain).toBeNull();
  });

  it('no matchea texto conversacional casual (no depende de Gemini pero no dispara)', () => {
    const result = resolveDeterministicCommand('cuéntame un chiste');
    expect(result.matched).toBe(false);
    expect(result.domain).toBeNull();
    expect(result.action).toBeNull();
  });

  it('no matchea texto vacío', () => {
    const result = resolveDeterministicCommand('');
    expect(result.matched).toBe(false);
  });

  it('respeta el idioma para el dominio de ambiente (en)', () => {
    const result = resolveDeterministicCommand('act as a chef', { language: 'en' });
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('environment');
    expect(result.action).toEqual({ tipo: 'activar', ambienteId: 'chef' });
  });

  it('prioriza config sobre navegación cuando ambos podrían aplicar', () => {
    // "desactiva la temporada" no es navegación, pero verifica que un comando
    // de estado gana sobre cualquier interpretación de navegación.
    const result = resolveDeterministicCommand('desactiva la temporada');
    expect(result.domain).toBe('config');
  });
});

describe('deterministicArbiter — funciones-adición (Phase B)', () => {
  it('resuelve el dominio de recordatorio (reminder.add)', () => {
    const result = resolveDeterministicCommand('recuérdame comprar leche mañana');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('reminder');
    expect(result.action).toMatchObject({ handled: true, action: 'reminder.add' });
    expect(result.channel).toBe('flu');
  });

  it('resuelve el dominio de recordatorio (shopping.add)', () => {
    const result = resolveDeterministicCommand('agrega leche a la lista de compras');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('reminder');
    expect(result.action).toMatchObject({ handled: true, action: 'shopping.add' });
    expect(result.channel).toBe('flu');
  });

  it('resuelve el dominio temporal (alarm.add)', () => {
    const result = resolveDeterministicCommand('pon una alarma a las 7');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('temporal');
    expect(result.action).toMatchObject({ handled: true, action: 'alarm.add' });
    expect(result.channel).toBe('flu');
  });

  it('resuelve el dominio temporal (timer.start)', () => {
    const result = resolveDeterministicCommand('pon un temporizador de 5 minutos');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('temporal');
    expect(result.action).toMatchObject({ handled: true, action: 'timer.start' });
    expect(result.channel).toBe('flu');
  });

  it('resuelve el dominio de diario (diary.addEntry)', () => {
    const result = resolveDeterministicCommand('escribe en el diario que fui al parque');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('diary');
    expect(result.action).toMatchObject({ handled: true, action: 'diary.addEntry' });
    expect(result.channel).toBe('flu');
  });

  it('enruta "anota X en el diario" a diario y NO a nota (diario gana)', () => {
    // El patrón de diario ("... en el diario ..." al inicio) es más específico
    // que el apunta genérico de nota, así que el diario se evalúa antes.
    const result = resolveDeterministicCommand('anota en el diario que fui al parque');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('diary');
    expect(result.action).toMatchObject({ handled: true, action: 'diary.addEntry' });
  });

  it('resuelve el dominio de nota (notes.add por apunta)', () => {
    const result = resolveDeterministicCommand('apunta comprar pan');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('note');
    expect(result.action).toMatchObject({ handled: true, action: 'notes.add' });
    expect(result.channel).toBe('flu');
  });

  it('resuelve el dominio de nota (notes.add por creación explícita)', () => {
    const result = resolveDeterministicCommand('crea una nota para recordar la tarea');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('note');
    expect(result.action).toMatchObject({ handled: true, action: 'notes.add' });
  });

  it('resuelve el dominio de nota (notes.add para supermercado)', () => {
    const result = resolveDeterministicCommand('nota para el super comprar cereal');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('note');
    expect(result.action).toMatchObject({ handled: true, action: 'notes.add' });
  });
});

describe('deterministicArbiter — canales de integración (Phase B)', () => {
  it('mapea búsqueda web al canal web', () => {
    const result = resolveDeterministicCommand('busca en la web capital de Francia');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('navigation');
    expect(result.action).toBe('BUSCAR');
    expect(result.channel).toBe('web');
  });

  it('mapea generación de video al canal video', () => {
    // El gatillo pelado "genera un video" es un comando de navegación directo
    // (GENERAR_VIDEO); con contenido adicional se trataría como consulta IA.
    const result = resolveDeterministicCommand('genera un video');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('navigation');
    expect(result.action).toBe('GENERAR_VIDEO');
    expect(result.channel).toBe('video');
  });

  it('mapea generación de documento al canal documento', () => {
    const result = resolveDeterministicCommand('generar documento');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('navigation');
    expect(result.action).toBe('GENERAR_DOCUMENTO');
    expect(result.channel).toBe('documento');
  });

  it('mapea iniciar conversación al canal flu (sin objeto de integración externo)', () => {
    const result = resolveDeterministicCommand('iniciar conversación');
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('navigation');
    expect(result.action).toBe('INICIAR_CONVERSACION');
    expect(result.channel).toBe('flu');
  });
});

describe('deterministicArbiter — resolveStatefulDomains', () => {
  it('resuelve config/juego/ambiente sin navegación', () => {
    const result = resolveStatefulDomains('actúa como chef');
    expect(result.env).toEqual({ tipo: 'activar', ambienteId: 'chef' });
    expect(result.config).toBeNull();
    expect(result.game).toBeNull();
  });

  it('devuelve nulls para texto sin dominio de estado', () => {
    const result = resolveStatefulDomains('cuéntame un chiste');
    expect(result.config).toBeNull();
    expect(result.game).toBeNull();
    expect(result.env).toBeNull();
  });
});

describe('deterministicArbiter — dominios declarados', () => {
  it('expone los dominios soportados en orden de prioridad', () => {
    // §Concepto plataforma (Phase B): las funciones-adición (reminder/temporal/
    // diary/note) se suman como términos al núcleo fijo, ANTES de horario y
    // navegación, en el MISMO punto único de resolución.
    expect(ARBITER_DOMAINS).toEqual([
      'config',
      'game',
      'environment',
      'reminder',
      'temporal',
      'diary',
      'note',
      'horario',
      'navigation',
    ]);
  });
});

interface SkipGeminiContractShape {
  domain: string;
  contract: {
    respuesta_voz: string;
    configuracion: unknown;
    juego: unknown;
    ambiente: unknown;
    metadata: { provider: string };
  };
}

function skipGemini(text: string, skipGeminiOnMatch: boolean) {
  return resolveDeterministicSkipGeminiContract({
    text,
    language: 'es',
    skipGeminiOnMatch,
  }) as SkipGeminiContractShape | null;
}

describe('deterministicArbiter — resolveDeterministicSkipGeminiContract (§2B/3B)', () => {
  it('devuelve null cuando el flag skipGeminiOnMatch está APAGADO (default → Gemini)', () => {
    const result = skipGemini('desactiva la temporada', false);
    expect(result).toBeNull();
  });

  it('devuelve null por defecto aunque haya match (flag ausente → Gemini)', () => {
    const result = resolveDeterministicSkipGeminiContract({
      text: 'desactiva la temporada',
      language: 'es',
    }) as SkipGeminiContractShape | null;
    expect(result).toBeNull();
  });

  it('devuelve null con flag activo pero SIN match de dominio de estado (va a Gemini)', () => {
    const result = skipGemini('cuéntame un chiste', true);
    expect(result).toBeNull();
  });

  it('devuelve null con flag activo para un dominio NO-estado (navegación → Gemini)', () => {
    const result = skipGemini('iniciar conversación', true);
    expect(result).toBeNull();
  });

  it('con flag activo y match config produce contrato determinista (NO llama a Gemini)', () => {
    const result = skipGemini('desactiva la temporada', true);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('config');
    expect(result!.contract.configuracion).toEqual({
      accion: 'set_branding',
      componente: 'branding',
      clave: 'mode',
      valor: 'disabled',
    });
    expect(result!.contract.juego).toBeNull();
    expect(result!.contract.ambiente).toBeNull();
    expect(result!.contract.respuesta_voz).toBe('Listo, he apagado el branding estacional.');
    expect(result!.contract.metadata.provider).toBe('deterministic-arbiter');
  });

  it('con flag activo y match config con valor produce confirmación verbal', () => {
    const result = skipGemini('cambia el idioma a inglés', true);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('config');
    expect(result!.contract.respuesta_voz).toContain('idioma');
  });

  it('con flag activo y match juego produce contrato con respuesta_voz vacía (motor habla)', () => {
    const result = skipGemini('juguemos a las adivinanzas', true);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('game');
    expect(result!.contract.juego).not.toBeNull();
    expect(result!.contract.respuesta_voz).toBe('');
  });

  it('con flag activo y match ambiente produce contrato con respuesta_voz vacía (motor habla)', () => {
    const result = skipGemini('actúa como chef', true);
    expect(result).not.toBeNull();
    expect(result!.domain).toBe('environment');
    expect(result!.contract.ambiente).not.toBeNull();
    expect(result!.contract.respuesta_voz).toBe('');
  });
});

describe('deterministicArbiter — resolveDeterministicCourtesySpeech (§2B)', () => {
  it('devuelve "" sin acción (no hay nada que confirmar)', () => {
    expect(resolveDeterministicCourtesySpeech(null, 'config', 'es')).toBe('');
    expect(resolveDeterministicCourtesySpeech(undefined, 'config', 'es')).toBe('');
  });

  it('devuelve "" para dominios no-config (motor local ya habla)', () => {
    expect(resolveDeterministicCourtesySpeech({ gameId: 'adivinaNumero' }, 'game', 'es')).toBe('');
    expect(resolveDeterministicCourtesySpeech({ tipo: 'activar', ambienteId: 'chef' }, 'environment', 'es')).toBe('');
  });

  it('devuelve "" para un dominio desconocido', () => {
    expect(resolveDeterministicCourtesySpeech({ clave: 'mode', valor: 'disabled' }, 'navigation', 'es')).toBe('');
    expect(resolveDeterministicCourtesySpeech({ clave: 'mode', valor: 'disabled' }, '', 'es')).toBe('');
  });

  it('confirma el apagado del branding estacional (mode=disabled)', () => {
    const action = { accion: 'set_branding', componente: 'branding', clave: 'mode', valor: 'disabled' };
    expect(resolveDeterministicCourtesySpeech(action, 'config', 'es')).toBe(
      'Listo, he apagado el branding estacional.',
    );
  });

  it('confirma una clave conocida con valor (es)', () => {
    const action = { accion: 'set_config', componente: 'config', clave: 'language', valor: 'en' };
    expect(resolveDeterministicCourtesySpeech(action, 'config', 'es')).toBe(
      'Listo, he configurado el idioma de la interfaz a en.',
    );
  });

  it('confirma una clave conocida con valor (en)', () => {
    const action = { accion: 'set_config', componente: 'config', clave: 'language', valor: 'es' };
    expect(resolveDeterministicCourtesySpeech(action, 'config', 'en')).toBe(
      'Listo, he configurado the interface language a es.',
    );
  });

  it('confirma una clave conocida sin valor (actualización genérica)', () => {
    const action = { accion: 'set_config', componente: 'config', clave: 'clearCache', valor: '' };
    expect(resolveDeterministicCourtesySpeech(action, 'config', 'es')).toBe(
      'Listo, he actualizado la caché.',
    );
  });

  it('cae a la clave cruda cuando la clave no tiene etiqueta amigable', () => {
    const action = { accion: 'set_config', componente: 'config', clave: 'claveDesconocida', valor: 'x' };
    expect(resolveDeterministicCourtesySpeech(action, 'config', 'es')).toBe(
      'Listo, he configurado claveDesconocida a x.',
    );
  });

  it('une valores de arreglo con coma (p. ej. wakeWords)', () => {
    const action = { accion: 'set_config', componente: 'config', clave: 'wakeWords', valor: ['flu', 'hey flu'] };
    expect(resolveDeterministicCourtesySpeech(action, 'config', 'es')).toBe(
      'Listo, he configurado las palabras de activación a flu, hey flu.',
    );
  });
});
