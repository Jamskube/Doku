import { describe, it, expect } from 'vitest'
import {
  buildChatMessages,
  buildDocContext,
  buildDocIndexChatMessages,
  buildFolderChatMessages,
  buildReduceSummaryPrompt,
  buildRephrasePrompt,
  buildSegmentSummaryPrompt,
  buildWholeSummaryPrompt,
  diffWords,
  segmentDoc,
  truncateDoc,
  DOC_INDEX_REFUSAL_PHRASE,
  FOLDER_REFUSAL_PHRASE,
  MAX_DOC_CHARS,
  REFUSAL_PHRASE,
  type DiffSeg,
} from './copilot-service'

describe('truncateDoc', () => {
  it('laisse un texte court intact', () => {
    expect(truncateDoc('court', 100)).toEqual({ text: 'court', truncated: false })
  })
  it('tronque au-delà de la limite', () => {
    const r = truncateDoc('abcdef', 3)
    expect(r).toEqual({ text: 'abc', truncated: true })
  })
})

describe('buildDocContext', () => {
  it('inclut le texte md entre délimiteurs', () => {
    const ctx = buildDocContext('notes.md', '# Titre\nCorps', 'md')
    expect(ctx).toContain('notes.md')
    expect(ctx).toContain('# Titre')
    expect(ctx).toContain('"""')
  })
  it('signale un PDF comme non extractible (pas de faux contexte)', () => {
    const ctx = buildDocContext('scan.pdf', '', 'pdf')
    expect(ctx).toMatch(/PDF/)
    expect(ctx).toMatch(/non extractible/i)
  })
  it('signale un document vide', () => {
    expect(buildDocContext('vide.txt', '   ', 'txt')).toMatch(/vide/i)
  })
  it('signale explicitement la troncature sur un long doc (pas silencieux)', () => {
    const long = 'x'.repeat(MAX_DOC_CHARS + 500)
    const ctx = buildDocContext('gros.md', long, 'md')
    expect(ctx).toMatch(/seul son début est fourni|n'a pas été lue/i)
  })
  it('gère un nom absent', () => {
    expect(buildDocContext(null, 'a', 'md')).toContain('sans titre')
  })
})

describe('buildFolderChatMessages (15.3)', () => {
  const passages = [
    { name: 'recettes.md', text: 'La pâte repose 30 minutes.' },
    { name: 'courses.md', text: 'Acheter de la levure.' },
  ]

  it('system = cadre + passages étiquetés par note ; question + rappel dossier', () => {
    const msgs = buildFolderChatMessages({ passages, history: [], question: 'Combien de repos ?' })
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('Note « recettes.md »')
    expect(msgs[0].content).toContain('La pâte repose 30 minutes.')
    expect(msgs[0].content).toContain('Note « courses.md »')
    const last = msgs[msgs.length - 1]
    expect(last.role).toBe('user')
    expect(last.content).toContain('Combien de repos ?')
    expect(last.content).toContain(FOLDER_REFUSAL_PHRASE)
  })

  it('la phrase de refus dossier parle des notes, pas du document', () => {
    expect(FOLDER_REFUSAL_PHRASE).toMatch(/notes/)
    expect(FOLDER_REFUSAL_PHRASE).not.toMatch(/document/)
  })

  it('insère l’historique entre le system et la question', () => {
    const msgs = buildFolderChatMessages({
      passages,
      history: [
        { role: 'user', content: 'Q1' },
        { role: 'assistant', content: 'R1' },
      ],
      question: 'Q2',
    })
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(msgs[1].content).toBe('Q1')
  })
})

describe('buildDocIndexChatMessages (15.3)', () => {
  const passages = [{ text: 'Le délai est de 140 jours.' }]

  it('annonce honnêtement des EXTRAITS d’un doc indexé en entier + refus dédié', () => {
    const msgs = buildDocIndexChatMessages({ docName: 'gros.md', passages, history: [], question: 'Quel délai ?' })
    expect(msgs[0].content).toContain('gros.md')
    expect(msgs[0].content).toMatch(/indexé\s+en entier/)
    expect(msgs[0].content).toContain("n'ont pas été relus")
    expect(msgs[0].content).toContain('Extrait 1')
    const last = msgs[msgs.length - 1]
    expect(last.content).toContain(DOC_INDEX_REFUSAL_PHRASE)
    // JAMAIS l'ancienne phrase 14.3 : le modèle ne peut pas affirmer une absence sur
    // tout le document alors qu'il n'a vu que le top-k.
    expect(msgs[0].content).not.toContain(REFUSAL_PHRASE)
    expect(last.content).not.toContain(`« ${REFUSAL_PHRASE} »`)
  })

  it('signale un index plafonné (doc géant)', () => {
    const msgs = buildDocIndexChatMessages({ docName: 'x.md', passages, history: [], question: 'Q', indexTruncated: true })
    expect(msgs[0].content).toMatch(/plafond d.indexation/)
  })
})

describe('buildChatMessages', () => {
  const base = { docName: 'notes.md', docText: 'Le ciel est bleu.', kind: 'md' as const }

  it('place un system (cadre + contexte doc), puis la question + un rappel d\'ancrage', () => {
    const msgs = buildChatMessages({ ...base, history: [], question: 'Quelle couleur ?' })
    expect(msgs[0].role).toBe('system')
    expect(msgs[0].content).toContain('Doku-San')
    expect(msgs[0].content).toContain('Le ciel est bleu.')
    const last = msgs[msgs.length - 1]
    expect(last.role).toBe('user')
    expect(last.content).toContain('Quelle couleur ?')
    expect(last.content).toMatch(/uniquement d'après le document/i) // rappel collé à la question
  })

  it('intercale l\'historique entre le system et la question, dans l\'ordre', () => {
    const history = [
      { role: 'user' as const, content: 'Salut' },
      { role: 'assistant' as const, content: 'Bonjour' },
    ]
    const msgs = buildChatMessages({ ...base, history, question: 'Suite ?' })
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user'])
    expect(msgs[1].content).toBe('Salut')
    expect(msgs[2].content).toBe('Bonjour')
  })

  it('ancre la réponse sur le seul document et donne la phrase de refus exacte (14.3)', () => {
    const msgs = buildChatMessages({ ...base, history: [], question: 'x' })
    expect(msgs[0].content).toMatch(/uniquement/i)
    expect(msgs[0].content).toContain(REFUSAL_PHRASE)
    expect(msgs[0].content).toMatch(/jamais sur des connaissances extérieures/i)
  })

  it('donne au cloud plus d’initiative tout en séparant faits, inférences et contexte extérieur', () => {
    const local = buildChatMessages({ ...base, history: [], question: 'Analyse.', persona: 'local' })
    const cloud = buildChatMessages({ ...base, history: [], question: 'Analyse.', persona: 'cloud' })
    expect(cloud[0].content).not.toBe(local[0].content)
    expect(cloud[0].content).toMatch(/prends l'initiative|synthétise/i)
    expect(cloud[0].content).toMatch(/infères|inférence/i)
    expect(cloud[cloud.length - 1].content).toMatch(/contexte général extérieur/i)
    expect(cloud[cloud.length - 1].content).toMatch(/n'invente jamais un fait attribué au document/i)
  })
})

describe('segmentDoc (14.2)', () => {
  it('un texte court reste en un seul segment', () => {
    expect(segmentDoc('petit', 100)).toEqual(['petit'])
  })
  it('un texte vide ne produit aucun segment', () => {
    expect(segmentDoc('   ', 100)).toEqual([])
  })
  it('segmente un long texte, chaque segment sous la limite', () => {
    const lines = Array.from({ length: 50 }, (_, i) => `ligne numero ${i}`).join('\n')
    const segs = segmentDoc(lines, 60)
    expect(segs.length).toBeGreaterThan(1)
    for (const s of segs) expect(s.length).toBeLessThanOrEqual(60)
  })
  it('ne perd aucun contenu (début, milieu et fin présents)', () => {
    const body = Array.from({ length: 40 }, (_, i) => `phrase ${i} lorem ipsum`).join('\n')
    const text = `DEBUT\n${body}\nFIN`
    const joined = segmentDoc(text, 50).join('\n')
    expect(joined).toContain('DEBUT')
    expect(joined).toContain('phrase 20')
    expect(joined).toContain('FIN')
  })
  it('tranche dur une ligne unique plus longue que la limite (sans rien perdre)', () => {
    const segs = segmentDoc('x'.repeat(250), 100)
    expect(segs.length).toBe(3)
    for (const s of segs) expect(s.length).toBeLessThanOrEqual(100)
    expect(segs.join('').length).toBe(250)
  })
})

describe('prompts de résumé (14.2)', () => {
  it('résumé direct : contient nom, texte et consigne fidèle', () => {
    const p = buildWholeSummaryPrompt('Corps du doc.', 'notes.md', 'summary')
    expect(p).toContain('notes.md')
    expect(p).toContain('Corps du doc.')
    expect(p).toMatch(/r[ée]sum/i)
    expect(p).toMatch(/sans rien inventer/i)
  })
  it('mode « points clés » diffère du mode résumé', () => {
    const a = buildWholeSummaryPrompt('t', 'd', 'summary')
    const b = buildWholeSummaryPrompt('t', 'd', 'keypoints')
    expect(a).not.toBe(b)
    expect(b).toMatch(/points cl[ée]s/i)
  })
  it('prompt de segment indique la position (partie i/N)', () => {
    const p = buildSegmentSummaryPrompt('seg', 2, 5, 'd')
    expect(p).toContain('2/5')
    expect(p).toContain('seg')
  })
  it("prompt de réduction interdit d'ajouter de l'info absente", () => {
    const p = buildReduceSummaryPrompt('r1\n\nr2', 'd', 'summary')
    expect(p).toContain('r1')
    expect(p).toMatch(/n'ajoute aucune information/i)
  })
  it('le profil cloud autorise une synthèse plus analytique sans relâcher la fidélité', () => {
    const local = buildWholeSummaryPrompt('t', 'd', 'summary', 'local')
    const cloud = buildWholeSummaryPrompt('t', 'd', 'summary', 'cloud')
    expect(cloud).not.toBe(local)
    expect(cloud).toMatch(/hiérarchise|implications/i)
    expect(cloud).toMatch(/n'invente aucun fait/i)
  })
})

describe('buildRephrasePrompt (16.1)', () => {
  it('inclut le passage et exige uniquement le texte reformulé, à sens et Markdown conservés', () => {
    const p = buildRephrasePrompt('Le chat dort sur le canapé.', 'clarify')
    expect(p).toContain('Le chat dort sur le canapé.')
    expect(p).toMatch(/UNIQUEMENT/)
    expect(p).toMatch(/même sens/i)
    expect(p).toMatch(/Markdown/)
  })
  it('les trois variantes produisent des consignes distinctes', () => {
    const c = buildRephrasePrompt('t', 'clarify')
    const s = buildRephrasePrompt('t', 'shorten')
    const t = buildRephrasePrompt('t', 'tone')
    expect(c).not.toBe(s)
    expect(s).not.toBe(t)
    expect(c).not.toBe(t)
    expect(s).toMatch(/court|concis/i)
    expect(t).toMatch(/ton/i)
    expect(c).toMatch(/clair/i)
  })
  it('le profil cloud peut réorganiser le passage mais conserve le contrat de remplacement', () => {
    const cloud = buildRephrasePrompt('t', 'clarify', 'cloud')
    expect(cloud).toMatch(/réorganiser/i)
    expect(cloud).toMatch(/même sens/i)
    expect(cloud).toMatch(/UNIQUEMENT/)
  })
  it('« Corriger » (16.2) : orthographe/grammaire, changement minimal, contrat conservé', () => {
    const p = buildRephrasePrompt('t', 'correct')
    expect(p).toMatch(/orthographe/i)
    expect(p).toMatch(/grammaire/i)
    expect(p).toMatch(/le moins/i)
    expect(p).toMatch(/même sens/i)
    expect(p).toMatch(/Markdown/)
    expect(p).toMatch(/UNIQUEMENT/)
    for (const other of ['clarify', 'shorten', 'tone'] as const) expect(p).not.toBe(buildRephrasePrompt('t', other))
  })
  it('cloud + Corriger : PAS de licence de réorganisation (correction = changement minimal)', () => {
    expect(buildRephrasePrompt('t', 'correct', 'cloud')).not.toMatch(/réorganiser/i)
  })
})

describe('diffWords (16.2, brief w3)', () => {
  // Propriété centrale : le diff reconstruit EXACTEMENT les deux textes (aucun blanc perdu).
  const reconstruct = (segs: DiffSeg[]) => ({
    original: segs.filter((s) => s.kind !== 'add').map((s) => s.text).join(''),
    proposed: segs.filter((s) => s.kind !== 'del').map((s) => s.text).join(''),
  })

  it('textes identiques → un seul segment same (et aucun pour deux vides)', () => {
    expect(diffWords('le chat dort', 'le chat dort')).toEqual([{ kind: 'same', text: 'le chat dort' }])
    expect(diffWords('', '')).toEqual([])
  })
  it('substitution : del + add ciblés, reconstruction exacte', () => {
    const segs = diffWords('le chat dort', 'le chien dort')
    expect(reconstruct(segs)).toEqual({ original: 'le chat dort', proposed: 'le chien dort' })
    expect(segs.some((s) => s.kind === 'del' && s.text.includes('chat'))).toBe(true)
    expect(segs.some((s) => s.kind === 'add' && s.text.includes('chien'))).toBe(true)
    expect(segs.some((s) => s.kind === 'same' && s.text.includes('dort'))).toBe(true)
  })
  it('insertion pure et suppression pure', () => {
    expect(reconstruct(diffWords('a c', 'a b c'))).toEqual({ original: 'a c', proposed: 'a b c' })
    expect(reconstruct(diffWords('a b c', 'a c'))).toEqual({ original: 'a b c', proposed: 'a c' })
  })
  it('fusionne les segments adjacents de même nature (mots consécutifs supprimés)', () => {
    const segs = diffWords('un deux trois quatre', 'un quatre')
    expect(segs.filter((s) => s.kind === 'del')).toEqual([{ kind: 'del', text: 'deux trois ' }])
    expect(reconstruct(segs)).toEqual({ original: 'un deux trois quatre', proposed: 'un quatre' })
  })
  it('préserve blancs multiples et sauts de ligne (reconstruction octet pour octet)', () => {
    const a = 'Premier  paragraphe.\n\nDeuxieme ligne\tavec tab.'
    const b = 'Premier  paragraphe corrige.\n\nDeuxieme ligne\tavec tab.'
    expect(reconstruct(diffWords(a, b))).toEqual({ original: a, proposed: b })
  })
  it('espaces de bord : jamais de segment vide', () => {
    const segs = diffWords(' a ', ' b ')
    expect(segs.every((s) => s.text !== '')).toBe(true)
    expect(reconstruct(segs)).toEqual({ original: ' a ', proposed: ' b ' })
  })
  it('au-delà du plafond → repli remplacement intégral (jamais de diff faux)', () => {
    const a = Array.from({ length: 1500 }, (_, i) => `a${i}`).join(' ')
    const b = Array.from({ length: 1500 }, (_, i) => `b${i}`).join(' ')
    expect(diffWords(a, b)).toEqual([
      { kind: 'del', text: a },
      { kind: 'add', text: b },
    ])
  })
  it('sous le plafond, un texte de plusieurs paragraphes garde un diff fin', () => {
    const base = Array.from({ length: 300 }, (_, i) => `mot${i}`).join(' ')
    const segs = diffWords(`${base} fin`, `${base} conclusion`)
    expect(segs.filter((s) => s.kind === 'del')).toEqual([{ kind: 'del', text: 'fin' }])
    expect(segs.filter((s) => s.kind === 'add')).toEqual([{ kind: 'add', text: 'conclusion' }])
  })
})
