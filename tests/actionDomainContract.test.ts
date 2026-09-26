// ============================================================
// tests/actionDomainContract.test.ts
// Invariante de alineacion del campo `acciones[].dominio`.
//
// El defecto que cubre: los DOS prompts del sistema ofrecian vocabularios
// distintos y contradictorios ("agenda"/"shopping" en gemini.js,
// "reminder"/"temporal" en capabilities.ts), y etiquetas como "agenda" o
// "temporal" NO las entiende resolveAgendaDomainIntent => la accion se
// descartaba en silencio y la IA confirmaba en voz algo que nunca se creo.
//
// Invariante: TODO dominio ofrecido al modelo esta aceptado por el resolver,
// y los dos prompts ofrecen EXACTAMENTE el mismo conjunto (fuente unica).
// ============================================================
import { describe, it, expect } from 'vitest';
import {
    CONTRACT_ACTION_DOMAINS,
    actionDomainList,
    resolveAgendaDomainIntent,
} from '../src/core/agenda/domainScopedIntent';
import { buildCapabilitiesPrompt } from '../src/services/capabilities';
import { buildSystemPrompt } from '../src/voice/lib/gemini';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter.js';

// Texto de referencia por dominio: el resolver debe aceptarlo.
const SAMPLE_TEXT: Record<string, string> = {
    reminder: 'recuerdame tomar el medicamento a las 12',
    alarma: 'pon una alarma a las 7',
    horario: 'agrega matematicas el lunes a las 8',
    junta: 'agendame una junta con Luis el martes a las 4',
    cita: 'crea una cita para manana a las 10',
    shopping: 'agrega leche a la lista de compras',
    note: 'apunta comprar pan',
    diary: 'escribe en el diario que fui al parque',
};

describe('acciones[].dominio - todo dominio ofrecido es ejecutable', () => {
    for (const domain of CONTRACT_ACTION_DOMAINS) {
        it(`"${domain}" llega a un resolver real`, () => {
            const text = SAMPLE_TEXT[domain];
            expect(text, `falta texto de referencia para ${domain}`).toBeTruthy();

            // Los dominios de agenda se resuelven SIEMPRE por la pista de dominio
            // (es el camino que el prompt habilita); shopping/note/diary los cubre
            // el arbitro determinista. Exigirlo por su via real evita que el
            // arbitro enmascare un dominio muerto.
            const AGENDA_DOMAINS = ['reminder', 'alarma', 'horario', 'junta', 'cita'];
            if (AGENDA_DOMAINS.includes(domain)) {
                const viaDomain = resolveAgendaDomainIntent(domain, text);
                expect(viaDomain?.matched, `el resolver no entiende el dominio "${domain}"`).toBe(true);
                expect(viaDomain?.domain).toBe('agendaCommand');
            } else {
                const viaArbiter = resolveDeterministicCommand(text) as { matched?: boolean; domain?: string };
                expect(viaArbiter.matched, `el arbitro no cubre "${domain}"`).toBe(true);
                expect(viaArbiter.domain).toBe(domain);
            }
        });
    }

    it('el dominio "alarma" llega al parser SIN trigger verbal (hueco real)', () => {
        // El hueco: AgendaKind incluye 'alarma' pero AGENDA_DOMAIN_KIND no lo
        // mapeaba, asi que el unico camino posible (texto sin la palabra
        // "alarma") devolvia null y el turno se perdia. El arbitro determinista
        // NO cubre este texto: la pista de dominio es la unica via.
        const text = 'a las 7 de la manana';
        const viaArbiter = resolveDeterministicCommand(text) as { matched?: boolean };
        expect(viaArbiter.matched).toBe(false);
        const viaDomain = resolveAgendaDomainIntent('alarma', text);
        expect(viaDomain?.matched).toBe(true);
        expect((viaDomain?.action as { kind?: string })?.kind).toBe('alarma');
    });

    it('no queda ningun dominio muerto en el vocabulario', () => {
        // Los que antes se ofrecian y el resolver NO entiende.
        expect([...CONTRACT_ACTION_DOMAINS]).not.toContain('agenda');
        expect([...CONTRACT_ACTION_DOMAINS]).not.toContain('temporal');
    });

    it('la lista del prompt es la fuente unica', () => {
        expect(actionDomainList()).toBe([...CONTRACT_ACTION_DOMAINS].join(' | '));
    });
});

describe('acciones[].dominio - los dos prompts dicen lo mismo', () => {
    const capabilitiesEs = buildCapabilitiesPrompt('es');
    const capabilitiesEn = buildCapabilitiesPrompt('en');
    const systemEs = buildSystemPrompt({ role: '', theme: '', phase: '', language: 'es', includeConfig: true });
    const systemEn = buildSystemPrompt({ role: '', theme: '', phase: '', language: 'en', includeConfig: true });

    it('capabilities (es) ofrece el vocabulario canonico', () => {
        expect(capabilitiesEs).toContain(actionDomainList());
    });

    it('capabilities (en) ofrece el vocabulario canonico', () => {
        expect(capabilitiesEn).toContain(actionDomainList());
    });

    it('el prompt de sistema de gemini ofrece el mismo vocabulario', () => {
        expect(systemEs).toContain(actionDomainList());
        expect(systemEn).toContain(actionDomainList());
    });

    it('la instruccion de acciones aparece UNA sola vez en el prompt', () => {
        // El prompt de sistema ya incluye buildCapabilitiesPrompt; gemini.js tenia
        // ADEMAS su propia copia de la instruccion con otro vocabulario: la misma
        // regla, dos veces y contradiciendose. Duplicarla de nuevo debe fallar aqui.
        const veces = (texto: string, aguja: string) => texto.split(aguja).length - 1;
        expect(veces(systemEs, actionDomainList())).toBe(1);
        expect(veces(systemEn, actionDomainList())).toBe(1);
    });

    it('ningun prompt ofrece las etiquetas que el resolver no entiende', () => {
        for (const prompt of [capabilitiesEs, capabilitiesEn, systemEs, systemEn]) {
            expect(prompt).not.toMatch(/dominio[^\n]*\bagenda\b\s*[,|]/);
            expect(prompt).not.toMatch(/\btemporal\b\s*[,|"]/);
        }
    });

    it('ningun prompt niega un dominio que SI existe', () => {
        for (const prompt of [capabilitiesEs, capabilitiesEn, systemEs, systemEn]) {
            expect(prompt).not.toMatch(/NO existe dominio "shopping"/);
            expect(prompt).not.toMatch(/there is NO "shopping"/);
        }
    });
});
