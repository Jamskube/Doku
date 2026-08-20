export interface WebCitation {
  n: number
  url: string
  title: string
  snippet?: string
  startIndex?: number
  endIndex?: number
}

interface RawWebCitation {
  url?: unknown
  title?: unknown
  snippet?: unknown
  startIndex?: unknown
  endIndex?: unknown
}

const WEB_MARKER = /\[web:(\d{1,2})\]/g

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

export function normalizeWebCitations(values: readonly unknown[]): WebCitation[] {
  const seen = new Set<string>()
  const citations: WebCitation[] = []
  for (const candidate of values) {
    if (!candidate || typeof candidate !== 'object') continue
    const value = candidate as RawWebCitation
    const url = safeHttpsUrl(value.url)
    if (!url || seen.has(url)) continue
    const startIndex = typeof value.startIndex === 'number' && Number.isFinite(value.startIndex)
      ? Math.max(0, Math.trunc(value.startIndex))
      : undefined
    const endIndex = typeof value.endIndex === 'number' && Number.isFinite(value.endIndex)
      ? Math.max(startIndex ?? 0, Math.trunc(value.endIndex))
      : undefined
    seen.add(url)
    citations.push({
      n: citations.length + 1,
      url,
      title: typeof value.title === 'string' && value.title.trim() ? value.title.trim() : new URL(url).hostname,
      snippet: typeof value.snippet === 'string' && value.snippet.trim() ? value.snippet.trim() : undefined,
      startIndex,
      endIndex,
    })
  }
  return citations
}

export function extractWebCitationsFromMarkdown(markdown: string): WebCitation[] {
  const candidates: RawWebCitation[] = []
  for (const match of markdown.matchAll(/\[([^\]\n]+)\]\((https:\/\/[^)\s]+)\)/g)) {
    candidates.push({ url: match[2], title: match[1] })
  }
  for (const match of markdown.matchAll(/<a\b[^>]*\bhref=["'](https:\/\/[^"']+)["'][^>]*>([^<]*)<\/a>/gi)) {
    candidates.push({ url: match[1], title: match[2] })
  }
  for (const match of markdown.matchAll(/https:\/\/[^\s<>"'`)\]]+/g)) {
    candidates.push({ url: match[0].replace(/[.,;:!?]+$/, '') })
  }
  return normalizeWebCitations(candidates)
}

// Les indices viennent de l'annotation OpenAI. On ajoute notre marqueur APRÈS le passage
// cité sans modifier le texte du modèle ; le marqueur devient un bouton après sanitize.
export function addWebCitationMarkers(markdown: string, citations: readonly WebCitation[]): string {
  const insertions = new Map<number, number[]>()
  for (const citation of citations) {
    if (citation.endIndex == null || citation.startIndex == null || citation.endIndex <= citation.startIndex) continue
    const at = Math.min(Math.max(citation.endIndex, 0), markdown.length)
    const list = insertions.get(at) ?? []
    list.push(citation.n)
    insertions.set(at, list)
  }
  let output = markdown
  for (const [at, numbers] of [...insertions].sort((a, b) => b[0] - a[0])) {
    const markers = [...new Set(numbers)].map((n) => `[web:${n}]`).join('')
    output = `${output.slice(0, at)}${markers}${output.slice(at)}`
  }
  return output
}

function webChipHtml(n: number): string {
  return `<button type="button" class="cop-web-cite" data-web-cite="${n}" aria-label="Ouvrir la source Web ${n}">${n}</button>`
}

// Appelé sur le HTML déjà assaini : seul ce markup constant est injecté.
export function annotateWebCitations(html: string, count: number): string {
  return html.replace(WEB_MARKER, (_whole, raw: string) => {
    const n = Number.parseInt(raw, 10)
    return n >= 1 && n <= count ? webChipHtml(n) : ''
  })
}

export function citedWebCitationNumbers(markdown: string, count: number): Set<number> {
  const cited = new Set<number>()
  for (const match of markdown.matchAll(WEB_MARKER)) {
    const n = Number.parseInt(match[1], 10)
    if (n >= 1 && n <= count) cited.add(n)
  }
  return cited
}

// Les fournisseurs pilotés par Doku citent avec `[web:n]`. OpenAI fournit plutôt
// une plage de caractères sur le texte final. Les deux formes désignent une source
// réellement utilisée et doivent alimenter la même vue « Sources ».
export function visibleWebCitations(markdown: string, citations: readonly WebCitation[]): WebCitation[] {
  const cited = citedWebCitationNumbers(markdown, citations.length)
  return citations.filter((citation) =>
    cited.has(citation.n) ||
    markdown.includes(citation.url) ||
    (
      citation.startIndex != null &&
      citation.endIndex != null &&
      citation.endIndex > citation.startIndex
    ),
  )
}

export function webCitationHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}
