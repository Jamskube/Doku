import { describe, it, expect } from 'vitest'
import {
  buildChatMessages,
  buildDocContext,
  buildReduceSummaryPrompt,
  buildRephrasePrompt,
  buildSegmentSummaryPrompt,
  buildWholeSummaryPrompt,
  segmentDoc,
  truncateDoc,
  MAX_DOC_CHARS,
  REFUSAL_PHRASE,
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
})
