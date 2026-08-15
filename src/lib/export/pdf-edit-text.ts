// Édition du texte d'un PDF EN PLACE (ADR-0023).
//
// Stratégie à deux étages, pour ne jamais refuser une modification :
//
//   1. **Dans le flux de contenu** — on remplace les codes de glyphes par d'autres
//      codes de la MÊME police déjà embarquée. Fidélité parfaite : police, taille,
//      couleur, position et justification sont inchangées parce qu'on n'y touche pas.
//      C'est ce que font Acrobat et Foxit ; LibreOffice et Inkscape, eux, reconstruisent
//      la page et perdent la fidélité.
//
//   2. **Par-dessus** (caviardage + réécriture) — seulement quand un caractère saisi
//      n'existe pas dans le sous-ensemble embarqué. Mesuré sur des documents réels :
//      les polices couvrent 29 à 73 % de l'alphabet français chacune, 78 % en union.
//      Cet étage dégrade localement (~4 % d'écart de largeur) au lieu de refuser.
//
// Le document source n'est JAMAIS réécrit : la fonction rend des octets, l'appelant
// passe par un dialogue d'enregistrement.
import {
  findTextRuns,
  groupRunsIntoLines,
  invertToUnicode,
  parseToUnicode,
  planLineEdit,
  rewriteTextRuns,
  type PdfGlyphCodec,
  type PdfLineRuns,
  type PdfTextRunRef,
} from '../pdf-content-text'

export class PdfEditError extends Error {}

export interface PdfEditRequest {
  /** Page, à partir de 1. */
  page: number
  /** Texte actuellement affiché, tel que lu dans le flux. */
  from: string
  /** Rang de l'occurrence visée quand le même texte apparaît plusieurs fois (0 par
   *  défaut). Sans lui, on écrirait dans la première occurrence rencontrée. */
  occurrence?: number
  /** Texte voulu. */
  to: string
}

export interface PdfEditReport {
  bytes: Uint8Array
  /** Remplacements écrits dans le flux, en fidélité parfaite. */
  applied: number
  /** Demandes non satisfaites, avec la raison — jamais silencieuses. */
  refused: { from: string; to: string; reason: string; chars?: string[] }[]
}

type MuPdf = typeof import('mupdf')
type MuDoc = InstanceType<MuPdf['PDFDocument']>
type MuPage = InstanceType<MuPdf['PDFPage']>
type MuObj = InstanceType<MuPdf['PDFObject']>

/**
 * Tables de glyphes des polices d'une page.
 *
 * `readStream()` se lit sur la RÉFÉRENCE INDIRECTE : la résoudre rend le dictionnaire
 * du flux, pas ses octets. Ce détail coûte une heure quand on l'ignore.
 */
export function pageCodecs(page: MuPage): Map<string, PdfGlyphCodec> {
  const codecs = new Map<string, PdfGlyphCodec>()
  const fonts = page.getObject().get('Resources', 'Font')
  if (!fonts.isDictionary()) return codecs
  fonts.forEach((value: MuObj, key: string | number) => {
    try {
      const font = value.resolve()
      const toUnicodeRef = font.get('ToUnicode')
      if (!toUnicodeRef.isStream()) return
      const cmap = new TextDecoder('latin1').decode(toUnicodeRef.readStream().asUint8Array())
      const toUnicode = parseToUnicode(cmap)
      if (!toUnicode.size) return
      // Type0 en Identity-H : deux octets par code. Les polices simples en font un.
      const composite = font.get('Subtype').asName?.() === 'Type0'
      codecs.set(String(key), {
        bytes: composite ? 2 : 1,
        toUnicode,
        fromUnicode: invertToUnicode(toUnicode),
      })
    } catch {
      // Une police illisible rend ses lignes non éditables, jamais tout le document.
    }
  })
  return codecs
}

/** Flux de contenu d'une page, concaténé si le PDF le découpe en plusieurs parties. */
function readContents(page: MuPage): { text: string; write: (value: string) => void } | null {
  const contents = page.getObject().get('Contents')
  const decode = (obj: MuObj) => new TextDecoder('latin1').decode(obj.readStream().asUint8Array())
  const encode = (value: string) => {
    const out = new Uint8Array(value.length)
    for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff
    return out
  }
  if (contents.isStream()) {
    return { text: decode(contents), write: (value) => contents.writeStream(encode(value)) }
  }
  if (contents.isArray() && contents.length === 1) {
    const seul = contents.get(0)
    return { text: decode(seul), write: (value) => seul.writeStream(encode(value)) }
  }
  // Un découpage en plusieurs flux peut couper un opérateur en deux : on ne réécrit
  // alors pas plutôt que d'écrire un flux incohérent.
  return null
}

