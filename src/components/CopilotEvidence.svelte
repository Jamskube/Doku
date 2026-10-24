<script lang="ts">
  import type { ChatMsg } from '../lib/copilot.svelte'
  import type { CitedPassage } from '../lib/citations'
  import { citedWebCitationNumbers, visibleWebCitations, webCitationHost } from '../lib/web-citations'
  import { fileIcon } from '../lib/file-icon'
  import { middleTruncate } from '../lib/middle-truncate'
  import { placeHoverCard } from '../lib/hover-card'

  interface Props {
    message: ChatMsg
    expanded?: boolean
    collapsed?: boolean
    onReveal: (source: CitedPassage) => void
    onOpenWeb: (url: string) => void
    onOpenMemory: () => void
  }

  let { message, expanded = false, collapsed = false, onReveal, onOpenWeb, onOpenMemory }: Props = $props()

  const uid = $props.id()
  const LABEL_MAX = 28

  const shownPassages = $derived(message.citedOnly
    ? (message.sources ?? []).filter((source) => message.cited?.includes(source.n))
    : (message.sources ?? []))
  // Recherche menée par Doku : on montre ce qui a RÉELLEMENT été transmis au modèle, sans
  // dépendre de sa docilité au format `[web:n]`. Tool hébergé OpenAI : la liste vient déjà
  // de ses annotations, on la filtre sur ce que la réponse cite vraiment.
  const shownWeb = $derived(message.webCitedOnly
    ? visibleWebCitations(message.content, message.webCitations ?? [])
    : (message.webCitations ?? []))
  const citedWeb = $derived(citedWebCitationNumbers(message.content, message.webCitations?.length ?? 0))
  const sourceCount = $derived(
    shownPassages.length + shownWeb.length + (message.contextSources?.length ?? 0) + (message.memorySources?.length ?? 0),
  )
  const runningActivity = $derived(message.activity?.find((activity) => activity.state === 'running'))

  // Même contrat que l'attribut `open` d'un <details> : ouvert pendant le flux, replié à
  // la fin ; un clic l'emporte jusqu'au prochain changement de l'état automatique.
  let activityOpen = $derived(!collapsed && (message.streaming || expanded))
  let sourcesOpen = $derived(!collapsed && expanded)
  let kbd = $state(false)

  function activityStateLabel(state: NonNullable<ChatMsg['activity']>[number]['state']): string {
    if (state === 'error') return 'Échec'
    if (state === 'done') return 'Terminé'
    if (state === 'pending') return 'En attente'
    return 'En cours'
  }

  // --- Aperçu d'une source (Kube hover card) : 200 ms après l'arrivée du pointeur, tout
  // de suite au focus clavier, jamais au doigt (le toucher déclenche l'action). Rendu en
  // couche supérieure (`popover`) : la carte du panneau et la liste défilante le rogneraient.
  interface SourcePreview { key: string; anchor: HTMLElement; num?: number; title: string; meta?: string; text?: string }
  let preview = $state.raw<SourcePreview | null>(null)
  let openTimer = 0
  let closeTimer = 0

  function showPreview(next: SourcePreview, delay: number) {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
    openTimer = window.setTimeout(() => (preview = next), delay)
  }

  function hidePreview(delay = 0) {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
    closeTimer = window.setTimeout(() => (preview = null), delay)
  }

  $effect(() => () => {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
  })

  function hoverCard(key: string, data: () => Omit<SourcePreview, 'key' | 'anchor'>) {
    const open = (event: Event, delay: number) => showPreview({ key, anchor: event.currentTarget as HTMLElement, ...data() }, delay)
    return {
      // Carte déjà ouverte : passer d'une puce à l'autre ne réarme pas le délai.
      onpointerenter: (event: PointerEvent) => { if (event.pointerType !== 'touch') open(event, preview ? 0 : 200) },
      onpointerleave: () => hidePreview(100),
      onfocus: (event: FocusEvent) => { if ((event.currentTarget as HTMLElement).matches(':focus-visible')) open(event, 0) },
      onblur: () => hidePreview(),
      // Échap ferme l'aperçu seul, pas le tiroir qui contient la puce.
      onkeydown: (event: KeyboardEvent) => {
        if (event.key === 'Escape' && preview) {
          event.stopPropagation()
          hidePreview()
        }
      },
    }
  }

  function describedBy(key: string): string | undefined {
    return preview?.key === key ? `${uid}-preview` : undefined
  }

  function mountPreview(el: HTMLElement) {
    const current = preview
    if (!current) return
    if (typeof el.showPopover === 'function' && !el.matches(':popover-open')) el.showPopover()
    const place = placeHoverCard(
      current.anchor.getBoundingClientRect(),
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    )
    el.style.left = `${place.left}px`
    el.style.top = `${place.top}px`
    el.style.transformOrigin = `${place.originX}px ${place.side === 'bottom' ? 'top' : 'bottom'}`
    const close = () => hidePreview()
    window.addEventListener('scroll', close, { capture: true, passive: true })
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('scroll', close, { capture: true })
      window.removeEventListener('resize', close)
    }
  }
