import DOMPurify from 'dompurify'

// SanitizeService (architecture) : assainit tout HTML issu de contenu non fiable
// avant l'aperçu (FR-8). Consommé par `html.ts::sandboxDoc`, dont le rendu se fait
// dans un `<iframe sandbox="">` + CSP `default-src 'none'`. La sandbox neutralise
// déjà les scripts et le réseau des sous-ressources ; on ajoute la défense que la
// CSP ne couvre PAS : les vecteurs de **navigation** (beacon phone-home).
//   - `<script>`, handlers `on*`, URLs `javascript:` : retirés par DOMPurify.
//   - `<meta http-equiv=refresh>` / `<base>` : navigation auto → FORBID meta/base.
//   - `<iframe>/<object>/<embed>/<form>/<link>` : conteneurs actifs / réseau → FORBID.
//   - ancres à href externe : navigation au clic → href retiré (voir hook).
// On CONSERVE `<style>` (fidélité du rendu ; le réseau CSS est bloqué par la CSP
// de l'iframe), d'où une allowlist adaptée à ce contexte sandboxé.

// Neutralise la navigation des ancres : un href externe dans l'aperçu = beacon au
// clic (la sandbox bloque le top-nav mais pas la nav du frame lui-même). On ne
// garde que les ancres de fragment (#…) ; les autres deviennent du texte inerte.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    const href = node.getAttribute('href') ?? ''
    if (!href.startsWith('#')) node.removeAttribute('href')
  }
})

export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: ['script', 'meta', 'base', 'iframe', 'object', 'embed', 'form', 'link'],
    ALLOW_DATA_ATTR: false,
  })
}

// Assainit le HTML issu d'une réponse LLM (chat copilote, 14.1) — contenu NON FIABLE rendu
// dans la webview PRINCIPALE (pas l'iframe sandboxée de l'aperçu), dont la CSP n'a pas de
// `default-src` : DOMPurify est ici la garantie de fond du « 0 réseau » (principe 8.3).
// Donc **allowlist stricte** (pas un denylist) : uniquement les balises que `marked` (GFM)
// produit. Tout vecteur réseau — <img>/<video>/<audio>/<source>/<svg><use>/<link>/<input
// src> — est absent de la liste et donc supprimé, robuste aux versions de marked/DOMPurify.
// `style` est hors ALLOWED_ATTR (pas de `background:url(...)`). Le hook module-level
// `afterSanitizeAttributes` ci-dessus s'applique AUSSI ici → les ancres externes perdent
// leur href (liens LLM inertes = pas de navigation/déchargement de la fenêtre principale).
export function sanitizeChatHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: [
      'p', 'br', 'a', 'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'em', 'strong',
      'b', 'i', 'del', 's', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'table', 'thead', 'tbody', 'tr', 'th', 'td', 'input',
    ],
    ALLOWED_ATTR: ['href', 'type', 'checked', 'disabled', 'align'],
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
  })
}
