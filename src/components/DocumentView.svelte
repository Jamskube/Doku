<script lang="ts">
  import { onMount } from 'svelte'
  import { EditorView } from '@codemirror/view'
  import { EditorState } from '@codemirror/state'
  import { app, activeTab, editorRef, isDirty } from '../lib/stores.svelte'
  import { baseExtensions, livePreviewComp, previewExtensions, sourceExtensions } from '../lib/editor/editor'

  let { onOpen }: { onOpen: () => void } = $props()

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

  {#if !activeTab()}
    <div class="empty">
      <svg class="empty-mark" width="72" height="72" viewBox="0 0 512 512" fill="none" aria-hidden="true">
        <path d="M122 132 H275 L378 235 V285 C378 353 326 407 260 407 H122 Z" fill="none" stroke="currentColor" stroke-width="46" stroke-linejoin="round" stroke-linecap="round" />
        <path d="M275 132 V214 H356" fill="none" stroke="currentColor" stroke-width="46" stroke-linejoin="round" stroke-linecap="round" />
      </svg>
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
  .empty-mark { color: var(--ink-4); opacity: 0.35; }
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
