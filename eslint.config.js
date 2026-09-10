import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['backups/**', 'node_modules/**', '.wrangler/**'] },
  js.configs.recommended,
  {
    files: ['public/**/*.js'],
    languageOptions: { globals: globals.browser, ecmaVersion: 2022, sourceType: 'module' },
    rules: { 'no-unused-vars': 'error' },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js', 'vitest.config.js'],
    languageOptions: { globals: globals.node, ecmaVersion: 2022, sourceType: 'module' },
    rules: { 'no-unused-vars': 'error' },
  },
  {
    files: ['functions/**/*.js'],
    languageOptions: { globals: globals.serviceworker, ecmaVersion: 2022, sourceType: 'module' },
    rules: { 'no-unused-vars': 'error' },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser }, ecmaVersion: 2022, sourceType: 'module' },
    rules: { 'no-unused-vars': 'error' },
  },
];
