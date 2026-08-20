<script lang="ts">
  import type { ChatMsg } from '../lib/copilot.svelte'
  import type { CitedPassage } from '../lib/citations'
  import { visibleWebCitations, webCitationHost } from '../lib/web-citations'

  interface Props {
    message: ChatMsg
    expanded?: boolean
    collapsed?: boolean
    onReveal: (source: CitedPassage) => void
    onOpenWeb: (url: string) => void
    onOpenMemory: () => void
  }

  let { message, expanded = false, collapsed = false, onReveal, onOpenWeb, onOpenMemory }: Props = $props()

  const shownPassages = $derived(message.citedOnly
    ? (message.sources ?? []).filter((source) => message.cited?.includes(source.n))
    : (message.sources ?? []))
  const shownWeb = $derived(visibleWebCitations(message.content, message.webCitations ?? []))
  const sourceCount = $derived(
    shownPassages.length + shownWeb.length + (message.contextSources?.length ?? 0) + (message.memorySources?.length ?? 0),
  )
  const runningActivity = $derived(message.activity?.find((activity) => activity.state === 'running'))

  function activityIcon(kind: NonNullable<ChatMsg['activity']>[number]['kind']): string {
    if (kind === 'web-plan' || kind === 'web-search') return 'search'
    if (kind === 'memory') return 'memory'
    if (kind === 'answer') return 'edit_note'
    return 'description'
  }

  function activityStateIcon(state: NonNullable<ChatMsg['activity']>[number]['state']): string {
    if (state === 'error') return 'error'
    if (state === 'done') return 'check'
    return 'more_horiz'
  }

  function activityStateLabel(state: NonNullable<ChatMsg['activity']>[number]['state']): string {
    if (state === 'error') return 'Échec'
    if (state === 'done') return 'Terminé'
    return 'En cours'
  }
</script>

