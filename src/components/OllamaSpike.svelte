<script lang="ts">
  // SPIKE 13.1 (JETABLE) — widget de test du sidecar Ollama, rendu en DEV uniquement
  // (gate `import.meta.env.DEV` côté DocumentView → absent des builds de prod). À SUPPRIMER
  // quand 14.1 (panneau copilote) livre l'UI réelle. NE PAS construire dessus.
  // Le « pull » est un bouton SÉPARÉ du « test » : la mesure « 0 réseau à l'inférence » doit
  // se faire au niveau process (netstat/pare-feu sur ollama.exe), pas polluée par un download.
  import { app } from '../lib/stores.svelte'
  import { generate, listModels, pull, startOllama, waitReady } from '../lib/ollama'

  let port = $state<number | null>(null)
  let busy = $state(false)
  let controller: AbortController | null = null

  async function ensureStarted(): Promise<number | null> {
    if (port !== null) return port
    app.banner = 'IA (spike) : démarrage du sidecar…'
    const p = await startOllama()
    if (p === null) {
      app.banner = 'IA (spike) : indisponible (mode navigateur — lancer en natif)'
      return null
    }
    if (!(await waitReady(p))) {
      app.banner = "IA (spike) : le sidecar n'a pas répondu (voir la console)"
      return null
    }
    port = p
    return p
  }

  async function test() {
    if (busy) return
    busy = true
    controller = new AbortController()
    try {
      const p = await ensureStarted()
      if (p === null) return
      const models = await listModels(p)
      if (!models.length) {
        app.banner = 'IA (spike) : aucun modèle — clique « pull 0.5b » d’abord'
        return
      }
      app.banner = `IA (spike) : génération (${models[0].name})… (clique stop pour annuler)`
      let out = ''
      // Prompt long → laisse le temps de tester l'annulation (13.3).
      await generate(
        p,
        models[0].name,
        'Écris un paragraphe détaillé sur l’histoire de l’informatique, des origines à aujourd’hui.',
        (t) => {
          out += t
          console.log('[ollama]', t)
        },
        controller.signal,
      )
      app.banner = (controller.signal.aborted ? 'IA (spike) annulée : ' : 'IA (spike) : ') + out
    } catch (e) {
      console.error('[spike ollama]', e)
      app.banner = 'IA (spike) : erreur — ' + String(e)
    } finally {
      busy = false
      controller = null
    }
  }

  function stop() {
    controller?.abort()
  }

  async function doPull() {
    if (busy) return
    busy = true
    try {
      const p = await ensureStarted()
      if (p === null) return
      if (!confirm('Télécharger qwen2.5:0.5b (~400 Mo) dans %APPDATA%\\Doku\\models ?')) {
        app.banner = 'IA (spike) : téléchargement annulé'
        return
      }
      await pull(p, 'qwen2.5:0.5b', (pct) => {
        app.banner = `IA (spike) : téléchargement du modèle ${pct}%`
      })
      app.banner = 'IA (spike) : modèle téléchargé — clique « tester »'
    } catch (e) {
      console.error('[spike ollama]', e)
      app.banner = 'IA (spike) : erreur pull — ' + String(e)
    } finally {
      busy = false
    }
  }
</script>

<div class="spike">
  <button onclick={test} disabled={busy}>🧪 IA: tester</button>
  <button onclick={stop} disabled={!busy}>🧪 stop</button>
  <button onclick={doPull} disabled={busy}>🧪 pull 0.5b</button>
</div>

<style>
  .spike {
    position: fixed;
    bottom: 10px;
    right: 12px;
    z-index: 50;
    display: flex;
    gap: 6px;
    opacity: 0.85;
  }
  .spike button {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 8px;
    border: 1px solid var(--ink-4);
    border-radius: 4px;
    background: #fff;
    color: var(--ink);
    cursor: pointer;
  }
  .spike button:disabled {
    opacity: 0.5;
    cursor: default;
  }
</style>
