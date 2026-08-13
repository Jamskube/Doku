import { minimalSetup } from 'codemirror'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { corpus, stressFile } from './corpus'
import { livePreview } from './live-preview'
import { makeLogger, measureTyping, nextFrame } from './perf'

interface SplitSpikeResult {
  mountMs: number
  typing: { avgMs: number; p95Ms: number; maxMs: number }
  secondaryUnchanged: boolean
  primaryChanged: boolean
  pass: boolean
}

declare global {
  interface Window {
    __dokuSplitSpike?: { run: () => Promise<SplitSpikeResult> }
  }
}

const log = makeLogger(document.querySelector('#log')!)
const verdict = document.querySelector('#verdict')!
const source = corpus[stressFile]
const splitLargeSourceMode = source.length >= 450_000
const extensions = [
  minimalSetup,
  EditorView.lineWrapping,
  markdown({ base: markdownLanguage, codeLanguages: languages }),
  ...(splitLargeSourceMode ? [] : [livePreview()]),
]

const mountStart = performance.now()
const primary = new EditorView({
  parent: document.querySelector('#primary')!,
  state: EditorState.create({ doc: source, extensions }),
})
const secondary = new EditorView({
  parent: document.querySelector('#secondary')!,
  state: EditorState.create({ doc: source, extensions }),
})
let mountMs = 0
requestAnimationFrame(() => {
  mountMs = performance.now() - mountStart
  log(`Deux éditeurs montés + premier rendu : ${mountMs.toFixed(1)} ms`)
})

let running: Promise<SplitSpikeResult> | null = null

async function run(): Promise<SplitSpikeResult> {
  if (running) return running
  running = (async () => {
    await nextFrame()
    const secondaryBefore = secondary.state.doc.toString()
    const primaryBefore = primary.state.doc.toString()
    primary.dispatch({ selection: { anchor: primary.state.doc.length }, scrollIntoView: true })
    primary.focus()

    const typing = await measureTyping((ch) => {
      const head = primary.state.selection.main.head
      primary.dispatch({
        changes: { from: head, insert: ch },
        selection: { anchor: head + ch.length },
        userEvent: 'input.type',
      })
    }, 80)

    const secondaryUnchanged = secondary.state.doc.toString() === secondaryBefore
    const primaryChanged = primary.state.doc.toString() !== primaryBefore
    // Seuil kill-test : aucune mutation croisée et aucun gel > 50 ms au p95.
    // Le budget produit de 16 ms reste une cible d'optimisation, pas un mensonge de gate.
    const pass = secondaryUnchanged && primaryChanged && typing.p95Ms <= 50
    const result = {
      mountMs: +mountMs.toFixed(1),
      typing,
      secondaryUnchanged,
      primaryChanged,
      pass,
    }
    verdict.textContent = pass ? 'PASS' : 'FAIL'
    verdict.className = pass ? 'pass' : 'fail'
    log(JSON.stringify(result, null, 2))
    return result
  })().finally(() => { running = null })
  return running
}

document.querySelector('#btn-run')!.addEventListener('click', () => void run())
window.__dokuSplitSpike = { run }

if (new URLSearchParams(location.search).has('autorun')) void run()
