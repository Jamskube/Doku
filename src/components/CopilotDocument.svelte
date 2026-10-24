<script lang="ts">
  import { tick } from 'svelte'
  import {
    generatedDocumentFileName,
    generatedDocumentPrintSource,
    generatedDocumentPreview,
    generatedDocumentStandalone,
    type DocumentBlockTarget,
    type GeneratedDocumentArtifact,
  } from '../lib/generated-document'
  import { exportViaPrint } from '../lib/export/print'
  import { app, openGeneratedTab } from '../lib/stores.svelte'
  import { isTauri, saveHtmlDialog } from '../lib/tauri'
  import { tooltip } from '../lib/tooltip'

  let { artifact, onModify }: {
    artifact: GeneratedDocumentArtifact
    onModify: (artifact: GeneratedDocumentArtifact, target?: DocumentBlockTarget) => void
  } = $props()

  let expanded = $state(false)
  let previewDialog = $state<HTMLDialogElement | null>(null)
  let saved = $state(false)
  const preview = $derived(generatedDocumentPreview(artifact, app.theme))
  const formatLabel = $derived(artifact.kind === 'pdf' ? 'Document PDF' : 'Page HTML')
  const reviewLabel = $derived(artifact.review?.visual ? 'vérifié visuellement' : artifact.review ? 'mise en page contrôlée' : 'créé à partir du contexte')

  async function openExpanded() {
    expanded = true
    await tick()
    previewDialog?.showModal()
  }

  function closeExpanded() {
    previewDialog?.close()
    expanded = false
  }

  // --- Désigner une partie : dans l'aperçu agrandi, un clic choisit un bloc (repère
  // data-doku-id posé par generatedDocumentPreview). L'iframe reste sans script (sandbox sans
  // allow-scripts, CSP default-src 'none') ; allow-same-origin laisse seulement Doku écouter
  // ses clics et marquer le bloc de l'extérieur.
  const BLOCK = '[data-doku-id]:not(style)'
  // L'iframe n'hérite pas des jetons de Doku : on y injecte la valeur résolue (et donc
  // celle du thème courant ; un changement de thème recharge l'aperçu et repasse ici).
  function pickCss(): string {
    const color = getComputedStyle(document.documentElement).getPropertyValue('--warn-text').trim() || 'Highlight'
    return `${BLOCK}{cursor:pointer}[data-doku-hover]{outline:1px dashed ${color}!important;outline-offset:2px}[data-doku-picked]{outline:2px solid ${color}!important;outline-offset:2px}`
  }
  let picked = $state<DocumentBlockTarget | null>(null)
  let canWiden = $state(false)
  let pickedEl: Element | null = null

  function describeBlock(el: Element): string {
    // innerText (texte rendu) sépare les blocs ; textContent collerait « Ingrédients1 pot… ».
    const text = ((el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text) return text.length > 80 ? `${text.slice(0, 79)}…` : text
    const tag = el.tagName.toLowerCase()
    return tag === 'svg' || tag === 'figure' ? 'Illustration' : tag === 'table' ? 'Tableau' : tag === 'hr' ? 'Séparateur' : 'Bloc sans texte'
  }

  function pick(el: Element | null) {
    pickedEl?.removeAttribute('data-doku-picked')
    pickedEl = el
    el?.setAttribute('data-doku-picked', '')
    picked = el ? { id: el.getAttribute('data-doku-id') ?? '', excerpt: describeBlock(el) } : null
    canWiden = Boolean(el?.parentElement?.closest(BLOCK))
  }

  function attachPicker(frame: HTMLIFrameElement) {
    pick(null)
    const doc = frame.contentDocument
    if (!doc?.head) return
    const style = doc.createElement('style')
    style.textContent = pickCss()
    doc.head.append(style)
    // Éléments d'un autre royaume JS : `instanceof Element` échouerait, on teste `closest`.
    const blockAt = (target: EventTarget | null) => (target as Element | null)?.closest?.(BLOCK) ?? null
    let hovered: Element | null = null
    const hover = (block: Element | null) => {
      hovered?.removeAttribute('data-doku-hover')
      hovered = block
      block?.setAttribute('data-doku-hover', '')
    }
    doc.addEventListener('mouseover', (event) => hover(blockAt(event.target)))
    doc.documentElement.addEventListener('mouseleave', () => hover(null))
    doc.addEventListener('click', (event) => {
      event.preventDefault()
      pick(blockAt(event.target))
    })
  }

  function designate() {
    if (!picked) return
    onModify(artifact, picked)
    closeExpanded()
  }

  // Le document devient un onglet HTML non enregistré, avec la CSP et la feuille papier
  // du fichier autonome : Ctrl+S enregistre exactement ce que l'export produirait.
  function openInTab() {
    openGeneratedTab(generatedDocumentFileName({ ...artifact, kind: 'html' }), generatedDocumentStandalone(artifact))
  }

  async function exportHtml() {
    const html = generatedDocumentStandalone(artifact)
    const fileName = generatedDocumentFileName({ ...artifact, kind: 'html' })
    if (isTauri) {
      saved = await saveHtmlDialog(fileName, html)
    } else {
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = fileName
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 0)
      saved = true
    }
    if (saved) setTimeout(() => (saved = false), 2_000)
  }

  function exportPdf() {
    exportViaPrint({ kind: 'html', name: generatedDocumentFileName(artifact), content: generatedDocumentPrintSource(artifact) })
  }
