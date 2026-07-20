// Le champ de l'aperçu de reformulation est testable SANS DOM : de simples EditorState +
// transactions suffisent à prouver les deux invariants zéro-perte — auto-dismiss atomique sur
// édition étrangère, et transaction d'accept (changes + effet null) sans décoration résiduelle.
import { describe, it, expect } from 'vitest'
import { EditorState } from '@codemirror/state'
import { rephrasePreviewField, rephrasePreviewRange, setRephrasePreview } from './rephrase-preview'

const make = (doc: string) => EditorState.create({ doc, extensions: [rephrasePreviewField] })
const size = (state: EditorState) => state.field(rephrasePreviewField).size

describe('rephrasePreviewField (16.2, brief w3)', () => {
  it("pose puis retire l'aperçu via l'effet", () => {
    let state = make('un deux trois')
    expect(size(state)).toBe(0)
    state = state.update({ effects: setRephrasePreview.of({ from: 3, to: 7 }) }).state
    expect(size(state)).toBe(1)
    expect(rephrasePreviewRange(state)).toEqual({ from: 3, to: 7 })
    state = state.update({ effects: setRephrasePreview.of(null) }).state
    expect(size(state)).toBe(0)
    expect(rephrasePreviewRange(state)).toBeNull()
  })

  it('édition étrangère (docChanged sans effet) → champ vidé ATOMIQUEMENT', () => {
    let state = make('un deux trois')
    state = state.update({ effects: setRephrasePreview.of({ from: 3, to: 7 }) }).state
    state = state.update({ changes: { from: 0, insert: 'X' } }).state
    expect(size(state)).toBe(0)
  })

  it("transaction d'accept (changes + effet null) → aucune décoration résiduelle", () => {
    let state = make('un deux trois')
    state = state.update({ effects: setRephrasePreview.of({ from: 3, to: 7 }) }).state
    state = state.update({
      changes: { from: 3, to: 7, insert: 'DEUX CORRIGÉ' },
      effects: setRephrasePreview.of(null),
    }).state
    expect(size(state)).toBe(0)
    expect(state.doc.toString()).toBe('un DEUX CORRIGÉ trois')
  })

  it("un changement de sélection seul ne touche pas l'aperçu (clic ailleurs ne détruit rien)", () => {
    let state = make('un deux trois')
    state = state.update({ effects: setRephrasePreview.of({ from: 3, to: 7 }) }).state
    state = state.update({ selection: { anchor: 0 } }).state
    expect(size(state)).toBe(1)
  })
})
