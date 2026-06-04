// For more info, see https://github.com/storybookjs/eslint-plugin-storybook#configuration-flat-config-format
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { fixupConfigRules, fixupPluginRules } from '@eslint/compat'
import { FlatCompat } from '@eslint/eslintrc'
import js from '@eslint/js'
import tsParser from '@typescript-eslint/parser'
import reactHooks from 'eslint-plugin-react-hooks'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
// TEMPORARILY DISABLED: storybook plugin has missing dependency
// import storybook from 'eslint-plugin-storybook'
import unusedImportsPlugin from 'eslint-plugin-unused-imports'
import globals from 'globals'

import { mpcSingletonRestrictedSyntax } from './eslint-rules/mpcSingletonSyntax.mjs'

const filePath = fileURLToPath(import.meta.url)
const baseDirectory = path.dirname(filePath)

const compat = new FlatCompat({
  baseDirectory,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
})

export default [
  {
    ignores: [
      // Vendored dependencies and generated build outputs are covered by
      // package/build checks, not source lint.
      '**/node_modules',
      '**/dist',
      '**/dist-electron',
      '**/.rollup.cache',
      '**/coverage',
      // Protobuf TypeScript generated from commondata; edit the proto source
      // and regenerate instead of lint-fixing these outputs by hand.
      '**/*_pb.ts',
      // Legacy MPC test fixtures still need a focused lint rollout because
      // they exercise generated payload shapes and fixture helpers.
      'packages/core/mpc/**/*.test.ts',
      'packages/core/mpc/**/tests/**',
      // wasm-pack emits these bindings; keep them byte-for-byte with the
      // generated artifacts instead of applying repo source rules.
      'packages/lib/dkls/vs_wasm*.{js,d.ts}',
      'packages/lib/mldsa/vs_wasm*.{js,d.ts}',
      'packages/lib/schnorr/vs_schnorr_wasm*.{js,d.ts}',
      'archived/**',
      // WASM files copied by build tools
      '**/public/wallet-core.js',
      '**/public/wallet-core.wasm',
      // Metro symlink+exports shim — CommonJS module.exports required so
      // Metro's resolver can pick it up at runtime. Source lint rules don't
      // apply; this is build-tool plumbing, not application source.
      'packages/sdk/react-native.js',
    ],
  },
  ...fixupConfigRules(
    compat.extends(
      'eslint:recommended',
      'plugin:react/recommended',
      'plugin:@typescript-eslint/recommended',
      'plugin:jsx-a11y/recommended',
      'prettier' // eslint-config-prettier: disables ESLint rules that conflict with Prettier
    )
  ),
  {
    plugins: {
      // react, jsx-a11y and @typescript-eslint are already registered by
      // fixupConfigRules(compat.extends(...)) above — re-declaring them here
      // causes ESLint 10 to throw "Cannot redefine plugin".
      'react-hooks': fixupPluginRules(reactHooks),
      'simple-import-sort': simpleImportSort,
      'unused-imports': fixupPluginRules(unusedImportsPlugin),
      // storybook, // TEMPORARILY DISABLED
    },

    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },

      parser: tsParser,
    },

    settings: {
      react: {
        version: 'detect',
      },
    },

    rules: {
      'react/react-in-jsx-scope': 'off',
      'jsx-a11y/no-autofocus': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': ['off', { allowEmptyObject: true }],

      'unused-imports/no-unused-imports': 'error',

      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
        },
      ],

      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'variable',
          format: ['camelCase', 'PascalCase', 'snake_case', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'allow',
        },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'type'],

      // ESLint 10 added these to recommended; opt-out until codebase adopts them
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
    },
  }, // Override for declaration files where interfaces are required for module augmentation
  {
    files: ['**/*.d.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
  {
    files: ['packages/core/mpc/**/*.ts'],
    ignores: ['**/*.test.ts', '**/*_pb.ts', '**/keysign/tests/**'],
    rules: {
      'simple-import-sort/imports': 'off',
      'simple-import-sort/exports': 'off',
      '@typescript-eslint/consistent-type-definitions': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'off',
      'react-hooks/rules-of-hooks': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'no-restricted-syntax': ['error', ...mpcSingletonRestrictedSyntax],
    },
  },
  {
    files: ['packages/mpc-types/src/**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-definitions': 'off',
      'no-restricted-syntax': ['error', ...mpcSingletonRestrictedSyntax],
    },
  },
  {
    files: ['packages/mpc-native/app.plugin.js'],
    rules: {
      // Expo config plugins are loaded by Node as CommonJS from package roots.
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['packages/mpc-native/src/**/*.ts', 'packages/walletcore-native/src/**/*.ts'],
    rules: {
      // Native bridge declarations mirror external module/interface shapes.
      '@typescript-eslint/consistent-type-definitions': 'off',
    },
  },
  // ...storybook.configs['flat/recommended'], // TEMPORARILY DISABLED
]
