<script lang="ts">
  // Bande irisée « Siri » derrière le contenu de l'îlot en mode question rapide.
  // CSS seul : dégradés peints une fois puis animés en transform/opacity — le
  // compositeur fait tout, aucun rAF ni WebGL (décision « liquide sans WebGL » du 26/11).
  // Grammaire empruntée à SiriGlass (Haplo LLC, MIT) : trois brins teintés (chaud, froid,
  // lilas) qui se croisent sur une ligne d'eau à cœur blanc, frange de prisme, halo plus
  // froid au-dessus ; « Réfléchir » resserre la lumière et l'accélère. Aucune ligne du
  // shader n'est reprise.
  type Phase = 'listening' | 'thinking' | 'answering'
  let { phase }: { phase: Phase } = $props()

  let root: HTMLDivElement

  // Vitesse des boucles par phase. updatePlaybackRate garde la position courante :
  // le changement de rythme se fait sans saut, ce qu'un échange de keyframes ne sait pas.
  const RATE: Record<Phase, number> = { listening: 1, thinking: 2.2, answering: 0.55 }

  $effect(() => {
    const rate = RATE[phase]
    for (const animation of root.getAnimations({ subtree: true })) {
      if (animation instanceof CSSAnimation && animation.animationName.includes('loop-')) animation.updatePlaybackRate(rate)
    }
  })
</script>

<div class="siri" data-phase={phase} bind:this={root} aria-hidden="true">
  <div class="band">
    <span class="halo"></span>
    <span class="swirl"><span></span></span>
    <span class="strands">
      <span class="strand warm"></span>
      <span class="strand cool"></span>
      <span class="strand lilac"></span>
    </span>
    <span class="fringe"></span>
    <span class="core"></span>
    <span class="sheen"></span>
  </div>
</div>