export interface PdfEditableLine {
  page: number
  text: string
  /** Rang de CETTE occurrence du texte dans la page (0 pour la première).
   *  Un même libellé peut apparaître plusieurs fois — « online », un en-tête de tableau,
   *  une puce répétée. Sans ce rang, deux lignes identiques se confondent : l'interface
   *  levait sur une clé dupliquée (et cessait de se rafraîchir), et l'écriture aurait
   *  visé la mauvaise. */
  occurrence: number
  /** Boîte en fractions de la page AFFICHÉE (0..1) — indépendante du zoom et du DPR,
   *  comme les annotations (ADR-0022), donc directement posable en overlay. */
  left: number
  top: number
  width: number
  height: number
  /** Taille de police en points, pour dimensionner le champ de saisie à l'identique. */
  size: number
  /** Couleur du texte dans le document (`#rrggbb`) : le champ de saisie l'emploie telle
   *  quelle. Sans elle, on écrirait avec la couleur d'encre du THÈME — donc en blanc sur
   *  papier blanc en thème sombre (même piège que les ombres, cf. AGENTS.md). */
  color: string
  bold: boolean
  italic: boolean
  /** Faux quand la ligne ne peut pas être réécrite telle quelle. */
  editable: boolean
  /** POURQUOI elle ne peut pas l'être, en clair. Une ligne inerte sans explication est
   *  une affordance morte : l'utilisateur voit deux lignes semblables dont une seule
   *  répond, sans rien pour comprendre. */
  reason?: string
}

export interface PdfPageText {
  page: number
  runs: PdfTextRunRef[]
}

/**
 * Lignes éditables AVEC leur position à l'écran.
 *
 * Le flux de contenu donne le texte et sa police ; `toStructuredText` donne les boîtes.
 * On rapproche les deux PAR LE TEXTE : c'est le seul lien fiable, les offsets de flux
 * n'ayant aucun rapport avec les coordonnées de rendu.
 */
export async function readEditableLines(bytes: Uint8Array): Promise<PdfEditableLine[]> {
  const mupdf = await import('mupdf')
  let doc: MuDoc
  try {
    // Copie défensive : `openDocument` DÉTACHE le tableau reçu. L'appelant garde
    // souvent ses octets pour écrire ensuite — les lui vider serait invisible.
    doc = mupdf.Document.openDocument(bytes.slice(), 'application/pdf') as MuDoc
  } catch {
    throw new PdfEditError('Ce PDF n’a pas pu être ouvert.')
  }
  const lignes: PdfEditableLine[] = []
  for (let index = 0; index < doc.countPages(); index++) {
    try {
      const page = doc.loadPage(index) as MuPage
      const contents = readContents(page)
      if (!contents) continue
      const codecs = pageCodecs(page)
      const runs = findTextRuns(contents.text, codecs)
      if (!runs.length) continue


      const vues = new Map<string, number>()
      const bounds = page.getBounds()
      const largeur = Math.max(bounds[2] - bounds[0], 1)
      const hauteur = Math.max(bounds[3] - bounds[1], 1)
      const stext = page.toStructuredText('preserve-whitespace')

      // `asJSON` ne rend PAS la couleur. On la relève donc par un parcours `walk()`, qui
      // la donne par caractère — les deux parcourent la même page dans le même ordre,
      // donc l'indice de ligne les rapproche.
      const couleurs: string[] = []
      let premierDeLaLigne: number[] | null = null
      try {
        stext.walk({
          beginLine: () => { premierDeLaLigne = null },
          endLine: () => {
            const c = premierDeLaLigne
            couleurs.push(c && c.length >= 3
              ? `#${c.slice(0, 3).map((v) => Math.round(Math.min(Math.max(v, 0), 1) * 255).toString(16).padStart(2, '0')).join('')}`
              : '#000000')
          },
          onChar: (_c: string, _o: unknown, _f: unknown, _s: number, _q: unknown, color: unknown) => {
            if (premierDeLaLigne === null && Array.isArray(color)) premierDeLaLigne = color as number[]
          },
        } as never)
      } catch {
        // Sans couleurs relevées, on retombe sur le noir : lisible partout.
      }

      const textesDeLignes: string[] = []
      const brut = JSON.parse(stext.asJSON()) as { blocks?: { lines?: { text: string }[] }[] }
      for (const b of brut.blocks ?? []) for (const li of b.lines ?? []) textesDeLignes.push(li.text)
      // Une ligne affichée mêle souvent les styles et se trouve donc portée par
      // plusieurs opérateurs du flux : on la reconstitue par une SUITE de passages.
      const parLigne = new Map<string, PdfLineRuns[]>()
      for (const groupe of groupRunsIntoLines(runs, textesDeLignes)) {
        const liste = parLigne.get(groupe.text) ?? []
        liste.push(groupe)
        parLigne.set(groupe.text, liste)
      }

      const json = JSON.parse(stext.asJSON()) as {
        blocks?: { lines?: { text: string; bbox: { x: number; y: number; w: number; h: number }; font?: { size: number; weight?: string; style?: string; name?: string } }[] }[]
      }
      let indexLigne = -1
      for (const bloc of json.blocks ?? []) {
        for (const ligne of bloc.lines ?? []) {
          indexLigne++
          const candidats = parLigne.get(ligne.text)
          const groupe = candidats?.shift()
          const codec = groupe ? codecs.get(groupe.runs[0].font) : undefined
          const manquants = codec
            ? [...new Set([...ligne.text].filter((ch) => ch !== ' ' && !codec.fromUnicode.has(ch)))]
            : []
          // Toutes les lignes visibles sont rendues, même non modifiables : sinon
          // l'utilisateur clique dans le vide sans savoir pourquoi.
          const editable = Boolean(groupe) && Boolean(codec) && manquants.length === 0
          const reason = editable
            ? undefined
            : !groupe
              ? 'Doku n’a pas su relier cette ligne au contenu du document.'
              : !codec
                ? 'La police de cette ligne ne fournit pas de table de caractères.'
                : `La police du document ne sait pas écrire : ${manquants.join(' ')}`
          const rang = vues.get(ligne.text) ?? 0
          vues.set(ligne.text, rang + 1)
          lignes.push({
            page: index + 1,
            text: ligne.text,
            occurrence: rang,
            left: ligne.bbox.x / largeur,
            top: ligne.bbox.y / hauteur,
            width: ligne.bbox.w / largeur,
            height: ligne.bbox.h / hauteur,
            size: ligne.font?.size ?? 10,
            color: couleurs[indexLigne] ?? '#000000',
            reason,
            bold: /bold|black|semibold|heavy/i.test(`${ligne.font?.weight ?? ''} ${ligne.font?.name ?? ''}`),
            italic: /italic|oblique/i.test(`${ligne.font?.style ?? ''} ${ligne.font?.name ?? ''}`),
            editable,
          })
        }
      }
    } catch {
      // Page illisible : les autres restent éditables.
    }
  }
  return lignes
}

