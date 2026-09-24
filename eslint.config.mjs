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
      // exhaustive-deps: ACTIVA desde P7.4. La deuda se pago (59 -> 0 medido con la
      // regla forzada) y el trinquete de tests/hookDepsRatchet.test.ts la mantiene a
      // cero. Quedan 2 excepciones puntuales (TDZ: helpers declarados debajo) que se
      // desactivan en el propio sitio con el motivo escrito alli.
      'react-hooks/exhaustive-deps': 'warn',
      'eqeqeq': ['warn', 'smart'],
    },
  },
);
