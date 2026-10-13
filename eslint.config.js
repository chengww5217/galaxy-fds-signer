import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'test/fixtures/**'],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-explicit-any': 'warn',
      // TypeScript already reports undefined identifiers; the base rule does
      // not know about runtime globals such as Headers or crypto.
      'no-undef': 'off',
      // The base rule does not understand TypeScript declaration merging
      // (a const and a type sharing a name); the TS-aware variant does.
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'error',
    },
  },
  prettier,
  {
    // The library must run on Web-standard runtimes (Workers, Edge, browsers).
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['node:*'] }],
      'no-restricted-globals': ['error', 'Buffer', 'process', 'require', '__dirname'],
    },
  },
  {
    // src/enums.ts intentionally pairs a const with a same-named union type
    // (the enum replacement pattern); @typescript-eslint/no-redeclare does
    // not treat variable+type-alias as declaration merging.
    files: ['src/enums.ts'],
    rules: {
      '@typescript-eslint/no-redeclare': 'off',
    },
  },
];
