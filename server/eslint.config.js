import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

export default [
  { ignores: ['node_modules/**', 'data/**', 'coverage/**'] },
  ...compat.config({
    env: { node: true, es2022: true },
    parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
    extends: ['eslint:recommended'],
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'prefer-const': 'warn',
      eqeqeq: ['warn', 'smart'],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-control-regex': 'off',
    },
  }),
];
