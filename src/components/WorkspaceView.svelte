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
  bind:this={root}
>
  <!-- flex-basis posé sur chaque volet, pas en variable sur .workspace : pendant le glisser,
       une variable héritée réécrite à chaque frame recalculerait le style des deux éditeurs. -->
  <div class="workspace-pane primary" style:flex-basis={workspace.split ? `${workspace.ratio}%` : '100%'}>
    <DocumentPane paneId="primary" onOpen={() => onOpen('primary')} onNewNote={newNote} />
  </div>

  {#if workspace.split}
    <SplitDivider orientation={vertical ? 'vertical' : 'horizontal'} ratio={workspace.ratio} onChange={resizeWorkspace} />
    <div class="workspace-pane secondary" style:flex-basis={`${100 - workspace.ratio}%`}>
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
  }
  .workspace-pane > :global(*) { flex: 1; min-width: 0; min-height: 0; }
  .workspace-pane.primary { flex-grow: 0; flex-shrink: 1; }
  .workspace-pane.secondary { flex-grow: 1; flex-shrink: 1; }
  .workspace.split.vertical { flex-direction: column; }
</style>
