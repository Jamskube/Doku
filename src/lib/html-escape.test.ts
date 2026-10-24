// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { escapeHtml } from './html-escape'
import { escapeHtml as reexported } from './export/print'

describe('escapeHtml', () => {
  it('échappe &, < et > (l’esperluette d’abord, sans double échappement)', () => {
    expect(escapeHtml('a & <b> &lt;')).toBe('a &amp; &lt;b&gt; &amp;lt;')
  })

  it('reste disponible depuis export/print pour les appelants existants', () => {
    expect(reexported).toBe(escapeHtml)
  })
})
