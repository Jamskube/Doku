// Recherche plein-texte (FR-1, story 9.2) — logique pure et testable.
// Décision ADR-0007 : index en mémoire (lit une fois, cherche en mémoire).
// Le matching est une sous-chaîne casse-insensible (pas de regex → pas de ReDoS) ;
// l'I/O (scan dossier + lecture) vit dans tauri.ts, l'orchestration dans le store.

export interface SearchDoc {
  path: string
  name: string
  content: string
  // Copie en minuscules, pré-calculée : le matching casse-insensible ne re-lowercase
  // pas le contenu à chaque requête (c'est ce qui rend la recherche < 2 ms — ADR-0007).
  lower: string
}

export interface SearchHit {
  // Numéro de ligne 1-based (sert au saut vers l'occurrence — story 9.4).
  line: number
  // Colonne 0-based du match DANS la ligne du document (≠ start, qui est relatif au
  // snippet fenêtré) + longueur du terme : position exacte pour le saut/surlignage éditeur.
  col: number
  length: number
  // Extrait de contexte (la ligne, fenêtrée si très longue).
  snippet: string
  // Bornes du terme DANS le snippet, pour le surlignage de l'extrait (start incl., end excl.).
  start: number
  end: number
}

export interface SearchResult {
  path: string
  name: string
  // Nombre total d'occurrences dans le fichier (peut dépasser hits.length).
  count: number
  // Extraits, dédupliqués par ligne, bornés (une ligne = un hit).
  hits: SearchHit[]
}

export function makeSearchDoc(path: string, name: string, content: string): SearchDoc {
  const lower = content.toLowerCase()
  // toLowerCase préserve la longueur pour du texte FR/EN. De rares caractères
  // (ex. U+0130 « İ ») s'allongent en minuscule, ce qui désalignerait les offsets
  // d'extrait/surlignage (indices de `lower` réutilisés sur `content`). Dans ce cas
  // on retombe sur une correspondance casse-sensible pour CE document : les offsets
  // restent garantis exacts (jamais de surlignage faux), au prix de la casse.
  return { path, name, content, lower: lower.length === content.length ? lower : content }
}

// Longueur max d'un extrait ; au-delà on fenêtre autour du match.
const SNIPPET_MAX = 160
const CONTEXT_BEFORE = 40

// Numéro de ligne 1-based de la position `index` (compte les \n avant elle).
function lineAt(content: string, index: number): number {
  let n = 1
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) n++
  return n
}

// Construit un extrait autour d'un match : la ligne entière, ou une fenêtre avec
// ellipses si la ligne dépasse SNIPPET_MAX. `start`/`end` repèrent le terme DANS
// le snippet renvoyé (décalés si un préfixe « … » a été ajouté).
function buildHit(content: string, matchIndex: number, matchLen: number): SearchHit {
  const lineStart = content.lastIndexOf('\n', matchIndex - 1) + 1
  let lineEnd = content.indexOf('\n', matchIndex)
  if (lineEnd < 0) lineEnd = content.length
  const rawLine = content.slice(lineStart, lineEnd)
  const col = matchIndex - lineStart // colonne dans la ligne du document (saut éditeur)
  let snippet = rawLine
  let start = col // offset du terme dans le snippet (peut différer de col si fenêtré)
  if (rawLine.length > SNIPPET_MAX) {
    const winStart = Math.max(0, col - CONTEXT_BEFORE)
    const prefix = winStart > 0 ? '…' : ''
    const winEnd = winStart + SNIPPET_MAX
    const suffix = winEnd < rawLine.length ? '…' : ''
    snippet = prefix + rawLine.slice(winStart, winEnd) + suffix
    start = col - winStart + prefix.length
  }
  return { line: lineAt(content, lineStart), col, length: matchLen, snippet, start, end: start + matchLen }
}

// Cherche `query` (sous-chaîne, casse-insensible) dans tous les documents indexés.
// Renvoie un résultat par fichier correspondant : nombre total d'occurrences +
// extraits dédupliqués par ligne (bornés par maxHitsPerFile). Requête vide → [].
export function searchDocs(
  docs: SearchDoc[],
  query: string,
  opts: { maxHitsPerFile?: number; maxResults?: number } = {},
): SearchResult[] {
  const ql = query.trim().toLowerCase()
  if (!ql) return []
  const maxHits = opts.maxHitsPerFile ?? 3
  const maxResults = opts.maxResults ?? 200
  const results: SearchResult[] = []
  for (const doc of docs) {
    let idx = doc.lower.indexOf(ql)
    if (idx < 0) continue
    let count = 0
    const hits: SearchHit[] = []
    const seenLines = new Set<number>()
    while (idx >= 0) {
      count++
      if (hits.length < maxHits) {
        const hit = buildHit(doc.content, idx, ql.length)
        if (!seenLines.has(hit.line)) {
          seenLines.add(hit.line)
          hits.push(hit)
        }
      }
      idx = doc.lower.indexOf(ql, idx + ql.length)
    }
    results.push({ path: doc.path, name: doc.name, count, hits })
    if (results.length >= maxResults) break
  }
  return results
}
