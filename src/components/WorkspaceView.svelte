<script lang="ts">
  import { onMount } from 'svelte'
  import DocumentPane from './DocumentPane.svelte'
  import SplitDivider from './SplitDivider.svelte'
  import {
    createWorkspaceNote,
    resizeWorkspace,
    workspace,
    workspaceLayout,
  } from '../lib/stores.svelte'
  import { clampWorkspaceRatioForSize, type PaneId } from '../lib/workspace'

  let { onOpen }: { onOpen: (paneId?: PaneId) => void } = $props()
  let root: HTMLElement | undefined = $state()
  let vertical = $state(false)
  let dragging = $state(false)

  function newNote(paneId: PaneId) {
    createWorkspaceNote(paneId)
  }

  onMount(() => {
    if (!root) return
    const observer = new ResizeObserver(([entry]) => {
      vertical = entry.contentRect.width < 720
      workspaceLayout.stacked = vertical
      const size = vertical ? entry.contentRect.height : entry.contentRect.width
      resizeWorkspace(clampWorkspaceRatioForSize(workspace.ratio, size, vertical ? 240 : 280))
    })
    observer.observe(root)
    return () => {
      observer.disconnect()
      workspaceLayout.stacked = false
    }
  })
</script>

<div
  class="workspace"
  class:split={workspace.split}
  class:vertical
  class:dragging
  bind:this={root}
  style={`--workspace-ratio:${workspace.ratio}%`}
>
  <div class="workspace-pane primary">
    <DocumentPane paneId="primary" onOpen={() => onOpen('primary')} onNewNote={newNote} />
  </div>

  {#if workspace.split}
    <SplitDivider orientation={vertical ? 'vertical' : 'horizontal'} ratio={workspace.ratio} onChange={resizeWorkspace} onDragging={(value) => (dragging = value)} />
    <div class="workspace-pane secondary">
      <DocumentPane paneId="secondary" showLocalSelector={vertical} onOpen={() => onOpen('secondary')} onNewNote={newNote} />
    </div>
  {/if}
</div>

<style>
  .workspace {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    overflow: hidden;
    background: var(--cream-content);
  }
  .workspace-pane {
    min-width: 0;
    min-height: 0;
    display: flex;
    transition: flex-basis 220ms cubic-bezier(0.22, 1, 0.36, 1);
  }
  .workspace.dragging .workspace-pane { transition: none; }
  .workspace-pane > :global(*) { flex: 1; min-width: 0; min-height: 0; }
  .workspace-pane.primary { flex: 0 1 var(--workspace-ratio); }
  .workspace-pane.secondary { flex: 1 1 calc(100% - var(--workspace-ratio)); }
  .workspace:not(.split) .workspace-pane.primary { flex-basis: 100%; }
  .workspace.split.vertical { flex-direction: column; }
  .workspace.split.vertical .workspace-pane.primary { flex-basis: var(--workspace-ratio); }
  .workspace.split.vertical .workspace-pane.secondary { flex-basis: calc(100% - var(--workspace-ratio)); }
  @media (prefers-reduced-motion: reduce) {
    .workspace-pane { transition-duration: 0.01ms; }
  }
</style>
