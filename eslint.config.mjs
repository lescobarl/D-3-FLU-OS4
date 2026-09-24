import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'tests/**', 'src/dev/**'],
  },
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks,
    },
    rules: {
      'no-unused-vars': 'off',
      'no-undef': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': 'off',
      'react-hooks/rules-of-hooks': 'error',
      // exhaustive-deps: deuda MEDIDA y CONGELADA por P7.4. El numero vive en un solo
      // sitio (plans/ledger.json) y tests/hookDepsRatchet.test.ts lo relee y lo vigila;
      // no se copia aqui a proposito, que un comentario con un numero envejece solo.
      // No se activa mientras lint:eslint use --max-warnings=0: cualquier warn rompe lint.
      'react-hooks/exhaustive-deps': 'off',
      'eqeqeq': ['warn', 'smart'],
    },
  },
);
