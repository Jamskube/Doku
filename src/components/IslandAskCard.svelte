<script lang="ts">
  // Carte « question rapide » de l'îlot. Au repos : le champ. Pendant l'échange : rien que
  // « Doku-San réfléchit » (shimmer Kube), puis la réponse écrite lettre par lettre. Une fois
  // l'écriture finie, « Copier » / « Continuer dans Doku-San » et le champ arrivent ensemble.
  // La question n'est pas réaffichée. La logique vit dans quick-ask.svelte.ts.
  import { closeQuickAsk, continueInCopilot, quickAsk, submitQuickAsk } from '../lib/quick-ask.svelte'
  import { plainMarkdown, streamReveal } from '../lib/copilot-stream-reveal'
  import { renderChatMarkdown } from '../lib/export/render-md'
  import { isTauri } from '../lib/tauri'
  import { startVoice } from '../lib/voice.svelte'

  let draft = $state('')
  let copied = $state(false)
  let answerEl = $state<HTMLElement>()
  let stuck = true
  // L'écriture lettre par lettre traîne derrière le flux : les actions attendent qu'elle ait fini.
  let typing = $state(false)

  const busy = $derived(quickAsk.phase === 'thinking' || quickAsk.phase === 'answering')
  // Le champ (et les actions) ne sont là qu'hors échange : ni pendant la réflexion, ni pendant
  // que la réponse s'écrit encore à l'écran.
  const composing = $derived(!busy && !typing)
  const hasResult = $derived(!!(quickAsk.answer || quickAsk.error))

  let form = $state<HTMLFormElement>()
  let input = $state<HTMLInputElement>()
  // Le champ disparaît sous le curseur : le focus reste dans la carte (Échap la ferme toujours),
  // puis revient au champ quand il réapparaît après une réponse.
  $effect(() => {
    if (!form) return
    if (!composing) {
      if (!document.activeElement || document.activeElement === document.body || form.contains(document.activeElement)) form.focus({ preventScroll: true })
    } else if (quickAsk.question && document.activeElement === form) {
      input?.focus({ preventScroll: true })
    }
  })

  function submit(e: SubmitEvent) {
    e.preventDefault()
    const q = draft.trim()
    if (!q || busy) return
    draft = ''
    void submitQuickAsk(q)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(quickAsk.answer)
      copied = true
      setTimeout(() => (copied = false), 1500)
    } catch (error) {
      console.error('Copie impossible', error)
    }
  }

  // La réponse défile avec l'écriture (lettre par lettre, streamReveal) tant qu'on n'est pas
  // remonté la relire : on suit le DOM, pas le flux, qui le devance.
  $effect(() => {
    const el = answerEl
    if (!el) return
    if (stuck) el.scrollTop = el.scrollHeight
    const follow = new MutationObserver(() => { if (stuck) el.scrollTop = el.scrollHeight })
    follow.observe(el, { childList: true, characterData: true, subtree: true })
    const start = () => (typing = true)
    const end = () => (typing = false)
    el.addEventListener('revealstart', start)
    el.addEventListener('revealend', end)
    return () => {
      follow.disconnect()
      el.removeEventListener('revealstart', start)
      el.removeEventListener('revealend', end)
    }
  })

  // Liens de la réponse rendue : jamais de navigation dans la webview ; https seulement, au navigateur.
  async function openLink(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest?.('a')
    if (!a) return
    e.preventDefault()
    let url: URL
    try { url = new URL(a.getAttribute('href') ?? '') } catch { return }
    if (url.protocol !== 'https:') return
    if (isTauri) {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url.href)
    } else globalThis.open(url.href, '_blank', 'noopener,noreferrer')
  }
</script>

