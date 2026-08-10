// Citations ancrées (NotebookLM-style) — logique pure et testable.
//
// Deux moitiés :
//  - annotateCitations : transforme les marqueurs [n] d'une réponse (HTML DÉJÀ assaini)
//    en puces cliquables. Post-traitement APRÈS DOMPurify : l'allowlist du sanitizer
//    reste stricte, seul notre propre markup est injecté.
//  - locatePassage : retrouve un passage (texte de chunk RAG) dans le contenu actuel du
//    document → position ligne/colonne pour la révélation éditeur (pendingReveal).
//    Les chunks datent de l'indexation : le fichier a pu changer → recherche par sondes
//    dégressives, null si introuvable (l'appelant ouvre alors juste le fichier).

// Un passage numéroté fourni au modèle — attaché au message pour le clic.
export interface CitedPassage {
  n: number
  path: string | null
  name: string | null
  text: string
}

// Marqueurs reconnus : [2], [1, 3], [1][2]. Bornés à 2 chiffres (jamais 100+ passages).
const MARKER = /\[(\d{1,2}(?:\s*,\s*\d{1,2})*)\]/g

// Découpe l'HTML pour ne JAMAIS réécrire l'intérieur de <code>/<pre> (un [1] dans un
// extrait de code n'est pas une citation).
const CODE_SPLIT = /(<(?:code|pre)\b[^>]*>[\s\S]*?<\/(?:code|pre)>)/gi

function chipHtml(n: number): string {
  return `<button type="button" class="cop-cite" data-cite="${n}" title="Voir le passage ${n}" aria-label="Voir le passage ${n}">${n}</button>`
}

// Remplace les marqueurs valides (1..count) par des puces ; retire les marqueurs
// invalides (numéro halluciné) plutôt que d'afficher un [7] mort. count=0 → retire tout.
export function annotateCitations(html: string, count: number): string {
  return html
    .split(CODE_SPLIT)
    .map((seg, i) => {
      if (i % 2 === 1) return seg // segment code : intact
      return (
        seg
          .replace(MARKER, (whole, list: string) => {
            const nums = list.split(',').map((s) => Number.parseInt(s.trim(), 10))
            const valid = [...new Set(nums.filter((n) => n >= 1 && n <= count))]
            if (valid.length === 0) return ''
            return valid.map(chipHtml).join('')
          })
          // Marqueur retiré en fin de phrase → espace orpheline avant . ou , (jamais
          // correcte en français — « ? » et « ! » prennent l'espace, on n'y touche pas).
          .replace(/ +([.,])/g, '$1')
      )
    })
    .join('')
}

// Numéros d'extraits réellement cités dans une réponse (uniques, bornés à 1..max, triés).
// Sert au pied « Passages cités » du mode document complet : n'afficher que ce que la
// réponse référence (les extraits = tout le document, la liste complète serait du bruit).
export function citedNumbers(content: string, max: number): number[] {
  const out = new Set<number>()
  for (const m of content.matchAll(MARKER)) {
    for (const s of m[1].split(',')) {
      const n = Number.parseInt(s.trim(), 10)
      if (n >= 1 && n <= max) out.add(n)
    }
  }
  return [...out].sort((a, b) => a - b)
}

export interface PassageLocation {
  line: number // 1-based
  col: number // 0-based dans la ligne
  length: number // longueur à surligner
}

// Sondes dégressives : 1re ligne non vide entière → ses 80 premiers caractères → les 40
// premiers. Un chunk commence sur une frontière de paragraphe (chunkText), sa première
// ligne est donc généralement intacte dans le document même après des éditions ailleurs.
export function locateOffset(content: string, passage: string): { index: number; length: number } | null {
  const firstLine = passage
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0)
  if (!firstLine) return null
  const probes = [firstLine]
  if (firstLine.length > 80) probes.push(firstLine.slice(0, 80))
  if (firstLine.length > 40) probes.push(firstLine.slice(0, 40))
  for (const probe of probes) {
    const idx = content.indexOf(probe)
    if (idx >= 0) return { index: idx, length: probe.length }
  }
  return null
}

export function locatePassage(content: string, passage: string): PassageLocation | null {
  const hit = locateOffset(content, passage)
  if (!hit) return null
  let line = 1
  for (let i = 0; i < hit.index; i++) if (content.charCodeAt(i) === 10) line++
  const lineStart = content.lastIndexOf('\n', hit.index - 1) + 1
  return { line, col: hit.index - lineStart, length: hit.length }
}
