<script lang="ts">
  // Chiffres qui roulent (Kube number-roll) : chaque chiffre est une colonne 0-9 translatée
  // en Y. Les autres caractères (%, espace, ×) restent fixes. Le texte complet est lu par
  // les lecteurs d'écran ; les colonnes sont décoratives.
  let { value }: { value: string | number } = $props()
  const chars = $derived([...String(value)])
</script>

<span class="roll"><span class="sr">{value}</span><span class="cols" aria-hidden="true">{#each chars as ch, i (chars.length - i)}{#if ch >= '0' && ch <= '9'}<span class="col"><span class="stack" style:--d={ch}>{#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as n (n)}<span>{n}</span>{/each}</span></span>{:else}<span>{ch}</span>{/if}{/each}</span></span>

<style>
  .roll { position: relative; display: inline-flex; font-variant-numeric: tabular-nums; }
  .cols { display: inline-flex; }
  .col { display: inline-block; height: 1lh; overflow: clip; }
  .stack {
    display: flex;
    flex-direction: column;
    transform: translateY(calc(var(--d) * -10%));
    transition: transform 300ms cubic-bezier(.16, 1, .3, 1);
  }
  .sr {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
