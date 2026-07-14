# Next session pointer
_Updated: 2026-07-14 16:20_

## Where I left off
**Cap v2 (copilote IA local) — fondation quasi complète.** Sprint 11 (Epic 13) **3/4** : le moteur Ollama en sidecar est **fonctionnel, robuste et offline**, validé en natif. 13.1 (spike GO — génération ARM64 ~120 tok/s, 100% local), 13.2 (SidecarManager : Job Object `KILL_ON_JOB_CLOSE` = kill d'arbre même au crash ; `OLLAMA_NO_CLOUD=1` = 0 egress ; lib via `resource_dir()`/`CARGO_MANIFEST_DIR`), 13.3 (OllamaClient : generate stream + annulation AbortController + delete). Ledger **49/50**. Toute l'infra risquée (Rust/sidecar/unsafe Windows) est derrière nous. Amont v2 écrit : PRD-v2, architecture-v2-copilot, ADR-0012 (amendé), epics 13-16.

## Open work
- Branch: `main` — **propre** (poussé, `ebde778`)
- Open PRs: aucune
- Sprint actif: **Sprint 11** (Epic 13), reste **13.4** (UI gestion des modèles)
- Prérequis machine : `src-tauri/binaries/ollama-aarch64-pc-windows-msvc.exe` + `lib/ollama/` en place (non commités, cf. binaries/README.md)
- Dette : (1) valider le **packaging release** (`resource_dir()` + `bundle.resources`) au prochain `tauri build` ; (2) pare-feu sur `ollama.exe` = garantie dure 8.3 ; (3) **supprimer `OllamaSpike.svelte`** (widget DEV jetable) quand 14.1 livre l'UI réelle ; (4) CORS Ollama permissif par défaut (loopback, faible risque).

## Next concrete step
**`/epct 13.4`** — UI gestion des modèles (liste + tailles + pull avec progression + modèle actif persistant en settings + purge confirmée). Le client est prêt (`ollama.ts` : listModels/pull/deleteModel). **Décision de design à trancher d'abord** : où vit le panneau modèles — sa propre vue sidebar, ou un sous-panneau du futur panneau copilote (14.1) ? Clôt l'Epic 13 = fondation copilote complète, puis Epic 14 (panneau chat + résumer + Q&A doc) = v2.0.
