// Nettoyage d'une transcription dictée, porté de Handy (`src-tauri/src/audio_toolkit/text.rs`,
// MIT, © 2025 CJ Pais — voir `src-tauri/resources/licenses/Handy-LICENSE.txt`), puis raccord au
// texte qui précède le curseur.

// Mots de remplissage qui ne sont un vrai mot dans aucune langue, plus « euh » pour le français
// (la transcription est demandée en français). « ah », « eh », « hum » restent : interjections.
const FILLERS = ['uh', 'uhm', 'umm', 'uhh', 'uhhh', 'ehh', 'ehm', 'ahm', 'hmm', 'hm', 'mmm', 'euh', 'euhh', 'heu']
// \b ne connaît pas les lettres accentuées : frontières Unicode explicites.
const FILLER_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${FILLERS.join('|')})(?![\\p{L}\\p{N}])[,.]?`, 'giu')

const opensSentence = (kept: string) => /(^|[.!?…])\s*$/.test(kept)

/** Retire les mots de remplissage ; une majuscule qui ouvrait la phrase passe au mot suivant. */
export function removeFillers(text: string): string {
  let kept = ''
  let resume = 0
  let capitalOwed = false
  const push = (segment: string) => {
    if (capitalOwed) {
      const i = segment.search(/[\p{L}\p{N}]/u)
      if (i >= 0) {
        capitalOwed = false
        segment = segment.slice(0, i) + segment[i].toUpperCase() + segment.slice(i + 1)
      }
    }
    kept += segment
  }
  for (const m of text.matchAll(FILLER_RE)) {
    push(text.slice(resume, m.index))
    capitalOwed ||= /^\p{Lu}/u.test(m[0]) && opensSentence(kept)
    resume = m.index + m[0].length
  }
  push(text.slice(resume))
  return kept
}

/** Trois répétitions ou plus d'un même mot (« je je je ») n'en gardent qu'une. */
export function collapseStutters(text: string): string {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < words.length; ) {
    const lower = words[i].toLowerCase()
    let n = 1
    if (/^\p{L}+$/u.test(words[i])) while (words[i + n]?.toLowerCase() === lower) n++
    out.push(words[i])
    i += n >= 3 ? n : 1
  }
  return out.join(' ')
}

export function cleanDictation(text: string): string {
  return collapseStutters(removeFillers(text))
    .replace(/\s+([,.])/g, '$1')
    .replace(/^[\s,.]+/, '')
    .trim()
}

/**
 * Raccorde un morceau dicté au texte qui précède le curseur : espace de liaison, majuscule en
 * début de phrase ou de ligne, minuscule au milieu d'une phrase (le modèle capitalise chaque
 * segment comme s'il était seul).
 */
export function joinDictation(before: string, piece: string): string {
  if (!piece) return ''
  const atStart = /(^|\n)[ \t]*([-*+>]|\d+[.)]|#{1,6})?[ \t]*$/.test(before)
  const sentence = atStart || /[.!?…][)"»”]?\s*$/.test(before)
  // Un mot en capitales (sigle) ou un « I » anglais garde sa casse.
  const keepCase = /^\p{Lu}[\p{Lu}\p{N}]+\b/u.test(piece)
  const first = sentence || keepCase ? piece[0].toUpperCase() : piece[0].toLowerCase()
  const body = first + piece.slice(1)
  const glue = before === '' || /\s$/.test(before) || /^[,.;:!?)]/.test(piece) ? '' : ' '
  return glue + body
}
