<script lang="ts">
  import { onMount } from 'svelte'
  import { EditorView } from '@codemirror/view'
  import { EditorState } from '@codemirror/state'
  import { app, activeTab, cycleColumnWidth, docHeadings, editorRef, isDirty } from '../lib/stores.svelte'
  import { baseExtensions, htmlSourceExtensions, livePreviewComp, previewExtensions, serializeDoc, sourceExtensions, txtExtensions } from '../lib/editor/editor'
  import { docDirFacet } from '../lib/editor/live-preview'
  import { parentPath } from '../lib/explorer'
  import { sandboxDoc } from '../lib/html'
  import DokuMark from '../lib/DokuMark.svelte'

  // Onglet HTML en mode rendu : aperçu sandboxé (iframe), pas l'éditeur (FR-8).
  const htmlRender = $derived(activeTab()?.kind === 'html' && !app.sourceMode)

  let { onOpen }: { onOpen: () => void } = $props()

  let host: HTMLElement | undefined = $state()
  let view: EditorView | null = null
  const states = new Map<number, EditorState>()
  // rev auquel l'état caché de chaque onglet a été construit (invalidation au reload externe).
  const revs = new Map<number, number>()
  let renderedId = -1
  let renderedRev = -1

  function makeState(tabId: number, content: string): EditorState {
    const tab = app.tabs.find((t) => t.id === tabId)
    const dir = parentPath(tab?.path ?? null) ?? ''
    const extra = [
      docDirFacet.of(dir),
      EditorView.updateListener.of((u) => {
        if (u.docChanged) {
          const t = app.tabs.find((x) => x.id === tabId)
          if (t) t.content = serializeDoc(u.state.doc.toString(), t.eol)
        }
      }),
    ]
    return EditorState.create({
      doc: content,
      extensions:
        tab?.kind === 'html'
          ? htmlSourceExtensions(extra)
          : tab?.kind === 'txt'
            ? txtExtensions(extra)
            : baseExtensions(app.sourceMode, extra),
    })
  }

  // Scroll-spy : titre courant = dernier titre au-dessus du haut du viewport (4.6).
  // Titres seulement pour le Markdown (un .txt/.html n'a pas de structure de titres).
  function updateActiveHeading(v: EditorView) {
    const headings = activeTab()?.kind === 'md' ? docHeadings(activeTab()?.content ?? '') : []
    if (!headings.length) {
      app.activeHeadingLine = 0
      return
    }
    const block = v.elementAtHeight(v.scrollDOM.scrollTop + 24)
    const topLine = v.state.doc.lineAt(block.from).number
    let active = headings[0].line
    for (const h of headings) {
      if (h.line <= topLine) active = h.line
      else break
    }
    app.activeHeadingLine = active
  }

  onMount(() => {
    view = new EditorView({ parent: host! })
    editorRef.view = view
    const onScroll = () => view && updateActiveHeading(view)
    view.scrollDOM.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      view?.scrollDOM.removeEventListener('scroll', onScroll)
      view?.destroy()
      editorRef.view = null
    }
  })

  $effect(() => {
    const tab = activeTab()
    const sourceMode = app.sourceMode
    if (!view) return
    if (tab && tab.id !== renderedId) {
      if (renderedId !== -1) states.set(renderedId, view.state)
      // Cache réutilisable seulement s'il a été bâti au rev courant de l'onglet.
      const cached = revs.get(tab.id) === tab.rev ? states.get(tab.id) : undefined
      view.setState(cached ?? makeState(tab.id, tab.content))
      renderedId = tab.id
      renderedRev = tab.rev
      revs.set(tab.id, tab.rev)
    } else if (tab && tab.rev !== renderedRev) {
      // Onglet actif rechargé depuis le disque : reconstruire depuis le contenu frais.
      states.delete(tab.id)
      view.setState(makeState(tab.id, tab.content))
      renderedRev = tab.rev
      revs.set(tab.id, tab.rev)
    }
    view.dispatch({ effects: livePreviewComp.reconfigure(sourceMode ? sourceExtensions() : previewExtensions()) })
    view.requestMeasure({ read: () => view && updateActiveHeading(view) })
  })
</script>

<div class="doc">
  {#if activeTab() && !app.focus}
    {@const tab = activeTab()!}
    <div class="doc-head">
      <span class="caption">{tab.path ?? tab.name} · {isDirty(tab) ? 'modifié' : 'enregistré'}{app.sourceMode ? ' · source' : ''}</span>
      <button
        class="width-btn"
        title="Largeur de colonne"
        aria-label="Largeur de colonne"
        onclick={cycleColumnWidth}
      >
        <span class="msr" style="font-size:18px">{app.columnWidth === 'narrow' ? 'width_normal' : app.columnWidth === 'wide' ? 'width_wide' : 'width_full'}</span>
      </button>
    </div>
  {/if}
  {#if htmlRender}
    <iframe class="html-view" title="Aperçu HTML" sandbox="" srcdoc={sandboxDoc(activeTab()!.content, app.theme)}></iframe>
  {/if}
  <div class="editor-host doku-doc" class:source-mode={app.sourceMode} class:txt={activeTab()?.kind === 'txt'} class:hidden={htmlRender} bind:this={host}></div>

  {#if !activeTab()}
    <div class="empty">
      <span class="empty-mark"><DokuMark size={64} /></span>
      <p class="empty-title">Aucun document ouvert</p>
      <button class="empty-open" onclick={onOpen}>
        <span class="msr" style="font-size:18px">folder_open</span>
        Ouvrir un fichier
        <span class="keys"><kbd>Ctrl</kbd><kbd>O</kbd></span>
      </button>
    </div>
  {/if}
</div>

<style>
  .doc { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--cream-content); }

  .empty {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    background: var(--cream-content);
    color: var(--ink-4);
    user-select: none;
  }
  .empty-mark { display: inline-flex; color: var(--ink-4); opacity: 0.35; }
  .empty-title { margin: 0; font-size: 14px; color: var(--ink-3); }
  .empty-open {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    border: 1px solid var(--line-2);
    border-radius: 9px;
    background: var(--surface);
    color: var(--ink-2);
    font-size: 13px;
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
  }
  .empty-open:hover { background: var(--surface-hover); color: var(--ink); border-color: var(--line-3); }
  .empty-open .keys { display: inline-flex; gap: 3px; margin-left: 4px; }
  .empty-open kbd {
    font-family: var(--font-mono);
    font-size: 10.5px;
    line-height: 1;
    padding: 3px 5px;
    border-radius: 4px;
    background: var(--surface-2);
    color: var(--ink-4);
    border: 1px solid var(--line-2);
  }
  .doc-head {
    flex: none;
    max-width: var(--doc-width, 680px);
    width: 100%;
    margin: 0 auto;
    padding: 40px 40px 0;
    display: flex;
    align-items: center;
    gap: 10px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-4);
    letter-spacing: 0.02em;
  }
  .caption { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; user-select: text; }
  .width-btn {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--ink-4);
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }
  .width-btn:hover { background: var(--surface-hover); color: var(--ink); }
  .editor-host { flex: 1; min-height: 0; user-select: text; }
  .editor-host.hidden { display: none; }
  .html-view {
    flex: 1;
    min-height: 0;
    width: 100%;
    border: 0;
    background: var(--cream-content);
  }
  .editor-host :global(.cm-editor) { height: 100%; }
  .editor-host.source-mode :global(.cm-content),
  .editor-host.txt :global(.cm-content) {
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 1.7;
  }
</style>
