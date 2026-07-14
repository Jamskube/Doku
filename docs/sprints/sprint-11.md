# Sprint 11

**Goal** : Le moteur IA local tourne dans Doku (sidecar Ollama) et l'utilisateur gère ses modèles — fondation du copilote (v2.0, Epic 13).
**Start** : 2026-07-14
**End** : 2026-07-28
**Status** : Active

1er sprint du cap v2 (source : `docs/planning/PRD-v2.md`, Epic 13 ; ADR-0006 moteur, ADR-0012 cycle de vie). À la clôture : Doku embarque `ollama.exe` ARM64 en sidecar, streame une génération locale hors-ligne, et l'utilisateur pull/choisit/purge ses modèles.

## Stories

| # | Story | Size | Status | Notes |
|---|---|---|---|---|
| 13.1 | Spike : sidecar Ollama ARM64 (externalBin, serve, generate, port éphémère) | M | TODO | **⚠️ Checkpoint go/no-go faisabilité.** Confirme ADR-0006/0012 en natif AVANT de coder 13.2. Validation native obligatoire (ne se teste pas en dev navigateur). |
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
