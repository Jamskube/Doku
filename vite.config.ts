import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// SuperDoc (édition DOCX, ADR-0023) importe ses modules de collaboration temps réel
// pour leur seul effet de bord. Doku est mono-poste et hors ligne : on les aiguille
// vers un talon vide plutôt que d'installer un client websocket que rien n'appelle.
const COLLAB_STUB = fileURLToPath(new URL('./src/lib/stubs/collab-none.ts', import.meta.url))

// Les paquets @fontsource émettent chaque police en .woff2 ET .woff (fallback d'un
// autre âge — WebView2 est un Chromium). Ce plugin retire les .woff du bundle et
// leurs références src dans le CSS : ~250 Ko d'installateur en moins, zéro risque.
function stripWoff1(): Plugin {
  return {
    name: 'doku-strip-woff1',
    generateBundle(_options, bundle) {
      for (const [fileName, asset] of Object.entries(bundle)) {
        if (fileName.endsWith('.woff')) delete bundle[fileName]
        else if (fileName.endsWith('.css') && asset.type === 'asset') {
          asset.source = String(asset.source).replace(/,url\([^)]+\.woff\)\s*format\((["'])woff\1\)/g, '')
        }
      }
    },
  }
}

// Port 1420 = convention Tauri (devUrl dans src-tauri/tauri.conf.json)
export default defineConfig({
  plugins: [svelte(), stripWoff1()],
  clearScreen: false,
  resolve: {
    alias: [
      { find: '@hocuspocus/provider', replacement: COLLAB_STUB },
      { find: 'y-websocket', replacement: COLLAB_STUB },
    ],
  },
  build: {
    // Cible réelle = WebView2 (Chromium evergreen) : pas de transpilation des champs
    // de classe / ??= / etc., ni de polyfill modulepreload (support natif).
    target: 'esnext',
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
  },
  server: {
    port: 1420,
    strictPort: true,
  },
})
