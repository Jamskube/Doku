// Lecture et réécriture du TEXTE dans le flux de contenu d'une page PDF.
//
// C'est le cœur de l'édition « en place » : un PDF affiche son texte par des opérateurs
// (`Tj`, `TJ`, `'`, `"`) dont l'argument n'est pas du texte mais une suite de codes de
// glyphes propres à la police. Remplacer ces codes par d'autres codes de la MÊME police
// change le texte affiché **sans toucher à rien d'autre** — ni la police, ni la taille,
// ni la couleur, ni la position, ni la justification. Rien n'est « préservé » par
// effort : c'est vrai par construction, puisqu'on ne réécrit que l'argument.
//
// Le pont entre codes de glyphes et caractères est la table `ToUnicode` du PDF. On la
// lit dans un sens pour AFFICHER le texte à l'utilisateur, et dans l'autre pour ENCODER
// ce qu'il tape. Un caractère absent du sous-ensemble embarqué ne peut pas être encodé —
// mesuré sur des documents réels : 29 à 73 % de l'alphabet français par police, 78 % en
// union. L'appelant retombe alors sur la réécriture par-dessus (voir `pdf-write.ts`),
// jamais sur un refus.

export type ToUnicode = Map<number, string>
export type FromUnicode = Map<string, number>

/** Table `ToUnicode` d'une police → association code de glyphe → caractère. */
export function parseToUnicode(cmap: string): ToUnicode {
  const table: ToUnicode = new Map()
  const hex = (s: string) => Number.parseInt(s, 16)
  // Les valeurs Unicode sont en UTF-16BE : une suite de groupes de 4 chiffres hexa.
  const decodeUtf16 = (s: string) => {
    let out = ''
    for (let i = 0; i + 4 <= s.length; i += 4) out += String.fromCharCode(hex(s.slice(i, i + 4)))
    return out
  }
  for (const bloc of cmap.match(/beginbfchar([\s\S]*?)endbfchar/g) ?? []) {
    for (const [, code, uni] of bloc.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      table.set(hex(code), decodeUtf16(uni))
    }
  }
  for (const bloc of cmap.match(/beginbfrange([\s\S]*?)endbfrange/g) ?? []) {
    // Forme « plage » : <début> <fin> <premier unicode>, incrémenté sur la plage.
    for (const [, debut, fin, uni] of bloc.matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const base = hex(uni)
      const premier = hex(debut)
      const dernier = hex(fin)
      // Une plage absurde (fin avant début, ou démesurée) est ignorée plutôt que de
      // faire exploser la table.
      if (dernier < premier || dernier - premier > 65_535) continue
      for (let code = premier; code <= dernier; code++) {
        table.set(code, String.fromCharCode(base + code - premier))
      }
    }
  }
  return table
}

/** Sens inverse : caractère → code de glyphe. Le premier code gagne (ordre stable). */
export function invertToUnicode(table: ToUnicode): FromUnicode {
  const inverse: FromUnicode = new Map()
  for (const [code, texte] of table) {
    // Une entrée peut viser une ligature (« ﬁ ») : on n'indexe que les caractères
    // simples, sinon on encoderait deux lettres avec un seul glyphe par erreur.
    if (texte.length === 1 && !inverse.has(texte)) inverse.set(texte, code)
  }
  return inverse
}

/** Chaîne PostScript (entre parenthèses) → octets. */
export function decodePdfString(source: string): number[] {
  const out: number[] = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '\\') {
      out.push(source.charCodeAt(i) & 0xff)
      continue
    }
    const suite = source.slice(i + 1)
    const octal = /^[0-7]{1,3}/.exec(suite)
    if (octal) {
      out.push(Number.parseInt(octal[0], 8) & 0xff)
      i += octal[0].length
      continue
    }
    const echappes: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 }
    const c = suite[0]
    if (c === undefined) break
    if (c === '\n') { i += 1; continue } // continuation de ligne : rien à émettre
    out.push(c in echappes ? echappes[c] : source.charCodeAt(i + 1) & 0xff)
    i += 1
  }
  return out
}

/** Octets → chaîne PostScript échappée, prête à réinsérer entre parenthèses. */
export function encodePdfString(octets: number[]): string {
  let out = ''
  for (const octet of octets) {
    if (octet === 40 || octet === 41 || octet === 92) out += `\\${String.fromCharCode(octet)}`
    else if (octet >= 32 && octet <= 126) out += String.fromCharCode(octet)
    else out += `\\${octet.toString(8).padStart(3, '0')}`
  }
  return out
}

export interface PdfGlyphCodec {
  /** Nombre d'octets par code : 2 pour les polices Type0 `Identity-H`, 1 sinon. */
  bytes: 1 | 2
  toUnicode: ToUnicode
  fromUnicode: FromUnicode
}

