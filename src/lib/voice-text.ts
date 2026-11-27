// Texte PARLÉ du mode vocal (ADR-0033) : ce que la synthèse de LFM3 doit lire, distinct du texte
// affiché. Elle massacre les chiffres (« salle 212 » → « salle Ludo's Total », spike § 5) mais lit
// parfaitement les nombres écrits en lettres : on verbalise donc tout avant la synthèse, et on
// retire ce qui ne se prononce pas (Markdown, numéros d'extraits).

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize']
const TENS: Record<number, string> = { 2: 'vingt', 3: 'trente', 4: 'quarante', 5: 'cinquante', 6: 'soixante', 8: 'quatre-vingt' }

function below100(n: number, final: boolean): string {
  if (n < 17) return UNITS[n]
  if (n < 20) return `dix-${UNITS[n - 10]}`
  const tens = Math.floor(n / 10)
  const unit = n % 10
  // 70-79 et 90-99 : soixante / quatre-vingt + 10-19.
  if (tens === 7) return unit === 1 ? 'soixante et onze' : `soixante-${below100(10 + unit, final)}`
  if (tens === 9) return `quatre-vingt-${below100(10 + unit, final)}`
  if (unit === 0) return tens === 8 && final ? 'quatre-vingts' : TENS[tens]
  if (unit === 1 && tens !== 8) return `${TENS[tens]} et un`
  return `${TENS[tens]}-${UNITS[unit]}`
}

// `final` : « deux cents », « quatre-vingts » prennent un s, sauf devant « mille ».
function below1000(n: number, final: boolean): string {
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (!hundreds) return below100(rest, final)
  const head = hundreds === 1 ? 'cent' : `${UNITS[hundreds]} cent`
  if (!rest) return hundreds > 1 && final ? `${head}s` : head
  return `${head} ${below100(rest, final)}`
}

/** Entier en toutes lettres (français, jusqu'à 999 milliards). */
export function frenchNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) return String(n)
  if (n === 0) return 'zéro'
  const billions = Math.floor(n / 1e9)
  const millions = Math.floor(n / 1e6) % 1000
  const thousands = Math.floor(n / 1e3) % 1000
  const rest = n % 1000
  const parts: string[] = []
  if (billions) parts.push(`${below1000(billions, true)} milliard${billions > 1 ? 's' : ''}`)
  if (millions) parts.push(`${below1000(millions, true)} million${millions > 1 ? 's' : ''}`)
  if (thousands) parts.push(thousands === 1 ? 'mille' : `${below1000(thousands, false)} mille`)
  if (rest) parts.push(below1000(rest, true))
  return parts.join(' ')
}

function ordinal(n: number): string {
  if (n === 1) return 'premier'
  const words = frenchNumber(n)
  if (words.endsWith('cinq')) return `${words}uième`
  if (words.endsWith('neuf')) return `${words.slice(0, -1)}vième`
  if (words.endsWith('e')) return `${words.slice(0, -1)}ième`
  return `${words}ième`
}

// Partie décimale lue chiffre à chiffre après un zéro de tête (« 0,05 » → « zéro virgule zéro
// cinq »), sinon comme un nombre (« 4,5 » → « quatre virgule cinq »).
function decimal(int: string, frac: string): string {
  const fracWords = frac.startsWith('0') ? [...frac].map((d) => UNITS[+d]).join(' ') : frenchNumber(+frac)
  return `${frenchNumber(+int)} virgule ${fracWords}`
}

const SPACE = '[ \\u00a0\\u202f]'
const NUMBER = `\\d{1,3}(?:${SPACE}\\d{3})+|\\d+`

function readNumber(raw: string): string {
  const [int, frac] = raw.replace(new RegExp(SPACE, 'g'), '').split(/[,.]/)
  return frac ? decimal(int, frac) : frenchNumber(+int)
}

