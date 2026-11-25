import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const ZOD_MESSAGE =
  "Import z from packages/core/src/zod.ts, not 'zod'. That module sets jitless mode before any schema is built, " +
  "so zod never calls new Function, which the CSP (script-src 'self') blocks and the project forbids.";
const zodImportRule = (allowTypeImports) => [
  'error',
  {
    paths: [{ name: 'zod', message: ZOD_MESSAGE, allowTypeImports }],
    patterns: [{ group: ['zod/*'], message: ZOD_MESSAGE, allowTypeImports }],
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-e2e/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/public/**',
      '.kiro/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx,js,mjs,cjs}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-eval': 'error',
      'no-new-func': 'error',
      '@typescript-eslint/no-restricted-imports': zodImportRule(false),
    },
  },
  {
    // Tests may name zod types (for example z.infer), but must not load zod at runtime.
    files: ['**/*.test.{ts,tsx}', '**/*.e2e.ts', '**/test-support/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-restricted-imports': zodImportRule(true) },
  },
  {
    files: ['packages/core/src/zod.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
  {
    files: ['apps/web/src/features/ingest/**/*.{ts,tsx}'],
    rules: {
      // Notes text must never reach logs or error reports (18.6).
      'no-console': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden in the ingest feature. Render text as plain React text.',
        },
        {
          selector: "Property[key.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is forbidden in the ingest feature. Render text as plain React text.',
        },
      ],
    },
  },
);
