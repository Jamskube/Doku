import { describe, expect, it } from 'vitest'
import { isWindowsPlatform, vaultLabel, vaultShortLabel } from './platform'

// Agents utilisateurs réels des deux webviews que Doku pilote.
const WEBVIEW2 = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0'
const WEBKITGTK = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

describe('platform', () => {
  it('reconnaît WebView2 comme Windows', () => {
    expect(isWindowsPlatform(WEBVIEW2)).toBe(true)
    expect(vaultLabel(WEBVIEW2)).toBe('le coffre Windows')
    expect(vaultShortLabel(WEBVIEW2)).toBe('Windows')
  })

  it('reconnaît WebKitGTK comme non-Windows', () => {
    expect(isWindowsPlatform(WEBKITGTK)).toBe(false)
    expect(vaultLabel(WEBKITGTK)).toBe('le trousseau de votre session')
    expect(vaultShortLabel(WEBKITGTK)).toBe('votre session')
  })

  // Le repli doit être le cas GÉNÉRAL, pas le cas Windows : annoncer un coffre Windows
  // à qui n'en a pas est précisément le défaut qu'on corrige. Se tromper dans l'autre
  // sens ne trompe personne — le texte reste vrai « quelque part ».
  it('ne suppose pas Windows quand l’agent est inconnu ou vide', () => {
    expect(isWindowsPlatform('')).toBe(false)
    expect(vaultLabel('')).toBe('le trousseau de votre session')
  })

  it('ne confond pas un chemin contenant « windows » ailleurs que dans le système', () => {
    // « X11; Linux » l'emporte : la casse est ignorée mais le motif reste explicite.
    expect(isWindowsPlatform('Mozilla/5.0 (X11; Linux x86_64) Doku/3.0')).toBe(false)
  })
})