export function decodeGlyphs(octets: number[], codec: PdfGlyphCodec): string {
  let texte = ''
  if (codec.bytes === 2) {
    for (let i = 0; i + 1 < octets.length; i += 2) {
      texte += codec.toUnicode.get((octets[i] << 8) | octets[i + 1]) ?? ''
    }
  } else {
    for (const octet of octets) texte += codec.toUnicode.get(octet) ?? ''
  }
  return texte
}

export interface EncodeResult {
  octets: number[]
  /** Caractères que la police embarquée ne sait pas écrire — jamais silencieux. */
  manquants: string[]
}

export function encodeGlyphs(texte: string, codec: PdfGlyphCodec): EncodeResult {
  const octets: number[] = []
  const manquants: string[] = []
  for (const ch of texte) {
    const code = codec.fromUnicode.get(ch)
    if (code === undefined) {
      if (!manquants.includes(ch)) manquants.push(ch)
      continue
    }
    if (codec.bytes === 2) octets.push((code >> 8) & 0xff, code & 0xff)
    else octets.push(code & 0xff)
  }
  return { octets, manquants }
}

export interface PdfTextRunRef {
  /** Position de l'opérateur complet dans le flux, pour un remplacement chirurgical. */
  start: number
  end: number
  /** Nom de ressource de la police active (`/f0`), tel qu'écrit dans le flux. */
  font: string
  /** Texte lu, reconstitué par la table `ToUnicode`. */
  text: string
  /** `TJ` porte des nombres de crénage entre les chaînes ; `Tj` n'en a pas. */
  kind: 'Tj' | 'TJ'
}

// Un opérateur de texte, et le `Tf` qui l'a précédé. On suit `Tf` parce que la police
// active est un ÉTAT du flux : le même `TJ` ne dit pas le même texte selon la police
// posée avant lui.
const OPERATEURS = /\/([A-Za-z0-9_.-]+)\s+[\d.-]+\s+Tf|\[((?:[^\]\\]|\\[\s\S])*)\]\s*TJ|\(((?:[^)\\]|\\[\s\S])*)\)\s*Tj/g

/** Recense les passages de texte d'un flux de contenu, avec leur police et leur lecture. */
export function findTextRuns(flux: string, codecs: Map<string, PdfGlyphCodec>): PdfTextRunRef[] {
  const runs: PdfTextRunRef[] = []
  let police = ''
  OPERATEURS.lastIndex = 0
  for (let m = OPERATEURS.exec(flux); m; m = OPERATEURS.exec(flux)) {
    const [tout, nomPolice, tableau, simple] = m
    if (nomPolice !== undefined) {
      police = nomPolice
      continue
    }
    const codec = codecs.get(police)
    if (!codec) continue
    const morceaux = tableau !== undefined
      ? [...tableau.matchAll(/\(((?:[^)\\]|\\[\s\S])*)\)/g)].map((x) => x[1])
      : [simple ?? '']
    const text = morceaux.map((morceau) => decodeGlyphs(decodePdfString(morceau), codec)).join('')
    if (!text) continue
    runs.push({ start: m.index, end: m.index + tout.length, font: police, text, kind: tableau !== undefined ? 'TJ' : 'Tj' })
  }
  return runs
}

export interface RewriteOutcome {
  flux: string
  applied: number
  /** Remplacements refusés faute de glyphe, avec les caractères en cause. */
  rejected: { text: string; manquants: string[] }[]
}

/**
 * Réécrit des passages dans le flux. Les remplacements sont appliqués de la FIN vers le
 * DÉBUT : sinon le premier décalerait les positions de tous les suivants.
 *
 * Un remplacement dont un caractère manque à la police est REFUSÉ et remonté — jamais
 * écrit partiellement, jamais tu.
 */
export function rewriteTextRuns(
  flux: string,
  codecs: Map<string, PdfGlyphCodec>,
  edits: { run: PdfTextRunRef; text: string }[],
): RewriteOutcome {
  const rejected: RewriteOutcome['rejected'] = []
  const retenus: { run: PdfTextRunRef; remplacement: string }[] = []

  for (const { run, text } of edits) {
    const codec = codecs.get(run.font)
    if (!codec) {
      rejected.push({ text, manquants: [] })
      continue
    }
    const { octets, manquants } = encodeGlyphs(text, codec)
    if (manquants.length) {
      rejected.push({ text, manquants })
      continue
    }
    // On réécrit toujours en `TJ` à une seule chaîne : le crénage d'origine ne
    // s'appliquerait plus au texte neuf, et un tableau à une chaîne reste valide.
    retenus.push({ run, remplacement: `[(${encodePdfString(octets)})]TJ` })
  }

  let sortie = flux
  for (const { run, remplacement } of [...retenus].sort((a, b) => b.run.start - a.run.start)) {
    sortie = sortie.slice(0, run.start) + remplacement + sortie.slice(run.end)
  }
  return { flux: sortie, applied: retenus.length, rejected }
}
