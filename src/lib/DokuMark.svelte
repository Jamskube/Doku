<script lang="ts">
  // Marque « D » de Doku, sans le fond noir de l'icône d'app : suit la couleur
  // du thème via currentColor. L'icône bureau/barre des tâches (fond noir arrondi)
  // vit dans src-tauri/icon-source.svg.
  let { size = 24 }: { size?: number } = $props()
  const width = $derived(Math.round((size * 490) / 572))
</script>

<svg {width} height={size} viewBox="284 266 490 572" fill="none" aria-hidden="true">
  <path
    fill="currentColor"
    fill-rule="evenodd"
    clip-rule="evenodd"
    d="M332 286H520C538 286 548 293 562 307L704 449C735 480 754 532 754 586C754 716 650 818 520 818H332Q304 818 304 790V314Q304 286 332 286M424 370Q396 370 396 398V684Q396 716 428 716H520C596 716 660 655 660 578V458H552V370H424"
  />
  <!-- Petite ombre sous la pliure : couleur de la surface (crème en clair, sombre en foncé)
       pour toujours contraster avec la marque en currentColor -->
  <path fill="var(--cream-content)" d="M660 458H724L668 472H660Z" />
</svg>
