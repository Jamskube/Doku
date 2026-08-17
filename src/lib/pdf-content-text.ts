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
  rejected: { text: string; manquants: string[]; group?: number }[]
}

/**
 * Réécrit des passages dans le flux. Les remplacements sont appliqués de la FIN vers le
 * DÉBUT : sinon le premier décalerait les positions de tous les suivants.
 *
 * Un remplacement dont un caractère manque à la police est REFUSÉ et remonté — jamais
 * écrit partiellement, jamais tu.
 *
 * **`group` rend la modification d'UNE ligne atomique.** Sans lui, chaque passage était
 * jugé seul, et la modification d'une ligne multi-passages pouvait s'écrire À MOITIÉ :
 * `planLineEdit` porte le texte neuf par le premier passage touché et VIDE les suivants
 * (`text: ''`) ; si le premier était refusé faute de glyphe — une apostrophe courbe, un
 * accent absent du sous-ensemble — les passages vides, eux, s'encodaient parfaitement et
 * partaient à l'écriture. Résultat : la correction n'était pas écrite, la FIN DE LA LIGNE
 * disparaissait du document, et `applied` valant 1 le rapport annonçait un succès.
 * Les passages d'un même groupe partagent donc leur sort ; deux lignes différentes
 * restent indépendantes.
 */
export function rewriteTextRuns(
  flux: string,
  codecs: Map<string, PdfGlyphCodec>,
  edits: RunEdit[],
): RewriteOutcome {
  const rejected: RewriteOutcome['rejected'] = []
  const candidats: { run: PdfTextRunRef; remplacement: string; groupe: number }[] = []
  // Sans `group`, chaque édition est son propre groupe — les appelants qui ne visent
  // qu'un passage isolé gardent exactement l'ancien comportement.
  const groupeDe = (edit: RunEdit, rang: number) => edit.group ?? -1 - rang
  const condamnes = new Set<number>()

  edits.forEach((edit, rang) => {
    const { run, text } = edit
    const groupe = groupeDe(edit, rang)
    const codec = codecs.get(run.font)
    if (!codec) {
      rejected.push({ text, manquants: [], group: edit.group })
      condamnes.add(groupe)
      return
    }
    const { octets, manquants } = encodeGlyphs(text, codec)
    if (manquants.length) {
      rejected.push({ text, manquants, group: edit.group })
      condamnes.add(groupe)
      return
    }
    // On réécrit toujours en `TJ` à une seule chaîne : le crénage d'origine ne
    // s'appliquerait plus au texte neuf, et un tableau à une chaîne reste valide.
    candidats.push({ run, remplacement: `[(${encodePdfString(octets)})]TJ`, groupe })
  })

  const retenus = candidats.filter((c) => !condamnes.has(c.groupe))

  let sortie = flux
  for (const { run, remplacement } of [...retenus].sort((a, b) => b.run.start - a.run.start)) {
    sortie = sortie.slice(0, run.start) + remplacement + sortie.slice(run.end)
  }
  return { flux: sortie, applied: retenus.length, rejected }
}

// --- Lignes composées de PLUSIEURS passages ----------------------------------------
// Une ligne affichée mêle souvent les styles : « remplace est dans » + « le nombre »
// en gras + « des mécanismes… ». Le flux la porte donc en plusieurs opérateurs. Exiger
// qu'UN passage égale toute la ligne laissait 31 % des lignes sans champ de saisie.

export interface PdfLineRuns {
  text: string
  runs: PdfTextRunRef[]
}

/**
 * Regroupe les passages en lignes, en suivant les textes de lignes attendus.
 * Consomme les passages dans l'ordre : c'est le même ordre que celui du rendu, donc
 * l'appariement est déterministe — et il le restera à la réécriture.
 */
