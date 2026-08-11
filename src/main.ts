// UI en Inter Variable (un seul woff2 variable couvre 400-700 — Geist Sans jugée trop
// massive à petite taille). Geist Mono reste pour le code. Source Serif et Material
// Symbols sont déclarés dans app.css : latin seul pour l'un, sous-ensemble généré
// (scripts/subset-icons.mjs) pour l'autre.
import '@fontsource-variable/inter'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { isTauri } from './lib/tauri'

const clamp = (value: number) => Math.min(1, Math.max(0, value))

async function bindChromeMaterialMotion(): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  let pending: { x: number; y: number } | null = null
  let frame = 0

  // Dernières valeurs écrites : écrire ces propriétés héritées à la racine invalide le
  // style de tout le document + repeint le fond plein écran. On ne le paie que si le
  // reflet bouge perceptiblement (~1,5 % de sa course), pas à chaque pixel de fenêtre.
  let lastX = Number.NaN
  let lastY = Number.NaN

  const paint = () => {
    frame = 0
    if (!pending) return
    const scale = window.devicePixelRatio || 1
    const display = screen as Screen & { availLeft?: number; availTop?: number }
    const travelX = Math.max(0, screen.availWidth - window.outerWidth)
    const travelY = Math.max(0, screen.availHeight - window.outerHeight)
    const normalizedX = travelX < 24 ? 0.5 : clamp((pending.x / scale - (display.availLeft ?? 0)) / travelX)
    const normalizedY = travelY < 24 ? 0.5 : clamp((pending.y / scale - (display.availTop ?? 0)) / travelY)

    // La lumière reste fixe dans l'espace : son reflet glisse à l'opposé de la fenêtre.
    const coolX = 68 - normalizedX * 50
    const coolY = 92 - normalizedY * 32
    if (Math.abs(coolX - lastX) < 0.75 && Math.abs(coolY - lastY) < 0.5) return
    lastX = coolX
    lastY = coolY
    document.documentElement.style.setProperty('--chrome-material-cool-x', `${coolX}%`)
    document.documentElement.style.setProperty('--chrome-material-cool-y', `${coolY}%`)
  }

  const unlisten = await getCurrentWindow().onMoved(({ payload }) => {
    pending = payload
    if (!frame) frame = requestAnimationFrame(paint)
  })

  return () => {
    if (frame) cancelAnimationFrame(frame)
    unlisten()
  }
}

let stopChromeMaterialMotion: (() => void) | undefined
if (isTauri) {
  document.documentElement.dataset.dokuRuntime = 'tauri'
  // Effet purement décoratif : différé à l'idle pour ne pas insérer un aller-retour
  // d'import (@tauri-apps/api/window) dans le chemin critique du démarrage.
  const bind = () => void bindChromeMaterialMotion().then((stop) => { stopChromeMaterialMotion = stop })
  if ('requestIdleCallback' in window) requestIdleCallback(bind, { timeout: 2000 })
  else setTimeout(bind, 300)
}

if (import.meta.hot) import.meta.hot.dispose(() => stopChromeMaterialMotion?.())

const app = mount(App, { target: document.getElementById('app')! })

// La fenêtre naît invisible (tauri.conf.json "visible": false) : on l'affiche une fois
// l'UI montée — plus de flash blanc pendant le parse JS/CSS au boot. Double rAF : la
// frame est peinte avant le show. Best-effort (jamais bloquant) ; en cas d'erreur JS
// plus haut, mount aurait déjà lancé — le catch garde une fenêtre visible quoi qu'il
// arrive tant que ce module s'exécute.
if (isTauri) {
  const show = async () => {
    try {
      const { getCurrentWindow } = await import('@tauri-apps/api/window')
      await getCurrentWindow().show()
    } catch {
      // API indisponible : la fenêtre restera telle que l'OS l'a créée.
    }
  }
  requestAnimationFrame(() => requestAnimationFrame(() => void show()))
}

export default app
