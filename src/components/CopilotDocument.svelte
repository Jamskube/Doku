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
  const PICK_CSS = `${BLOCK}{cursor:pointer}[data-doku-hover]{outline:1px dashed #b45309!important;outline-offset:2px}[data-doku-picked]{outline:2px solid #b45309!important;outline-offset:2px}`
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
    style.textContent = PICK_CSS
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

<section class="generated" class:paper={artifact.kind === 'pdf'} aria-label={`${formatLabel} : ${artifact.title}`}>
  <header>
    <span class="mark" aria-hidden="true"><span class="msr">{artifact.kind === 'pdf' ? 'picture_as_pdf' : 'html'}</span></span>
    <div class="heading">
      <strong>{artifact.title}</strong>
      <small>{formatLabel} · {reviewLabel}</small>
    </div>
    <button class="icon-button" title="Agrandir" aria-label={`Agrandir ${artifact.title}`} onclick={openExpanded}><span class="msr">open_in_full</span></button>
  </header>

  <button class="preview" class:paper={artifact.kind === 'pdf'} title="Ouvrir dans un onglet" aria-label={`Ouvrir ${artifact.title} dans un onglet`} onclick={openInTab}>
    <iframe title={`Aperçu de ${artifact.title}`} sandbox="" srcdoc={preview}></iframe>
    <span class="preview-shield" aria-hidden="true"></span>
  </button>

  <footer>
    <button onclick={openInTab}><span class="msr">open_in_new</span>Ouvrir</button>
    <button onclick={() => onModify(artifact)}><span class="msr">edit</span>Modifier</button>
    <button title="Désigner une partie à modifier" aria-label={`Désigner une partie de ${artifact.title} à modifier`} onclick={openExpanded}><span class="msr">ads_click</span>Cibler</button>
    <span class="spacer"></span>
    {#if artifact.kind === 'html'}
      <button onclick={() => void exportHtml()}><span class="msr">{saved ? 'check' : 'download'}</span>{saved ? 'Enregistré' : 'Exporter'}</button>
    {:else}
      <button onclick={exportPdf}><span class="msr">picture_as_pdf</span>Exporter</button>
    {/if}
  </footer>
</section>

{#if expanded}
  <dialog bind:this={previewDialog} class="document-dialog" aria-label={`Aperçu agrandi : ${artifact.title}`} onclose={() => (expanded = false)} onclick={(event) => { if (event.target === previewDialog) closeExpanded() }}>
    <header>
      <div><strong>{artifact.title}</strong><small>{formatLabel}</small></div>
      <div class="dialog-actions">
        {#if artifact.kind === 'html'}
          <button onclick={() => void exportHtml()}><span class="msr">download</span>Exporter</button>
        {:else}
          <button onclick={exportPdf}><span class="msr">picture_as_pdf</span>Exporter</button>
        {/if}
        <button class="icon-button" title="Fermer" aria-label="Fermer l’aperçu" onclick={closeExpanded}><span class="msr">close</span></button>
      </div>
    </header>
    <div class="dialog-stage" class:paper={artifact.kind === 'pdf'}>
      <iframe title={`Document ${artifact.title}`} sandbox="allow-same-origin" srcdoc={preview} onload={(event) => attachPicker(event.currentTarget as HTMLIFrameElement)}></iframe>
    </div>
    <div class="pick-bar" class:active={picked}>
      <span class="msr">ads_click</span>
      {#if picked}
        <span class="pick-text" title={picked.excerpt}>{picked.excerpt}</span>
        <button disabled={!canWiden} onclick={() => pick(pickedEl?.parentElement?.closest(BLOCK) ?? null)}><span class="msr">unfold_more</span>Élargir</button>
        <button class="primary" onclick={designate}><span class="msr">edit</span>Modifier cette partie</button>
      {:else}
        <span class="pick-text">Cliquez sur une partie du document pour la désigner à Doku-San.</span>
      {/if}
    </div>
  </dialog>
{/if}

<style>
  .generated { margin-top: 9px; overflow: hidden; border-radius: 15px; background: var(--surface-2); color: var(--ink); }
  .generated > header { min-height: 50px; display: flex; align-items: center; gap: 9px; padding: 7px 8px 7px 11px; }
  .mark { width: 30px; height: 30px; flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; border-radius: 9px; background: var(--cream-content); color: var(--ink-3); }
  .mark .msr { font-size: 17px; }
  .heading { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
  strong { overflow: hidden; font: 600 12.5px/1.35 var(--font-sans); text-overflow: ellipsis; white-space: nowrap; }
  small { color: var(--ink-4); font: 400 10.5px/1.3 var(--font-sans); }
  button { font-family: var(--font-sans); }
  .icon-button { width: 32px; height: 32px; padding: 0; border: 0; border-radius: 9px; background: transparent; color: var(--ink-4); cursor: pointer; }
  .icon-button:hover { background: var(--surface-hover); color: var(--ink); }
  .icon-button .msr { font-size: 17px; }
  .preview { position: relative; display: block; width: calc(100% - 16px); height: 230px; margin: 0 8px; padding: 0; overflow: hidden; border: 0; border-radius: 11px; background: var(--cream-content); cursor: pointer; }
  .preview iframe { width: 150%; height: 150%; border: 0; transform: scale(.6667); transform-origin: top left; pointer-events: none; }
  .preview.paper iframe { width: 180%; height: 180%; transform: scale(.5556); }
  .preview-shield { position: absolute; inset: 0; }
  footer { min-height: 45px; display: flex; align-items: center; gap: 3px; padding: 6px 8px; }
  footer button, .document-dialog header button { white-space: nowrap; min-height: 30px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 0 9px; border: 0; border-radius: 9px; background: transparent; color: var(--ink-3); font-size: 11px; font-weight: 550; cursor: pointer; }
  footer button:hover, .document-dialog header button:hover { background: var(--surface-hover); color: var(--ink); }
  footer .msr, .document-dialog header .msr { font-size: 15px; }
  .spacer { flex: 1; }
  /* `margin: auto` et les `max-*` ne sont PAS décoratifs : le reset universel d'app.css
     (`*, *::before, *::after { margin: 0 }`) écrase le `margin: auto` que le navigateur
     pose sur <dialog> pour le centrer, et la modale retombe en haut à gauche. Les bornes
     de l'agent utilisateur (`calc(100% - 6px - 2em)`) rogneraient en plus la taille
     demandée. Toutes les autres modales de Doku posent les trois pour la même raison. */
  .document-dialog { width: min(1180px, calc(100vw - 48px)); height: min(900px, calc(100vh - 48px)); max-width: none; max-height: none; margin: auto; padding: 0; overflow: hidden; border: 0; border-radius: 18px; background: var(--cream-tint); color: var(--ink); box-shadow: 0 24px 80px rgba(var(--shadow-rgb), .34); }
  .document-dialog::backdrop { background: rgba(0, 0, 0, .42); backdrop-filter: blur(2px); }
  .document-dialog > header { height: 54px; display: flex; align-items: center; gap: 12px; padding: 0 10px 0 16px; }
  .document-dialog > header > div:first-child { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .dialog-actions { display: flex; align-items: center; gap: 3px; }
  .dialog-stage { height: calc(100% - 54px - 48px); padding: 12px; background: var(--cream-content); }
  .pick-bar { height: 48px; display: flex; align-items: center; gap: 8px; padding: 0 10px 0 16px; color: var(--ink-4); font: 400 12px/1.3 var(--font-sans); }
  .pick-bar.active { color: var(--ink); }
  .pick-bar > .msr { font-size: 17px; }
  .pick-text { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pick-bar button { min-height: 30px; display: inline-flex; align-items: center; gap: 5px; padding: 0 10px; border: 0; border-radius: 9px; background: transparent; color: var(--ink-3); font: 550 11.5px var(--font-sans); cursor: pointer; }
  .pick-bar button:hover:not(:disabled) { background: var(--surface-hover); color: var(--ink); }
  .pick-bar button:disabled { opacity: .45; cursor: default; }
  .pick-bar button.primary { background: var(--ink); color: var(--cream-content); }
  .pick-bar button.primary:hover { background: var(--ink); color: var(--cream-content); opacity: .9; }
  .pick-bar .msr { font-size: 15px; }
  .dialog-stage.paper { overflow: auto; background: var(--surface-2); }
  .dialog-stage iframe { width: 100%; height: 100%; border: 0; border-radius: 10px; background: var(--cream-content); }
  /* 794 px de feuille + la scrollbar verticale du document : sans cette réserve,
     un layout A4 exact déborde horizontalement dès que l'iframe doit défiler. */
  .dialog-stage.paper iframe { display: block; width: min(826px, 100%); margin: 0 auto; }
  button:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
</style>
