<script lang="ts">
  import { tick } from 'svelte'
  import {
    generatedDocumentFileName,
    generatedDocumentPrintSource,
    generatedDocumentPreview,
    generatedDocumentStandalone,
    type GeneratedDocumentArtifact,
  } from '../lib/generated-document'
  import { exportViaPrint } from '../lib/export/print'
  import { app, openGeneratedTab } from '../lib/stores.svelte'
  import { isTauri, saveHtmlDialog } from '../lib/tauri'

  let { artifact, onModify }: {
    artifact: GeneratedDocumentArtifact
    onModify: (artifact: GeneratedDocumentArtifact) => void
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
    <span class="spacer"></span>
    {#if artifact.kind === 'html'}
      <button onclick={() => void exportHtml()}><span class="msr">{saved ? 'check' : 'download'}</span>{saved ? 'Enregistré' : 'Exporter HTML'}</button>
    {:else}
      <button onclick={exportPdf}><span class="msr">picture_as_pdf</span>Exporter PDF</button>
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
      <iframe title={`Document ${artifact.title}`} sandbox="" srcdoc={preview}></iframe>
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
  footer button, .document-dialog header button { min-height: 30px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; padding: 0 9px; border: 0; border-radius: 9px; background: transparent; color: var(--ink-3); font-size: 11px; font-weight: 550; cursor: pointer; }
  footer button:hover, .document-dialog header button:hover { background: var(--surface-hover); color: var(--ink); }
  footer .msr, .document-dialog header .msr { font-size: 15px; }
  .spacer { flex: 1; }
  .document-dialog { width: min(1180px, calc(100vw - 48px)); height: min(900px, calc(100vh - 48px)); padding: 0; overflow: hidden; border: 0; border-radius: 18px; background: var(--cream-tint); color: var(--ink); box-shadow: 0 24px 80px rgba(var(--shadow-rgb), .34); }
  .document-dialog::backdrop { background: rgba(0, 0, 0, .42); backdrop-filter: blur(2px); }
  .document-dialog > header { height: 54px; display: flex; align-items: center; gap: 12px; padding: 0 10px 0 16px; }
  .document-dialog > header > div:first-child { min-width: 0; flex: 1; display: flex; flex-direction: column; }
  .dialog-actions { display: flex; align-items: center; gap: 3px; }
  .dialog-stage { height: calc(100% - 54px); padding: 12px; background: var(--cream-content); }
  .dialog-stage.paper { overflow: auto; background: var(--surface-2); }
  .dialog-stage iframe { width: 100%; height: 100%; border: 0; border-radius: 10px; background: var(--cream-content); }
  /* 794 px de feuille + la scrollbar verticale du document : sans cette réserve,
     un layout A4 exact déborde horizontalement dès que l'iframe doit défiler. */
  .dialog-stage.paper iframe { display: block; width: min(826px, 100%); margin: 0 auto; }
  button:focus-visible { outline: 2px solid var(--line-3); outline-offset: 1px; }
</style>
