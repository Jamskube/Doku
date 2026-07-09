import { defineConfig } from 'vitest/config'

// Config dédiée aux tests unitaires (n'utilise pas la config Vite/Svelte de l'app).
// Les tests portent sur des modules TS purs (CodeMirror EditorState = pas de DOM).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
