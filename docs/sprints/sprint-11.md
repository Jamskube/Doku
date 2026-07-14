# Sprint 11

**Goal** : Le moteur IA local tourne dans Doku (sidecar Ollama) et l'utilisateur gère ses modèles — fondation du copilote (v2.0, Epic 13).
**Start** : 2026-07-14
**End** : 2026-07-28
**Status** : Active

1er sprint du cap v2 (source : `docs/planning/PRD-v2.md`, Epic 13 ; ADR-0006 moteur, ADR-0012 cycle de vie). À la clôture : Doku embarque `ollama.exe` ARM64 en sidecar, streame une génération locale hors-ligne, et l'utilisateur pull/choisit/purge ses modèles.

## Stories

| # | Story | Size | Status | Notes |
|---|---|---|---|---|
| 13.1 | Spike : sidecar Ollama ARM64 (externalBin, serve, generate, port éphémère) | M | ✅ Done | **GO** (validé natif 2026-07-14, 3/3 critères). ~120 tok/s CPU ARM64, 100% local, kill d'arbre propre. Findings → dette 13.2 ci-dessous. |
| 13.2 | SidecarManager (port éphémère, readiness-poll, kill, pidfile) | M | TODO | Dépend de 13.1. ADR-0012. Rust minimal (spawn + port + kill + proxy). |
| 13.3 | OllamaClient (generate stream, tags, pull, delete, annulation) | M | TODO | TS pur/fetch. NDJSON + AbortController (annulation < 500 ms). 0 requête non-localhost à l'inférence. |
| 13.4 | Gestion des modèles (liste, pull+progress, actif persistant, taille/purge) | M | TODO | UI ModelManager. Modèles dans `%APPDATA%\Doku\models`. Exigence-cœur ADR-0006. |

## Blockers
_None_

## Checkpoints STOP/GO
| ~% | Critère | Si STOP |
|---|---|---|
| 25 % (13.1) | `ollama.exe` ARM64 spawn + `/api/generate` streame en local, 0 réseau, kill propre | Re-gate ADR-0006 (llama.cpp / Foundry Local), stopper le sprint |
| 60 % (13.2-13.3) | Génération streamée pilotée depuis le front, annulable, port éphémère sans collision | Revoir le cycle de vie (ADR-0012) |
| 90 % (13.4) | Pull + choix du modèle actif persistants, purge OK | Livrer 13.1-13.3, reporter 13.4 |

## Progress Log
### 2026-07-14
- Sprint initialisé avec 4 stories (Epic 13, toutes M/P0). Vélocité cible 3-4 ; 4×M = bord haut, mais Epic 13 = unité livrable cohérente (« le moteur marche »).
- Risque n°1 : **13.1** faisabilité sidecar Ollama ARM64 natif (spawn/port/generate hors-ligne). Gate go/no-go en tête ; échec → re-gate ADR-0006.
- Contexte v2 prêt en amont : PRD-v2, architecture-v2-copilot, ADR-0012 (cycle de vie sidecar) écrits et poussés avant ce sprint.

### 2026-07-14 — 13.1 GO (checkpoint 25 % franchi)
Spike validé natif : `ollama.exe` ARM64 (asset `ollama-windows-arm64.zip`, v0.32.0) en sidecar, génération streamée **~120 tok/s** CPU Snapdragon X, 100% local, kill d'arbre propre. **Faisabilité ADR-0006/0012 confirmée → le cap v2 continue.**

**Findings → dette à traiter en 13.2 (SidecarManager) :**
1. **`lib/ollama` packaging** — le zip ARM64 = `ollama.exe` + dossier `lib/ollama/` (DLLs + `llama-server.exe`) qu'Ollama charge relativement au dossier de l'exe. `externalBin` ne copie **que** l'exe. En dev, le sidecar tourne depuis `target/debug` → hand-copie `lib/` dans `target/debug/`. **13.2** : empaqueter `lib/ollama` via `bundle.resources` + résoudre `OLLAMA_LIBRARY_PATH` via `app.path().resource_dir()` (robuste dev + build).
2. **Kill d'arbre** — `ollama.exe` spawne `llama-server.exe` (grand-enfant) ; `CommandChild::kill` seul le laissait orphelin. Corrigé au spike par `taskkill /F /T`. **13.2** : Job Object `KILL_ON_JOB_CLOSE` (survit à un crash de Doku) + pidfile sweep (ADR-0012).
3. **Egress / principe 8.3** — Ollama a `OLLAMA_REMOTES=ollama.com`, un check `model_recommendations` planifié (~4 h), `OLLAMA_NO_CLOUD=false`, et génère une clé SSH `~/.ollama/id_ed25519`. **13.2** : neutraliser le cloud/télémétrie (`OLLAMA_NO_CLOUD`, recommendations off) et **re-vérifier 0 réseau au repos** au niveau process.
4. **CORS** — Ollama fusionne notre `OLLAMA_ORIGINS` avec une liste permissive par défaut (localhost/0.0.0.0/*). Loopback-only donc risque faible ; à noter.
