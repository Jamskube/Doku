<script lang="ts">
  import { tick } from 'svelte'
  import { renderBgraph, type DiagramArtifact } from '../lib/bgraph'
  import { isTauri, saveSvgDialog } from '../lib/tauri'

  let {
    artifact,
    onModify,
    onSelect,
  }: {
    artifact: DiagramArtifact
    onModify: (artifact: DiagramArtifact) => void
    onSelect: (candidateId: string) => void
  } = $props()

  let svg = $state('')
  let imageUrl = $state('')
  let candidateImages = $state<Record<string, string>>({})
  let error = $state('')
  let loading = $state(true)
  let expanded = $state(false)
  let alternativesOpen = $state(false)
  let previewDialog = $state<HTMLDialogElement | null>(null)
  let alternativesDialog = $state<HTMLDialogElement | null>(null)
  let renderNonce = 0
  let alternativesNonce = 0

  const selectedCandidate = $derived(
    artifact.studio?.candidates.find((candidate) => candidate.id === artifact.studio?.selectedCandidateId),
  )
  const alternatives = $derived(artifact.studio?.candidates ?? [])
  // Le passage par <img src="data:…"> rend inertes le role="img", l'aria-label et les
  // <title> que le moteur produit : ce texte est le seul que porte le diagramme.
  const imageAlt = $derived(artifact.studio?.brief.desiredInsight || artifact.title)

  function svgDataUrl(rendered: string): string {
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(rendered)}`
  }

  $effect(() => {
    const source = artifact.source
    const nonce = ++renderNonce
    loading = true
    error = ''
    imageUrl = ''
    void renderBgraph(source)
      .then((rendered) => {
        if (nonce !== renderNonce) return
        svg = rendered
        // La CSP native autorise `data:` pour les images, pas `blob:`. Le contenu a déjà
        // traversé l'allowlist SVG stricte de bgraph.ts avant d'arriver ici.
        imageUrl = svgDataUrl(rendered)
      })
      .catch((cause) => {
        if (nonce !== renderNonce) return
        error = cause instanceof Error ? cause.message : 'Le diagramme n’a pas pu être affiché.'
      })
      .finally(() => {
        if (nonce === renderNonce) loading = false
      })
    return () => {
      renderNonce += 1
      imageUrl = ''
    }
  })

  $effect(() => {
    const candidates = alternatives
    const nonce = ++alternativesNonce
    if (candidates.length < 2) {
      candidateImages = {}
      return
    }
    void Promise.all(candidates.map(async (candidate) => {
      try {
        return [candidate.id, svgDataUrl(await renderBgraph(candidate.source))] as const
      } catch {
        return [candidate.id, ''] as const
      }
    })).then((entries) => {
      if (nonce === alternativesNonce) candidateImages = Object.fromEntries(entries)
    })
    return () => { alternativesNonce += 1 }
  })

  async function openExpanded() {
    expanded = true
    await tick()
    previewDialog?.showModal()
  }

  function closeExpanded() {
    previewDialog?.close()
    expanded = false
  }

  async function openAlternatives() {
    alternativesOpen = true
    await tick()
    alternativesDialog?.showModal()
  }

  function closeAlternatives() {
    alternativesDialog?.close()
    alternativesOpen = false
  }

  function chooseCandidate(candidateId: string) {
    onSelect(candidateId)
    closeAlternatives()
  }

  async function exportSvg() {
    if (!svg) return
    const name = `${artifact.title.replace(/[<>:"/\\|?*]+/g, '-').slice(0, 72) || 'diagramme'}.svg`
    if (isTauri) {
      await saveSvgDialog(name, svg)
      return
    }
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
</script>

<section class="diagram" aria-label={`Diagramme : ${artifact.title}`}>
  <header>
    <span class="diagram-mark" aria-hidden="true"><span class="msr">account_tree</span></span>
    <div class="diagram-heading">
      <strong>{artifact.title}</strong>
      <small>
        {#if selectedCandidate}<span>{selectedCandidate.label}</span>{/if}
        {#if artifact.studio?.rationale}<span class="rationale">{artifact.studio.rationale}</span>{:else}<span>Créé à partir du contexte</span>{/if}
      </small>
    </div>
    {#if imageUrl}
      <button class="icon-button" title="Agrandir le diagramme" aria-label="Agrandir le diagramme" onclick={openExpanded}><span class="msr">open_in_full</span></button>
    {/if}
  </header>

  <div class="diagram-stage" class:loading>
    {#if loading}
      <div class="diagram-skeleton" aria-label="Rendu du diagramme en cours"></div>
    {:else if error}
      <div class="diagram-error" role="alert"><span class="msr">error</span><span>{error}</span></div>
    {:else if imageUrl}
      <img src={imageUrl} alt={imageAlt} />
    {/if}
  </div>

  <footer>
    {#if alternatives.length > 1}
      <button class="alternatives-trigger" onclick={openAlternatives}>
        <span class="msr">view_column</span>
        Autres vues
        <span class="view-count">{alternatives.length - 1}</span>
      </button>
      <span class="footer-spacer"></span>
    {/if}
    <button onclick={() => onModify(artifact)}><span class="msr">edit</span>Modifier</button>
    <button disabled={!svg} onclick={() => void exportSvg()}><span class="msr">download</span>Exporter SVG</button>
  </footer>
</section>

{#if expanded}
  <dialog bind:this={previewDialog} class="diagram-dialog" aria-label={`Aperçu agrandi : ${artifact.title}`} onclose={() => (expanded = false)} onclick={(event) => { if (event.target === previewDialog) closeExpanded() }}>
    <header>
      <strong>{artifact.title}</strong>
      <button class="icon-button" title="Fermer" aria-label="Fermer l’aperçu" onclick={closeExpanded}><span class="msr">close</span></button>
    </header>
    {#if imageUrl}<img src={imageUrl} alt={imageAlt} />{/if}
  </dialog>
{/if}

{#if alternativesOpen}
  <dialog
    bind:this={alternativesDialog}
    class="alternatives-dialog"
    aria-label="Autres vues du diagramme"
    onclose={() => (alternativesOpen = false)}
    onclick={(event) => { if (event.target === alternativesDialog) closeAlternatives() }}
  >
    <header>
      <div><strong>Autres vues</strong><small>Choisis l’angle le plus utile pour ton document.</small></div>
      <button class="icon-button" title="Fermer" aria-label="Fermer les autres vues" onclick={closeAlternatives}><span class="msr">close</span></button>
    </header>
    <div class="view-grid">
      {#each alternatives as candidate (candidate.id)}
        <button
          class="view-option"
          class:selected={candidate.id === artifact.studio?.selectedCandidateId}
          aria-pressed={candidate.id === artifact.studio?.selectedCandidateId}
          onclick={() => chooseCandidate(candidate.id)}
        >
          <span class="view-preview">
            {#if candidateImages[candidate.id]}
              <img src={candidateImages[candidate.id]} alt="" />
            {:else}
              <span class="msr">account_tree</span>
            {/if}
          </span>
          <span class="view-copy">
            <span class="view-title">{candidate.label}</span>
            <span class="view-thesis">{candidate.thesis}</span>
          </span>
          {#if candidate.id === artifact.studio?.selectedCandidateId}
            <span class="view-selected"><span class="msr">check</span>Actuelle</span>
          {/if}
        </button>
      {/each}
    </div>
  </dialog>
{/if}

<style>
  .diagram {
    margin-top: 9px;
    overflow: hidden;
    border: 0;
    border-radius: 15px;
    background: var(--surface-2);
    color: var(--ink);
  }
  .diagram > header {
    min-height: 50px;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 8px 7px 11px;
  }
  .diagram-mark {
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    background: var(--cream-content);
    color: var(--ink-3);
  }
  .diagram-mark .msr { font-size: 17px; }
  .diagram-heading { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .diagram strong { overflow: hidden; font: 600 12.5px/1.35 var(--font-sans); text-overflow: ellipsis; white-space: nowrap; }
  .diagram small { min-width: 0; display: flex; align-items: center; gap: 6px; color: var(--ink-4); font: 400 10.5px/1.3 var(--font-sans); }
  .diagram small > span:first-child:not(:last-child) { flex: 0 0 auto; color: var(--ink-3); }
  .rationale { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .diagram button, .diagram-dialog button, .alternatives-dialog button {
    min-height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    padding: 0 9px;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--ink-3);
    font: 500 11px/1 var(--font-sans);
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease, transform 100ms ease;
  }
  .diagram button:hover, .diagram-dialog button:hover, .alternatives-dialog button:hover { background: var(--surface-hover); color: var(--ink); }
  .diagram button:active, .diagram-dialog button:active, .alternatives-dialog button:active { transform: scale(0.96); }
  .diagram button:focus-visible, .diagram-dialog button:focus-visible, .alternatives-dialog button:focus-visible { outline: 2px solid var(--line-3); outline-offset: -2px; }
  .diagram button:disabled { opacity: 0.4; cursor: default; }
  .diagram button .msr, .diagram-dialog button .msr, .alternatives-dialog button .msr { font-size: 15px; }
  .icon-button { width: 32px; padding: 0 !important; flex: 0 0 auto; }
  .diagram-stage {
    min-height: 190px;
    max-height: 460px;
    margin: 0 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    border-radius: 11px;
    /* Le diagramme peint son propre fond blanc. Ce qu'on voit ici n'est que le
       letterbox laissé par `object-fit: contain` : il doit se fondre dans le
       panneau, pas y poser une dalle blanche en thème sombre. */
    background: var(--surface-2);
  }
  .diagram-stage img { display: block; width: 100%; height: auto; min-height: 180px; max-height: 450px; object-fit: contain; }
  .diagram-skeleton {
    width: calc(100% - 28px);
    height: 160px;
    border-radius: 9px;
    background: linear-gradient(100deg, rgba(0,0,0,.035) 20%, rgba(0,0,0,.075) 36%, rgba(0,0,0,.035) 52%);
    background-size: 220% 100%;
    animation: diagram-loading 1.4s ease-in-out infinite;
  }
  .diagram-error { display: flex; align-items: center; gap: 8px; padding: 18px; color: var(--err-text); font: 500 12px/1.45 var(--font-sans); }
  .diagram-error .msr { font-size: 18px; }
  .diagram > footer { display: flex; align-items: center; gap: 3px; padding: 6px 8px 7px; }
  .footer-spacer { flex: 1; }
  .view-count {
    min-width: 17px;
    height: 17px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: var(--surface-hover);
    font-size: 9.5px;
  }
  @keyframes diagram-loading { to { background-position-x: -220%; } }

  .diagram-dialog,
  .alternatives-dialog {
    max-width: none;
    margin: auto;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: 18px;
    background: var(--cream-content);
    color: var(--ink);
    box-shadow: 0 28px 76px rgba(var(--shadow-rgb), 0.34), 0 6px 20px rgba(var(--shadow-rgb), 0.16);
  }
  .diagram-dialog { width: min(1100px, calc(100vw - 52px)); height: min(780px, calc(100vh - 52px)); }
  .diagram-dialog::backdrop, .alternatives-dialog::backdrop { background: rgba(0, 0, 0, 0.48); }
  .diagram-dialog > header { height: 52px; display: flex; align-items: center; gap: 10px; padding: 0 10px 0 16px; }
  .diagram-dialog > header strong { flex: 1; font: 600 13px/1.4 var(--font-sans); }
  .diagram-dialog > img { display: block; width: 100%; height: calc(100% - 52px); padding: 14px; object-fit: contain; background: var(--surface-2); }

  .alternatives-dialog { width: min(920px, calc(100vw - 44px)); max-height: min(720px, calc(100vh - 44px)); }
  .alternatives-dialog > header { min-height: 62px; display: flex; align-items: center; gap: 14px; padding: 9px 12px 9px 18px; }
  .alternatives-dialog > header > div { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 3px; }
  .alternatives-dialog > header strong { font: 620 15px/1.3 var(--font-sans); }
  .alternatives-dialog > header small { color: var(--ink-4); font: 400 11.5px/1.35 var(--font-sans); }
  .view-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr));
    gap: 10px;
    padding: 4px 12px 12px;
    overflow: auto;
    max-height: calc(min(720px, 100vh - 44px) - 62px);
  }
  .alternatives-dialog .view-option {
    position: relative;
    min-width: 0;
    min-height: 0;
    display: grid;
    grid-template-rows: 158px auto;
    align-content: start;
    padding: 6px;
    border-radius: 13px;
    background: var(--surface-2);
    color: var(--ink);
    text-align: left;
    transform: none;
  }
  .alternatives-dialog .view-option:hover { background: var(--surface-hover); }
  .alternatives-dialog .view-option.selected { box-shadow: inset 0 0 0 1.5px var(--line-3); }
  .view-preview { min-width: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: 9px; background: var(--surface-2); color: var(--ink-3); }
  .view-preview img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .view-preview > .msr { font-size: 28px; }
  .view-copy { min-width: 0; display: flex; flex-direction: column; gap: 4px; padding: 10px 8px 7px; }
  .view-title { font: 600 12px/1.3 var(--font-sans); }
  .view-thesis { min-height: 2.7em; overflow: hidden; color: var(--ink-4); font: 400 11px/1.35 var(--font-sans); display: -webkit-box; line-clamp: 2; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .view-selected { position: absolute; margin: 10px; justify-self: end; display: inline-flex; align-items: center; gap: 3px; padding: 4px 7px; border-radius: 7px; background: var(--cream-content); color: var(--ink-2); font: 600 9.5px/1 var(--font-sans); box-shadow: 0 2px 8px rgba(var(--shadow-rgb), .12); }
  .view-selected .msr { font-size: 12px !important; }

  @media (max-width: 620px) {
    .diagram > footer { flex-wrap: wrap; }
    .footer-spacer { display: none; }
    .alternatives-trigger { margin-right: auto; }
    .alternatives-dialog { width: calc(100vw - 24px); max-height: calc(100vh - 24px); }
    .view-grid { grid-template-columns: 1fr; max-height: calc(100vh - 98px); }
    .alternatives-dialog .view-option { grid-template-columns: 116px 1fr; grid-template-rows: minmax(92px, auto); }
  }

  @media (prefers-reduced-motion: reduce) {
    .diagram button, .diagram-dialog button, .alternatives-dialog button { transition-duration: 0.01ms; }
    .diagram-skeleton { animation: none; }
  }
</style>