/** Remplace les nombres d'une phrase par des mots (heures, %, €, ordinaux, milliers, décimales). */
export function verbalizeNumbers(text: string): string {
  return text
    .replace(/\b(\d{1,2})\s?(?:h|:)\s?(\d{2})\b/g, (_, h: string, m: string) => `${+h === 1 ? 'une' : frenchNumber(+h)} heure${+h > 1 ? 's' : ''} ${+m ? frenchNumber(+m) : ''}`.trim())
    .replace(/\b(\d{1,2})\s?h\b/g, (_, h: string) => `${+h === 1 ? 'une' : frenchNumber(+h)} heure${+h > 1 ? 's' : ''}`)
    .replace(/\b1(?:er|re|ère)\b/g, (m) => (m === '1er' ? 'premier' : 'première'))
    .replace(/\b(\d+)(?:e|ème)\b/g, (_, n: string) => ordinal(+n))
    .replace(new RegExp(`(${NUMBER})(?:[,.](\\d+))?\\s?%`, 'g'), (_, n: string, f?: string) => `${f ? decimal(n.replace(new RegExp(SPACE, 'g'), ''), f) : readNumber(n)} pour cent`)
    .replace(new RegExp(`(${NUMBER})(?:[,.](\\d+))?\\s?€`, 'g'), (_, n: string, f?: string) => {
      const value = f ? decimal(n.replace(new RegExp(SPACE, 'g'), ''), f) : readNumber(n)
      return `${value} euro${value === 'un' ? '' : 's'}`
    })
    .replace(new RegExp(`(${NUMBER}),(\\d+)`, 'g'), (_, n: string, f: string) => decimal(n.replace(new RegExp(SPACE, 'g'), ''), f))
    .replace(new RegExp(NUMBER, 'g'), (n) => readNumber(n))
}

/** Markdown → texte à prononcer : sans titres, puces, emphase, code, liens ni numéros d'extraits. */
export function stripForSpeech(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\s*\[(?:A?\d+)(?:\s*,\s*A?\d+)*\]/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, '')
    .replace(/\|/g, ', ')
    .replace(/[*_`~]/g, '')
    .replace(/[ \t]+/g, ' ')
}

const comparable = (s: string) => stripForSpeech(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()

/**
 * Réponse-réflexe à du bruit transcrit (radio, conversation voisine) : « je n'ai pas compris »,
 * écho de ce qui a été entendu, ou refus du document alors qu'on ne lui a rien demandé (pas de
 * « ? » : la transcription ponctue les vraies questions). Le mode vocal la retire de la
 * discussion sans la lire : gardé, ce bruit est recopié aux tours suivants et finit attribué
 * au document (banc radio du 27/11).
 */
export function isNoiseReply(heard: string, reply: string, refusal: string): boolean {
  const r = comparable(reply)
  if (!r || r === comparable(heard)) return true
  if (/^(?:pardon |désolé |excuse moi )?(?:je n ai pas|je n ai pas bien|j ai pas) compris/.test(r)) return true
  return !heard.includes('?') && r.startsWith(comparable(refusal))
}

/** Réponse Markdown → phrases verbalisées, prêtes pour la synthèse (une requête par phrase). */
export function speakableSentences(md: string): string[] {
  const sentences: string[] = []
  for (const line of stripForSpeech(md).split(/\n+/)) {
    for (const part of line.split(/(?<=[.!?…])\s+/)) {
      const s = verbalizeNumbers(part.trim()).replace(/\s+/g, ' ').trim()
      if (!/[\p{L}\p{N}]/u.test(s)) continue
      // Une ligne de liste sans ponctuation finale : on la clôt pour une intonation de phrase.
      const closed = /[.!?…:;,]$/.test(s) ? s : `${s}.`
      // Les fragments très courts (« Oui. ») rejoignent la phrase précédente : une requête de
      // synthèse par mot coûterait plus en latence qu'elle ne rapporte.
      if (sentences.length && closed.length < 12) sentences[sentences.length - 1] += ` ${closed}`
      else sentences.push(closed)
    }
  }
  return sentences
}