{#if message.activity?.length}
  <details class="activity" open={!collapsed && (message.streaming || expanded)}>
    <summary>
      <span class="activity-lead msr" class:spinning={Boolean(runningActivity)} aria-hidden="true">
        {runningActivity ? 'progress_activity' : 'check_circle'}
      </span>
      <span>{runningActivity?.label ?? `Activité · ${message.activity.length} étape${message.activity.length > 1 ? 's' : ''}`}</span>
      <span class="summary-chevron msr" aria-hidden="true">expand_more</span>
    </summary>
    <div class="activity-list">
      {#each message.activity as activity (activity.id)}
        <div class="activity-row" class:running={activity.state === 'running'} class:error={activity.state === 'error'}>
          <span class="msr activity-kind" aria-hidden="true">{activityIcon(activity.kind)}</span>
          <span class="activity-copy">
            <strong>{activity.label}</strong>
            {#if activity.detail}<small>{activity.detail}</small>{/if}
          </span>
          <span class="msr activity-state" aria-label={activityStateLabel(activity.state)}>
            {activityStateIcon(activity.state)}
          </span>
        </div>
      {/each}
    </div>
  </details>
{/if}

{#if sourceCount > 0 && !message.streaming}
  <details class="evidence" open={!collapsed && expanded}>
    <summary>
      <span class="msr" aria-hidden="true">link</span>
      <span>Sources et contexte</span>
      <span class="source-count">{sourceCount}</span>
      <span class="summary-chevron msr" aria-hidden="true">expand_more</span>
    </summary>
    <div class="evidence-list">
      {#if shownWeb.length}
        <section>
          <h4>Web</h4>
          {#each shownWeb as source (source.n)}
            <button class="source-row" onclick={() => onOpenWeb(source.url)} title={source.url}>
              <span class="source-index">{source.n}</span>
              <span class="source-copy">
                <strong>{source.title}</strong>
                <small>{source.snippet ?? webCitationHost(source.url)}</small>
              </span>
              <span class="msr source-open" aria-hidden="true">open_in_new</span>
            </button>
          {/each}
        </section>
      {/if}

      {#if shownPassages.length}
        <section>
          <h4>{message.citedOnly ? 'Passages cités' : 'Passages consultés'}</h4>
          {#each shownPassages as source (source.n)}
            <button class="source-row" onclick={() => onReveal(source)} title={source.path ?? undefined}>
              <span class="source-index">{source.n}</span>
              <span class="source-copy">
                <strong>{source.name ?? 'Document courant'}</strong>
                <small>{source.text}</small>
              </span>
              <span class="msr source-open" aria-hidden="true">arrow_forward</span>
            </button>
          {/each}
        </section>
      {/if}

      {#if message.contextSources?.length}
        <section>
          <h4>Contexte transmis</h4>
          {#each message.contextSources as source (source.id)}
            <div class="source-row static">
              <span class="msr source-index" aria-hidden="true">{source.kind === 'clipboard' ? 'content_paste' : source.kind === 'selection' ? 'notes' : 'description'}</span>
              <span class="source-copy">
                <strong>{source.label}</strong>
                <small>{source.truncatedAtLoad || source.truncatedForRequest ? 'Transmis partiellement' : 'Transmis en entier'}</small>
              </span>
            </div>
          {/each}
        </section>
      {/if}

      {#if message.memorySources?.length}
        <section>
          <h4>Mémoire utilisée</h4>
          {#each message.memorySources as memory (memory.id)}
            <button class="source-row" onclick={onOpenMemory} title={memory.content}>
              <span class="msr source-index" aria-hidden="true">memory</span>
              <span class="source-copy"><strong>{memory.name}</strong><small>{memory.content}</small></span>
              <span class="msr source-open" aria-hidden="true">arrow_forward</span>
            </button>
          {/each}
        </section>
      {/if}
    </div>
  </details>
{/if}

<style>
  details { margin-top: 10px; color: var(--ink-3); }
  summary {
    min-height: 30px;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 0 9px;
    border-radius: 10px;
    font: 500 11.5px/1.3 var(--font-sans);
    cursor: pointer;
    list-style: none;
    transition: background 120ms ease, color 120ms ease;
  }
  summary::-webkit-details-marker { display: none; }
  summary:hover { background: var(--surface-hover); color: var(--ink); }
  summary:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .summary-chevron { margin-left: auto; font-size: 17px; transition: transform 160ms ease; }
  details[open] .summary-chevron { transform: rotate(180deg); }
  .activity-lead { font-size: 15px; }
  .activity-lead.spinning { animation: activity-spin 1.1s linear infinite; }
  .activity-list, .evidence-list {
    margin: 4px 0 0 13px;
    padding: 4px 0 2px 12px;
    border-left: 1px solid var(--line-2);
  }
  .activity-row {
    min-height: 30px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 8px;
  }
  .activity-row.running { color: var(--ink); }
  .activity-row.error { color: var(--err-text); }
  .activity-kind, .activity-state { flex: 0 0 auto; font-size: 15px; color: var(--ink-4); }
  .activity-copy, .source-copy { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
  .activity-copy { flex: 1; }
  .activity-copy strong, .source-copy strong { font: 500 11.5px/1.35 var(--font-sans); color: inherit; }
  .activity-copy small, .source-copy small {
    overflow: hidden;
    color: var(--ink-4);
    font: 400 10.5px/1.4 var(--font-sans);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .source-count {
    min-width: 19px;
    padding: 1px 6px;
    border-radius: 999px;
    background: var(--surface-2);
    color: var(--ink-4);
    font-size: 10px;
    text-align: center;
  }
  .evidence-list { max-height: 280px; overflow-y: auto; padding-right: 5px; }
  section + section { margin-top: 9px; padding-top: 8px; border-top: 1px solid var(--line-1); }
  h4 { margin: 0 8px 4px; color: var(--ink-4); font: 600 10px/1.4 var(--font-sans); letter-spacing: .04em; text-transform: uppercase; }
  .source-row {
    width: 100%;
    min-height: 42px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--ink-2);
    text-align: left;
  }
  button.source-row { cursor: pointer; }
  button.source-row:hover { background: var(--surface-hover); }
  button.source-row:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .source-index {
    width: 23px;
    height: 23px;
    flex: 0 0 23px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 7px;
    background: var(--surface-2);
    color: var(--ink-3);
    font: 600 10.5px/1 var(--font-sans);
  }
  .source-index.msr {
    font-family: 'Material Symbols Rounded';
    font-size: 15px;
    font-weight: 400;
  }
  .source-copy { flex: 1; }
  .source-open { flex: 0 0 auto; color: var(--ink-4); font-size: 15px; }
  @keyframes activity-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    .activity-lead.spinning { animation: none; }
    .summary-chevron { transition: none; }
  }
</style>
