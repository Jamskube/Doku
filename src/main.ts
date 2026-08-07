import '@fontsource/geist-sans/300.css'
import '@fontsource/geist-sans/400.css'
import '@fontsource/geist-sans/500.css'
import '@fontsource/geist-sans/600.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/geist-mono/500.css'
import '@fontsource-variable/source-serif-4/opsz.css'
import '@fontsource-variable/source-serif-4/opsz-italic.css'
import 'material-symbols/rounded.css'
import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { isTauri } from './lib/tauri'

const clamp = (value: number) => Math.min(1, Math.max(0, value))

async function bindChromeMaterialMotion(): Promise<() => void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  let pending: { x: number; y: number } | null = null
  let frame = 0

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
    document.documentElement.style.setProperty('--chrome-material-cool-x', `${68 - normalizedX * 50}%`)
    document.documentElement.style.setProperty('--chrome-material-cool-y', `${92 - normalizedY * 32}%`)
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
  void bindChromeMaterialMotion().then((stop) => { stopChromeMaterialMotion = stop })
}

if (import.meta.hot) import.meta.hot.dispose(() => stopChromeMaterialMotion?.())

const app = mount(App, { target: document.getElementById('app')! })

export default app
