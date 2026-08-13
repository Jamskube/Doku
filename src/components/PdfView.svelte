<script lang="ts">
  import { onMount } from 'svelte'
  import { app } from '../lib/stores.svelte'
  import { readFileBytes } from '../lib/tauri'
  import type { PdfDoc } from '../lib/pdf'
  import { fitPdfPage } from '../lib/pdf-layout'

  let { path }: { path: string } = $props()

  let container: HTMLElement | undefined = $state()
  let status: 'loading' | 'ready' | 'error' = $state('loading')
  let message = $state('')
  // Doc pdf.js courant, hissé hors du onMount : la révélation de citation (effet plus
  // bas) lit les coordonnées du texte de la page ciblée.
  let pdf: PdfDoc | null = null

  // Surligne les rectangles du passage cité dans le wrapper de la page (fractions 0..1 →
  // % du canvas, insensible au zoom/DPR). Éléments transitoires, retirés après le fondu.
  async function highlightPassage(wrap: HTMLElement, page: number, text: string): Promise<boolean> {
    if (!pdf) return false
    const { getCitedRects } = await import('../lib/pdf')
    const rects = await getCitedRects(pdf, page, text).catch(() => [])
    if (!rects.length) return false
    const marks: HTMLElement[] = []
    for (const r of rects) {
      const m = document.createElement('div')
      m.className = 'pdf-cite-mark'
      m.style.left = `${r.left * 100}%`
      m.style.top = `${r.top * 100}%`
      m.style.width = `${r.width * 100}%`
      m.style.height = `${r.height * 100}%`
      wrap.appendChild(m)
      marks.push(m)
    }
    setTimeout(() => marks.forEach((m) => m.remove()), 4200)
    return true
  }

  // Révélation d'une page citée (citations ancrées sur PDF). Les canvases sont créés
  // en boucle asynchrone après le montage : on réessaie jusqu'à ce que la page existe
  // (borné — un PDF corrompu ne doit pas faire boucler à vide).
  let revealTimer: ReturnType<typeof setTimeout> | undefined
  $effect(() => {
    const reveal = app.pendingPdfReveal
    if (!reveal || reveal.path !== path) return
    let tries = 0
    const attempt = () => {
      const canvas = container?.querySelector(`canvas.pdf-page[data-page="${reveal.page}"]`)
      if (canvas) {
        app.pendingPdfReveal = null
        const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
        canvas.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
        const wrap = canvas.parentElement
        const fallbackHalo = () => {
          canvas.classList.add('pdf-page-cited')
          setTimeout(() => canvas.classList.remove('pdf-page-cited'), 1800)
        }
        // Surlignage précis si le passage est fourni ET retrouvé ; sinon halo de page.
        if (reveal.text && wrap) {
          void highlightPassage(wrap, reveal.page, reveal.text).then((ok) => { if (!ok) fallbackHalo() })
        } else {
          fallbackHalo()
        }
        return
      }
      if (++tries < 50) revealTimer = setTimeout(attempt, 100) // ≤ 5 s : pages en cours de création
      else app.pendingPdfReveal = null
    }
    attempt()
    return () => clearTimeout(revealTimer)
  })

  onMount(() => {
    let cancelled = false
    let destroyPdf: (() => Promise<void>) | null = null
    let observer: IntersectionObserver | null = null
    let resizeObserver: ResizeObserver | null = null
    let fitFrame = 0
    let rerenderTimer: ReturnType<typeof setTimeout> | undefined

    interface PageView {
      baseWidth: number
      baseHeight: number
      wrap: HTMLDivElement
      canvas: HTMLCanvasElement
      targetScale: number
    }

    const pages = new Map<number, PageView>()
    const visiblePages = new Set<number>()
    const renderedScales = new Map<number, number>()
    const renderJobs = new Map<number, Promise<void>>()

    async function ensureRendered(pageNumber: number) {
      const page = pages.get(pageNumber)
      const doc = pdf
      if (!page || !doc || cancelled || page.targetScale <= 0) return

      const running = renderJobs.get(pageNumber)
      if (running) {
        await running.catch(() => {})
        if (!cancelled && visiblePages.has(pageNumber)) void ensureRendered(pageNumber)
        return
      }

      const targetScale = page.targetScale
      const renderedScale = renderedScales.get(pageNumber)
      if (renderedScale !== undefined && Math.abs(renderedScale - targetScale) < 0.001) return

      const job = import('../lib/pdf')
        .then(({ renderPage }) => renderPage(doc, pageNumber, page.canvas, targetScale))
      renderJobs.set(pageNumber, job)
      try {
        await job
        if (!cancelled) renderedScales.set(pageNumber, targetScale)
      } catch {
        // Un redimensionnement peut rendre une échelle obsolète pendant un rendu. La
        // demande la plus récente est rejouée juste après, sans erreur visible.
      } finally {
        if (renderJobs.get(pageNumber) === job) renderJobs.delete(pageNumber)
      }

      if (!cancelled && visiblePages.has(pageNumber) && Math.abs(page.targetScale - targetScale) >= 0.001) {
        void ensureRendered(pageNumber)
      }
    }

    function applyFit() {
      const host = container
      if (!host || cancelled || pages.size === 0 || host.clientWidth <= 0) return

      let anchor: { page: PageView; progress: number } | null = null
      if (host.scrollTop > 0) {
        const scrollTop = host.scrollTop
        let current = pages.values().next().value as PageView | undefined
        for (const page of pages.values()) {
          if (page.wrap.offsetTop > scrollTop + 1) break
          current = page
        }
        if (current) {
          const height = Math.max(current.wrap.offsetHeight, 1)
          anchor = {
            page: current,
            progress: Math.min(Math.max((scrollTop - current.wrap.offsetTop) / height, 0), 1),
          }
        }
      }

      for (const page of pages.values()) {
        const fitted = fitPdfPage(
          host.clientWidth,
          24,
          page.baseWidth,
          page.baseHeight,
          window.devicePixelRatio || 1,
        )
        page.targetScale = fitted.renderScale
        const cssWidth = `${fitted.cssWidth}px`
        const cssHeight = `${fitted.cssHeight}px`
        page.wrap.style.width = cssWidth
        page.wrap.style.height = cssHeight
        page.canvas.style.width = cssWidth
        page.canvas.style.height = cssHeight
      }

      if (anchor) {
        host.scrollTop = anchor.page.wrap.offsetTop + anchor.progress * anchor.page.wrap.offsetHeight
      }

      clearTimeout(rerenderTimer)
      rerenderTimer = setTimeout(() => {
        for (const pageNumber of visiblePages) void ensureRendered(pageNumber)
      }, 140)
    }

    function scheduleFit() {
      if (fitFrame) cancelAnimationFrame(fitFrame)
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0
        applyFit()
      })
    }

    ;(async () => {
      const bytes = await readFileBytes(path)
      if (cancelled) return
      if (!bytes) {
        status = 'error'
        message = 'Lecture du fichier impossible.'
        return
      }
      try {
        const { loadPdf, pageSize } = await import('../lib/pdf')
        const loaded = await loadPdf(bytes)
        if (cancelled) {
          void loaded.destroy()
          return
        }
        pdf = loaded.doc
        destroyPdf = loaded.destroy
        status = 'ready'

        const host = container!
        observer = new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              const canvas = e.target as HTMLCanvasElement
              const n = Number(canvas.dataset.page)
              if (e.isIntersecting) {
                visiblePages.add(n)
                void ensureRendered(n)
              } else {
                visiblePages.delete(n)
              }
            }
          },
          { root: host, rootMargin: '300px' },
        )

        for (let n = 1; n <= pdf.numPages; n++) {
          if (cancelled) break
          const dims = await pageSize(pdf, n, 1)
          // Wrapper positionné : reçoit les surlignages de citation en overlay (%).
          const wrap = document.createElement('div')
          wrap.className = 'pdf-page-wrap'
          const canvas = document.createElement('canvas')
          canvas.className = 'pdf-page'
          canvas.dataset.page = String(n)
          canvas.width = Math.max(1, Math.round(dims.width))
          canvas.height = Math.max(1, Math.round(dims.height))
          wrap.appendChild(canvas)
          host.appendChild(wrap)
          pages.set(n, {
            baseWidth: dims.width,
            baseHeight: dims.height,
            wrap,
            canvas,
            targetScale: 0,
          })
          observer.observe(canvas)
        }

        applyFit()
        resizeObserver = new ResizeObserver(scheduleFit)
        resizeObserver.observe(host)
        window.addEventListener('resize', scheduleFit)
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
      resizeObserver?.disconnect()
      window.removeEventListener('resize', scheduleFit)
      if (fitFrame) cancelAnimationFrame(fitFrame)
      clearTimeout(rerenderTimer)
      pdf = null
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
  .pdf-view :global(.pdf-page-wrap) {
    position: relative;
    flex: 0 0 auto;
    max-width: 100%;
  }
  .pdf-view :global(canvas.pdf-page) {
    display: block;
    max-width: 100%;
    box-shadow: 0 1px 6px rgba(var(--shadow-rgb), 0.14);
    border-radius: 2px;
    background: #fff;
    scroll-margin-top: 14px;
  }
  /* Surlignage d'un passage cité : marqueur ambré en multiply (le texte du canvas reste
     net dessous), fondu doux avant retrait des nœuds. */
  .pdf-view :global(.pdf-cite-mark) {
    position: absolute;
    background: rgba(255, 205, 84, 0.42);
    mix-blend-mode: multiply;
    border-radius: 2px;
    pointer-events: none;
    animation: pdf-cite-mark 4.2s ease forwards;
  }
  @keyframes pdf-cite-mark {
    0%, 65% { opacity: 1; }
    100% { opacity: 0; }
  }
  /* Halo transitoire de la page citée : même vocabulaire que le flash de recherche de
     l'éditeur (révélation brève, sans état persistant). */
  .pdf-view :global(canvas.pdf-page-cited) {
    animation: pdf-cited 1.8s ease;
  }
  @keyframes pdf-cited {
    0%, 60% { box-shadow: 0 0 0 3px var(--ink-3), 0 1px 6px rgba(var(--shadow-rgb), 0.14); }
    100% { box-shadow: 0 1px 6px rgba(var(--shadow-rgb), 0.14); }
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
