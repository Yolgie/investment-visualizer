'use strict';

const js = require('@eslint/js');

module.exports = [
  { ignores: ['vendor/'] },
  js.configs.recommended,
  {
    files: ['calculator.js', 'i18n.js', 'app.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        navigator: 'readonly',
        localStorage: 'readonly',
        Intl: 'readonly',
        Chart: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        FileReader: 'readonly',
        alert: 'readonly',
        module: 'writable',
      },
    },
  },
  {
    files: ['test.js', 'test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'writable',
        process: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        setTimeout: 'readonly',
        // referenced inside Playwright page.evaluate() callbacks (run in-browser)
        window: 'readonly',
        document: 'readonly',
      },
    },
  },
  {
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^(I18N|DEFAULT_PARAMS|simulate|simulateScenarios|withDefaults)$' }],
    },
  },
];