<form class="ask" onsubmit={submit} bind:this={form} tabindex="-1">
  <!-- Le champ reste en tête, mais seulement hors échange : il revient avec les actions. -->
  {#if composing}
    <div class="tail top" class:reveal={!!quickAsk.question}>
      <div class="tail-inner">
        <div class="field">
          <input
            bind:this={input}
            bind:value={draft}
            data-autofocus
            placeholder={quickAsk.question ? 'Une autre question…' : 'Demander à Doku-San…'}
            aria-label="Question pour Doku-San"
            autocomplete="off"
            spellcheck="false"
          />
          <!-- Passe en conversation vocale : l'îlot quitte la question rapide pour la vue « J'écoute ». -->
          <button class="round" type="button" onclick={() => { closeQuickAsk(); void startVoice() }} aria-label="Parler à Doku-San">
            <svg class="icon" aria-hidden="true"><use href="#i-mic" /></svg>
          </button>
          <button class="round send" type="submit" disabled={!draft.trim()} aria-label="Envoyer">
            <svg class="icon" aria-hidden="true"><use href="#i-arrow-up" /></svg>
          </button>
        </div>
      </div>
    </div>
  {/if}
  {#if quickAsk.phase === 'thinking' && !quickAsk.answer}
    <p class="hint" role="status">
      <span class="shimmer"><span class="shimmer-mask"><span class="shimmer-text">Doku-San réfléchit</span></span></span>
    </p>
  {/if}
  <!-- Monté dès la question (vide, masqué) : le premier paquet du flux s'écrit lui aussi lettre
       par lettre au lieu d'apparaître d'un bloc au montage. -->
  <!-- Pendant l'écriture : du texte propre (plainMarkdown, sans **, # ni backticks) ; une fois
       écrite, la réponse est rendue en Markdown assaini (gras, listes, code). -->
  {#if quickAsk.question && composing && quickAsk.answer}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div
      class="answer md"
      bind:this={answerEl}
      onclick={openLink}
      onscroll={() => answerEl && (stuck = answerEl.scrollHeight - answerEl.scrollTop - answerEl.clientHeight < 8)}
    >{@html renderChatMarkdown(quickAsk.answer)}</div>
  {:else if quickAsk.question}
    <div
      class="answer"
      bind:this={answerEl}
      use:streamReveal={plainMarkdown(quickAsk.answer)}
      onscroll={() => answerEl && (stuck = answerEl.scrollHeight - answerEl.scrollTop - answerEl.clientHeight < 8)}
      aria-live="polite"
      aria-busy={busy}
    ></div>
  {/if}
  {#if quickAsk.error}
    <p class="error" role="alert">{quickAsk.error}</p>
  {/if}
  <!-- Après une réponse, champ (en tête) et actions (en pied) arrivent ensemble : la carte s'ouvre
       pour eux (l'îlot suit sa hauteur sans délai), puis ils montent d'un flou. -->
  {#if composing && hasResult}
    <div class="tail" class:reveal={!!quickAsk.question}>
      <div class="tail-inner">
        <div class="actions">
          {#if quickAsk.answer}
            <button type="button" class="ghost" onclick={copy}>{copied ? 'Copié' : 'Copier'}</button>
          {/if}
          <button type="button" class="primary" onclick={continueInCopilot}>Continuer dans Doku-San</button>
        </div>
      </div>
    </div>
  {/if}
</form>

<style>
  .ask {
    display: grid;
    gap: 8px;
    padding: 8px 8px calc(10px + var(--foot, 0px));
    color: #F4F1E9;
  }
  .field { display: flex; align-items: center; gap: 6px; padding-left: 12px; }
  input {
    flex: 1;
    min-width: 0;
    height: 32px;
    border: 0;
    background: none;
    color: inherit;
    font: 400 14px/1.2 var(--font-sans);
    outline: none;
    user-select: text;
  }
  input::placeholder { color: rgb(244 241 233 / 0.5); }
  .round {
    position: relative;
    flex: none;
    width: 28px;
    height: 28px;
    display: grid;
    place-items: center;
    border: 0;
    border-radius: 50%;
    background: rgb(244 241 233 / 0.1);
    color: rgb(244 241 233 / 0.75);
    cursor: pointer;
    transition: background-color 150ms ease, opacity 150ms ease, transform 150ms ease;
  }
  .round .icon { font-size: 14px; }
  .round:hover { background: rgb(244 241 233 / 0.18); }
  .send:not(:disabled) { background: #F4F1E9; color: rgb(28 26 22); }
  .round:disabled { opacity: 0.4; cursor: default; }
  .round:active:not(:disabled), .actions button:active { transform: scale(0.97); }
  .hint,
  .error,
  .answer { margin: 0; padding: 0 10px; font-size: 12.5px; line-height: 1.5; }
  /* Même rangée que le champ (32 px, texte 14 px, retrait 12 px) : la carte ne rétrécit pas
     entre la question et la réflexion, ni à l'arrivée du premier mot. */
  .hint { display: flex; align-items: center; min-height: 32px; padding-left: 12px; font-size: 14px; color: rgb(244 241 233 / 0.6); }
  .error { color: #F29A88; }
  .answer {
    max-height: 360px;
    overflow-y: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: 13.5px;
    min-height: 32px;
    padding: 6px 12px;
    box-sizing: border-box;
    user-select: text;
    scrollbar-width: thin;
    scrollbar-color: rgb(244 241 233 / 0.25) transparent;
  }
  .answer:empty { display: none; }
  /* Réponse rendue (Markdown assaini, injecté via {@html} → :global) : prose compacte sur l'encre. */
  .answer.md { white-space: normal; }
  .md :global(:is(p, ul, ol, pre, blockquote, h1, h2, h3, h4, h5, h6, table)) { margin: 0 0 0.55em; }
  .md :global(> :last-child) { margin-bottom: 0; }
  .md :global(:is(h1, h2, h3, h4, h5, h6)) { font-size: 1em; font-weight: 600; }
  .md :global(:is(ul, ol)) { padding-left: 1.3em; }
  .md :global(li) { margin: 0.15em 0; }
  .md :global(li::marker) { color: rgb(244 241 233 / 0.5); }
  .md :global(strong) { font-weight: 600; color: #fff; }
  .md :global(a) { color: inherit; text-decoration: underline; text-decoration-color: rgb(244 241 233 / 0.4); text-underline-offset: 2px; }
  .md :global(code) { padding: 1px 4px; border-radius: 4px; background: rgb(244 241 233 / 0.1); font: 0.92em var(--font-mono, ui-monospace, monospace); }
  .md :global(pre) { padding: 8px 10px; border-radius: 8px; background: rgb(244 241 233 / 0.07); overflow-x: auto; white-space: pre; }
  .md :global(pre code) { padding: 0; background: none; }
  .md :global(blockquote) { padding-left: 0.8em; border-left: 2px solid rgb(244 241 233 / 0.25); color: rgb(244 241 233 / 0.75); }
  .md :global(hr) { border: 0; border-top: 1px solid rgb(244 241 233 / 0.15); margin: 0.6em 0; }
  /* Lettres nouvelles (streamReveal) : elles sortent d'un léger flou. */
  .answer :global(.cop-reveal) { animation: ask-letter 200ms ease-out both; }
  @keyframes ask-letter { from { opacity: 0; filter: blur(2px); } }
  @media (prefers-reduced-motion: reduce) {
    .answer :global(.cop-reveal) { animation: ask-letter-fade 160ms ease-out both; }
    @keyframes ask-letter-fade { from { opacity: 0; } }
  }
  .ask { outline: none; }
  .tail { display: grid; grid-template-rows: 1fr; }
  .tail-inner { display: grid; gap: 8px; min-height: 0; overflow: hidden; }
  .actions { display: flex; justify-content: flex-end; gap: 6px; padding: 2px 2px 0; }
  /* La fin d'échange naît à 0 de haut et sans l'écart de la grille (−8 px) : rien ne saute. */
  .tail.reveal { animation: tail-open 320ms var(--ease-enter-snappy) both; }
  .tail.reveal .actions button,
  .tail.reveal .field { animation: tail-in 340ms var(--ease-enter-snappy) 110ms both; }
  .tail.reveal .actions button + button { animation-delay: 150ms; }
  .tail.reveal .field { animation-delay: 110ms; }
  .tail.top.reveal { animation-name: tail-open-top; }
  @keyframes tail-open { from { grid-template-rows: 0fr; margin-top: -8px; } }
  @keyframes tail-open-top { from { grid-template-rows: 0fr; margin-bottom: -8px; } }
  @keyframes tail-in { from { opacity: 0; translate: 0 6px; filter: blur(4px); } }

  /* « Doku-San réfléchit » : shimmer Kube (variante forte), même mécanique que le panneau —
     un masque trois fois plus large glisse, le texte glisse en sens inverse et reste immobile. */
  .shimmer { display: inline-block; max-width: 100%; overflow: clip; color: #F4F1E9; }
  .shimmer-mask {
    display: block;
    width: 300%;
    -webkit-mask-image: linear-gradient(90deg, rgb(0 0 0 / 0.45) 0%, rgb(0 0 0 / 0.45) 38%, #000 50%, rgb(0 0 0 / 0.45) 62%, rgb(0 0 0 / 0.45) 100%);
    mask-image: linear-gradient(90deg, rgb(0 0 0 / 0.45) 0%, rgb(0 0 0 / 0.45) 38%, #000 50%, rgb(0 0 0 / 0.45) 62%, rgb(0 0 0 / 0.45) 100%);
    animation: shimmer-mask 2s linear infinite;
  }
  .shimmer-text {
    display: inline-block;
    max-width: calc(100% / 3);
    white-space: nowrap;
    vertical-align: top;
    animation: shimmer-text 2s linear infinite;
  }
  @keyframes shimmer-mask { from { transform: translateX(calc(-200% / 3)); } 70%, to { transform: translateX(0); } }
  @keyframes shimmer-text { from { transform: translateX(200%); } 70%, to { transform: translateX(0); } }

  @media (prefers-reduced-motion: reduce) {
    .tail.reveal { animation: none; }
    .tail.reveal .actions button, .tail.reveal .field { animation: tail-fade 200ms ease-out both; }
    @keyframes tail-fade { from { opacity: 0; } }
    .shimmer-mask, .shimmer-text { animation: none; -webkit-mask-image: none; mask-image: none; width: auto; }
    .shimmer-text { max-width: none; color: rgb(244 241 233 / 0.7); }
  }
  .actions button {
    height: 28px;
    padding: 0 13px;
    border: 0;
    border-radius: 14px;
    font: var(--weight-control) 12px/1 var(--font-sans);
    cursor: pointer;
    transition: background-color 150ms ease, transform 150ms ease;
  }
  .primary { background: #F4F1E9; color: rgb(28 26 22); }
  .primary:hover { background: #fff; }
  .ghost { background: rgb(244 241 233 / 0.1); color: #F4F1E9; }
  .ghost:hover { background: rgb(244 241 233 / 0.18); }
  button:focus-visible { outline: 2px solid #F4F1E9; outline-offset: 2px; }
  @media (any-pointer: coarse) {
    .round::after { content: ''; position: absolute; inset: -6px; }
  }
</style>
