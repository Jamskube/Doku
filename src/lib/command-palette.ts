// Filtrage et classement de la palette de commandes (module pur, testé).

export interface PaletteCommand {
  id: string
  label: string
  group: string
  icon: string
  kbd?: string
  /** Synonymes cherchables, jamais affichés (« dark » pour « Thème : Sombre »). */
  keywords?: string
  run: () => void | Promise<void>
}

export interface PaletteGroup {
  group: string
  items: PaletteCommand[]
}

// Accents et casse ignorés : « theme » trouve « Thème », « echap » trouve « Échap ».
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const isBoundary = (char: string | undefined) => char === undefined || /[\s\-/(«:.]/.test(char)

/**
 * 0 = aucune correspondance. Sous-chaîne d'abord (début > début de mot > milieu, la plus
 * précoce gagne), puis sous-séquence (« msrc » → « Mode source ») : les lettres consécutives
 * et les débuts de mot valent plus que les lettres dispersées.
 */
export function matchScore(query: string, text: string): number {
  const q = fold(query.trim())
  if (!q) return 1
  const t = fold(text)
  const at = t.indexOf(q)
  if (at === 0) return 1000 - t.length
  // Un début de mot plus loin bat une occurrence en milieu de mot plus tôt (« e » → « exporter »).
  for (let word = at; word >= 0; word = t.indexOf(q, word + 1)) {
    if (isBoundary(t[word - 1])) return 800 - word
  }
  if (at > 0) return 600 - at
  let score = 0
  let from = 0
  let prev = -2
  for (const char of q.replace(/\s+/g, '')) {
    const found = t.indexOf(char, from)
    if (found < 0) return 0
    score += found === prev + 1 ? 5 : isBoundary(t[found - 1]) ? 4 : 1
    prev = found
    from = found + 1
  }
  return 100 + score
}

/** Commandes qui correspondent, de la meilleure à la moins bonne ; à égalité, l'ordre d'origine. */
export function filterCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  if (!query.trim()) return commands
  return commands
    .map((command, index) => {
      const keywordScore = command.keywords ? matchScore(query, command.keywords) * 0.8 : 0
      return { command, index, score: Math.max(matchScore(query, command.label), keywordScore) }
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.command)
}

/** Regroupe sans casser le classement : un groupe se place à la hauteur de sa meilleure commande. */
export function groupCommands(commands: PaletteCommand[]): PaletteGroup[] {
  const groups = new Map<string, PaletteCommand[]>()
  for (const command of commands) {
    const items = groups.get(command.group)
    if (items) items.push(command)
    else groups.set(command.group, [command])
  }
  return [...groups].map(([group, items]) => ({ group, items }))
}
