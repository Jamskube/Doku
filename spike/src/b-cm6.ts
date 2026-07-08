import { minimalSetup } from 'codemirror'
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { corpus, corpusFiles, stressFile } from './corpus'
import { makeLogger, measureTyping } from './perf'
import { livePreview } from './live-preview'

const log = makeLogger(document.querySelector('#log')!)

const mdHighlight = HighlightStyle.define([
  { tag: tags.heading1, fontSize: '1.7em', fontWeight: '700' },
  { tag: tags.heading2, fontSize: '1.45em', fontWeight: '700' },
  { tag: tags.heading3, fontSize: '1.25em', fontWeight: '700' },
  { tag: tags.heading4, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, fontFamily: 'ui-monospace, monospace', fontSize: '0.9em' },
  { tag: tags.link, color: '#4a6fa5' },
  { tag: tags.url, color: 'rgba(28,26,22,.5)' },
  { tag: tags.quote, color: 'rgba(28,26,22,.72)', fontStyle: 'italic' },
])

const extensions = [
  minimalSetup,
  EditorView.lineWrapping,
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  syntaxHighlighting(mdHighlight),
  livePreview(),
]

const view = new EditorView({
  parent: document.querySelector('#editor')!,
  state: EditorState.create({ doc: corpus['08-syntax-variety.md'], extensions }),
})

const setContent = (doc: string) => view.setState(EditorState.create({ doc, extensions }))

const typeChar = (ch: string) => {
  const head = view.state.selection.main.head
  view.dispatch({
    changes: { from: head, insert: ch },
    selection: { anchor: head + ch.length },
    userEvent: 'input.type',
  })
}

window.addEventListener('spike:wikilink', (e) => {
  log(`wikilink cliqué → ${(e as CustomEvent).detail}`)
})

document.querySelector('#btn-roundtrip')!.addEventListener('click', () => {
  log('=== ROUND-TRIP corpus ===')
  for (const name of corpusFiles) {
    const original = corpus[name]
    const t0 = performance.now()
    setContent(original)
    const identical = view.state.doc.toString() === original
    const ms = (performance.now() - t0).toFixed(0)
    log(`${name}: ${identical ? 'IDENTIQUE octet pour octet' : 'MODIFIÉ (!!)'} (${ms} ms)`)
  }
  log('(par construction : le buffer EST la source, aucune sérialisation)')
  log('=== fin round-trip ===')
})

document.querySelector('#btn-load-stress')!.addEventListener('click', () => {
  log(`Chargement ${stressFile} (${(corpus[stressFile].length / 1024).toFixed(0)} Ko)…`)
  const t0 = performance.now()
  setContent(corpus[stressFile])
  requestAnimationFrame(() => {
    log(`chargé + premier rendu : ${(performance.now() - t0).toFixed(0)} ms`)
  })
})

document.querySelector('#btn-typing')!.addEventListener('click', async () => {
  view.dispatch({ selection: { anchor: view.state.doc.length }, scrollIntoView: true })
  view.focus()
  log('Test frappe (80 caractères, fin de document)…')
  const r = await measureTyping(typeChar, 80)
  log(`frappe : avg ${r.avgMs} ms · p95 ${r.p95Ms} ms · max ${r.maxMs} ms par frame`)
})

const select = document.querySelector<HTMLSelectElement>('#file-select')!
for (const name of [...corpusFiles, stressFile]) {
  const opt = document.createElement('option')
  opt.value = name
  opt.textContent = name
  select.append(opt)
}
select.value = '08-syntax-variety.md'
select.addEventListener('change', () => setContent(corpus[select.value]))

log('CM6 live preview prêt (lang-markdown GFM + plugin spike).')
