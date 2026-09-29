import typescriptParser from '@typescript-eslint/parser'
import pluginVue from 'eslint-plugin-vue'

export default [
  ...pluginVue.configs['flat/essential'],
  {
    files: ['apps/web/**/*.vue'],
    languageOptions: {
      parserOptions: { parser: typescriptParser },
    },
    rules: {
      'vue/multi-word-component-names': 'off',
    },
  },
]
