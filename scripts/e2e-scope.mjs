// ============================================================
// e2e-scope - corrida E2E ACOTADA al bloque que se modifico
// ------------------------------------------------------------
// Correr la suite completa cuesta ~19 min y es donde salen los rojos de carga:
// el dev server de Vite compila la app entera en el primer arranque, el timeout
// corta al worker y el fallo se ve como pagina cerrada, no como producto. Eso
// mezcla senales y obliga a repetir la corrida para saber que fallo de verdad.
//
// Aqui se corre SOLO el bloque tocado:
//   - specs e2e modificados en la ronda -> se corren;
//   - ficheros de src/ modificados      -> los specs que el contrato declara
//     responsables de ese fichero (`e2eScope`), porque un cambio de producto sin
//     spec declarado es un hueco que nadie veria.
//
// Y no se permite el hueco silencioso: si un fichero de src/ cambia y no tiene
// spec declarado, esto FALLA y hay que declararlo en `.task/contract.json`.
//
// Limite conocido: el mapa `e2eScope` es una DECLARACION, no un analisis de
// dependencias. Si se declara de menos, se corre de menos; por eso el mapa se
// revisa con el mismo cuidado que el codigo.
// ============================================================

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Decide que specs cubren los cambios de la ronda. Puro: sin git ni ficheros,
 * para poder probarlo con datos fijos.
 */
export function planE2E({ cambios, allow, e2eScope }) {
    const enAlcance = cambios.filter((f) => allow.includes(f));
    const specs = new Set();
    const sinDeclarar = [];
    for (const f of enAlcance) {
        if (f.startsWith('tests/e2e/') && f.endsWith('.spec.ts')) {
            specs.add(f);
            continue;
        }
        if (f.startsWith('src/')) {
            const declarados = e2eScope && e2eScope[f];
            if (!declarados || declarados.length === 0) {
                sinDeclarar.push(f);
                continue;
            }
            for (const s of declarados) specs.add(s);
        }
    }
    return { specs: [...specs].sort(), sinDeclarar: sinDeclarar.sort() };
}

/** Specs del plan que ademas contienen `filtro` (vacio = todos). */
export function filtrarSpecs(specs, filtro) {
    if (!filtro) return specs;
    return specs.filter((s) => s.includes(filtro));
}

function cambiosDesde(base) {
    return execSync('git diff --name-only ' + base, { maxBuffer: 1e8 })
        .toString()
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
}

/**
 * El arranque en frio se paga en `tests/e2e/_globalSetup.ts` (Playwright levanta
 * el dev server y LUEGO corre el globalSetup), asi que aqui no se precalienta:
 * antes de lanzar Playwright no hay nada escuchando.
 */
async function main() {
    const contrato = JSON.parse(readFileSync('.task/contract.json', 'utf8'));
    const cambios = cambiosDesde(contrato.base);
    const { specs, sinDeclarar } = planE2E({
        cambios,
        allow: contrato.allow || [],
        e2eScope: contrato.e2eScope || {},
    });

    console.log('[e2e-scope] ficheros cambiados en alcance: ' + cambios.length);
    if (sinDeclarar.length) {
        console.error(
            '[e2e-scope] src/ cambiado SIN spec declarado (no se corre a ciegas):\n  ' +
                sinDeclarar.join('\n  ') +
                '\n  Declara en .task/contract.json -> e2eScope ("<fichero>": ["<spec>"])',
        );
        process.exit(1);
    }
    const argFiltro = process.argv.find((a) => a.startsWith('--filter='));
    const filtro = argFiltro ? argFiltro.slice('--filter='.length) : '';
    const aCorrer = filtrarSpecs(specs, filtro);
    if (!aCorrer.length) {
        console.log(
            '[e2e-scope] sin specs que correr' + (filtro ? ' para el filtro "' + filtro + '"' : '') + '.',
        );
        return;
    }
    console.log('[e2e-scope] specs del bloque:\n  ' + aCorrer.join('\n  '));
    if (!process.argv.includes('--run')) {
        console.log('[e2e-scope] (dry-run; añade --run para ejecutarlos)');
        return;
    }
    try {
        execSync('npx playwright test ' + aCorrer.join(' ') + ' --workers=1', {
            stdio: 'inherit',
        });
    } catch (e) {
        // El fallo del spec ES el resultado: se propaga el codigo, sin stack.
        const code = typeof e.status === 'number' ? e.status : 1;
        console.error('[e2e-scope] el bloque fallo (playwright exit ' + code + ')');
        process.exit(code);
    }
}

if (process.argv[1] && process.argv[1].endsWith('e2e-scope.mjs')) main();
