<script lang="ts">
  import { onMount } from 'svelte'
  import { EditorView } from '@codemirror/view'
  import { EditorState } from '@codemirror/state'
  import { app, activeTab, editorRef, isDirty } from '../lib/stores.svelte'
  import { baseExtensions, livePreviewComp, previewExtensions, sourceExtensions } from '../lib/editor/editor'

  let host: HTMLElement | undefined = $state()
  let view: EditorView | null = null
  const states = new Map<number, EditorState>()
  let renderedId = -1

  function makeState(tabId: number, content: string): EditorState {
    return EditorState.create({
      doc: content,
      extensions: baseExtensions(app.sourceMode, [
        EditorView.updateListener.of((u) => {
          if (u.docChanged) {
            const tab = app.tabs.find((t) => t.id === tabId)
            if (tab) tab.content = u.state.doc.toString()
          }
        }),
      ]),
    })
  }

  onMount(() => {
    view = new EditorView({ parent: host! })
    editorRef.view = view
    return () => {
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
      view.setState(states.get(tab.id) ?? makeState(tab.id, tab.content))
      renderedId = tab.id
    }
    view.dispatch({ effects: livePreviewComp.reconfigure(sourceMode ? sourceExtensions() : previewExtensions()) })
  })
</script>

<div class="doc">
  {#if activeTab()}
    {@const tab = activeTab()!}
    <div class="doc-head">
      <span>{tab.path ?? tab.name} · {isDirty(tab) ? 'modifié' : 'enregistré'}{app.sourceMode ? ' · source' : ''}</span>
    </div>
  {/if}
  <div class="editor-host doku-doc" class:source-mode={app.sourceMode} bind:this={host}></div>
</div>

<style>
  .doc { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--cream-content); }
  .doc-head {
    flex: none;
    max-width: 680px;
    width: 100%;
    margin: 0 auto;
    padding: 40px 40px 0;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--ink-4);
    letter-spacing: 0.02em;
    user-select: text;
  }
  .editor-host { flex: 1; min-height: 0; user-select: text; }
  .editor-host :global(.cm-editor) { height: 100%; }
  .editor-host.source-mode :global(.cm-content) {
    font-family: var(--font-mono);
    font-size: 14px;
    line-height: 1.7;
  }
</style>
