// ============================================================
// vozNombreFraseUnDuenoGuard - un dato, un dueno.
// ------------------------------------------------------------
// MEDIDO ANTES DE TOCAR (log del dueno, sesion 02:20-02:42):
//   * 41/41 (y 80/80 medidos) commits con `preReady:false` y `written:""`: el gate
//     `preflight?.ready ? speakerName : ''` tiraba la etiqueta del resolver y la fila
//     quedaba a merced de una SEGUNDA resolucion por TEXTO: dos duenos del nombre.
//   * al cerrar el turno se borraba lo PUBLICADO ("ultima frase") y la zona quedaba en
//     blanco mientras el dueno seguia hablando: flicker.
//   * `pendingFinal` (locucion CONFIRMADA sin fila) se borraba desde TRES sitios por su
//     cuenta: tres duenos del mismo dato.
//   * `conversationMaxAutoSpeakers: 6`: el tope forzaba FUSIONES FALSAS (se pierden
//     voces reales). `srGapCommitMs: 10000`: 10 s de silencio para cerrar.
//
// Corte de la tuberia vieja (2026-10-25): los casos que montaban
// `handleConversationStreamSync` (gate del nombre en el commit y flicker del stream)
// se retiraron con ese flujo. El nombre de la fila del producto lo escribe ahora
// `commitUserTurnRow` y su propiedad "nunca vacia" se mide en
// `vozFilaSiempreConHablanteGuard`. Aqui quedan las reglas que siguen vivas.
// ============================================================
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { clearPendingFinal, createActiveListenState } from '../src/voice/lib/activeListen.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

describe('un dueno del borrado de `pendingFinal` (locucion confirmada sin fila)', () => {
  const SRC = join(process.cwd(), 'src');

  /** Todos los .js/.ts de src (recursivo). */
  function jsFiles(dir: string, acc: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const abs = join(dir, name);
      if (statSync(abs).isDirectory()) jsFiles(abs, acc);
      else if (/\.(js|ts)$/.test(name)) acc.push(abs);
    }
    return acc;
  }

  /** Implementaciones que VACIAN el slot (el dato), no menciones del nombre. */
  function borradoresDePendingFinal(): string[] {
    const re = /\.pendingFinal\s*=\s*(['"])\1/g;
    const out: string[] = [];
    for (const abs of jsFiles(SRC)) {
      const src = readFileSync(abs, 'utf8');
      if (re.test(src)) out.push(join('src', abs.slice(SRC.length + 1)).replace(/\\/g, '/'));
    }
    return out;
  }

  it('un solo sitio vacia el dato (delega en `clearPendingFinal`)', () => {
    const sitios = borradoresDePendingFinal();
    expect(sitios, `el borrado sigue repartido:\n  ${sitios.join('\n  ')}`).toEqual([
      'src/voice/lib/activeListen.js',
    ]);
  });

  it('el detector no es decorativo: reconoce un borrado inyectado fuera del dueno', () => {
    const muestra = "if (ctx.listenState) ctx.listenState.pendingFinal = ''";
    expect(/\.pendingFinal\s*=\s*(['"])\1/.test(muestra)).toBe(true);
    const limpio = "clearPendingFinal(ctx.listenState)";
    expect(/\.pendingFinal\s*=\s*(['"])\1/.test(limpio)).toBe(false);
  });

  it('el dueno devuelve lo descartado y deja el slot vacio', () => {
    const state = createActiveListenState() as { pendingFinal?: string };
    state.pendingFinal = 'vamos a comer del plato';
    expect(clearPendingFinal(state)).toBe('vamos a comer del plato');
    expect(state.pendingFinal).toBe('');
    expect(clearPendingFinal(state)).toBe('');
  });
});

describe('tope de hablantes y silencio de cierre (config del dueno)', () => {
  it('sin tope de etiquetas automaticas: la voz manda, no un numero', () => {
    const tope = Number(FLU_CONFIG.voiceIdentity?.capture?.conversationMaxAutoSpeakers);
    expect(tope, 'un tope bajo fuerza FUSIONES FALSAS (se pierden voces)').toBeGreaterThanOrEqual(99);
  });

  it('silencio de cierre ~3,5 s (no 10 s)', () => {
    const gap = Number(FLU_CONFIG.transcript?.pauseAndWeakAsr?.srGapCommitMs);
    expect(gap).toBeGreaterThan(0);
    expect(gap, 'el cierre por silencio tardaba 10 s').toBeLessThanOrEqual(4000);
  });
});
