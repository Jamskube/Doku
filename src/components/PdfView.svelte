<script lang="ts">
  import { onMount } from 'svelte'
  import { readFileBytes } from '../lib/tauri'
  import type { PdfDoc } from '../lib/pdf'

  let { path }: { path: string } = $props()

  let container: HTMLElement | undefined = $state()
  let status: 'loading' | 'ready' | 'error' = $state('loading')
  let message = $state('')

  onMount(() => {
    let cancelled = false
    let pdf: PdfDoc | null = null
    let destroyPdf: (() => Promise<void>) | null = null
    let observer: IntersectionObserver | null = null

    ;(async () => {
      const bytes = await readFileBytes(path)
      if (cancelled) return
      if (!bytes) {
        status = 'error'
        message = 'Lecture du fichier impossible.'
        return
      }
      try {
        const { loadPdf, pageSize, renderPage } = await import('../lib/pdf')
        const loaded = await loadPdf(bytes)
        if (cancelled) {
          void loaded.destroy()
          return
        }
        pdf = loaded.doc
        destroyPdf = loaded.destroy
        status = 'ready'

        // Échelle « ajustée à la largeur » calée sur la 1re page (× devicePixelRatio pour la netteté).
        const host = container!
        const first = await pageSize(pdf, 1, 1)
        const dpr = Math.min(window.devicePixelRatio || 1, 3)
        const scale = ((host.clientWidth - 24) / first.width) * dpr

        // Rendu paresseux (IntersectionObserver) : seules les pages visibles sont rendues
        // → 1re page rapide, pas de rendu de tout le document d'un coup.
        const rendered = new Set<number>()
        observer = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue
              const canvas = e.target as HTMLCanvasElement
              const n = Number(canvas.dataset.page)
              observer!.unobserve(canvas)
              if (rendered.has(n) || cancelled || !pdf) continue
              rendered.add(n)
              void renderPage(pdf, n, canvas, scale).catch(() => {})
            }
          },
          { root: host, rootMargin: '300px' },
        )

        for (let n = 1; n <= pdf.numPages; n++) {
          if (cancelled) break
          const dims = await pageSize(pdf, n, scale)
          const canvas = document.createElement('canvas')
          canvas.className = 'pdf-page'
          canvas.dataset.page = String(n)
          canvas.width = dims.width
          canvas.height = dims.height
          canvas.style.width = `${dims.width / dpr}px`
          host.appendChild(canvas)
          observer.observe(canvas)
        }
      } catch (err) {
        if (!cancelled) {
          status = 'error'
          message = String(err)
        }
      }
    })()

    return () => {
      cancelled = true
      observer?.disconnect()
      void destroyPdf?.()
    }
  })
</script>

<div class="pdf-view" bind:this={container}>
  {#if status === 'loading'}
    <div class="pdf-state">Chargement du PDF…</div>
  {:else if status === 'error'}
    <div class="pdf-state pdf-error">Impossible d'afficher ce PDF. {message}</div>
  {/if}
</div>

<style>
  .pdf-view {
    flex: 1;
    min-height: 0;
    overflow: auto;
    /* Reserve la gouttiere de scrollbar en amont : sans ca, la scrollbar verticale
       apparait apres coup, retrecit la largeur utile et force `max-width:100%` a
       reechantillonner le canvas d'un facteur non-entier -> flou. clientWidth mesure
       ici exclut deja la gouttiere, donc la largeur du canvas colle au conteneur. */
    scrollbar-gutter: stable;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 20px 12px 60px;
    background: var(--cream-base);
  }
  .pdf-view :global(canvas.pdf-page) {
    display: block;
    max-width: 100%;
    box-shadow: 0 1px 6px rgba(var(--ink-rgb), 0.14);
    border-radius: 2px;
    background: #fff;
  }
  .pdf-state {
    margin: auto;
    color: var(--ink-4);
    font-size: 13px;
    font-family: var(--font-mono);
  }
  .pdf-error {
    max-width: 420px;
    text-align: center;
    color: var(--err);
  }
</style>
