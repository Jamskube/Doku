// UI en police système (kit Kube). Geist Mono reste pour le code, en variantes LATINES ;
// Source Serif est déclarée dans app.css (latin seul).
import '@fontsource/geist-mono/latin-400.css'
import '@fontsource/geist-mono/latin-500.css'
import './app.css'
import iconSprite from './assets/icons.svg?raw'
import { mount } from 'svelte'
import App from './App.svelte'
import { backgroundModeActive, isTauri, launchedAtStartup, syncSystemBackdrop } from './lib/tauri'

if (isTauri) {
  document.documentElement.dataset.dokuRuntime = 'tauri'
}

// Journal persistant (tauri-plugin-log) : les erreurs non rattrapées et tout
// `console.error`/`console.warn` du frontend partent aussi dans `doku.log`. Best-effort :
// si le plugin manque, l'application tourne comme avant, seule la trace est perdue.
if (isTauri) {
  void import('@tauri-apps/plugin-log').then(({ error, warn }) => {
    const describe = (value: unknown) => value instanceof Error ? (value.stack ?? value.message) : String(value)
    window.addEventListener('error', (event) => void error(`[window] ${event.message} — ${event.filename}:${event.lineno}`))
    window.addEventListener('unhandledrejection', (event) => void error(`[promise] ${describe(event.reason)}`))
    const originalError = console.error.bind(console)
    const originalWarn = console.warn.bind(console)
    console.error = (...args: unknown[]) => { originalError(...args); void error(args.map(describe).join(' ')) }
    console.warn = (...args: unknown[]) => { originalWarn(...args); void warn(args.map(describe).join(' ')) }
  }).catch(() => {})
}

// Sprite Lucide dans le DOM de chaque fenêtre : les <use href="#i-…"> le résolvent sans
// requête réseau (scripts/subset-icons.mjs).
document.body.insertAdjacentHTML('afterbegin', iconSprite)

// Sur un appareil hybride (Surface : écran tactile + Type Cover), `(any-pointer: coarse)`
// est TOUJOURS vrai : le dessin tactile ne peut pas en dépendre. On suit le dernier
// pointeur réellement utilisé ; les changements VISIBLES pour le doigt (rangées plus
// hautes, actions révélées) se posent sous `:root[data-input='touch']`. Défaut : souris.
document.documentElement.dataset.input = 'mouse'
window.addEventListener('pointerdown', (event) => {
  const input = event.pointerType === 'mouse' ? 'mouse' : 'touch'
  if (document.documentElement.dataset.input !== input) document.documentElement.dataset.input = input
}, { capture: true, passive: true })

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
      // Lancée avec la session en mode veille, la fenêtre principale reste masquée — Mica est
      // déjà posé pour son premier affichage : Doku attend dans la zone de notification.
      // Sans icône (création refusée), elle s'affiche quand même.
      const { app: settings, setBackgroundModeSetting } = await import('./lib/stores.svelte')
      if (getCurrentWindow().label === 'main' && settings.backgroundMode && (await launchedAtStartup())) {
        await setBackgroundModeSetting(true)
        if (await backgroundModeActive()) return
      }
      await getCurrentWindow().show()
    } catch {
      // API indisponible : la fenêtre restera telle que l'OS l'a créée.
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(() => void show()))
}

export default app