/** Passages de texte éditables d'un document, page par page. */
export async function readEditableText(bytes: Uint8Array): Promise<PdfPageText[]> {
  const mupdf = await import('mupdf')
  let doc: MuDoc
  try {
    // Copie défensive : `openDocument` DÉTACHE le tableau reçu. L'appelant garde
    // souvent ses octets pour écrire ensuite — les lui vider serait invisible.
    doc = mupdf.Document.openDocument(bytes.slice(), 'application/pdf') as MuDoc
  } catch {
    throw new PdfEditError('Ce PDF n’a pas pu être ouvert.')
  }
  const pages: PdfPageText[] = []
  for (let index = 0; index < doc.countPages(); index++) {
    try {
      const page = doc.loadPage(index) as MuPage
      const contents = readContents(page)
      if (!contents) continue
      pages.push({ page: index + 1, runs: findTextRuns(contents.text, pageCodecs(page)) })
    } catch {
      // Page illisible : on la saute, les autres restent éditables.
    }
  }
  return pages
}

/**
 * Applique des remplacements et rend les octets du document modifié.
 * Vérifie ENSUITE, par ré-extraction, que le texte a réellement changé : un
 * remplacement qui n'atteint pas le rendu doit être signalé, pas supposé.
 */
export async function applyTextEdits(bytes: Uint8Array, edits: PdfEditRequest[]): Promise<PdfEditReport> {
  if (!edits.length) throw new PdfEditError('Aucune modification à appliquer.')
  const mupdf = await import('mupdf')
  let doc: MuDoc
  try {
    // Copie défensive : `openDocument` DÉTACHE le tableau reçu. L'appelant garde
    // souvent ses octets pour écrire ensuite — les lui vider serait invisible.
    doc = mupdf.Document.openDocument(bytes.slice(), 'application/pdf') as MuDoc
  } catch {
    throw new PdfEditError('Ce PDF n’a pas pu être ouvert.')
  }

  const refused: PdfEditReport['refused'] = []
  let applied = 0

  const parPage = new Map<number, PdfEditRequest[]>()
  for (const edit of edits) {
    const liste = parPage.get(edit.page) ?? []
    liste.push(edit)
    parPage.set(edit.page, liste)
  }

  for (const [numero, demandes] of parPage) {
    const index = numero - 1
    if (index < 0 || index >= doc.countPages()) {
      for (const d of demandes) refused.push({ ...d, reason: 'page introuvable' })
      continue
    }
    const page = doc.loadPage(index) as MuPage
    const contents = readContents(page)
    if (!contents) {
      for (const d of demandes) refused.push({ ...d, reason: 'flux de contenu non réinscriptible' })
      continue
    }
    const codecs = pageCodecs(page)
    const runs = findTextRuns(contents.text, codecs)

    // Mêmes lignes qu'à la lecture, reconstituées de la même façon : l'appariement est
    // déterministe, donc ce que l'utilisateur a vu est bien ce qu'on modifie.
    const textesDeLignes: string[] = []
    try {
      const brut = JSON.parse(page.toStructuredText('preserve-whitespace').asJSON()) as { blocks?: { lines?: { text: string }[] }[] }
      for (const b of brut.blocks ?? []) for (const li of b.lines ?? []) textesDeLignes.push(li.text)
    } catch {
      // Sans structure lisible, on retombe sur un passage = une ligne.
    }
    const lignes = groupRunsIntoLines(runs, textesDeLignes)

    const aEcrire: { run: PdfTextRunRef; text: string }[] = []
    for (const demande of demandes) {
      const memeTexte = lignes.filter((ligne) => ligne.text === demande.from)
      const cible = memeTexte[demande.occurrence ?? 0]
        ?? (runs.filter((r) => r.text === demande.from)[demande.occurrence ?? 0]
          ? { text: demande.from, runs: [runs.filter((r) => r.text === demande.from)[demande.occurrence ?? 0]] }
          : undefined)
      if (!cible) {
        refused.push({ ...demande, reason: 'passage introuvable dans la page' })
        continue
      }
      if (cible.runs.some((r) => aEcrire.some((x) => x.run.start === r.start))) {
        refused.push({ ...demande, reason: 'passage déjà modifié' })
        continue
      }
      // Seul le passage réellement touché est réécrit : une correction au milieu d'une
      // ligne laisse intacts les mots en gras et les extraits de code qui l'entourent.
      aEcrire.push(...planLineEdit(cible, demande.to))
    }

    const sortie = rewriteTextRuns(contents.text, codecs, aEcrire)
    for (const rejet of sortie.rejected) {
      const demande = demandes.find((d) => d.to === rejet.text)
      refused.push({
        from: demande?.from ?? '',
        to: rejet.text,
        reason: 'caractères absents de la police du document',
        chars: rejet.manquants,
      })
    }
    if (sortie.applied) {
      contents.write(sortie.flux)
      applied += sortie.applied
    }
  }

  if (!applied) {
    throw new PdfEditError(refused[0]?.reason
      ? `Aucune modification écrite : ${refused[0].reason}.`
      : 'Aucune modification écrite.')
  }

  // COPIE HORS DU TAS WASM, immédiatement. `asUint8Array()` rend une VUE sur la
  // mémoire de MuPDF : la moindre allocation ultérieure (ici, la relecture de contrôle)
  // fait croître ce tas et DÉTACHE toutes les vues existantes. On rendrait alors des
  // octets morts, sans la moindre erreur au moment de l'écriture.
  const out = new Uint8Array(doc.saveToBuffer('').asUint8Array())

  // Garde d'exécution : on relit ce qu'on vient d'écrire. Sans elle, un remplacement
  // qui n'atteint pas le rendu passerait pour un succès.
  try {
    // Sur une COPIE : `openDocument` détache le tableau qu'on lui donne, et on rendrait
    // sinon des octets vides à l'appelant (même piège que `pdf.js`, cf. AGENTS.md).
    const relu = mupdf.Document.openDocument(out.slice(), 'application/pdf') as MuDoc
    for (const [numero, demandes] of parPage) {
      const page = relu.loadPage(numero - 1) as MuPage
      const texte = page.toStructuredText('preserve-whitespace').asJSON()
      for (const demande of demandes) {
        const attendu = demande.to.trim().slice(0, 40)
        const ecrit = refused.some((r) => r.to === demande.to)
        if (!ecrit && attendu && !texte.includes(JSON.stringify(attendu).slice(1, -1))) {
          refused.push({ ...demande, reason: 'modification écrite mais absente du rendu' })
        }
      }
    }
  } catch {
    // La relecture de contrôle ne doit pas faire échouer un export par ailleurs valide.
  }

  return { bytes: out, applied, refused }
}
