<script lang="ts">
  // Îlot de la barre de titre (façon Dynamic Island) : UNE goutte d'encre qui porte les
  // notifications de l'app, les travaux longs en direct (indexation, téléchargement de modèle,
  // export, Doku-San qui écrit), le flash « Enregistré » et la question rapide.
  // Grammaire glass-island : la forme d'abord (largeur sur un ressort qui dépasse de 3 %, la
  // hauteur suit un temps après), le contenu ensuite (il sort d'un flou une fois la forme posée
  // et s'en va AVANT qu'elle ne change). Deux choses en direct : la seconde bourgeonne en
  // cercle à côté (goo local, jamais sur du texte). Placé dans la zone de glissement de la
  // fenêtre : seule la goutte visible capte le pointeur. En mode focus (barre masquée),
  // Il est accroché en haut de la feuille du document, centré sur elle (encoche d'iPhone), et
  // s'ouvre vers le bas par-dessus le document.
  import { untrack } from 'svelte'
  import { app, dismissReloadPrompt, notices, openCopilot, reloadPromptedTab } from '../lib/stores.svelte'
  import { cancelPull, copilot, stopChat } from '../lib/copilot.svelte'
  import { cancelRagIndexing, ragState } from '../lib/rag-index.svelte'
  import { exportJob } from '../lib/export/progress'
  import { formatBytes } from '../lib/llama'
  import { baseName } from '../lib/paths'
  import { removeNotice } from '../lib/notice-queue'
  import { NOTICE_DELAY, autoDismiss } from '../lib/auto-dismiss'
  import { overshootEasing, pickLive } from '../lib/island'
  import { prefersReducedMotion } from '../lib/liquid'
  import { closeQuickAsk, openQuickAsk, quickAsk } from '../lib/quick-ask.svelte'
  import { lensMapUrl } from '../lib/island-lens'
  import type { AppNotice } from '../lib/stores.svelte'
  import IslandAskCard from './IslandAskCard.svelte'
  import IslandSiri from './IslandSiri.svelte'
  import { interruptVoice, stopVoice, voice } from '../lib/voice.svelte'
  import { dictation, stopDictation } from '../lib/dictation.svelte'


  type Tone = 'success' | 'warning' | 'error' | 'info'
  type Layout = 'bar' | 'pill' | 'card' | 'ask'
  interface Action { label: string; run: () => void }
  interface View {
    id: string
    priority: number
    tone: Tone
    icon?: string
    glyph?: 'drops' | 'check' | 'dot'
    title: string
    // Titre de la carte quand il diffère de celui de la pastille.
    heading?: string
    message?: string
    // 0..1 ; null = indéterminé ; absent = pas de progression.
    progress?: number | null
    expanded?: boolean
    expandable?: boolean
    life?: number
    lifeKey?: unknown
    onLife?: () => void
    action?: Action
    cancel?: Action
    close?: () => void
    tap?: () => void
    kbd?: string
    label: string
  }

  const SAVED_MS = 1600
  // Une erreur se lit en carte, puis reste en pastille à point rouge jusqu'à sa fermeture.
  const ERROR_CARD_MS = 8_000
  const RELOAD_CARD_MS = 10_000
  const PILL_MS = 4_000
  // Un export plus court que ça ne mérite pas un aller-retour de l'îlot.
  const EXPORT_SHOW_DELAY = 350
  const OUT_MS = 140
  const MORPH_MS = 520
  const QUICK_MS = 280

  // --- Sources -------------------------------------------------------------------------

  let savedVisible = $state(false)
  $effect(() => {
    if (!app.savedPulse) return
    savedVisible = true
    const timer = setTimeout(() => (savedVisible = false), SAVED_MS)
    return () => clearTimeout(timer)
  })

  let exportShown = $state(false)
  $effect(() => {
    if (!$exportJob) {
      exportShown = false
      return
    }
    const timer = setTimeout(() => (exportShown = true), EXPORT_SHOW_DELAY)
    return () => clearTimeout(timer)
  })

  // Une notification vit d'abord en carte dans la file ; sa carte lue, elle quitte la file
  // (la suivante entre aussitôt) et finit sa vie en pastille. Les erreurs y restent garées
  // jusqu'à leur fermeture : une cause effacée avant d'être lue coûte un aller-retour.
  interface Afterglow { id: number; notice: AppNotice }
  let afterglow = $state<Afterglow[]>([])
  const AFTERGLOW_CAP = 3

  function endNoticeCard(id: number) {
    const entry = notices.find((e) => e.id === id)
    if (!entry) return
    const notice = $state.snapshot(entry.notice) as AppNotice
    removeNotice(notices, id)
    afterglow = [...afterglow.filter((a) => a.notice.tone === 'error'), { id, notice }].slice(-AFTERGLOW_CAP)
  }
  const dropAfterglow = (id: number) => (afterglow = afterglow.filter((a) => a.id !== id))

  let reloadPhase = $state<'card' | 'pill'>('card')
  $effect(() => {
    void app.reloadPrompt
    untrack(() => (reloadPhase = 'card'))
  })

  const VOICE_TITLES = { listening: 'J’écoute…', transcribing: 'Je transcris…', thinking: 'Doku-San réfléchit…', speaking: 'Doku-San parle…' } as const
  // Phase de la bande « Siri » : elle écoute, se resserre en réfléchissant, s'apaise en parlant.
  const siriPhase = $derived(voice.phase === 'listening' ? 'listening' : voice.phase === 'speaking' ? 'answering' : 'thinking')

  const toneIcon = (tone: Tone) => (tone === 'success' ? 'check' : tone === 'warning' ? 'triangle-alert' : tone === 'error' ? 'circle-alert' : 'sparkles')

  // Bourgeon promu d'un clic, carte épinglée d'un clic / Entrée / toucher.
  let promoted = $state<string | null>(null)
  let pinnedId = $state<string | null>(null)
  let hovered = $state(false)

  const views = $derived.by<View[]>(() => {
    const list: View[] = []
    const head = notices[0]
    if (head) {
      const n = head.notice
      list.push({
        id: `notice-${head.id}`, priority: 90, tone: n.tone, icon: toneIcon(n.tone), title: n.title, message: n.message,
        expanded: true, life: NOTICE_DELAY[n.tone] || ERROR_CARD_MS, lifeKey: n, onLife: () => endNoticeCard(head.id),
        close: () => removeNotice(notices, head.id), label: n.title,
      })
    }
    if (app.reloadPrompt) {
      const card = reloadPhase === 'card'
      list.push({
        id: 'reload', priority: card ? 85 : 45, tone: 'warning', icon: 'refresh-cw', glyph: card ? undefined : 'dot',
        title: card ? 'Fichier modifié sur le disque' : 'Fichier modifié', heading: 'Fichier modifié sur le disque',
        message: `« ${app.reloadPrompt.name} » a changé ailleurs. Le recharger remplacera vos modifications locales.`,
        expanded: card, expandable: true, life: card ? RELOAD_CARD_MS : 0, lifeKey: app.reloadPrompt,
        onLife: () => (reloadPhase = 'pill'), action: { label: 'Recharger', run: () => void reloadPromptedTab() },
        close: dismissReloadPrompt, label: 'Fichier modifié sur le disque',
      })
    }
    if (copilot.generating && !(app.copilotOpen && !app.focus) && !quickAsk.open) {
      list.push({
        id: 'writing', priority: 60, tone: 'info', glyph: 'drops', title: 'Doku-San écrit…', icon: 'sparkles',
        message: 'La réponse arrive dans le panneau Doku-San.', expandable: true, tap: () => openCopilot(),
        action: { label: 'Ouvrir', run: () => openCopilot() }, cancel: { label: 'Arrêter', run: stopChat },
        label: 'Doku-San écrit — ouvrir le copilote',
      })
    }
    if (copilot.pulling) {
      const p = copilot.pulling
      list.push({
        id: 'pull', priority: 55, tone: 'info', icon: 'download', title: `${p.name.split(':')[0]} · ${p.pct} %`, heading: `Téléchargement de ${p.name}`,
        message: p.total ? `${formatBytes(p.done)} sur ${formatBytes(p.total)}` : 'Connexion au registre…',
        progress: p.total ? p.pct / 100 : null, expandable: true, cancel: { label: 'Annuler', run: cancelPull },
        label: `Téléchargement de ${p.name}, ${p.pct} %`,
      })
    }
    if ($exportJob && exportShown) {
      const job = $exportJob
      list.push({
        id: 'export', priority: 52, tone: 'info', icon: 'printer',
        title: job.total ? `${job.label} · ${job.done}/${job.total}` : job.label, heading: job.label,
        message: job.total ? `Page ${Math.min(job.done + 1, job.total)} sur ${job.total}` : 'Un instant…',
        progress: job.total ? job.done / job.total : null, expandable: true, label: job.label,
      })
    }
    if (ragState.phase === 'indexing') {
      const { done, total } = ragState
      list.push({
        id: 'rag', priority: 50, tone: 'info', icon: 'database', title: total ? `Indexation ${done}/${total}` : 'Indexation…', heading: 'Indexation du dossier',
        message: ragState.dir ? `Dossier « ${baseName(ragState.dir)} »` : 'Préparation de l’index',
        progress: total ? done / total : null, expandable: true, cancel: { label: 'Annuler', run: cancelRagIndexing },
        label: total ? `Indexation du dossier, ${done} fichiers sur ${total}` : 'Indexation du dossier',
      })
    }
    for (const a of afterglow) {
      const error = a.notice.tone === 'error'
      list.push({
        id: `glow-${a.id}`, priority: error ? 40 : 80, tone: a.notice.tone, glyph: error ? 'dot' : undefined, icon: toneIcon(a.notice.tone),
        title: a.notice.title, message: a.notice.message, expandable: true, life: error ? 0 : PILL_MS, lifeKey: a.id,
        onLife: () => dropAfterglow(a.id), close: () => dropAfterglow(a.id), label: a.notice.title,
      })
    }
    if (savedVisible) list.push({ id: 'saved', priority: 70, tone: 'success', glyph: 'check', title: 'Enregistré', label: 'Enregistré' })
    if (!list.length && !app.focus) {
      list.push({ id: 'idle', priority: 0, tone: 'info', title: 'Demander à Doku-San', expandable: true, tap: openQuickAsk, label: 'Demander à Doku-San' })
    }
    if (voice.phase !== 'off') {
      const phase = voice.phase
      const busy = phase === 'transcribing' || phase === 'thinking'
      list.push({
        id: 'voice', priority: 98, tone: 'info', glyph: busy ? 'drops' : undefined,
        icon: phase === 'listening' ? 'mic' : 'audio-lines',
        title: VOICE_TITLES[phase], heading: VOICE_TITLES[phase],
        message: phase === 'listening' ? 'Parlez, je vous écoute.' : voice.heard ? `« ${voice.heard} »` : undefined,
        expanded: true, tap: phase === 'listening' ? undefined : interruptVoice,
        action: phase === 'listening' ? undefined : { label: 'Interrompre', run: interruptVoice },
        cancel: { label: 'Terminer', run: stopVoice },
        label: `Mode vocal — ${VOICE_TITLES[phase]}`,
      })
    }
    if (dictation.mode !== 'off') {
      // La fenêtre d'état de Handy : discrète (pastille), dépliée d'un clic pour arrêter.
      const writing = dictation.pending > 0 && !dictation.recording
      const hold = dictation.mode === 'hold'
      const title = dictation.recording ? 'Je note…' : writing ? 'J’écris…' : hold ? 'Maintenez Espace pour dicter' : 'Dictée : parlez'
      list.push({
        id: 'dictation', priority: 97, tone: 'info', glyph: writing ? 'drops' : undefined, icon: 'mic',
        title, heading: hold ? 'Dictée : Espace maintenue' : 'Dictée mains libres',
        message: hold ? 'Maintenez Espace dans la note pour parler, relâchez pour écrire.' : 'Chaque phrase s’écrit au curseur dès que vous marquez une pause.',
        expandable: true, cancel: { label: 'Arrêter la dictée', run: stopDictation }, label: `Dictée — ${title}`,
      })
    }
    for (const v of list) if (v.id === promoted) v.priority = 95
    if (quickAsk.open) list.push({ id: 'ask', priority: 100, tone: 'info', title: '', expanded: true, label: 'Question rapide' })
    return list
  })

  $effect(() => {
    if (promoted && !views.some((v) => v.id === promoted)) promoted = null
  })

  const picked = $derived(pickLive(views))
  const main = $derived(picked.main)
  const pinned = $derived(!!main && pinnedId === main.id)
  const wantExpanded = $derived(!!main && (!!main.expanded || (!!main.expandable && (hovered || pinned))))
  const wantLayout = $derived<Layout | null>(
    !main ? null : main.id === 'ask' ? 'ask' : main.id === 'idle' ? (wantExpanded ? 'pill' : 'bar') : wantExpanded ? 'card' : 'pill',
  )
  const bud = $derived(wantLayout === 'pill' ? picked.bud : null)

  // --- Moteur de morphose -----------------------------------------------------------

  let shownId = $state<string | null>(null)
  let layout = $state<Layout | null>(null)
  let shown = $state.raw<View | null>(null)
  let contentIn = $state(false)
  // Sans phase de sortie (repos → pilule, repos → notification), l'ancien contenu disparaît sec :
  // en fondu, il prêtait sa transparence au NOUVEAU texte, déjà posé et plus large que la forme.
  let cut = $state(false)
  let quick = $state(false)
  let lastKeyAt = -Infinity
  let focusAfterSwap = false
  let timers: ReturnType<typeof setTimeout>[] = []
  const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms))

  // Le contenu affiché suit la vue vivante (progression), et garde sa dernière image quand
  // elle disparaît : il doit pouvoir s'effacer avant que la forme ne se résorbe.
  $effect(() => {
    const live = views.find((v) => v.id === shownId)
    if (live) shown = live
  })

  $effect(() => {
    const id = main?.id ?? null
    const next = wantLayout
    untrack(() => {
      if (id === shownId && next === layout) {
        if (!contentIn && id) {
          for (const t of timers) clearTimeout(t)
          timers = []
          cut = false
          contentIn = true
        }
        return
      }
      for (const t of timers) clearTimeout(t)
      timers = []
      quick = performance.now() - lastKeyAt < 250
      const out = contentIn && shownId && layout !== 'bar' && !quick ? OUT_MS : 0
      contentIn = false
      cut = out === 0
      later(out, () => {
        shownId = id
        layout = next
        shown = main
        if (!id) return
        // Le texte entre quand la forme a fait l'essentiel du trajet (≈ 96 % en largeur) ; ce qui
        // reste à ouvrir est découpé par la forme pendant son entrée floue.
        later(quick ? QUICK_MS * 0.7 : MORPH_MS * 0.62, () => {
          cut = false
          contentIn = true
          if (focusAfterSwap || next === 'ask') {
            focusAfterSwap = false
            requestAnimationFrame(() => body?.querySelector<HTMLElement>('[data-autofocus], button')?.focus({ preventScroll: true }))
          }
        })
      })
    })
  })
  $effect(() => () => timers.forEach(clearTimeout))

  let cw = $state(0)
  let ch = $state(0)

  // --- Placement ---------------------------------------------------------------------

  let root = $state<HTMLElement>()
  let body = $state<HTMLElement>()
  let maxW = $state(440)

  function place() {
    const page = root?.offsetParent as HTMLElement | null
    if (page) maxW = page.clientWidth - 32
  }

  $effect(() => {
    if (!root) return
    place()
    const page = root.offsetParent as HTMLElement | null
    const resize = new ResizeObserver(place)
    if (page) resize.observe(page)
    return () => resize.disconnect()
  })



  // --- Interaction -------------------------------------------------------------------

  let hoverTimer: ReturnType<typeof setTimeout> | undefined
  function pointerEnter(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return
    clearTimeout(hoverTimer)
    hoverTimer = setTimeout(() => (hovered = true), 90)
  }
  function pointerLeave(e: PointerEvent) {
    if (e.pointerType !== 'mouse') return
    clearTimeout(hoverTimer)
    hoverTimer = setTimeout(() => (hovered = false), 220)
  }

  function collapse() {
    pinnedId = null
    promoted = null
    hovered = false
  }

  function tapMain(e: MouseEvent) {
    if (!main) return
    if (e.detail === 0) focusAfterSwap = true
    if (main.tap) main.tap()
    else if (main.expandable) pinnedId = pinned ? null : main.id
  }

  function tapBud(e: MouseEvent) {
    if (!bud) return
    if (e.detail === 0) focusAfterSwap = true
    // Lu une fois : promouvoir le bourgeon change aussitôt ce que `bud` désigne.
    const id = bud.id
    promoted = id
    pinnedId = id
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key !== 'Escape' || !main) return
    if (main.id === 'ask') closeQuickAsk()
    else if (main.id.startsWith('notice-')) main.onLife?.()
    else if (pinned || hovered) collapse()
    else return
    focusAfterSwap = root?.contains(document.activeElement) ?? false
    e.stopPropagation()
    e.preventDefault()
  }

  $effect(() => {
    const key = () => (lastKeyAt = performance.now())
    const outside = (e: PointerEvent) => {
      if (!root || root.contains(e.target as Node)) return
      // Question rapide : un clic ailleurs la ferme (pas de bouton ×), sauf pendant la réponse,
      // qu'un clic distrait annulerait (Échap reste là pour l'arrêter exprès).
      if (quickAsk.open && quickAsk.phase !== 'thinking' && quickAsk.phase !== 'answering') closeQuickAsk()
      else if (pinnedId) collapse()
    }
    window.addEventListener('keydown', key, true)
    window.addEventListener('pointerdown', outside, true)
    return () => {
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('pointerdown', outside, true)
    }
  })

  // --- Annonces ----------------------------------------------------------------------
  // Régions vivantes toujours montées : le contenu de l'îlot change de forme et de nœud,
  // une région créée avec son texte ne serait pas lue.
  let politeText = $state('')
  let alertText = $state('')
  $effect(() => {
    const n = notices[0]?.notice
    if (!n) return
    const text = `${n.title}. ${n.message}`
    const error = n.tone === 'error'
    untrack(() => {
      if (error) alertText = ''
      else politeText = ''
    })
    const timer = setTimeout(() => (error ? (alertText = text) : (politeText = text)), 60)
    return () => clearTimeout(timer)
  })
  $effect(() => {
    if (app.reloadPrompt) politeText = `Fichier modifié sur le disque. « ${app.reloadPrompt.name} » a changé ailleurs.`
  })
  $effect(() => {
    if (savedVisible) untrack(() => (politeText = 'Enregistré'))
  })

  const easeW = overshootEasing(0.03)
  const easeH = overshootEasing(0.025)
  const reduced = prefersReducedMotion()
  // Lentille Liquid Glass (island-lens.ts) : carte refaite quand la forme se pose (60 ms sans
  // changement) ; pendant une morphose, la précédente s'étire à la taille courante.
  const LENS_RIM = 18
  // Courbure au bord et léger flou (px) : sans flou, la page se lisait derrière la réponse.
  const LENS_SCALE = 22
  const LENS_BLUR = 5
  let lensMap = $state('')
  $effect(() => {
    const w = Math.round(cw)
    const h = Math.round(ch)
    const r = radius
    if (!shownId || w < 2 || h < 2) return
    const timer = setTimeout(() => (lensMap = lensMapUrl(w, h, r, LENS_RIM)), 60)
    return () => clearTimeout(timer)
  })

  const radius = $derived(layout === 'bar' ? 11 : layout === 'pill' ? 13 : layout === 'ask' ? 32 : 28)
  const ringLength = 2 * Math.PI * 6

  // Clé du compte à rebours : l'IDENTITÉ de l'objet notifié (un doublon arrive en objet neuf
  // et relance la carte), jamais l'objet vue, recréé à chaque tic de progression voisin.
  const serials = new WeakMap<object, number>()
  let serial = 0
  function identity(value: unknown): string {
    if (typeof value !== 'object' || value === null) return String(value)
    let n = serials.get(value)
    if (n === undefined) serials.set(value, (n = ++serial))
    return `#${n}`
  }