export function groupRunsIntoLines(runs: PdfTextRunRef[], lineTexts: string[]): PdfLineRuns[] {
  const out: PdfLineRuns[] = []
  const utilise = new Array<boolean>(runs.length).fill(false)

  // On CHERCHE la suite correspondante au lieu de l'exiger séquentielle : l'ordre du
  // flux est l'ordre de DESSIN, celui des lignes est l'ordre de LECTURE, et les deux
  // divergent dès qu'un document a des colonnes, des encadrés ou des notes. Exiger la
  // séquence faisait chuter la couverture à 18 % sur un document réel.
  for (const attendu of lineTexts) {
    if (!attendu) continue
    let trouve: PdfTextRunRef[] | null = null
    for (let depart = 0; depart < runs.length && !trouve; depart++) {
      if (utilise[depart] || !attendu.startsWith(runs[depart].text) || !runs[depart].text) continue
      const pris: PdfTextRunRef[] = []
      let assemble = ''
      for (let k = depart; k < runs.length; k++) {
        if (utilise[k]) break
        const suivant = assemble + runs[k].text
        if (!attendu.startsWith(suivant)) break
        pris.push(runs[k])
        assemble = suivant
        if (assemble === attendu) break
      }
      if (assemble === attendu && pris.length) trouve = pris
    }
    if (!trouve) continue
    for (const run of trouve) utilise[runs.indexOf(run)] = true
    out.push({ text: attendu, runs: trouve })
  }
  return out
}

export interface RunEdit {
  run: PdfTextRunRef
  text: string
  /** Passages solidaires : la modification d'UNE ligne réussit ou échoue en entier. */
  group?: number
}

/**
 * Répartit la modification d'une LIGNE sur les passages qui la composent.
 *
 * On isole ce qui a réellement changé (préfixe et suffixe communs) et on ne réécrit que
 * le ou les passages touchés. Une correction d'un mot au milieu d'une ligne laisse donc
 * intacts les passages voisins — c'est ce qui préserve les mots en gras et les extraits
 * de code d'une ligne mixte.
 */
export function planLineEdit(line: PdfLineRuns, nouveau: string): RunEdit[] {
  const ancien = line.text
  if (ancien === nouveau) return []
  if (line.runs.length === 1) return [{ run: line.runs[0], text: nouveau }]

  let debut = 0
  while (debut < ancien.length && debut < nouveau.length && ancien[debut] === nouveau[debut]) debut++
  let fin = 0
  while (
    fin < ancien.length - debut &&
    fin < nouveau.length - debut &&
    ancien[ancien.length - 1 - fin] === nouveau[nouveau.length - 1 - fin]
  ) fin++

  const finAncien = ancien.length - fin
  // Bornes de chaque passage dans le texte de la ligne.
  const bornes: { run: PdfTextRunRef; from: number; to: number }[] = []
  let position = 0
  for (const run of line.runs) {
    bornes.push({ run, from: position, to: position + run.text.length })
    position += run.text.length
  }

  // Une INSERTION pure (ajout sans suppression) donne un intervalle de longueur nulle :
  // aucun passage ne le « chevauche ». On rattache alors le point d'insertion au passage
  // qui le contient — et à la fin de ligne, au dernier. Sans ce cas, un simple ajout en
  // bout de ligne aplatissait toute la ligne dans son premier passage.
  const finReelle = Math.max(finAncien, debut)
  const touches = debut === finReelle
    ? bornes.filter((b) => (debut > b.from && debut <= b.to) || (debut === 0 && b.from === 0))
    : bornes.filter((b) => b.to > debut && b.from < finReelle)
  if (!touches.length) return [{ run: line.runs[0], text: nouveau }]

  const premier = touches[0]
  const dernier = touches[touches.length - 1]
  // Le passage touché reçoit sa part inchangée, plus le texte neuf.
  const avant = ancien.slice(premier.from, debut)
  const apres = ancien.slice(finAncien, dernier.to)
  const remplacement = avant + nouveau.slice(debut, nouveau.length - fin) + apres

  const edits: RunEdit[] = [{ run: premier.run, text: remplacement }]
  // Les autres passages couverts par la modification sont vidés : leur contenu est
  // désormais porté par le premier.
  for (const b of touches.slice(1)) edits.push({ run: b.run, text: '' })
  return edits
}
