<script lang="ts">
  // Marque « D » de Doku, sans le fond noir de l'icône d'app : suit la couleur
  // du thème via currentColor. L'icône bureau/barre des tâches (fond noir arrondi)
  // vit dans src-tauri/icon-source.svg.
  //
  // `trace` : 'once' dessine le contour une fois puis le remplit (apparition) ; 'loop' fait
  // courir un segment autour du contour fantôme, sans remplissage (indicateur de chargement).
  let { size = 24, trace = false }: { size?: number; trace?: false | 'once' | 'loop' } = $props()
  const width = $derived(Math.round((size * 490) / 572))
  // Trait de ~1,5 px à l'écran quelle que soit la taille, exprimé en unités du viewBox.
  const strokeUnits = $derived((1.5 * 572) / size)

  const OUTLINE = 'M332 286H520C538 286 548 293 562 307L704 449C735 480 754 532 754 586C754 716 650 818 520 818H332Q304 818 304 790V314Q304 286 332 286'
  const COUNTER = 'M424 370Q396 370 396 398V684Q396 716 428 716H520C596 716 660 655 660 578V458H552V370H424'
</script>

<svg {width} height={size} viewBox="284 266 490 572" fill="none" aria-hidden="true" class:once={trace === 'once'} class:loop={trace === 'loop'}>
  {#if trace === 'loop'}
    <path class="ghost" d={OUTLINE} stroke="currentColor" stroke-width={strokeUnits} stroke-linejoin="round" />
    <path class="runner" d={OUTLINE} stroke="currentColor" stroke-width={strokeUnits * 1.6} stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
  {:else}
    {#if trace === 'once'}
      <path class="draw" d={OUTLINE} stroke="currentColor" stroke-width={strokeUnits} stroke-linecap="round" stroke-linejoin="round" pathLength="1" />
    {/if}
    <g class="fill">
      <path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="{OUTLINE}{COUNTER}" />
      <!-- Petite ombre sous la pliure : couleur de la surface (crème en clair, sombre en foncé)
           pour toujours contraster avec la marque en currentColor -->
      <path fill="var(--cream-content)" d="M660 458H724L668 472H660Z" />
    </g>
  {/if}
</svg>

<style>
  .draw {
    stroke-dasharray: 1 1;
    animation:
      mark-draw 900ms cubic-bezier(.65, 0, .35, 1) both,
      mark-fade-out 300ms ease 850ms forwards;
  }
  .once .fill { animation: mark-fade-in 400ms ease 700ms both; }
  @keyframes mark-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
  @keyframes mark-fade-in { from { opacity: 0; } }
  @keyframes mark-fade-out { to { opacity: 0; } }

  .ghost { opacity: 0.18; }
  .runner {
    stroke-dasharray: 0.16 0.84;
    animation: mark-run 1.6s linear infinite;
  }
  @keyframes mark-run { to { stroke-dashoffset: -1; } }

  /* La règle globale ramène les durées à ~0 mais garde les délais : sans ceci, la marque
     resterait invisible 700 ms. Mouvement réduit = marque pleine d'emblée, contour fixe. */
  @media (prefers-reduced-motion: reduce) {
    .draw { display: none; }
    .once .fill { animation: none; }
    .runner { animation: none; stroke-dasharray: none; opacity: 0.6; }
  }
</style>