<style>
  .siri {
    position: absolute;
    inset: 0;
    z-index: 0;
    border-radius: inherit;
    overflow: hidden;
    pointer-events: none;
    isolation: isolate;
    contain: strict;
    container-type: size;
    opacity: 0.92;
  }
  /* Sur un îlot noir posé sur papier clair, la même lumière paraît plus vive : un cran plus bas. */
  :global(:root[data-theme='light']) .siri {
    opacity: 0.8;
  }

  /* Ligne d'eau : basse dans le corps, réglable par l'îlot (--siri-band-y). */
  .band {
    position: absolute;
    inset-inline: 0;
    top: var(--siri-band-y, 74%);
    height: 0;
    animation: band-in 0.7s var(--ease-spring-liquid, ease-out) both;
  }
  /* Capsule (une ligne de saisie) : la lumière passe sous le texte, pas à travers. */
  @container (max-height: 80px) {
    .band {
      top: var(--siri-band-y, 84%);
    }
  }
  .band > span,
  .strand {
    position: absolute;
    display: block;
    mix-blend-mode: plus-lighter;
    will-change: transform;
  }

  .halo {
    inset-inline: 0;
    top: -34px;
    height: 68px;
    background:
      radial-gradient(48% 46% at 50% 38%, rgb(150 176 232 / 0.2), transparent 72%),
      radial-gradient(36% 30% at 50% 66%, rgb(255 206 184 / 0.1), transparent 75%);
    animation: loop-halo 4.4s ease-in-out infinite alternate;
  }

  .strands {
    inset-inline: 12%;
    top: 0;
    height: 0;
    opacity: 0.85;
    transition: transform 0.7s var(--ease-spring-liquid, ease-out), opacity 0.4s ease;
  }
  .strand {
    inset-inline: 0;
    top: -8px;
    height: 16px;
    border-radius: 50%;
  }
  .warm {
    background: radial-gradient(closest-side, rgb(255 196 176 / 0.9), rgb(255 160 140 / 0.32) 55%, transparent);
    animation: loop-warm 3.2s ease-in-out infinite alternate;
  }
  .cool {
    background: radial-gradient(closest-side, rgb(178 216 255 / 0.85), rgb(120 176 255 / 0.3) 55%, transparent);
    animation: loop-cool 4.1s ease-in-out -1.3s infinite alternate;
  }
  .lilac {
    background: radial-gradient(closest-side, rgb(226 214 255 / 0.8), rgb(176 156 255 / 0.26) 55%, transparent);
    animation: loop-lilac 5.3s ease-in-out -2.1s infinite alternate;
  }

  /* Prisme : les bords de la lumière se séparent en un liseré chaud au-dessus, froid au-dessous. */
  .fringe {
    inset-inline: 18%;
    top: -6px;
    height: 12px;
    background: linear-gradient(180deg, transparent, rgb(255 150 118 / 0.32) 28%, transparent 50%, rgb(118 168 255 / 0.32) 72%, transparent);
    mask-image: linear-gradient(90deg, transparent, #000 32%, #000 68%, transparent);
    animation: loop-fringe 3.7s ease-in-out -0.8s infinite alternate;
  }

  .core {
    inset-inline: 24%;
    top: -1px;
    height: 2px;
    background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.85) 50%, transparent);
    animation: loop-core 2.6s ease-in-out infinite alternate;
  }

  /* Réfléchir : un anneau teinté écrasé en ellipse tourne autour de la lumière resserrée. */
  .swirl {
    left: 50%;
    top: -110px;
    width: 220px;
    height: 220px;
    margin-left: -110px;
    transform: scaleY(0.16);
    opacity: 0;
    transition: opacity 0.45s ease;
  }
  .swirl > span {
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: conic-gradient(rgb(255 190 168 / 0.6), rgb(170 210 255 / 0.6), rgb(214 198 255 / 0.6), rgb(255 255 255 / 0.3), rgb(255 190 168 / 0.6));
    mask-image: radial-gradient(closest-side, transparent 38%, #000 62%, transparent);
    animation: swirl 2.4s linear infinite paused;
  }

  /* Répondre : un reflet calme longe la ligne pendant que le texte arrive. */
  .sheen {
    left: 0;
    top: -10px;
    width: 30%;
    height: 20px;
    background: radial-gradient(closest-side, rgb(255 255 255 / 0.3), transparent);
    opacity: 0;
    transition: opacity 0.4s ease;
    animation: sheen 2.8s ease-in-out infinite paused;
  }

  .siri[data-phase='thinking'] .strands {
    transform: scale(0.62, 1.35);
    opacity: 1;
  }
  .siri[data-phase='thinking'] .swirl {
    opacity: 0.75;
  }
  .siri[data-phase='thinking'] .swirl > span,
  .siri[data-phase='answering'] .sheen {
    animation-play-state: running;
  }
  .siri[data-phase='answering'] .strands {
    transform: scale(1.04, 0.7);
    opacity: 0.7;
  }
  .siri[data-phase='answering'] .sheen {
    opacity: 1;
  }

  @keyframes band-in {
    from { transform: scaleX(0.2); opacity: 0; }
  }
  @keyframes loop-halo {
    from { transform: scale(0.92, 0.85); }
    to { transform: scale(1.05, 1.1); }
  }
  @keyframes loop-warm {
    from { transform: translateX(-9%) scale(0.82, 0.45); }
    to { transform: translateX(8%) scale(1.04, 1.15); }
  }
  @keyframes loop-cool {
    from { transform: translateX(10%) scale(0.9, 1.1); }
    to { transform: translateX(-7%) scale(0.74, 0.5); }
  }
  @keyframes loop-lilac {
    from { transform: translate(-4%, 1px) scale(0.68, 0.7); }
    to { transform: translate(5%, -1px) scale(0.96, 1.25); }
  }
  @keyframes loop-fringe {
    from { transform: translateX(-6%) scaleY(0.8); }
    to { transform: translateX(6%) scaleY(1.2); }
  }
  @keyframes loop-core {
    from { transform: scaleX(0.84); opacity: 0.75; }
    to { transform: scaleX(1.06); opacity: 1; }
  }
  @keyframes swirl {
    to { transform: rotate(1turn); }
  }
  @keyframes sheen {
    from { transform: translateX(-110%); }
    to { transform: translateX(440%); }
  }

  @media (prefers-reduced-motion: reduce) {
    .band,
    .band > span,
    .strand,
    .swirl > span {
      animation: none;
      transition: none;
    }
    .band > .sheen,
    .band > .swirl {
      display: none;
    }
  }
</style>