</script>

<section class="card" aria-label={`${formatLabel} : ${artifact.title}`}>
  <header class="card-head">
    <span class="card-mark" aria-hidden="true"><svg class="icon" aria-hidden="true"><use href="#i-{artifact.kind === 'pdf' ? 'file-text' : 'file-code'}" /></svg></span>
    <div class="card-heading">
      <strong class="card-title">{artifact.title}</strong>
      <small class="card-meta">{formatLabel} · {reviewLabel}</small>
    </div>
    <button class="btn icon-btn" use:tooltip={'Agrandir'} aria-label={`Agrandir ${artifact.title}`} onclick={openExpanded}><svg class="icon" aria-hidden="true"><use href="#i-maximize-2" /></svg></button>
  </header>

  <button class="card-stage preview" class:paper={artifact.kind === 'pdf'} use:tooltip={'Ouvrir dans un onglet'} aria-label={`Ouvrir ${artifact.title} dans un onglet`} onclick={openInTab}>
    <iframe title={`Aperçu de ${artifact.title}`} sandbox="" srcdoc={preview}></iframe>
    <span class="preview-shield" aria-hidden="true"></span>
  </button>

  <footer class="card-actions">
    <button class="btn" onclick={openInTab}><svg class="icon" aria-hidden="true"><use href="#i-external-link" /></svg>Ouvrir</button>
    <button class="btn" onclick={() => onModify(artifact)}><svg class="icon" aria-hidden="true"><use href="#i-pencil" /></svg>Modifier</button>
    <button class="btn" title="Désigner une partie à modifier" aria-label={`Désigner une partie de ${artifact.title} à modifier`} onclick={openExpanded}><svg class="icon" aria-hidden="true"><use href="#i-mouse-pointer-click" /></svg>Cibler</button>
    <span class="card-spacer"></span>
    {#if artifact.kind === 'html'}
      <button class="btn" onclick={() => void exportHtml()}><span class="swap" aria-hidden="true"><svg class="icon" class:out={saved}><use href="#i-download" /></svg><svg class="icon" class:out={!saved}><use href="#i-check" /></svg></span>{saved ? 'Enregistré' : 'Exporter'}</button>
    {:else}
      <button class="btn" onclick={exportPdf}><svg class="icon" aria-hidden="true"><use href="#i-file-down" /></svg>Exporter</button>
    {/if}
  </footer>
</section>

{#if expanded}
  <dialog bind:this={previewDialog} class="dialog document-dialog" aria-label={`Aperçu agrandi : ${artifact.title}`} onclose={() => (expanded = false)} onclick={(event) => { if (event.target === previewDialog) closeExpanded() }}>
    <header class="dialog-head">
      <div class="card-heading"><strong class="dialog-title">{artifact.title}</strong><small class="card-meta">{formatLabel}</small></div>
      <div class="dialog-actions">
        {#if artifact.kind === 'html'}
          <button class="btn lg" onclick={() => void exportHtml()}><svg class="icon" aria-hidden="true"><use href="#i-download" /></svg>Exporter</button>
        {:else}
          <button class="btn lg" onclick={exportPdf}><svg class="icon" aria-hidden="true"><use href="#i-file-down" /></svg>Exporter</button>
        {/if}
        <button class="btn lg icon-btn" use:tooltip={{ label: 'Fermer', kbd: 'Échap' }} aria-label="Fermer l’aperçu" onclick={closeExpanded}><svg class="icon" aria-hidden="true"><use href="#i-x" /></svg></button>
      </div>
    </header>
    <div class="dialog-stage" class:paper={artifact.kind === 'pdf'}>
      <iframe title={`Document ${artifact.title}`} sandbox="allow-same-origin" srcdoc={preview} onload={(event) => attachPicker(event.currentTarget as HTMLIFrameElement)}></iframe>
    </div>
    <div class="pick-bar" class:active={picked}>
      <svg class="icon" aria-hidden="true"><use href="#i-mouse-pointer-click" /></svg>
      {#if picked}
        <span class="pick-text" title={picked.excerpt}>{picked.excerpt}</span>
        <button class="btn lg" disabled={!canWiden} onclick={() => pick(pickedEl?.parentElement?.closest(BLOCK) ?? null)}><svg class="icon" aria-hidden="true"><use href="#i-chevrons-up-down" /></svg>Élargir</button>
        <button class="btn lg primary" onclick={designate}><svg class="icon" aria-hidden="true"><use href="#i-pencil" /></svg>Modifier cette partie</button>
      {:else}
        <span class="pick-text">Cliquez sur une partie du document pour la désigner à Doku-San.</span>
      {/if}
    </div>
  </dialog>
{/if}

<style>
  /* Grammaire des cartes de livrable (Kube Card : en-tête, scène, actions). Bloc IDENTIQUE
     dans CopilotDocument.svelte et CopilotDiagram.svelte : modifier les deux ensemble. */
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
  .btn.primary { background: var(--ink); color: var(--cream-content); }
  @media (hover: hover) and (pointer: fine) {
    .btn:not(:disabled):hover { background: var(--fill-hover); color: var(--ink); }
    .btn.primary:not(:disabled):hover { background: var(--ink-2); color: var(--cream-content); }
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

  .preview { position: relative; display: block; width: calc(100% - 16px); height: 230px; padding: 0; overflow: hidden; border: 0; background: var(--cream-content); cursor: pointer; }
  .preview iframe { width: 150%; height: 150%; border: 0; transform: scale(.6667); transform-origin: top left; pointer-events: none; }
  .preview.paper iframe { width: 180%; height: 180%; transform: scale(.5556); }
  .preview-shield { position: absolute; inset: 0; }
  /* Téléchargement → coche : les deux icônes occupent la même cellule et se croisent. */
  .swap { display: inline-grid; }
  .swap > .icon { grid-area: 1 / 1; transition: opacity var(--duration-relaxed) var(--ease-icon), transform var(--duration-relaxed) var(--ease-icon), filter var(--duration-relaxed) var(--ease-icon); }
  .swap > .out { opacity: 0; transform: scale(0.25); filter: blur(4px); }
  .document-dialog { width: min(1180px, calc(100vw - 48px)); height: min(900px, calc(100vh - 48px)); }
  .dialog-actions { display: flex; align-items: center; gap: 4px; }
  .dialog-stage { height: calc(100% - 52px - 48px); padding: 12px; background: var(--cream-content); }
  .pick-bar { height: 48px; display: flex; align-items: center; gap: 8px; padding: 0 12px 0 16px; color: var(--ink-3); font: var(--weight-regular) var(--text-sm)/var(--leading-tight) var(--font-sans); }
  .pick-bar.active { color: var(--ink); }
  .pick-bar > .icon { font-size: 16px; }
  .pick-text { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dialog-stage.paper { overflow: auto; background: var(--surface-2); }
  .dialog-stage iframe { width: 100%; height: 100%; border: 0; border-radius: var(--radius-md); background: var(--cream-content); }
  /* 794 px de feuille + la scrollbar verticale du document : sans cette réserve,
     un layout A4 exact déborde horizontalement dès que l'iframe doit défiler. */
  .dialog-stage.paper iframe { display: block; width: min(826px, 100%); margin: 0 auto; }
</style>