</script>

{#snippet ring(progress: number | null)}
  <svg class="ring" class:spin={progress === null} viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6" class="track" />
    <circle cx="8" cy="8" r="6" class="arc" stroke-dasharray={ringLength} stroke-dashoffset={ringLength * (1 - (progress ?? 0.28))} />
  </svg>
{/snippet}

{#snippet glyph(view: View, size: 'pill' | 'bud')}
  {#if view.glyph === 'drops'}
    <span class="drops" aria-hidden="true"><i></i><i></i><i></i></span>
  {:else if view.glyph === 'check'}
    <svg class="check" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5" pathLength="1" /></svg>
  {:else if view.glyph === 'dot'}
    <span class="dot tone-{view.tone}" aria-hidden="true"></span>
  {:else if size === 'bud' && view.progress !== undefined}
    {@render ring(view.progress)}
  {:else if view.icon}
    <svg class="icon tone-{view.tone}" aria-hidden="true"><use href="#i-{view.icon}" /></svg>
  {/if}
{/snippet}

<div
  class="island"
  class:quick
  class:reduced
  class:shown={!!shownId}
  bind:this={root}
  style:--ease-w={easeW}
  style:--ease-h={easeH}
  style:--max-w="{maxW}px"
  style:--ask-w={app.copilotOpen || app.sidebarOpen ? '340px' : '440px'}
  onkeydown={onKeydown}
  role="presentation"
>
  <!-- Clic pendant la morphose : le contenu n'est pas encore cliquable (il entre), la forme si —
       l'action part sans attendre la fin de l'animation. Le clavier passe par le bouton du contenu. -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div
    class="body"
    class:visible={!!shownId}
    class:lens={!!lensMap}
    class:streaming={layout === 'ask' && quickAsk.phase !== 'listening'}
    role="presentation"
    data-layout={layout}
    bind:this={body}
    style:width={shownId ? `${cw}px` : null}
    style:height={shownId ? `${ch}px` : null}
    style:--radius="{radius}px"
    onpointerenter={pointerEnter}
    onpointerleave={pointerLeave}
    onclick={() => { if (!contentIn && main?.tap) main.tap() }}
    use:autoDismiss={{
      delay: main && main.id !== 'ask' && !pinned ? (main.life ?? 0) : 0,
      key: main ? `${main.id}:${pinned}:${identity(main.lifeKey)}` : null,
      onDismiss: () => main?.onLife?.(),
    }}
  >
    <!-- Filtre de la lentille : la carte s'étire sur la boîte de l'îlot (objectBoundingBox). Le
         fond est adouci (5 px, la réponse reste lisible) puis courbé au bord — pas de verre dépoli. -->
    <svg class="lens-defs" aria-hidden="true" width="0" height="0">
      <filter id="doku-island-lens" x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" color-interpolation-filters="sRGB">
        <feImage href={lensMap} x="0" y="0" width="1" height="1" preserveAspectRatio="none" result="map" />
        <feGaussianBlur in="SourceGraphic" stdDeviation="{LENS_BLUR / Math.max(cw, 1)} {LENS_BLUR / Math.max(ch, 1)}" result="soft" />
        <!-- Pas de prisme (frange rouge/bleu du kit) : au bord, les canaux décalés sortaient de la
             zone du fond et traçaient un liseré bleu sous la forme sur fond clair. -->
        <feDisplacementMap in="soft" in2="map" scale={LENS_SCALE / Math.max(ch, 1)} xChannelSelector="R" yChannelSelector="G" result="bent" />
        <feColorMatrix in="bent" type="saturate" values="1.5" />
      </filter>
    </svg>
    <div class="shell">
      <!-- Bande « Siri » : réservée à l'échange parlé (mode vocal, ADR-0033). -->
      {#if shown?.id === 'voice'}<IslandSiri phase={siriPhase} />{/if}
    </div>
    <div class="content" class:in={contentIn} class:cut data-layout={layout} bind:offsetWidth={cw} bind:offsetHeight={ch}>
      {#if shown && layout === 'ask'}
        <IslandAskCard />
      {:else if shown && layout === 'bar'}
        <button class="face bar-face" aria-label={shown.label} onclick={tapMain}></button>
      {:else if shown && layout === 'pill'}
        {#if shown.tap || shown.expandable}
          <button class="face pill-face" class:rec={shown.id === 'dictation' && dictation.recording} style:--level={shown.id === 'dictation' ? dictation.level : null} aria-label={shown.label} aria-expanded={shown.tap ? undefined : false} onclick={tapMain}>
            {@render glyph(shown, 'pill')}
            <span class="pill-title">{shown.title}</span>
            {#if shown.progress !== undefined}{@render ring(shown.progress)}{/if}
            {#if shown.kbd}<kbd>{shown.kbd}</kbd>{/if}
          </button>
        {:else}
          <span class="face pill-face" aria-hidden="true">
            {@render glyph(shown, 'pill')}
            <span class="pill-title">{shown.title}</span>
          </span>
        {/if}
      {:else if shown && layout === 'card'}
        <div class="card" role="group" aria-label={shown.label}>
          <span class="tile tone-{shown.tone}" class:voice={shown.id === 'voice'} style:--level={shown.id === 'voice' ? voice.level : null} aria-hidden="true">
            {#if shown.glyph === 'drops'}{@render glyph(shown, 'pill')}{:else}<svg class="icon"><use href="#i-{shown.icon ?? toneIcon(shown.tone)}" /></svg>{/if}
          </span>
          <span class="copy">
            <strong>{shown.heading ?? shown.title}</strong>
            {#if shown.message}<span>{shown.message}</span>{/if}
          </span>
          {#if shown.close || shown.expandable}
            <button
              class="close"
              aria-label={shown.close ? 'Fermer la notification' : 'Replier'}
              onclick={() => (shown?.close ? shown.close() : collapse())}
            >
              <svg class="icon" aria-hidden="true"><use href="#i-{shown.close ? 'x' : 'chevron-up'}" /></svg>
            </button>
          {/if}
          {#if shown.progress !== undefined}
            <span class="bar" class:indeterminate={shown.progress === null} aria-hidden="true">
              <i style:width={shown.progress === null ? null : `${Math.round(shown.progress * 100)}%`}></i>
            </span>
          {/if}
          {#if shown.action || shown.cancel}
            <span class="actions">
              {#if shown.cancel}<button class="ghost" onclick={shown.cancel.run}>{shown.cancel.label}</button>{/if}
              {#if shown.action}<button class="primary" onclick={shown.action.run}>{shown.action.label}</button>{/if}
            </span>
          {/if}
          {#if main?.id === shown.id && shown.life && !pinned}
            {#key shown.lifeKey}
              <span class="life" aria-hidden="true" style:animation-duration="{shown.life}ms"></span>
            {/key}
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="bud-slot" class:on={!!bud}>
    <div class="goo" aria-hidden="true"><i class="cap"></i><i class="blob"></i></div>
    <button class="bud" tabindex={bud ? 0 : -1} aria-hidden={!bud} aria-label={bud ? `${bud.label} — afficher` : undefined} onclick={tapBud}>
      {#if bud}{@render glyph(bud, 'bud')}{/if}
    </button>
  </div>
</div>
<div class="sr-only" role="status">{politeText}</div>
<div class="sr-only" role="alert">{alertText}</div>

<!-- Goo à l'échelle des formes : trois gouttes de 5 px, et le pont entre l'îlot et son bourgeon. -->
<svg width="0" height="0" style="position:absolute" aria-hidden="true">
  <filter id="island-goo"><feGaussianBlur stdDeviation="1.4" /><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 16 -6" /></filter>
  <filter id="island-bud-goo" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="3.2" /><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -7" /></filter>
</svg>

<style>
  /* La seule chose sombre d'une interface crème : encre pleine, comme l'îlot d'Apple. */
  .island {
    /* Noir neutre du kit SiriGlass (kInkColour 0,052 / 0,052 / 0,058). */
    --island-ink: 13 13 15;
    --island-bg: rgb(var(--island-ink));
    /* Pied de verre clair sous la dernière ligne d'une carte (voir .shell). */
    --foot: 20px;
    --island-fg: #F4F1E9;
    --island-fg-2: rgb(244 241 233 / 0.62);
    --island-rim: transparent;
    --morph: 520ms;
    position: absolute;
    z-index: var(--z-toast);
    /* Juste sous le bord haut de la feuille. Le bord HAUT ne bouge jamais d'une forme à l'autre :
       l'îlot ne s'ouvre que vers le bas (aucune « montée » au survol). */
    top: 2px;
    left: 50%;
    display: flex;
    align-items: flex-start;
    translate: -50% 0;
    pointer-events: none;
    color: var(--island-fg);
  }
  :global(:root[data-theme='dark']) .island {
    --island-rim: rgb(255 255 255 / 0.13);
  }
  .island.quick { --morph: 280ms; }

  .body {
    position: relative;
    width: 10px;
    height: 10px;
    margin-top: 8px;
    opacity: 0;
    scale: 0.5;
    border-radius: var(--radius);
    /* Résorption sans rebond : un ressort qui dépasse vers zéro laisse un trait vertical. */
    transition:
      width 300ms cubic-bezier(.5, 0, .2, 1),
      height 300ms cubic-bezier(.5, 0, .2, 1),
      margin-top 300ms cubic-bezier(.5, 0, .2, 1),
      scale 200ms ease-in 220ms,
      opacity 160ms ease 260ms;
  }
  .body.visible {
    opacity: 1;
    scale: 1;
    margin-top: 0;
    pointer-events: auto;
    /* La largeur part d'abord, la hauteur suit un temps après : la goutte s'étire puis s'ouvre. */
    transition:
      width var(--morph) var(--ease-w),
      height var(--morph) var(--ease-h) 60ms,
      border-radius var(--morph) var(--ease-h) 60ms,
      margin-top var(--morph) var(--ease-h) 60ms,
      scale 160ms ease-out,
      opacity 90ms ease;
  }
  /* Réponse en flux : le texte grandit plus vite que le ressort de 520 ms et débordait de la
     forme (même à 90 ms : 47 px mesurés). Pendant l'écriture, la hauteur suit le contenu sans
     transition ; c'est le texte qui apparaît, la forme l'accompagne. */
  /* La hauteur suit le contenu avec une image de retard, et le contenu suivant entre (flou) avant
     que la forme ait fini de grandir : la forme découpe ce qui dépasse. 4 px de marge pour les
     anneaux de focus. */
  .body { overflow: clip; overflow-clip-margin: 4px; }
  .body.visible.streaming {
    transition:
      width var(--morph) var(--ease-w),
      border-radius 90ms ease-out,
      margin-top 90ms ease-out,
      scale 160ms ease-out,
      opacity 90ms ease;
  }
  /* Repos : une mini-capsule d'encre (84 × 22) dans le même verre que l'îlot ouvert. */

  .shell {
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: inherit;
    background: var(--island-bg);
    box-shadow: inset 0 0 0 0.5px var(--island-rim), 0 6px 18px rgb(0 0 0 / 0.16), 0 1px 2px rgb(0 0 0 / 0.12);
  }
  :global(:root[data-theme='dark']) .shell { box-shadow: inset 0 0 0 0.5px var(--island-rim), 0 6px 18px rgb(0 0 0 / 0.45); }
  /* Verre SiriGlass (DesignKit ui/siriglass, shader `siriGlassDrop`), en trois couches :
     - le verre lui-même (fond de .shell) : épais, il assombrit ce qu'il montre (×0,84 sur fond
       clair, ×0,92 sur fond sombre) et pose un voile laiteux de 3 % ; la lentille le courbe ;
     - l'encre (::before) : pleine sur la pilule ; sur une carte, pleine derrière le texte puis
       ~50 % à la ligne de flottaison et rien au bas du pied (--foot) : le pied est du verre clair.
       Son bord flouté laisse le contour clair tout autour, la forme se lit comme une coque ;
     - la lumière (::after) : reflet côté haut-gauche, reflet plus faible à l'opposé, fil de bord,
       bande blanche dans le pied, léger éclat intérieur ; sur fond clair, le bord s'assombrit vers
       l'intérieur pour détacher la silhouette — pas d'ombre portée (elle se lisait en double bord). */
  .shell {
    --glass-dim: 0.16;
    --rim-dim: 0.22;
    --foot-band: 0.3;
    --ink-fill: rgb(var(--island-ink));
    background-color: transparent;
    background-image: linear-gradient(rgb(255 255 255 / 0.03), rgb(255 255 255 / 0.03)), linear-gradient(rgb(0 0 0 / var(--glass-dim)), rgb(0 0 0 / var(--glass-dim)));
    backdrop-filter: blur(14px) saturate(1.7);
    box-shadow: none;
  }
  :global(:root[data-theme='dark']) .shell { --glass-dim: 0.08; --rim-dim: 0; box-shadow: none; }
  .shell::before,
  .shell::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    pointer-events: none;
  }
  .shell::before {
    inset: 0.75px;
    background: var(--ink-fill);
    filter: blur(0.75px);
  }
  .shell::after {
    box-shadow:
      inset 0.75px 1px 0 rgb(255 255 255 / 0.3),
      inset -0.75px -1px 0 rgb(255 255 255 / 0.1),
      inset 0 0 0 0.5px rgb(255 255 255 / 0.14),
      inset 0 -2px 3px -1px rgb(255 255 255 / var(--foot-band)),
      inset 0 0 7px rgb(255 255 255 / 0.06),
      inset 0 0 5px rgb(0 0 0 / var(--rim-dim));
  }
  .body[data-layout='card'] .shell,
  .body[data-layout='ask'] .shell {
    --foot-band: 0.6;
    /* Fondu doux (≈ smoothstep) sur tout le pied et 8 px au-dessus de la dernière ligne. */
    --fade: calc(var(--foot) + 8px);
    --ink-fill: linear-gradient(to bottom,
      rgb(var(--island-ink) / 1) calc(100% - var(--fade) * 1.00),
      rgb(var(--island-ink) / 0.95) calc(100% - var(--fade) * 0.85),
      rgb(var(--island-ink) / 0.84) calc(100% - var(--fade) * 0.70),
      rgb(var(--island-ink) / 0.66) calc(100% - var(--fade) * 0.55),
      rgb(var(--island-ink) / 0.46) calc(100% - var(--fade) * 0.40),
      rgb(var(--island-ink) / 0.26) calc(100% - var(--fade) * 0.25),
      rgb(var(--island-ink) / 0.1) calc(100% - var(--fade) * 0.12),
      rgb(var(--island-ink) / 0) calc(100% - var(--fade) * 0.00));
  }
  /* Liquid Glass : le bas translucide COURBE la page au bord (lentille) au lieu de la flouter. */
  .lens-defs { position: absolute; width: 0; height: 0; overflow: hidden; pointer-events: none; }
  .body.lens .shell { backdrop-filter: url(#doku-island-lens); }
  @media (prefers-reduced-transparency: reduce) {
    .shell { background: var(--island-bg); backdrop-filter: none; }
    .shell::before { background: var(--island-bg); }
  }

  /* Le contenu se mesure lui-même (la forme en prend la taille) et n'apparaît qu'une fois la
     forme posée, en sortant d'un flou ; il s'en va avant qu'elle ne change. */
  .content {
    position: absolute;
    top: 0;
    left: 50%;
    z-index: 1;
    translate: -50% 0;
    opacity: 0;
    filter: blur(6px);
    scale: 0.97;
    pointer-events: none;
    transition: opacity 140ms ease, filter 140ms ease, scale 140ms ease;
  }
  .content.in {
    opacity: 1;
    filter: none;
    scale: 1;
    pointer-events: auto;
    transition: opacity 220ms ease-out, filter 220ms ease-out, scale 220ms ease-out;
  }
  .content { width: max-content; }
  .content.cut { opacity: 0; transition: none; }
  .content[data-layout='card'] { width: min(360px, var(--max-w)); }
  /* Panneau latéral ouvert : la feuille rétrécit, la question rapide aussi (elle couvrait les onglets). */
  .content[data-layout='ask'] { width: min(var(--ask-w, 440px), var(--max-w)); }
  .island.quick .content { filter: none; scale: 1; transition: none; }

  .face {
    display: flex;
    align-items: center;
    gap: 7px;
    border: 0;
    background: none;
    color: inherit;
    font: var(--weight-control) var(--text-xs)/1 var(--font-sans);
    white-space: nowrap;
    cursor: pointer;
  }
  .face:focus-visible { outline: 2px solid var(--island-fg); outline-offset: -3px; border-radius: 13px; }
  .pill-face { height: 26px; padding: 0 11px 0 9px; font-variant-numeric: tabular-nums; }
  span.pill-face { cursor: default; padding: 0 12px 0 10px; }
  /* Interligne > 1 : un « _ » rogné par l'overflow disparaît (« q4_0 » lu « q4 0 »). */
  .pill-title { max-width: 220px; overflow: hidden; text-overflow: ellipsis; line-height: 1.35; }
  kbd { padding: 3px 5px; border-radius: 5px; background: rgb(244 241 233 / 0.12); color: var(--island-fg-2); font: 500 10px/1 var(--font-sans); }
  .bar-face { position: relative; width: 84px; height: 22px; padding: 0; }
  /* La cible déborde un peu, invisible : la capsule se vise sans précision. */
  .bar-face::after { content: ''; position: absolute; inset: -6px -8px; }
  .bar-face:focus-visible { outline-offset: 3px; border-radius: 11px; }
  .face .icon { font-size: 13px; stroke-width: 2.2; }

  .tone-success { color: #9AD3A5; }
  .tone-warning { color: #EBC072; }
  .tone-error { color: #F29A88; }
  .tone-info { color: var(--island-fg); }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 3px color-mix(in srgb, currentColor 22%, transparent); }

  .check { width: 14px; height: 14px; fill: none; stroke: #9AD3A5; stroke-width: 2.6; stroke-linecap: round; stroke-linejoin: round; }
  .check path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: island-draw 340ms cubic-bezier(.3, 0, .2, 1) 380ms forwards; }
  @keyframes island-draw { to { stroke-dashoffset: 0; } }

  .ring { width: 14px; height: 14px; flex: none; rotate: -90deg; }
  .ring circle { fill: none; stroke-width: 2; }
  .ring .track { stroke: rgb(244 241 233 / 0.18); }
  .ring .arc { stroke: var(--island-fg); stroke-linecap: round; transition: stroke-dashoffset 300ms ease; }
  .ring.spin { animation: doku-orbit 1s linear infinite; }

  /* Trois gouttes qui enflent tour à tour : voisines grosses en même temps, le goo les soude. */
  .drops { display: inline-flex; gap: 2px; padding: 2px; filter: url(#island-goo); }
  .drops i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; animation: island-swell 1.1s ease-in-out infinite; }
  .drops i:nth-child(2) { animation-delay: 0.15s; }
  .drops i:nth-child(3) { animation-delay: 0.3s; }
  @keyframes island-swell { 0%, 100% { scale: 0.6; } 40% { scale: 1.35; } }

  /* Carte : tuile teintée, titre 13/600, message 12, fermeture ; actions et progression dessous. */
  .card {
    position: relative;
    display: grid;
    grid-template-columns: 28px 1fr auto;
    column-gap: 11px;
    row-gap: 10px;
    align-items: start;
    padding: 12px 10px calc(13px + var(--foot)) 12px;
  }
  .tile {
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border-radius: 9px;
    background: color-mix(in srgb, currentColor 18%, transparent);
  }
  .tile .icon { font-size: 15px; stroke-width: 2; }
  /* Micro : la tuile suit le niveau de la voix (transform seul, composé par le GPU). */
  .tile.voice { transform: scale(calc(1 + var(--level, 0) * 0.22)); transition: transform 90ms linear; }
  .pill-face.rec .icon { color: #F29A88; transform: scale(calc(1 + var(--level, 0) * 0.3)); transition: transform 90ms linear; }
  @media (prefers-reduced-motion: reduce) { .pill-face.rec .icon { transform: none; } }
  @media (prefers-reduced-motion: reduce) { .tile.voice { transform: none; } }
  .copy {
    min-width: 0;
    display: grid;
    gap: 2px;
    padding-top: 1px;
    font-size: 12px;
    line-height: 1.4;
    user-select: text;
  }
  .copy strong { font-size: 13px; font-weight: 600; letter-spacing: -0.005em; text-wrap: balance; }
  .copy span { color: var(--island-fg-2); overflow-wrap: anywhere; text-wrap: pretty; }
  .close {
    position: relative;
    width: 22px;
    height: 22px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: rgb(244 241 233 / 0.08);
    color: var(--island-fg-2);
    cursor: pointer;
    transition: background-color 150ms ease, color 150ms ease, transform 150ms ease;
  }
  .close .icon { font-size: 13px; }
  .close:hover { background: rgb(244 241 233 / 0.16); color: var(--island-fg); }
  .bar {
    grid-column: 2 / 4;
    height: 4px;
    margin-right: 6px;
    border-radius: 2px;
    overflow: hidden;
    background: rgb(244 241 233 / 0.14);
  }
  .bar i { display: block; height: 100%; border-radius: inherit; background: var(--island-fg); transition: width 300ms ease; }
  .bar.indeterminate i { width: 30%; animation: island-slide 1.2s cubic-bezier(.5, 0, .5, 1) infinite; }
  @keyframes island-slide { from { translate: -100% 0; } to { translate: 340% 0; } }
  .actions { grid-column: 2 / 4; display: flex; justify-content: flex-end; gap: 6px; margin-right: 2px; }
  .actions button {
    height: 26px;
    padding: 0 12px;
    border: 0;
    border-radius: 13px;
    font: var(--weight-control) 12px/1 var(--font-sans);
    cursor: pointer;
    transition: background-color 150ms ease, transform 150ms ease;
  }
  .actions .primary { background: var(--island-fg); color: rgb(28 26 22); }
  .actions .primary:hover { background: #fff; }
  .actions .ghost { background: rgb(244 241 233 / 0.1); color: var(--island-fg); }
  .actions .ghost:hover { background: rgb(244 241 233 / 0.18); }
  .actions button:active, .close:active { transform: scale(0.97); }
  .card button:focus-visible { outline: 2px solid var(--island-fg); outline-offset: 2px; }
  /* Filet de vie : la carte est transitoire, il dit combien de temps il reste ; il se fige
     sur `data-paused`, posé par le compte à rebours lui-même (survol, focus, fenêtre absente). */
  .life {
    position: absolute;
    left: 22px;
    right: 22px;
    bottom: 0;
    height: 2px;
    border-radius: 1px;
    background: rgb(244 241 233 / 0.22);
    transform-origin: left center;
    animation: doku-life linear forwards;
  }
  .body:global([data-paused]) .life { animation-play-state: paused; }

  /* Bourgeon : un cercle qui sort du bout de l'îlot et y rentre. Le pont qui les relie est un
     calque de formes à part, filtré goo, glissé dessous — le texte n'y passe jamais. */
  .bud-slot {
    position: relative;
    flex: none;
    width: 0;
    height: 26px;
    transition: width var(--morph) var(--ease-w);
  }
  .bud-slot.on { width: calc(6px + 26px); }
  .bud,
  .goo .blob {
    position: absolute;
    top: 0;
    left: 6px;
    width: 26px;
    height: 26px;
    border-radius: 50%;
    translate: -32px 0;
    scale: 0.6;
    transition: translate var(--morph) var(--ease-spring-liquid), scale var(--morph) var(--ease-spring-liquid);
  }
  .bud-slot.on .bud,
  .bud-slot.on .goo .blob { translate: 0 0; scale: 1; }
  .bud {
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    background: var(--island-bg);
    box-shadow: inset 0 0 0 0.5px var(--island-rim), 0 6px 12px -8px rgb(0 0 0 / 0.3);
    color: var(--island-fg);
    cursor: pointer;
    opacity: 0;
    transition: translate var(--morph) var(--ease-spring-liquid), scale var(--morph) var(--ease-spring-liquid), opacity 120ms ease 200ms;
  }
  .bud-slot.on .bud { opacity: 1; pointer-events: auto; transition: translate var(--morph) var(--ease-spring-liquid), scale var(--morph) var(--ease-spring-liquid), opacity 60ms ease; }
  .bud .icon { font-size: 12px; stroke-width: 2.2; }
  .bud .drops i { width: 4px; height: 4px; }
  .bud:focus-visible { outline: 2px solid var(--island-fg); outline-offset: 2px; }
  .goo {
    position: absolute;
    top: -12px;
    left: -40px;
    width: 92px;
    z-index: -1;
    height: 50px;
    filter: url(#island-bud-goo);
    pointer-events: none;
    /* Visible le temps que le bourgeon rentre, puis éteint : sinon une goutte d'encre reste. */
    opacity: 0;
    transition: opacity 0s linear var(--morph);
  }
  .bud-slot.on .goo { opacity: 1; transition: none; }
  .goo i { position: absolute; display: block; background: var(--island-bg); }
  /* Gouttes un poil plus petites que les formes : le seuil du goo les regonfle d'environ 1 px,
     à taille égale elles déborderaient en liseré autour du bourgeon posé. */
  .goo .blob { top: 13px; left: 47px; width: 24px; height: 24px; }
  .goo .cap { top: 13px; left: 15px; width: 24px; height: 24px; border-radius: 50%; }

  @media (any-pointer: coarse) {
    .close::after { content: ''; position: absolute; inset: -8px; }
    .bud::after { content: ''; position: absolute; inset: -6px; }
  }

  /* Mouvement réduit : la forme se pose sans morphose, seul le contenu passe en fondu. */
  .island.reduced .body,
  .island.reduced .body.visible { transition: opacity 160ms ease; scale: 1; }
  .island.reduced .content { filter: none; scale: 1; transition: opacity 160ms ease; }
  .island.reduced .bud,
  .island.reduced .goo .blob { translate: 0 0; scale: 1; transition: opacity 160ms ease; }
  .island.reduced .goo { display: none; }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
