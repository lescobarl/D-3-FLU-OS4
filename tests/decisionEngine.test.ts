// @vitest-environment jsdom
/**
 * decisionEngine (autonomia) - el motor que decide cambiar de proveedor de IA (0%).
 *
 * POR QUE ESTE TEST: `decisionEngine.ts` (525 sentencias) es el unico sitio donde
 * la app decide por si misma cambiar de proveedor, y hasta ahora no se ejecutaba
 * ni una linea. Aqui se prueban sus DOS reglas de negocio de verdad:
 *   - la puntuacion: costo y CO2 suman AL REVES (barato/limpio = 1), los pesos
 *     salen de la config (no de literales), y la tendencia exige 3 muestras;
 *   - el freno: histeresis de mejora, umbral de confianza y penalizacion por
 *     cambios recientes, mas el limite diario.
 * Se sustituye UNICAMENTE al tomador de decisiones (`DecisionMaker`, no exportado)
 * por un doble, para poder disparar decisiones con la forma real; la persistencia
 * es la puerta real (`localStore`) sobre jsdom y los eventos son el bus real.
 *
 * HALLAZGOS DECLARADOS (no se toca el producto):
 *   - `getAllProviderMetrics()` NO usa lo grabado con `recordProviderMetrics`:
 *     devuelve metricas de EJEMPLO de config para openrouter/gemini (el fuente lo
 *     admite: "Por ahora usamos datos de ejemplo"). Por eso los VALORES de los
 *     factores son los de la muestra y solo la TENDENCIA mira el historial.
 *   - `analyzeTrend` empieza con `if (history.length < 3) return 'stable'`, pero esa
 *     guarda es REDUNDANTE: con menos de 3 muestras `values[2]` es undefined, la
 *     resta da NaN y todas las comparaciones son falsas. Medido: quitarla entera
 *     deja las 35 pruebas verdes (mutacion equivalente).
 *   - `evaluateAlternativeProviderOption` calcula la puntuacion del proveedor actual
 *     y la TIRA (sentencia muerta); `generateJustification` ordena `factors` EN
 *     SITIO, asi que reordena el `influencingFactors` que se guarda en la decision.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    DecisionEngine,
    DEFAULT_DECISION_CONFIG,
    FactorEvaluator,
    getDecisionEngine,
    getRecentAutonomousDecisions,
    setDecisionEngineFactory,
    startGlobalDecisionEngine,
    stopGlobalDecisionEngine,
    type AutonomousDecision,
    type DecisionAction,
    type DecisionFactor,
} from '../src/core/autonomy/decisionEngine.js';
import { onAutonomyEvent, type AutonomyEvent } from '../src/core/autonomy/autonomyEvents.js';
import { STORAGE_KEYS } from '../src/core/config/appConfig.js';
import {
    AI_PROVIDER_IDS,
    AUTONOMY_THRESHOLD_DEFAULTS,
    DEFAULT_AI_FALLBACK_ORDER,
    DEFAULT_AI_PROVIDER,
} from '../src/core/config/sharedConfig.js';
import { localGet, localRemove, localSet } from '../src/core/storage/localStore.js';

const PESOS = AUTONOMY_THRESHOLD_DEFAULTS.decision;
const CAMBIOS = 'flu-provider-changes';

type Metricas = Parameters<FactorEvaluator['recordProviderMetrics']>[0];

/** Una muestra completa; se sobreescribe lo que interese en cada caso. */
const muestra = (over: Partial<Metricas> = {}): Metricas => ({
    provider: AI_PROVIDER_IDS.OPENROUTER,
    avgResponseTime: 12_000,
    successRate: 0.9,
    costPer1kTokens: 0.075,
    co2Emissions: 1,
    perceivedLatency: 15_000,
    responseQuality: 0.9,
    lastUpdated: 0,
    requestCount: 10,
    ...over,
});

