// ============================================================
// appAnalyzer.test.ts — fase estática del análisis de apps (F2)
// ============================================================
// Cubre: detección de framework (react/flutter/other), clasificación
// de archivos de configuración y pantallas, recolección de errores
// (con tope de 40) y la salida heuristic + input.
// ============================================================

import { describe, test, expect } from 'vitest';
import { analyzeAppStructure } from '../src/lib/appAnalyzer';

describe('appAnalyzer — detección de framework', () => {
    test('flutter por archivo pubspec.yaml', () => {
        const result = analyzeAppStructure('MiApp', ['pubspec.yaml', 'lib/main.dart']);
        expect(result.input.framework).toBe('flutter');
        expect(result.heuristic.framework).toBe('flutter');
    });

    test('flutter por marcador de código', () => {
        const result = analyzeAppStructure('MiApp', ['lib/main.dart'], {
            'lib/main.dart': "import 'package:flutter/material.dart';",
        });
        expect(result.input.framework).toBe('flutter');
    });

    test('react por archivos de config y App', () => {
        const result = analyzeAppStructure('MiApp', [
            'package.json',
            'vite.config.ts',
            'src/App.tsx',
            'README.md',
        ]);
        expect(result.input.framework).toBe('react');
    });

    test('react por marcador de import', () => {
        const result = analyzeAppStructure('MiApp', ['src/index.jsx'], {
            'src/index.jsx': 'import React from "react";',
        });
        expect(result.input.framework).toBe('react');
    });

    test('other cuando no hay pistas', () => {
        const result = analyzeAppStructure('MiApp', ['README.md', 'src/helper.py']);
        expect(result.input.framework).toBe('other');
    });
});

describe('appAnalyzer — clasificación de archivos', () => {
    test('detecta archivos de configuración', () => {
        const result = analyzeAppStructure('MiApp', [
            'package.json',
            'vite.config.ts',
            'index.html',
            'src/App.tsx',
            'src/utils.ts',
        ]);
        expect(result.configFiles).toContain('package.json');
        expect(result.configFiles).toContain('vite.config.ts');
        expect(result.configFiles).toContain('index.html');
        expect(result.configFiles).not.toContain('src/App.tsx');
    });

    test('detecta archivos de pantallas', () => {
        const result = analyzeAppStructure('MiApp', [
            'src/HomeScreen.tsx',
            'src/App.tsx',
            'src/utils.ts',
            'package.json',
        ]);
        expect(result.screenFiles).toContain('src/HomeScreen.tsx');
        expect(result.screenFiles).toContain('src/App.tsx');
        expect(result.screenFiles).not.toContain('src/utils.ts');
        expect(result.input.archivos).toEqual(['src/HomeScreen.tsx', 'src/App.tsx']);
    });
});

describe('appAnalyzer — recolección de errores', () => {
    test('detecta marcadores de error en el contenido', () => {
        const result = analyzeAppStructure('MiApp', ['src/a.ts', 'src/b.ts', 'src/c.ts'], {
            'src/a.ts': '// TODO: fix\nconst x = 1;\nconsole.error("boom");',
            'src/b.ts': 'throw new Error("x");',
            'src/c.ts': '// @ts-ignore\n// eslint-disable',
        });
        expect(result.input.errores_detectados.length).toBeGreaterThanOrEqual(5);
        expect(result.input.errores_detectados.some((e) => e.includes('TODO'))).toBe(true);
        expect(result.input.errores_detectados.some((e) => e.includes('console.error'))).toBe(true);
        expect(result.input.errores_detectados.some((e) => e.includes('throw new Error'))).toBe(true);
        expect(result.input.errores_detectados.some((e) => e.includes('@ts-ignore'))).toBe(true);
        expect(result.input.errores_detectados.some((e) => e.includes('eslint-disable'))).toBe(true);
    });

    test('el tope de errores es 40', () => {
        const many = Array.from({ length: 45 }, (_, i) => `console.error("err ${i}");`).join('\n');
        const result = analyzeAppStructure('MiApp', ['src/big.ts'], {
            'src/big.ts': many,
        });
        expect(result.input.errores_detectados).toHaveLength(40);
        expect(result.heuristic.errores_detectados).toHaveLength(40);
    });
});

describe('appAnalyzer — estructura y heuristic', () => {
    test('construye estructura con framework y archivos', () => {
        const result = analyzeAppStructure('MiApp', ['package.json', 'src/Home.tsx', 'src/utils.ts']);
        expect(result.input.estructura).toContain('Framework detectado: react');
        expect(result.input.estructura).toContain('Archivos totales: 3');
    });

    test('usar solo archivos de pantallas cuando existen', () => {
        const result = analyzeAppStructure('MiApp', [
            'src/LoginScreen.tsx',
            'src/HomeScreen.tsx',
            'src/utils.ts',
        ]);
        expect(result.input.archivos).toEqual(['src/LoginScreen.tsx', 'src/HomeScreen.tsx']);
        expect(result.heuristic.pantallas[0].nombre).toBe('LoginScreen.tsx');
    });
});