</script>

{#if message.activity?.length}
  <div class="steps" class:kbd data-expanded={activityOpen} data-streaming={message.streaming || undefined}>
    <button
      type="button"
      class="steps-head"
      aria-expanded={activityOpen}
      aria-controls="{uid}-activity"
      onclick={(event) => { kbd = event.detail === 0; activityOpen = !activityOpen }}
    >
      {#if runningActivity && !activityOpen}<span class="pulse" aria-hidden="true"></span>{/if}
      <span class="steps-title">{runningActivity?.label ?? `Activité · ${message.activity.length} étape${message.activity.length > 1 ? 's' : ''}`}</span>
      <svg class="icon chevron" aria-hidden="true"><use href="#i-chevron-right" /></svg>
    </button>
    <div class="steps-body" id="{uid}-activity" inert={!activityOpen}>
      <div class="steps-inner">
        <ol class="entries">
          {#each message.activity as activity (activity.id)}
            <li class="entry" data-status={activity.state}>
              <span class="dot" aria-hidden="true"></span>
              <span class="entry-text">
                <span class="sr-only">{activityStateLabel(activity.state)} : </span>
                <strong>{activity.label}</strong>
                {#if activity.detail}<small>{activity.detail}</small>{/if}
              </span>
            </li>
          {/each}
        </ol>
      </div>
    </div>
  </div>
{/if}

{#if sourceCount > 0 && !message.streaming}
  <div class="steps" class:kbd data-expanded={sourcesOpen}>
    <button
      type="button"
      class="steps-head"
      aria-expanded={sourcesOpen}
      aria-controls="{uid}-sources"
      onclick={(event) => { kbd = event.detail === 0; sourcesOpen = !sourcesOpen }}
    >
      <span class="steps-title">Sources et contexte</span>
      <span class="source-count">{sourceCount}</span>
      <svg class="icon chevron" aria-hidden="true"><use href="#i-chevron-right" /></svg>
    </button>
    <div class="steps-body" id="{uid}-sources" inert={!sourcesOpen}>
      <div class="steps-inner">
        <div class="evidence-list">
          {#if shownWeb.length}
            <section>
              <h4>{message.webCitedOnly ? 'Sources Web citées' : 'Sources Web consultées'}</h4>
              <div class="sources">
                {#each shownWeb as source (source.n)}
                  {@const cited = citedWeb.has(source.n)}
                  {@const host = webCitationHost(source.url)}
                  <button
                    type="button"
                    class="source"
                    class:cited
                    aria-label={`Source Web ${source.n}${cited ? ', citée' : ''} : ${source.title}`}
                    aria-describedby={describedBy(`w${source.n}`)}
                    onclick={() => { hidePreview(); onOpenWeb(source.url) }}
                    {...hoverCard(`w${source.n}`, () => ({ num: source.n, title: source.title, meta: cited ? `${host} · citée dans la réponse` : host, text: source.snippet }))}
                  >
                    <svg class="icon source-icon" aria-hidden="true"><use href="#i-globe" /></svg>
                    <span class="source-label">{middleTruncate(host || source.title, LABEL_MAX)}</span>
                    <span class="source-num">{source.n}</span>
                  </button>
                {/each}
              </div>
            </section>
          {/if}

          {#if shownPassages.length}
            <section>
              <h4>{message.citedOnly ? 'Passages cités' : 'Passages consultés'}</h4>
              <div class="sources">
                {#each shownPassages as source (source.n)}
                  {@const name = source.name ?? 'Document courant'}
                  <button
                    type="button"
                    class="source"
                    aria-label={`Passage ${source.n} : ${name}`}
                    aria-describedby={describedBy(`p${source.n}`)}
                    onclick={() => { hidePreview(); onReveal(source) }}
                    {...hoverCard(`p${source.n}`, () => ({ num: source.n, title: name, meta: source.path ?? undefined, text: source.text }))}
                  >
                    <svg class="icon source-icon" aria-hidden="true"><use href="#i-{source.name ? fileIcon(source.name) : 'file-text'}" /></svg>
                    <span class="source-label">{middleTruncate(name, LABEL_MAX)}</span>
                    <span class="source-num">{source.n}</span>
                  </button>
                {/each}
              </div>
            </section>
          {/if}

          {#if message.contextSources?.length}
            <section>
              <h4>Contexte transmis</h4>
              <div class="sources">
                {#each message.contextSources as source (source.id)}
                  {@const partial = source.truncatedAtLoad || source.truncatedForRequest}
                  {@const short = middleTruncate(source.label, LABEL_MAX)}
                  <span class="source" title={partial ? 'Transmis partiellement' : 'Transmis en entier'}>
                    <svg class="icon source-icon" aria-hidden="true"><use href="#i-{source.kind === 'clipboard' ? 'clipboard-paste' : source.kind === 'selection' ? 'text-align-justify-start' : 'file-text'}" /></svg>
                    {#if short === source.label}
                      <span class="source-label">{source.label}</span>
                    {:else}
                      <span class="source-label" aria-hidden="true">{short}</span><span class="sr-only">{source.label}</span>
                    {/if}
                    {#if partial}<span class="source-tag">partiel</span>{/if}
                  </span>
                {/each}
              </div>
            </section>
          {/if}

          {#if message.memorySources?.length}
            <section>
              <h4>Mémoire utilisée</h4>
              <div class="sources">
                {#each message.memorySources as memory (memory.id)}
                  <button
                    type="button"
                    class="source"
                    aria-label={`Souvenir : ${memory.name}`}
                    aria-describedby={describedBy(`m${memory.id}`)}
                    onclick={() => { hidePreview(); onOpenMemory() }}
                    {...hoverCard(`m${memory.id}`, () => ({ title: memory.name, text: memory.content }))}
                  >
                    <svg class="icon source-icon" aria-hidden="true"><use href="#i-brain" /></svg>
                    <span class="source-label">{middleTruncate(memory.name, LABEL_MAX)}</span>
                  </button>
                {/each}
              </div>
            </section>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

{#if preview}
  <div class="source-preview" id="{uid}-preview" role="tooltip" popover="manual" {@attach mountPreview}>
    <div class="preview-head">
      {#if preview.num}<span class="source-num">{preview.num}</span>{/if}
      <strong>{preview.title}</strong>
    </div>
    {#if preview.meta}<small>{preview.meta}</small>{/if}
    {#if preview.text}<p>{preview.text}</p>{/if}
  </div>
{/if}

<style>
  /* Anatomie Kube WorkflowSteps : en-tête repliable, corps 0fr → 1fr, corps replié inert. */
  .steps { margin-top: 10px; color: var(--ink-3); }
  .steps-head {
    width: 100%;
    min-height: var(--control-md);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: inherit;
    font: var(--weight-control) var(--text-sm)/var(--leading-tight) var(--font-sans);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease;
  }
  /* Survols de rangée réservés à la souris : au doigt, ils resteraient allumés après le toucher. */
  @media (hover: hover) and (pointer: fine) {
    .steps-head:hover { background: var(--surface-hover); color: var(--ink); }
    button.source:hover { background: var(--fill-pressed); color: var(--ink); }
  }
  /* Le tiroir défile : l'anneau se dessine à l'intérieur pour ne pas être rogné. */
  .steps-head:focus-visible { outline-offset: -2px; }
  .steps-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* Se referme plus vite qu'il ne s'ouvre (200 / 300 ms). */
  .chevron { flex: none; font-size: 14px; color: var(--ink-4); transition: transform var(--duration-moderate) var(--ease-move); }
  .steps[data-expanded='true'] .chevron { transform: rotate(90deg); transition-duration: var(--duration-relaxed); }
  .steps-body { display: grid; grid-template-rows: 0fr; transition: grid-template-rows var(--duration-relaxed) var(--ease-move); }
  .steps[data-expanded='true'] > .steps-body { grid-template-rows: 1fr; }
  .steps-inner { min-height: 0; overflow: hidden; }
  .kbd .steps-body, .kbd .chevron { transition: none; }

  /* Un seul point vivant par bloc : celui de l'en-tête quand la liste est repliée,
     celui de l'étape en cours quand elle est ouverte (aucune boucle sous un corps masqué). */
  .pulse { width: 6px; height: 6px; flex: none; border-radius: var(--radius-full); background: var(--ink); }
  .pulse, .steps[data-expanded='true'] .entry[data-status='running'] .dot::before { animation: steps-pulse 1.2s ease-in-out infinite; }
  /* Mouvement réduit : la règle globale figerait le point, et « en cours » ne se
     distinguerait plus de « terminé ». La pulsation est d'opacité seule : on la garde.
     Longhands et non le raccourci : celui-ci réimposerait `animation-play-state` et
     relancerait la boucle du panneau fermé. */
  @media (prefers-reduced-motion: reduce) {
    .pulse, .steps[data-expanded='true'] .entry[data-status='running'] .dot::before {
      animation-duration: 1.2s !important;
      animation-iteration-count: infinite !important;
    }
  }
  /* Panneau fermé (visibility: hidden) : aucune boucle ne tourne pour rien. */
  :global(.cop-panel:not(.open)) .pulse,
  :global(.cop-panel:not(.open)) .steps[data-expanded='true'] .entry[data-status='running'] .dot::before { animation-play-state: paused; }
  @keyframes steps-pulse { 50% { opacity: 0.35; } }

  .entries { --steps-line: 20px; margin: 0; padding: 0 8px 8px; list-style: none; }
  .entry {
    display: flex;
    padding-top: 8px;
    line-height: var(--steps-line);
    transition: opacity var(--duration-relaxed) var(--ease-move), transform var(--duration-relaxed) var(--ease-move);
  }
  @starting-style {
    .steps[data-streaming] .entry { opacity: 0; transform: translateY(-6px); }
  }
  /* Colonne 12 px : point de 6 px centré sur la première ligne, filet jusqu'à l'étape suivante. */
  .dot { position: relative; flex: none; align-self: stretch; width: 12px; margin-inline-end: 8px; }
  .dot::before { content: ''; position: absolute; top: calc(var(--steps-line) / 2 - 3px); left: 3px; width: 6px; height: 6px; box-sizing: border-box; border-radius: var(--radius-full); background: var(--ink-5); }
  .dot::after { content: ''; position: absolute; top: var(--steps-line); bottom: -8px; left: 5.5px; width: 1px; background: var(--line-1); }
  .entry:last-child .dot::after { display: none; }
  .entry[data-status='pending'] .dot::before { border: 1px solid var(--ink-5); background: none; }
  .entry[data-status='running'] .dot::before { background: var(--ink); }
  .entry[data-status='error'] .dot::before { background: var(--err); }
  .entry[data-status='running'] .entry-text { color: var(--ink); }
  .entry[data-status='error'] .entry-text { color: var(--err-text); }
  .entry-text { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .entry-text strong { font: var(--weight-control) var(--text-sm)/var(--steps-line) var(--font-sans); color: inherit; overflow-wrap: anywhere; }
  .entry-text small {
    overflow: hidden;
    color: var(--ink-3);
    font: var(--weight-regular) var(--text-xs)/var(--leading-snug) var(--font-sans);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entry[data-status='error'] .entry-text small { color: inherit; }

  .source-count, .source-num {
    min-width: 18px;
    height: 18px;
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 5px;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--ink-2);
    font: var(--weight-strong) var(--text-2xs)/1 var(--font-sans);
    font-variant-numeric: tabular-nums;
  }
  .evidence-list { max-height: 280px; overflow-y: auto; padding: 6px 0 4px; }
  section + section { margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--line-1); }
  /* Intitulé de section en casse normale, comme partout ailleurs dans Doku. */
  h4 { margin: 0 8px 6px; color: var(--ink-3); font: var(--weight-control) var(--text-xs)/var(--leading-snug) var(--font-sans); }

  /* Anatomie Kube Source : puce pilule, icône de type, nom coupé au milieu, numéro. */
  .sources { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 8px; }
  .source {
    max-width: 100%;
    height: var(--control-2xs);
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--ink-3);
    font: var(--weight-regular) var(--text-xs)/var(--leading-normal) var(--font-sans);
    letter-spacing: var(--tracking-badge);
    white-space: nowrap;
  }
  button.source { cursor: pointer; transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease; }
  /* Puce dont l'aperçu est ouvert : même état que le survol (Kube `aria-expanded`). */
  button.source[aria-describedby] { background: var(--fill-pressed); color: var(--ink); }
  .source:has(.source-num) { padding-inline-end: 3px; }
  .source-icon { flex: none; font-size: 14px; color: var(--ink-4); }
  .source-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .source .source-num { min-width: 16px; height: 16px; padding: 0 4px; background: var(--cream-content); color: var(--ink-3); letter-spacing: 0; }
  /* Toutes les sources listées ont été transmises au modèle ; celles-ci, il les a citées. */
  .source.cited .source-num { background: var(--ink); color: var(--cream-content); }
  .source-tag { flex: none; color: var(--ink-4); font-size: var(--text-2xs); }
  :global(:where(:root[data-input='touch'])) .source { height: 40px; padding-inline: 12px; }
  /* Au doigt, le numéro garde en fin l'écart qu'il a en haut et en bas ((40 − 16) / 2). */
  :global(:where(:root[data-input='touch'])) .source:has(.source-num) { padding-inline-end: 12px; }
  :global(:where(:root[data-input='touch'])) .sources { gap: 6px; }
  :global(:where(:root[data-input='touch'])) .steps-head { min-height: 40px; }

  /* Aperçu : hors flux (couche supérieure), positionné en JS, grandit depuis la puce. */
  .source-preview {
    position: fixed;
    inset: auto;
    width: min(300px, calc(100vw - 16px));
    margin: 0;
    padding: 12px 12px 10px;
    overflow: hidden;
    border: 0;
    border-radius: var(--radius-xl);
    background: var(--composer-bg);
    color: var(--ink);
    box-shadow: var(--shadow-xl);
    pointer-events: none;
    animation: doku-pop-in var(--duration-moderate) var(--ease-enter-snappy);
  }
  .preview-head { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .preview-head strong { min-width: 0; overflow: hidden; font: var(--weight-strong) var(--text-sm)/var(--leading-snug) var(--font-sans); text-overflow: ellipsis; white-space: nowrap; }
  .source-preview small { display: block; margin-top: 2px; overflow: hidden; color: var(--ink-3); font: var(--weight-regular) var(--text-xs)/var(--leading-snug) var(--font-sans); text-overflow: ellipsis; white-space: nowrap; }
  .source-preview p {
    display: -webkit-box;
    margin-top: 6px;
    overflow: hidden;
    color: var(--ink-2);
    font: var(--weight-regular) var(--text-xs)/var(--leading-normal) var(--font-sans);
    text-wrap: pretty;
    line-clamp: 7;
    -webkit-line-clamp: 7;
    -webkit-box-orient: vertical;
  }

  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
</style>