const factor = (factores: DecisionFactor[], nombre: string): DecisionFactor => {
    const encontrado = factores.find((f) => f.name === nombre);
    if (!encontrado) throw new Error(`sin factor ${nombre}`);
    return encontrado;
};

const decision = (over: Partial<AutonomousDecision> = {}): AutonomousDecision => ({
    type: 'switch_ai_provider',
    selectedOption: `switch_to_${AI_PROVIDER_IDS.GEMINI}`,
    consideredOptions: [],
    influencingFactors: [],
    justification: 'prueba',
    timestamp: Date.now(),
    confidence: 0.9,
    actions: [],
    ...over,
});

const accion = (action: DecisionAction['action'], order: number, params: unknown = {}): DecisionAction =>
    ({ action, order, params }) as DecisionAction;

/** Doble del tomador (la clase real NO se exporta): solo su unico metodo publico. */
const tomador = (impl: () => AutonomousDecision | null) => ({ evaluateAISwitchDecision: vi.fn(impl) });

const motor = (config = {}, maker = tomador(() => null)) =>
    DecisionEngine.create(config, { decisionMaker: maker as never, factorEvaluator: new FactorEvaluator() });

beforeEach(() => {
    localRemove(CAMBIOS);
    localRemove('flu-decisions-today');
    localRemove('flu-autonomous-decisions');
    localRemove(STORAGE_KEYS.AI_PROVIDER);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('FactorEvaluator - puntuacion de proveedores', () => {
    it('un proveedor sin metricas no genera factores', () => {
        expect(new FactorEvaluator().evaluateAIProviderFactors('desconocido')).toEqual([]);
    });

    it('costo y CO2 puntuan AL REVES: el mas barato y el mas limpio sacan 1', () => {
        const evaluador = new FactorEvaluator();

        const openrouter = evaluador.evaluateAIProviderFactors(AI_PROVIDER_IDS.OPENROUTER);
        const gemini = evaluador.evaluateAIProviderFactors(AI_PROVIDER_IDS.GEMINI);

        // Las muestras de config dan a OpenRouter el mejor costo y el mejor CO2.
        expect(factor(openrouter, 'cost').value).toBeCloseTo(1, 6);
        expect(factor(openrouter, 'ecological_impact').value).toBeCloseTo(1, 6);
        expect(factor(gemini, 'cost').value).toBeCloseTo(0, 6);
        expect(factor(gemini, 'ecological_impact').value).toBeCloseTo(0, 6);

        // Tiempo de respuesta tambien invertido: el mas rapido puntua mas alto.
        expect(factor(openrouter, 'response_time').value).toBeGreaterThan(
            factor(gemini, 'response_time').value,
        );

        // Y todo valor queda recortado a [0,1] aunque la muestra se salga de rango.
        for (const f of [...openrouter, ...gemini]) {
            expect(f.value).toBeGreaterThanOrEqual(0);
            expect(f.value).toBeLessThanOrEqual(1);
        }
    });

    it('los pesos son los declarados en la config, no literales sueltos', () => {
        const factores = new FactorEvaluator().evaluateAIProviderFactors(AI_PROVIDER_IDS.OPENROUTER);

        expect(factor(factores, 'response_time').weight).toBe(PESOS.factorWeightResponseTime);
        expect(factor(factores, 'success_rate').weight).toBe(PESOS.factorWeightSuccessRate);
        expect(factor(factores, 'cost').weight).toBe(PESOS.factorWeightCost);
        expect(factor(factores, 'ecological_impact').weight).toBe(PESOS.factorWeightEcological);
        expect(factor(factores, 'response_quality').weight).toBe(PESOS.factorWeightResponseQuality);
    });

    it('sin historial suficiente la tendencia es estable; con 3 muestras habla', () => {
        const evaluador = new FactorEvaluator();

        evaluador.recordProviderMetrics(muestra({ avgResponseTime: 10_000 }));
        evaluador.recordProviderMetrics(muestra({ avgResponseTime: 30_000 }));
        expect(factor(evaluador.evaluateAIProviderFactors(AI_PROVIDER_IDS.OPENROUTER), 'response_time').trend)
            .toBe('stable');

        // Tercera muestra: 10s -> 20s -> 30s empeora en una metrica donde menos es mejor.
        evaluador.recordProviderMetrics(muestra({ avgResponseTime: 30_000 }));
        expect(factor(evaluador.evaluateAIProviderFactors(AI_PROVIDER_IDS.OPENROUTER), 'response_time').trend)
            .toBe('worsening');
    });

    it('en metricas donde MAS es mejor, la subida es la buena', () => {
        const evaluador = new FactorEvaluator();
        for (const tasa of [0.1, 0.5, 0.9]) {
            evaluador.recordProviderMetrics(muestra({ successRate: tasa }));
        }

        expect(factor(evaluador.evaluateAIProviderFactors(AI_PROVIDER_IDS.OPENROUTER), 'success_rate').trend)
            .toBe('improving');
    });

    it('HALLAZGO: los VALORES salen de la muestra de config; solo la tendencia mira el historial', () => {
        const evaluador = new FactorEvaluator();
        for (const tasa of [0.1, 0.5, 0.9]) {
            evaluador.recordProviderMetrics(muestra({ successRate: tasa }));
        }

        const conHistorial = evaluador.evaluateAIProviderFactors(AI_PROVIDER_IDS.OPENROUTER);
        const sinHistorial = new FactorEvaluator().evaluateAIProviderFactors(AI_PROVIDER_IDS.OPENROUTER);

        expect(conHistorial.map((f) => f.value)).toEqual(sinHistorial.map((f) => f.value));
        expect(factor(conHistorial, 'success_rate').trend).toBe('improving');
        expect(factor(sinHistorial, 'success_rate').trend).toBe('stable');
    });

    it('la tendencia se mide por la metrica pedida, no por el resto', () => {        const evaluador = new FactorEvaluator();
        for (const calidad of [1, 2, 3]) {
            evaluador.recordProviderMetrics(muestra({
                provider: AI_PROVIDER_IDS.GEMINI,
                responseQuality: calidad,
            }));
        }

        const factores = evaluador.evaluateAIProviderFactors(AI_PROVIDER_IDS.GEMINI);
        expect(factor(factores, 'response_quality').trend).toBe('improving');
        expect(factor(factores, 'response_time').trend).toBe('stable');
    });

    it('evaluateSwitchAIOptions: una opcion por proveedor, ordenadas y con su costo de cambio', () => {
        const opciones = new FactorEvaluator().evaluateSwitchAIOptions(AI_PROVIDER_IDS.OPENROUTER);

        expect(opciones.map((o) => o.option).sort()).toEqual(
            DEFAULT_AI_FALLBACK_ORDER.map((p) => (p === AI_PROVIDER_IDS.OPENROUTER ? `keep_${p}` : `switch_to_${p}`)).sort(),
        );
        for (let i = 1; i < opciones.length; i += 1) {
            expect(opciones[i - 1].expectedValue).toBeGreaterThanOrEqual(opciones[i].expectedValue);
        }

        const actual = opciones.find((o) => o.option === `keep_${AI_PROVIDER_IDS.OPENROUTER}`)!;
        const alternativa = opciones.find((o) => o.option.startsWith('switch_to_'))!;
        expect(actual.implementationCost).toBe(0);
        expect(alternativa.implementationCost).toBe(0.1);
        expect(actual.risks).toHaveLength(2);
        expect(alternativa.risks).toHaveLength(3);
    });

    it('el valor de mantener es la suma ponderada de sus factores', () => {
        const evaluador = new FactorEvaluator();
        const factores = evaluador.evaluateAIProviderFactors(AI_PROVIDER_IDS.OPENROUTER);
        const esperado = factores.reduce((suma, f) => suma + f.value * f.weight, 0);

        const opciones = evaluador.evaluateSwitchAIOptions(AI_PROVIDER_IDS.GEMINI);
        const mantener = opciones.find((o) => o.option === `keep_${AI_PROVIDER_IDS.GEMINI}`)!;

        const factoresGemini = evaluador.evaluateAIProviderFactors(AI_PROVIDER_IDS.GEMINI);
        const esperadoGemini = factoresGemini.reduce((suma, f) => suma + f.value * f.weight, 0);
        expect(mantener.expectedValue).toBeCloseTo(esperadoGemini, 6);
        expect(esperado).toBeGreaterThan(esperadoGemini);
    });

    it('los cambios recientes de proveedor penalizan la alternativa (0.2 y 0.5)', () => {
        const evaluador = new FactorEvaluator();
        const base = evaluador
            .evaluateSwitchAIOptions(AI_PROVIDER_IDS.OPENROUTER)
            .find((o) => o.option === `switch_to_${AI_PROVIDER_IDS.GEMINI}`)!.expectedValue;

        localSet(CAMBIOS, JSON.stringify([{ from: 'a', to: 'b', timestamp: Date.now(), reason: 'x' }]));
        expect(evaluador.evaluateSwitchAIOptions(AI_PROVIDER_IDS.OPENROUTER)
            .find((o) => o.option === `switch_to_${AI_PROVIDER_IDS.GEMINI}`)!.expectedValue)
            .toBeCloseTo(base - 0.2, 6);

        localSet(CAMBIOS, JSON.stringify(
            Array.from({ length: 3 }, (_, i) => ({ from: 'a', to: 'b', timestamp: Date.now() - i, reason: 'x' })),
        ));
        expect(evaluador.evaluateSwitchAIOptions(AI_PROVIDER_IDS.OPENROUTER)
            .find((o) => o.option === `switch_to_${AI_PROVIDER_IDS.GEMINI}`)!.expectedValue)
            .toBeCloseTo(base - 0.5, 6);
    });

    it('un cambio de hace mas de una hora ya no penaliza', () => {
        const evaluador = new FactorEvaluator();
        const base = evaluador
            .evaluateSwitchAIOptions(AI_PROVIDER_IDS.OPENROUTER)
            .find((o) => o.option === `switch_to_${AI_PROVIDER_IDS.GEMINI}`)!.expectedValue;

        localSet(CAMBIOS, JSON.stringify([
            { from: 'a', to: 'b', timestamp: Date.now() - 3_600_001, reason: 'x' },
        ]));

        expect(evaluador.evaluateSwitchAIOptions(AI_PROVIDER_IDS.OPENROUTER)
            .find((o) => o.option === `switch_to_${AI_PROVIDER_IDS.GEMINI}`)!.expectedValue)
            .toBeCloseTo(base, 6);
    });

    it('historial negativo o basura en el almacen no rompe la evaluacion', () => {
        const evaluador = new FactorEvaluator();
        localSet(CAMBIOS, '[]');
        expect(evaluador.evaluateSwitchAIOptions(AI_PROVIDER_IDS.OPENROUTER)).toHaveLength(
            DEFAULT_AI_FALLBACK_ORDER.length,
        );
    });
});

describe('DecisionEngine - cuando se decide y que se ejecuta', () => {
    it('con el motor apagado no se consulta al tomador', async () => {
        const maker = tomador(() => decision());
        const engine = motor({ enabled: false }, maker);

        expect(await engine.evaluateAndDecide()).toBeNull();
        expect(maker.evaluateAISwitchDecision).not.toHaveBeenCalled();
    });

    it('el proveedor se lee del almacen y, si no hay, del de por defecto', async () => {
        const maker = tomador(() => null);
        const engine = motor({}, maker);

        await engine.evaluateAndDecide();
        expect(maker.evaluateAISwitchDecision).toHaveBeenCalledWith(DEFAULT_AI_PROVIDER);

        localSet(STORAGE_KEYS.AI_PROVIDER, AI_PROVIDER_IDS.GEMINI);
        await engine.evaluateAndDecide();
        expect(maker.evaluateAISwitchDecision).toHaveBeenLastCalledWith(AI_PROVIDER_IDS.GEMINI);
    });

    it('sin decision no hay historial', async () => {
        const engine = motor();

        expect(await engine.evaluateAndDecide()).toBeNull();
        expect(engine.getDecisionHistory()).toEqual([]);
    });

    it('por debajo del umbral la decision se devuelve pero NO se ejecuta ni se registra', async () => {
        const engine = motor({}, tomador(() => decision({ confidence: 0.5 })));

        const resultado = await engine.evaluateAndDecide();

        expect(resultado?.confidence).toBe(0.5);
        expect(engine.getDecisionHistory()).toEqual([]);
        expect(localGet(STORAGE_KEYS.AI_PROVIDER)).toBeNull();
        expect(localGet('flu-autonomous-decisions')).toBeNull();
    });

    it('con confianza suficiente ejecuta las acciones en orden y deja rastro', async () => {
        const eventos: AutonomyEvent[] = [];
        const baja = onAutonomyEvent((e) => eventos.push(e));
        const engine = motor({}, tomador(() => decision({
            confidence: DEFAULT_DECISION_CONFIG.minConfidenceThreshold,
            selectedOption: `switch_to_${AI_PROVIDER_IDS.GEMINI}`,
            // Desordenadas a proposito: el motor debe ordenarlas por `order`.
            actions: [
                accion('record_decision', 3, { decisionType: 'switch_ai_provider', from: 'x', to: 'y', timestamp: 1 }),
                accion('notify_system', 2, { message: 'cambio', type: 'warning' }),
                accion('update_provider_config', 1, {
                    newProvider: AI_PROVIDER_IDS.GEMINI,
                    oldProvider: AI_PROVIDER_IDS.OPENROUTER,
                }),
            ],
        })));

        try {
            await engine.evaluateAndDecide();
        } finally {
            baja();
        }

        // 1) La configuracion del proveedor cambia y se registra el cambio.
        expect(localGet(STORAGE_KEYS.AI_PROVIDER)).toBe(AI_PROVIDER_IDS.GEMINI);
        const cambios = JSON.parse(localGet(CAMBIOS)!);
        expect(cambios).toHaveLength(1);
        expect(cambios[0]).toMatchObject({
            from: AI_PROVIDER_IDS.OPENROUTER,
            to: AI_PROVIDER_IDS.GEMINI,
            reason: 'autonomous_decision',
        });

        // 2) Sale por el bus central de autonomia, con nivel derivado del tipo.
        expect(eventos.map((e) => e.type)).toEqual(['ai-provider-changed', 'system-notification']);
        expect(eventos[0].level).toBe('info');
        expect(eventos[1].level).toBe('warning');

        // 3) Queda el registro persistido y en el historial del motor.
        const persistidas = JSON.parse(localGet('flu-autonomous-decisions')!);
        expect(persistidas).toHaveLength(1);
        expect(typeof persistidas[0].executedAt).toBe('number');
        expect(engine.getDecisionHistory()).toHaveLength(1);
        expect(engine.getRecentDecisions(5)).toHaveLength(1);
    });

    it('el historial se devuelve como copia y getRecentDecisions va del mas nuevo al mas viejo', async () => {
        let n = 0;
        const engine = motor({}, tomador(() => decision({ confidence: 0.99, selectedOption: `switch_${(n += 1)}` })));

        await engine.evaluateAndDecide();
        await engine.evaluateAndDecide();

        const copia = engine.getDecisionHistory();
        copia.pop();
        expect(engine.getDecisionHistory()).toHaveLength(2);
        expect(engine.getRecentDecisions().map((d) => d.selectedOption)).toEqual(['switch_2', 'switch_1']);
        expect(engine.getRecentDecisions(1).map((d) => d.selectedOption)).toEqual(['switch_2']);
    });

    it('el historial en memoria se recorta a 50 decisiones', async () => {
        const engine = motor({}, tomador(() => decision({ confidence: 1 })));

        for (let i = 0; i < 51; i += 1) await engine.evaluateAndDecide();

        expect(engine.getDecisionHistory()).toHaveLength(50);
    });

    it('clearDecisionHistory vacia el historial sin tocar lo persistido', async () => {
        const engine = motor({}, tomador(() => decision({
            confidence: 1,
            actions: [accion('record_decision', 1, {
                decisionType: 'switch_ai_provider',
                from: AI_PROVIDER_IDS.OPENROUTER,
                to: AI_PROVIDER_IDS.GEMINI,
                timestamp: 1,
            })],
        })));
        await engine.evaluateAndDecide();

        engine.clearDecisionHistory();

        expect(engine.getDecisionHistory()).toEqual([]);
        expect(JSON.parse(localGet('flu-autonomous-decisions')!)).toHaveLength(1);
    });

    it('una accion desconocida solo avisa y no corta las demas', async () => {
        const aviso = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const engine = motor({}, tomador(() => decision({
            actions: [
                accion('inventada' as DecisionAction['action'], 1),
                accion('update_provider_config', 2, {
                    newProvider: AI_PROVIDER_IDS.GEMINI,
                    oldProvider: AI_PROVIDER_IDS.OPENROUTER,
                }),
            ],
        })));

        await engine.evaluateAndDecide();

        // Se comprueba ANTES de restaurar: mockRestore tambien borra el registro.
        expect(aviso).toHaveBeenCalledTimes(1);
        expect(localGet(STORAGE_KEYS.AI_PROVIDER)).toBe(AI_PROVIDER_IDS.GEMINI);
        aviso.mockRestore();
    });

    it('el historial de cambios de proveedor se recorta a 100', async () => {
        const engine = motor({}, tomador(() => decision({
            actions: [accion('update_provider_config', 1, {
                newProvider: AI_PROVIDER_IDS.GEMINI,
                oldProvider: AI_PROVIDER_IDS.OPENROUTER,
            })],
        })));
        localSet(CAMBIOS, JSON.stringify(
            Array.from({ length: 100 }, (_, i) => ({ from: 'a', to: 'b', timestamp: i, reason: 'x' })),
        ));

        await engine.evaluateAndDecide();

        const cambios = JSON.parse(localGet(CAMBIOS)!);
        expect(cambios).toHaveLength(100);
        expect(cambios[0].timestamp).toBe(1); // el mas antiguo cayo
        expect(cambios.at(-1).to).toBe(AI_PROVIDER_IDS.GEMINI);
    });

    it('getConfig y updateConfig trabajan sobre una copia (no se contaminan desde fuera)', () => {
        const engine = motor();

        const config = engine.getConfig();
        config.maxDecisionsPerDay = 99;

        expect(engine.getConfig().maxDecisionsPerDay).toBe(DEFAULT_DECISION_CONFIG.maxDecisionsPerDay);
        engine.updateConfig({ verboseLogging: true });
        expect(engine.getConfig().verboseLogging).toBe(true);
        expect(engine.getConfig().enabled).toBe(DEFAULT_DECISION_CONFIG.enabled);
    });

    it('recordProviderMetrics alimenta al evaluador del motor', () => {
        const evaluador = new FactorEvaluator();
        const engine = DecisionEngine.create({}, {
            decisionMaker: tomador(() => null) as never,
            factorEvaluator: evaluador,
        });

        for (const ms of [30_000, 20_000, 1_000]) {
            engine.recordProviderMetrics(AI_PROVIDER_IDS.OPENROUTER, { avgResponseTime: ms });
        }

        expect(factor(evaluador.evaluateAIProviderFactors(AI_PROVIDER_IDS.OPENROUTER), 'response_time').trend)
            .toBe('improving');
    });
});

describe('DecisionEngine - con el tomador REAL (DecisionMaker)', () => {
    it('decide cambiar cuando el proveedor guardado es el peor', async () => {
        localSet(STORAGE_KEYS.AI_PROVIDER, AI_PROVIDER_IDS.GEMINI);
        const engine = DecisionEngine.create();

        const resultado = await engine.evaluateAndDecide();

        expect(resultado).not.toBeNull();
        expect(resultado!.type).toBe('switch_ai_provider');
        expect(resultado!.selectedOption).toBe(`switch_to_${AI_PROVIDER_IDS.OPENROUTER}`);
        expect(resultado!.confidence).toBeGreaterThanOrEqual(DEFAULT_DECISION_CONFIG.minConfidenceThreshold);
        expect(resultado!.justification).toMatch(new RegExp('openrouter.*\\d+% de mejora'));
        expect(resultado!.actions.map((a) => a.action)).toEqual([
            'update_provider_config',
            'notify_system',
            'record_decision',
        ]);
        // Decidir no es opinar: el cambio se aplica y queda apuntado.
        expect(localGet(STORAGE_KEYS.AI_PROVIDER)).toBe(AI_PROVIDER_IDS.OPENROUTER);
        expect(engine.getDecisionHistory()).toHaveLength(1);
    });

    it('con el proveedor optimo guardado no hay nada que decidir', async () => {
        localSet(STORAGE_KEYS.AI_PROVIDER, AI_PROVIDER_IDS.OPENROUTER);

        expect(await DecisionEngine.create().evaluateAndDecide()).toBeNull();
    });

    it('no se vuelve a decidir dentro de los 5 minutos', async () => {
        localSet(STORAGE_KEYS.AI_PROVIDER, AI_PROVIDER_IDS.GEMINI);
        const engine = DecisionEngine.create();

        expect(await engine.evaluateAndDecide()).not.toBeNull();

        // Se vuelve a poner el proveedor peor a proposito: si lo unico que frenara
        // la segunda vuelta fuera "ya cambie", esta prueba no probaria el plazo.
        localSet(STORAGE_KEYS.AI_PROVIDER, AI_PROVIDER_IDS.GEMINI);
        expect(await engine.evaluateAndDecide()).toBeNull();
    });

    it('la histeresis frena el cambio cuando la mejora es pequena', async () => {
        localSet(STORAGE_KEYS.AI_PROVIDER, AI_PROVIDER_IDS.GEMINI);

        // Tres cambios en la ultima hora: la alternativa pierde 0.5 y la mejora
        // (0.55 -> 0.05) ya no supera el 15% exigido.
        localSet(CAMBIOS, JSON.stringify(
            Array.from({ length: 3 }, (_, i) => ({ from: 'a', to: 'b', timestamp: Date.now() - i, reason: 'x' })),
        ));
        expect(await DecisionEngine.create().evaluateAndDecide()).toBeNull();

        // Con un solo cambio reciente (0.2) la mejora vuelve a superar el umbral.
        localSet(CAMBIOS, JSON.stringify([{ from: 'a', to: 'b', timestamp: Date.now(), reason: 'x' }]));
        expect(await DecisionEngine.create().evaluateAndDecide()).not.toBeNull();
    });

    it('el limite diario se lee del almacen y frena la decision numero 11', async () => {
        localSet(STORAGE_KEYS.AI_PROVIDER, AI_PROVIDER_IDS.GEMINI);
        const hoy = new Date().toDateString();

        localSet('flu-decisions-today', JSON.stringify({
            date: hoy,
            count: DEFAULT_DECISION_CONFIG.maxDecisionsPerDay,
        }));
        expect(await DecisionEngine.create().evaluateAndDecide()).toBeNull();

        localSet('flu-decisions-today', JSON.stringify({
            date: hoy,
            count: DEFAULT_DECISION_CONFIG.maxDecisionsPerDay - 1,
        }));
        expect(await DecisionEngine.create().evaluateAndDecide()).not.toBeNull();
    });

    it('un contador de otro dia no cuenta y vuelve a empezar en 1', async () => {
        localSet(STORAGE_KEYS.AI_PROVIDER, AI_PROVIDER_IDS.GEMINI);
        localSet('flu-decisions-today', JSON.stringify({ date: 'ayer', count: 10 }));

        expect(await DecisionEngine.create().evaluateAndDecide()).not.toBeNull();

        const contador = JSON.parse(localGet('flu-decisions-today')!);
        expect(contador.count).toBe(1);
        expect(contador.date).toBe(new Date().toDateString());
    });
});

describe('DecisionEngine - el reloj', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    it('el motor apagado no programa nada', () => {
        const maker = tomador(() => null);
        const engine = motor({ enabled: false, evaluationInterval: 1_000 }, maker);

        engine.start();
        vi.advanceTimersByTime(5_000);

        expect(maker.evaluateAISwitchDecision).not.toHaveBeenCalled();
    });

    it('start programa la evaluacion periodica y no duplica el intervalo', () => {
        const maker = tomador(() => null);
        const engine = motor({ evaluationInterval: 1_000 }, maker);

        engine.start();
        engine.start(); // segunda llamada: no debe crear otro reloj
        vi.advanceTimersByTime(1_000);
        expect(maker.evaluateAISwitchDecision).toHaveBeenCalledTimes(1);

        vi.advanceTimersByTime(2_000);
        expect(maker.evaluateAISwitchDecision).toHaveBeenCalledTimes(3);
    });

    it('stop cancela la evaluacion y se puede volver a arrancar', () => {
        const maker = tomador(() => null);
        const engine = motor({ evaluationInterval: 1_000 }, maker);

        engine.start();
        vi.advanceTimersByTime(1_000);
        engine.stop();
        vi.advanceTimersByTime(5_000);
        expect(maker.evaluateAISwitchDecision).toHaveBeenCalledTimes(1);

        engine.start();
        vi.advanceTimersByTime(1_000);
        expect(maker.evaluateAISwitchDecision).toHaveBeenCalledTimes(2);
    });

    it('cambiar el intervalo mientras corre reinicia el reloj', () => {
        const maker = tomador(() => null);
        const engine = motor({ evaluationInterval: 10_000 }, maker);

        engine.start();
        engine.updateConfig({ evaluationInterval: 500 });
        vi.advanceTimersByTime(500);

        expect(maker.evaluateAISwitchDecision).toHaveBeenCalledTimes(1);
    });

    it('un fallo del tomador se registra y el reloj sigue latiendo', async () => {
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const maker = tomador(() => {
            throw new Error('tomador roto');
        });
        const engine = motor({ evaluationInterval: 1_000 }, maker);

        engine.start();
        await vi.advanceTimersByTimeAsync(2_000);

        expect(maker.evaluateAISwitchDecision).toHaveBeenCalledTimes(2);
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });
});

describe('motor global (singleton inyectable)', () => {
    it('la fabrica manda en la primera creacion y despues el singleton ya no cambia', () => {
        const falso = {
            start: vi.fn(),
            stop: vi.fn(),
            getRecentDecisions: vi.fn(() => [] as AutonomousDecision[]),
        };
        setDecisionEngineFactory(() => falso as never);

        const primero = getDecisionEngine();
        expect(primero).toBe(falso);
        expect(getDecisionEngine()).toBe(primero);

        startGlobalDecisionEngine();
        expect(falso.start).toHaveBeenCalledTimes(1);
        stopGlobalDecisionEngine();
        expect(falso.stop).toHaveBeenCalledTimes(1);

        expect(getRecentAutonomousDecisions(2)).toEqual([]);
        expect(falso.getRecentDecisions).toHaveBeenCalledWith(2);

        setDecisionEngineFactory(() => ({ otro: true }) as never);
        expect(getDecisionEngine()).toBe(primero);
    });
});
