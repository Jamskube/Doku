// UI en Inter Variable (un seul woff2 variable couvre 400-700 — Geist Sans jugée trop
// massive à petite taille). Geist Mono reste pour le code, en variantes LATINES.
// Inter, Source Serif et Material Symbols sont déclarés dans app.css : latin seul pour
// les deux premières, sous-ensemble généré (scripts/subset-icons.mjs) pour la dernière.
import '@fontsource/geist-mono/latin-400.css'
import '@fontsource/geist-mono/latin-500.css'
import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { isTauri, syncSystemBackdrop } from './lib/tauri'

if (isTauri) {
  document.documentElement.dataset.dokuRuntime = 'tauri'
}

const app = mount(App, { target: document.getElementById('app')! })

// La fenêtre naît invisible (tauri.conf.json "visible": false) : on l'affiche une fois
// l'UI montée — plus de flash blanc pendant le parse JS/CSS au boot. Mica doit être
// appliqué AVANT le premier show() : l'ordre inverse peut laisser le DWM composer un
// fond opaque pour toute la session. Best-effort : le fond CSS reste valide sans Mica.
if (isTauri) {
  const show = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      const theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
      try {
        await syncSystemBackdrop(theme)
      } catch {
        // Le fond CSS de repli est déjà prêt ; l'échec natif n'empêche pas l'ouverture.
      }
      await getCurrentWindow().show()
    } catch {
      // API indisponible : la fenêtre restera telle que l'OS l'a créée.
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(() => void show()))
}

export default app
