# Next session pointer
_Updated: 2026-07-14 16:55_

## Where I left off
**Cap v2 (copilote IA local) — Epic 13 codé 4/4, il reste UNE validation native.** Le moteur Ollama en sidecar est complet et robuste (13.1-13.3 validés natif : génération ARM64 ~120 tok/s, Job Object crash-kill, offline `OLLAMA_NO_CLOUD`, client generate/pull/delete + annulation). **13.4 (vue sidebar « Copilote » : gestion des modèles — liste/tailles, pull+progression+annuler, purge, modèle actif persistant) est CODE-COMPLETE + revu (critic + code-reviewer Approve, Major `ensureReady` corrigé) mais PAS encore validé natif** → ledger **49/50**. Amont v2 écrit : PRD-v2, architecture-v2-copilot, ADR-0012 (amendé), epics 13-16.

## Open work
- Branch: `main` — **propre** (poussé, `05a859a`)
- Open PRs: aucune
- Sprint actif: **Sprint 11** (Epic 13), reste la **validation native de 13.4**
- Prérequis machine : `src-tauri/binaries/ollama-aarch64-pc-windows-msvc.exe` + `lib/ollama/` en place (non commités)
- Dette : (1) **valider 13.4 en natif** (ouvrir la vue Copilote → liste modèles, pull, purge, actif persistant) → flipper ledger 50/50 ; (2) packaging release (`resource_dir`) au prochain `tauri build` ; (3) pare-feu `ollama.exe` = garantie dure 8.3 ; (4) **supprimer `OllamaSpike.svelte`** (widget DEV) en 14.1 ; (5) réconcilier `app.activeModel` persisté vs modèles présents (pour 14.1 `generate`).

## Next concrete step
**Valider 13.4 en natif** (vue Copilote dans `tauri dev`) → flipper le ledger (**50/50, Epic 13 clos = fondation copilote complète**). Puis **`/epct 14.1`** — panneau copilote (chat streaming + annuler, au-dessus de la section Modèles dans la même vue), première story de l'Epic 14 (v2.0 : chat + résumer + Q&A doc), qui **remplace et supprime** `OllamaSpike.svelte`.
