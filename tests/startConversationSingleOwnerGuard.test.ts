/**
 * startConversationSingleOwnerGuard — el comando de voz delega en el mismo
 * dueno de "iniciar conversacion" (App.handleStartConversation): reset + audit
 * + modo + escucha. Antes el comando reimplementaba reset/reanudar y dejaba
 * auditoria y modo sin limpiar.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const ownsReset = (source: string) => source.includes('resetConversationHistory()');

describe('iniciar conversacion — un solo dueno', () => {
  it('el comando delega por ref y no reimplementa el reset', () => {
    const hook = read('src/hooks/useNavigationCommands.ts');
    expect(hook).toContain('startConversationRef.current?.({ announce: false })');
    expect(ownsReset(hook)).toBe(false);
  });

  it('App declara el dueno y lo publica en la ref', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('const startConversationRef = useRef');
    expect(app).toContain('const handleStartConversation = useCallback');
    expect(app).toContain('startConversationRef.current = handleStartConversation');
    expect(app).toContain('startConversationRef,');
  });

  it('el detector no es decorativo', () => {
    expect(ownsReset('integrationStore.resetConversationHistory()')).toBe(true);
    expect(ownsReset('await startConversationRef.current?.({ announce: false })')).toBe(false);
  });
});
