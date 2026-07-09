import DOMPurify from 'dompurify'

// SanitizeService (architecture) : allowlist stricte pour tout HTML issu de
// contenu non fiable (FR-2, sécurité). DOMPurify retire par défaut les <script>,
// les handlers on*, et les URLs javascript: ; on renforce en interdisant les
// conteneurs actifs et les balises réseau/document.
//
// Consommateur principal à venir : la vue HTML (FR-8). Le chemin markdown actuel
// (CodeMirror en contenteditable) n'injecte jamais de HTML — il est sûr par
// construction ; cette primitive garde tout futur rendu HTML sûr par défaut.
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta', 'base'],
    ALLOW_DATA_ATTR: false,
  })
}
