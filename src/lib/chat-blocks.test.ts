// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { codeLanguages, decorateChatBlocks } from './chat-blocks'
import { renderChatMarkdown } from './export/render-md'
import { annotateCitations } from './citations'
import { annotateWebCitations } from './web-citations'

function render(md: string) {
  return decorateChatBlocks(renderChatMarkdown(md), codeLanguages(md))
}

// Chaîne complète du panneau (CopilotPanel `renderAssistant`), relue par un vrai parseur.
function renderFull(md: string, cites = 0, webCites = 0) {
  const html = annotateCitations(renderChatMarkdown(md), cites)
  const box = document.createElement('div')
  box.innerHTML = decorateChatBlocks(annotateWebCitations(html, webCites), codeLanguages(md))
  return box
}

describe('chat-blocks', () => {
  it('lit les langages dans l’ordre, blocs imbriqués dans les listes compris', () => {
    const md = '```ts\nconst a = 1\n```\n\n- item\n\n  ```Python extra\n  x = 1\n  ```\n\n```\nplain\n```'
    expect(codeLanguages(md)).toEqual(['ts', 'python', ''])
  })

  it('refuse un libellé hors charset (il entrerait tel quel dans le markup)', () => {
    expect(codeLanguages('```<img/onerror=x>\ncode\n```')).toEqual([''])
  })

  it('habille chaque bloc de code d’un en-tête langage + Copier', () => {
    const html = render('```js\nlet x = "<b>"\n```')
    expect(html).toContain('<span class="cop-code-lang">js</span>')
    expect(html).toContain('class="cop-code-copy"')
    expect(html).toMatch(/<\/pre><\/div>$/m)
    expect(html).toContain('&lt;b&gt;')
  })

  it('libellé générique quand l’appariement source/HTML échoue', () => {
    expect(decorateChatBlocks('<pre><code>a</code></pre><pre><code>b</code></pre>', ['js'])).not.toContain('>js<')
  })

  it('enveloppe les tables (même imbriquées) dans un conteneur défilant équilibré', () => {
    const html = decorateChatBlocks('<table><tr><td><table></table></td></tr></table>', [])
    expect(html.match(/<div class="cop-table-scroll">/g)?.length).toBe(2)
    expect(html.match(/<\/table><\/div>/g)?.length).toBe(2)
  })

  it('une valeur d’attribut porteuse de markup ne ressort pas active après l’habillage', () => {
    const box = renderFull('| a |\n|---|\n| x |\n\n<table><tr><td align="<table><img src=x onerror=alert(1)>">y</td></tr></table>\n')
    expect(box.querySelectorAll('img').length).toBe(0)
    expect(box.querySelector('[onerror]')).toBeNull()
  })

  it('un marqueur [n] / [web:n] dans un attribut ne devient pas une puce injectée', () => {
    const box = renderFull('<a href="#x[1]">l</a> <a href="#y[web:1]">m</a> fin [1] [web:1]', 1, 1)
    expect([...box.querySelectorAll('.cop-cite, .cop-web-cite')].map((el) => el.tagName)).toEqual(['BUTTON', 'BUTTON'])
    for (const el of box.querySelectorAll('*')) {
      for (const attr of el.attributes) expect(attr.value).not.toMatch(/[<>]/)
    }
  })
})
