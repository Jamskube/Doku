import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { docDirCompartment, docDirFacet } from './live-preview'

describe('live preview image directory', () => {
  it('updates after the first save without rebuilding the editor state', () => {
    const before = EditorState.create({
      extensions: [docDirCompartment.of(docDirFacet.of(''))],
    })
    const after = before.update({
      effects: docDirCompartment.reconfigure(docDirFacet.of('G:\\Notes')),
    }).state

    expect(before.facet(docDirFacet)).toBe('')
    expect(after.facet(docDirFacet)).toBe('G:\\Notes')
    expect(after.doc).toBe(before.doc)
  })
})
