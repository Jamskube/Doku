<script lang="ts">
  import { tick } from 'svelte'
  import { renderBgraph, type DiagramArtifact } from '../lib/bgraph'
  import { isTauri, saveSvgDialog } from '../lib/tauri'
  import { openGeneratedTab } from '../lib/stores.svelte'
  import { escapeHtml } from '../lib/export/print'
  import { tooltip } from '../lib/tooltip'

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

  // Le diagramme devient un onglet HTML non enregistré (le SVG inline suffit) :
  // lisible en grand, enregistrable par Ctrl+S, imprimable par l'export de l'onglet.
  function openInTab() {
    if (!svg) return
    const name = `${artifact.title.replace(/[<>:"/\|?*]+/g, '-').slice(0, 72) || 'diagramme'}.html`
    openGeneratedTab(name, `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${escapeHtml(artifact.title)}</title><style>body{display:flex;justify-content:center}svg{max-width:100%;height:auto}</style></head><body>${svg}</body></html>`)
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

<section class="card" aria-label={`Diagramme : ${artifact.title}`}>
  <header class="card-head">
    <span class="card-mark" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-network" /></svg></span>
    <div class="card-heading">
      <strong class="card-title">{artifact.title}</strong>
      <small class="card-meta diagram-meta">
        {#if selectedCandidate}<span>{selectedCandidate.label}</span>{/if}
        {#if artifact.studio?.rationale}<span class="rationale">{artifact.studio.rationale}</span>{:else}<span>Créé à partir du contexte</span>{/if}
      </small>
    </div>
    {#if imageUrl}
      <button class="btn icon-btn" use:tooltip={'Agrandir le diagramme'} aria-label="Agrandir le diagramme" onclick={openExpanded}><svg class="icon" aria-hidden="true"><use href="#i-maximize-2" /></svg></button>
    {/if}
  </header>

  <div class="card-stage diagram-stage">
    {#if loading}
      <div class="diagram-skeleton doku-skel" aria-label="Rendu du diagramme en cours"></div>
    {:else if error}
      <div class="diagram-error" role="alert"><svg class="icon" aria-hidden="true"><use href="#i-circle-alert" /></svg><span>{error}</span></div>
    {:else if imageUrl}
      <button class="diagram-open" use:tooltip={'Ouvrir dans un onglet'} aria-label={`Ouvrir ${artifact.title} dans un onglet`} onclick={openInTab}><img src={imageUrl} alt={imageAlt} /></button>
    {/if}
  </div>

  <footer class="card-actions">
    {#if alternatives.length > 1}
      <button class="btn" onclick={openAlternatives}>
        <svg class="icon" aria-hidden="true"><use href="#i-columns-2" /></svg>
        Autres vues
        <span class="view-count">{alternatives.length - 1}</span>
      </button>
      <span class="card-spacer"></span>
    {/if}
    <button class="btn" disabled={!svg} onclick={openInTab}><svg class="icon" aria-hidden="true"><use href="#i-external-link" /></svg>Ouvrir</button>
    <button class="btn" onclick={() => onModify(artifact)}><svg class="icon" aria-hidden="true"><use href="#i-pencil" /></svg>Modifier</button>
    <button class="btn" disabled={!svg} onclick={() => void exportSvg()}><svg class="icon" aria-hidden="true"><use href="#i-download" /></svg>Exporter SVG</button>
  </footer>
</section>

{#if expanded}
  <dialog bind:this={previewDialog} class="dialog diagram-dialog" aria-label={`Aperçu agrandi : ${artifact.title}`} onclose={() => (expanded = false)} onclick={(event) => { if (event.target === previewDialog) closeExpanded() }}>
    <header class="dialog-head">
      <strong class="dialog-title">{artifact.title}</strong>
      <button class="btn lg icon-btn" use:tooltip={{ label: 'Fermer', kbd: 'Échap' }} aria-label="Fermer l’aperçu" onclick={closeExpanded}><svg class="icon" aria-hidden="true"><use href="#i-x" /></svg></button>
    </header>
    {#if imageUrl}<img src={imageUrl} alt={imageAlt} />{/if}
  </dialog>
{/if}

{#if alternativesOpen}
  <dialog
    bind:this={alternativesDialog}
    class="dialog alternatives-dialog"
    aria-label="Autres vues du diagramme"
    onclose={() => (alternativesOpen = false)}
    onclick={(event) => { if (event.target === alternativesDialog) closeAlternatives() }}
  >
    <header class="dialog-head">
      <div class="card-heading"><strong class="dialog-title">Autres vues</strong><small class="card-meta">Choisissez l’angle le plus utile pour votre document.</small></div>
      <button class="btn lg icon-btn" use:tooltip={{ label: 'Fermer', kbd: 'Échap' }} aria-label="Fermer les autres vues" onclick={closeAlternatives}><svg class="icon" aria-hidden="true"><use href="#i-x" /></svg></button>
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
              <svg class="icon" aria-hidden="true"><use href="#i-network" /></svg>
            {/if}
          </span>
          <span class="view-copy">
            <span class="view-title">{candidate.label}</span>
            <span class="view-thesis">{candidate.thesis}</span>
          </span>
          {#if candidate.id === artifact.studio?.selectedCandidateId}
            <span class="view-selected"><svg class="icon" aria-hidden="true"><use href="#i-check" /></svg>Actuelle</span>
          {/if}
        </button>
      {/each}
    </div>
  </dialog>
{/if}

<style>
  /* Grammaire des cartes de livrable (Kube Card : en-tête, scène, actions). Bloc IDENTIQUE
     dans CopilotDocument.svelte et CopilotDiagram.svelte (ici sans la variante .primary,
     inutilisée) : modifier les deux ensemble. */
  .card { margin-top: 10px; overflow: hidden; border-radius: var(--radius-2xl); background: var(--surface-2); color: var(--ink); }
  .card-head { min-height: 48px; display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; }
  .card-mark { width: var(--control-sm); height: var(--control-sm); flex: none; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-md); background: var(--cream-content); color: var(--ink-3); font-size: 16px; }
  .card-heading { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
  .card-title { overflow: hidden; font: var(--weight-strong) var(--text-sm)/var(--leading-snug) var(--font-sans); text-overflow: ellipsis; white-space: nowrap; }
  .card-meta { min-width: 0; overflow: hidden; color: var(--ink-3); font: var(--weight-regular) var(--text-xs)/var(--leading-tight) var(--font-sans); text-overflow: ellipsis; white-space: nowrap; }
  /* Scène en retrait de 8 px dans une carte de 16 px : rayon 8, coins concentriques. */
  .card-stage { margin: 0 8px; border-radius: var(--radius-md); }
  .card-actions { min-height: 44px; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 8px; }
  .card-spacer { flex: 1; }
  /* Bouton fantôme : 28 px dans la carte, 32 px (.lg) dans les modales, 40 px au doigt. */
  .btn { height: var(--control-sm); flex: none; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 0 8px 0 6px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--ink-3); font: var(--weight-control) var(--text-sm)/1 var(--font-sans); white-space: nowrap; cursor: pointer; transition: background-color var(--duration-basic) ease, color var(--duration-basic) ease, transform var(--duration-basic) var(--ease-enter-snappy); }
  .btn .icon { font-size: 14px; }
  .btn.icon-btn { width: var(--control-sm); padding: 0; color: var(--ink-4); }
  .btn.icon-btn .icon, .btn.lg .icon { font-size: 16px; }
  .btn.lg { height: var(--control-md); padding: 0 10px 0 8px; border-radius: var(--radius-lg); }
  .btn.lg.icon-btn { width: var(--control-md); padding: 0; }
  @media (hover: hover) and (pointer: fine) {
    .btn:not(:disabled):hover { background: var(--fill-hover); color: var(--ink); }
  }
  .btn:not(:disabled):active { transform: scale(0.97); }
  .btn:disabled { opacity: var(--opacity-disabled); cursor: default; }
  :global(:where(:root[data-input='touch'])) .btn { height: 40px; }
  :global(:where(:root[data-input='touch'])) .btn.icon-btn { width: 40px; }
  :global(:where(:root[data-input='touch'])) .btn.lg { height: 40px; }
  :global(:where(:root[data-input='touch'])) .btn.lg.icon-btn { width: 40px; }
  /* `margin: auto` et les `max-*` ne sont PAS décoratifs : le reset universel d'app.css
     (`*, *::before, *::after { margin: 0 }`) écrase le `margin: auto` que le navigateur
     pose sur <dialog> pour le centrer, et la modale retombe en haut à gauche. Les bornes
     de l'agent utilisateur (`calc(100% - 6px - 2em)`) rogneraient en plus la taille
     demandée. Toutes les autres modales de Doku posent les trois pour la même raison. */
  .dialog { max-width: none; max-height: none; margin: auto; padding: 0; overflow: hidden; border: 0; border-radius: var(--radius-2xl); background: var(--surface); color: var(--ink); box-shadow: var(--shadow-dialog); animation: doku-dialog-in var(--duration-dialog) var(--ease-enter-snappy); }
  /* Voile discret, partagé par toutes les modales de Doku. */
  .dialog::backdrop { background: var(--scrim); animation: doku-fade-in var(--duration-dialog) var(--ease-enter-snappy); }
  .dialog-head { height: 52px; display: flex; align-items: center; gap: 12px; padding: 0 12px 0 16px; }
  .dialog-head > :first-child { min-width: 0; flex: 1; }
  .dialog-title { overflow: hidden; font: var(--weight-strong) var(--text-lg)/var(--leading-tight) var(--font-sans); letter-spacing: var(--tracking-tight); text-overflow: ellipsis; white-space: nowrap; }
  /* Fin du bloc commun. */

  .diagram-meta { display: flex; align-items: center; gap: 6px; }
  .diagram-meta > span:first-child:not(:last-child) { flex: none; color: var(--ink-2); }
  .rationale { overflow: hidden; text-overflow: ellipsis; }
  .diagram-stage {
    min-height: 190px;
    max-height: 460px;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    /* Le diagramme peint son propre fond blanc. Ce qu'on voit ici n'est que le
       letterbox laissé par `object-fit: contain` : il doit se fondre dans le
       panneau, pas y poser une dalle blanche en thème sombre. */
    background: var(--surface-2);
  }
  .diagram-stage img { display: block; width: 100%; height: auto; min-height: 180px; max-height: 450px; object-fit: contain; }
  .diagram-open { display: block; width: 100%; padding: 0; border: 0; background: transparent; cursor: pointer; }
  /* Ces deux surfaces défilent : un anneau extérieur y serait rogné. */
  .diagram-open:focus-visible, .view-option:focus-visible { outline-offset: -2px; }
  /* Le balayage vient de `.doku-skel` (app.css) ; seul le fond est rehaussé, la scène
     ayant déjà la teinte --surface-2 du squelette. */
  .diagram-skeleton { width: calc(100% - 28px); height: 160px; border-radius: var(--radius-md); background: var(--surface-hover); }
  .diagram-error { display: flex; align-items: center; gap: 8px; padding: 18px; color: var(--err-text); font: var(--weight-control) var(--text-xs)/var(--leading-snug) var(--font-sans); text-wrap: pretty; }
  .diagram-error .icon { font-size: 16px; }
  .view-count {
    min-width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 4px;
    /* Compteur : pilule ; une étiquette (« Actuelle ») garde --radius-xs. */
    border-radius: var(--radius-full);
    background: var(--accent-soft);
    color: var(--ink-2);
    font: var(--weight-strong) var(--text-2xs)/1 var(--font-sans);
    font-variant-numeric: tabular-nums;
  }

  .diagram-dialog { width: min(1100px, calc(100vw - 52px)); height: min(780px, calc(100vh - 52px)); }
  .diagram-dialog > img { display: block; width: 100%; height: calc(100% - 52px); padding: 14px; object-fit: contain; background: var(--surface-2); }

  .alternatives-dialog { width: min(920px, calc(100vw - 44px)); max-height: min(720px, calc(100vh - 44px)); }
  .view-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(230px, 100%), 1fr));
    gap: 10px;
    padding: 4px 12px 12px;
    overflow: auto;
    max-height: calc(min(720px, 100vh - 44px) - 52px);
  }
  /* Carte de vue : une surface, pas un bouton d'action (pas de pression). */
  .view-option {
    position: relative;
    min-width: 0;
    display: grid;
    grid-template-rows: 158px auto;
    align-content: start;
    gap: 5px;
    padding: 6px;
    border: 0;
    border-radius: var(--radius-xl);
    background: var(--surface-2);
    color: var(--ink);
    text-align: left;
    cursor: pointer;
    transition: background-color var(--duration-basic) ease, box-shadow var(--duration-basic) ease;
  }
  /* Voile d'encre sur la carte : --fill-hover seul (transparent) éclaircirait --surface-2. */
  @media (hover: hover) and (pointer: fine) {
    .view-option:hover { background: var(--accent-soft); }
  }
  .view-option.selected { box-shadow: inset 0 0 0 1.5px var(--line-3); }
  .view-preview { min-width: 0; display: flex; align-items: center; justify-content: center; overflow: hidden; border-radius: var(--radius-sm); background: var(--surface-2); color: var(--ink-4); }
  .view-preview img { display: block; width: 100%; height: 100%; object-fit: contain; }
  .view-preview > .icon { font-size: 24px; stroke-width: 1.5; }
  .view-copy { min-width: 0; display: flex; flex-direction: column; gap: 4px; padding: 10px 8px 8px; }
  .view-title { font: var(--weight-strong) var(--text-sm)/var(--leading-tight) var(--font-sans); }
  .view-thesis { min-height: 2.8em; overflow: hidden; color: var(--ink-3); font: var(--weight-regular) var(--text-xs)/var(--leading-snug) var(--font-sans); display: -webkit-box; line-clamp: 2; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .view-selected { position: absolute; margin: 12px; justify-self: end; height: 18px; display: inline-flex; align-items: center; gap: 4px; padding: 0 6px; border-radius: var(--radius-xs); background: var(--cream-content); color: var(--ink); font: var(--weight-strong) var(--text-2xs)/1 var(--font-sans); box-shadow: var(--shadow-md), 0 0 0 0.5px var(--elevation-ring); }
  .view-selected .icon { font-size: 12px; }

  /* Modale : dimensionnée sur la fenêtre, d'où une requête de viewport (la carte, elle,
     n'en a pas besoin : son pied passe à la ligne tout seul). */
  @media (max-width: 620px) {
    .alternatives-dialog { width: calc(100vw - 24px); max-height: calc(100vh - 24px); }
    .view-grid { grid-template-columns: 1fr; max-height: calc(100vh - 88px); }
    .view-option { grid-template-columns: 116px 1fr; grid-template-rows: minmax(92px, auto); }
  }
</style>
