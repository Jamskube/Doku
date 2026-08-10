// Sauvegarde d'une réponse de Doku-San en note .md — couche PURE (nommage + contenu),
// testable sous Node. L'orchestration I/O (écriture, ouverture, explorateur) vit dans
// copilot.svelte.ts::saveMessageAsNote.
import { normalizeNewName } from './explorer'
import { stripCitationMarkers } from './citations'

// Longueur max de la partie « question » du nom de fichier : assez pour reconnaître la
// note dans l'explorateur, jamais un nom-paragraphe.
const NAME_MAX = 40

const FALLBACK_BASE = 'Note Doku-San'

// Base du nom (sans extension ni suffixe) depuis la question posée : caractères interdits
// Windows et sauts de ligne retirés, blancs normalisés, troncature à une frontière de mot,
// jamais de point/espace final (nom inaccessible sous Windows). Question vide → repli.
export function noteFileBase(question: string | null): string {
  const cleaned = (question ?? '')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return FALLBACK_BASE
  let base = cleaned
  if (base.length > NAME_MAX) {
    const cut = base.slice(0, NAME_MAX)
    const lastSpace = cut.lastIndexOf(' ')
    base = (lastSpace > NAME_MAX / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()
  }
  base = base.replace(/[. ]+$/, '')
  return base || FALLBACK_BASE
}

// Nom de fichier complet pour une tentative donnée (1 = sans suffixe, 2 → « (2) »…),
// validé par la même porte que la création manuelle (normalizeNewName ajoute « .md »,
// rejette noms réservés/finales invalides). Un rejet improbable retombe sur le repli.
export function noteFileName(question: string | null, attempt: number): string {
  const base = noteFileBase(question)
  const candidate = attempt > 1 ? `Doku-San — ${base} (${attempt})` : `Doku-San — ${base}`
  const check = normalizeNewName(candidate, 'file')
  const name = check.ok ? check.name : null
  // Une note est TOUJOURS un .md : une question finissant par « …3.pdf » passerait
  // normalizeNewName avec son extension (supportée) — du Markdown écrit dans un fichier
  // .pdf que le viewer tenterait ensuite de rendre (Major de la revue 21.x).
  if (name) return name.endsWith('.md') ? name : `${name.replace(/\.[^.]+$/, '')}.md`
  const fallback = normalizeNewName(attempt > 1 ? `${FALLBACK_BASE} (${attempt})` : FALLBACK_BASE, 'file')
  return fallback.ok ? fallback.name : `${FALLBACK_BASE}.md`
}

export interface NoteMeta {
  // Libellé de la source CAPTURÉ à la fin de la génération (jamais résolu au moment du
  // clic — l'onglet actif a pu changer, la provenance mentirait).
  sourceLabel: string | null
  date: Date
  // Noms de notes du mode dossier (uniques) : annexés en « Passages consultés ».
  sourceNames?: string[]
}

const DATE_FMT = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })

// Contenu de la note : ligne de provenance honnête (sans « d'après » si l'origine n'est
// pas connue avec certitude), réponse débarrassée de ses marqueurs [n] (références
// mortes hors du panneau), et liste des notes consultées quand elle existe.
export function noteContent(answer: string, meta: NoteMeta): string {
  const date = DATE_FMT.format(meta.date)
  const provenance = meta.sourceLabel
    ? `> Note générée par Doku-San le ${date} — d'après « ${meta.sourceLabel} ».`
    : `> Note générée par Doku-San le ${date}.`
  let out = `${provenance}\n\n${stripCitationMarkers(answer).trim()}\n`
  const names = [...new Set(meta.sourceNames ?? [])]
  if (names.length) {
    out += `\nPassages consultés : ${names.map((n) => `« ${n} »`).join(', ')}.\n`
  }
  return out
}
