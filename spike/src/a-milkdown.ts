import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  serializerCtx,
  remarkStringifyOptionsCtx,
} from '@milkdown/kit/core'
import { commonmark } from '@milkdown/kit/preset/commonmark'
import { gfm } from '@milkdown/kit/preset/gfm'
import { replaceAll } from '@milkdown/kit/utils'
import { TextSelection } from '@milkdown/kit/prose/state'
import { diffLines } from 'diff'
import { corpus, corpusFiles, stressFile } from './corpus'
import { makeLogger, measureTyping } from './perf'
import '@milkdown/kit/prose/view/style/prosemirror.css'

const log = makeLogger(document.querySelector('#log')!)

const editor = await Editor.make()
  .config((ctx) => {
    ctx.set(rootCtx, document.querySelector('#editor'))
    ctx.set(defaultValueCtx, corpus['08-syntax-variety.md'])
    // aligné sur le style dominant du corpus pour donner sa meilleure chance au round-trip
    ctx.set(remarkStringifyOptionsCtx, {
      bullet: '-',
      emphasis: '*',
      strong: '*',
      rule: '-',
      listItemIndent: 'one',
    })
  })
  .use(commonmark)
  .use(gfm)
  .create()

const getMarkdown = () =>
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const serializer = ctx.get(serializerCtx)
    return serializer(view.state.doc)
  })

const setMarkdown = (md: string) => editor.action(replaceAll(md))

const typeChar = (ch: string) =>
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    view.dispatch(view.state.tr.insertText(ch, view.state.selection.to))
  })

const focusEnd = () =>
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx)
    const doc = view.state.doc
    view.dispatch(view.state.tr.setSelection(TextSelection.near(doc.resolve(doc.content.size))))
    view.focus()
  })

document.querySelector('#btn-roundtrip')!.addEventListener('click', () => {
  log('=== ROUND-TRIP corpus (parse -> serialize, zéro édition) ===')
  for (const name of corpusFiles) {
    const original = corpus[name]
    const t0 = performance.now()
    setMarkdown(original)
    const out = getMarkdown()
    const ms = (performance.now() - t0).toFixed(0)
    if (out === original) {
      log(`${name}: IDENTIQUE octet pour octet (${ms} ms)`)
      continue
    }
    const changed = diffLines(original, out).filter((p) => p.added || p.removed)
    const changedLines = changed.reduce((n, p) => n + (p.count ?? 0), 0)
    const totalLines = original.split('\n').length
    log(`${name}: MODIFIÉ — ${changedLines} lignes de diff pour ${totalLines} lignes (${ms} ms)`)
    for (const p of changed.slice(0, 6)) {
      log(`   ${p.added ? '+' : '-'} ${JSON.stringify(p.value.slice(0, 100))}`)
    }
  }
  log('=== fin round-trip ===')
})

document.querySelector('#btn-load-stress')!.addEventListener('click', () => {
  log(`Chargement ${stressFile} (${(corpus[stressFile].length / 1024).toFixed(0)} Ko)…`)
  const t0 = performance.now()
  setMarkdown(corpus[stressFile])
  requestAnimationFrame(() => {
    log(`chargé + premier rendu : ${(performance.now() - t0).toFixed(0)} ms`)
  })
})

document.querySelector('#btn-typing')!.addEventListener('click', async () => {
  focusEnd()
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
select.addEventListener('change', () => setMarkdown(corpus[select.value]))

log('Milkdown prêt (kit, commonmark + gfm).')
