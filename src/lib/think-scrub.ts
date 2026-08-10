// Scrubber AVEC ÉTAT pour les blocs de raisonnement streamés (<think>…</think>) des
// modèles cloud type MiniMax M-series. `reasoning_split` isole normalement la pensée
// dans un champ séparé (ignoré côté Rust) — ceci est la ceinture de sécurité : sans lui,
// Doku-San afficherait son monologue interne.
//
// Règle : seuls les blocs OUVERTS EN TÊTE de réponse (espaces initiaux tolérés, blocs
// enchaînés compris) sont supprimés. Dès le premier caractère visible émis, tout passe
// tel quel — un texte qui MENTIONNE « <think> » plus loin n'est jamais amputé.
// Une balise peut arriver COUPÉE entre deux deltas (« <thi » + « nk>… ») : le préfixe
// ambigu est retenu puis rendu à `flush()` s'il s'avérait être du vrai texte.

const TAGS = ['think', 'thinking', 'reasoning', 'thought'] as const

const OPENERS = TAGS.map((t) => `<${t}>`)

function openerAt(text: string): string | null {
  const lower = text.toLowerCase()
  return OPENERS.find((o) => lower.startsWith(o)) ?? null
}

function isOpenerPrefix(text: string): boolean {
  const lower = text.toLowerCase()
  return OPENERS.some((o) => o.startsWith(lower))
}

export class ThinkScrubber {
  private held = ''
  private openTag: string | null = null
  private done = false
  private stripped = false

  /** Passe un delta du flux ; renvoie le texte VISIBLE à émettre (souvent vide en tête). */
  push(delta: string): string {
    if (this.done) return delta
    let buf = this.held + delta
    this.held = ''
    let out = ''
    for (;;) {
      if (this.openTag) {
        const close = `</${this.openTag}>`
        const at = buf.toLowerCase().indexOf(close)
        if (at === -1) {
          // Fermeture peut-être coupée en fin de buffer : retenir juste ce fragment.
          const keep = Math.min(close.length - 1, buf.length)
          this.held = buf.slice(buf.length - keep)
          return out
        }
        buf = buf.slice(at + close.length)
        this.openTag = null
        continue
      }
      const lead = /^\s*/.exec(buf)![0]
      const rest = buf.slice(lead.length)
      if (rest === '') {
        this.held = buf // que des espaces : on ne sait pas encore ce qui suit
        return out
      }
      const opener = openerAt(rest)
      if (opener) {
        this.openTag = opener.slice(1, -1)
        this.stripped = true
        buf = rest.slice(opener.length)
        continue
      }
      if (isOpenerPrefix(rest)) {
        this.held = buf // début de balise potentiel, coupé par le stream
        return out
      }
      // Premier caractère visible : plus aucun scrub jusqu'à la fin de la réponse.
      // Un bloc a été supprimé juste avant → ses espaces résiduels partent avec lui.
      this.done = true
      return out + (this.stripped ? rest : buf)
    }
  }

  /**
   * Fin du flux : rend le préfixe ambigu retenu (c'était du vrai texte). Un bloc de
   * pensée resté OUVERT est abandonné — l'appelant voit une réponse vide et la traite
   * en échec (jamais de monologue affiché, jamais de suppression silencieuse du tour).
   */
  flush(): string {
    if (this.openTag) return ''
    const rest = this.held
    this.held = ''
    // Résidu blanc après un bloc supprimé : rien de visible à rendre.
    if (this.stripped && rest.trim() === '') return ''
    return rest
  }
}
