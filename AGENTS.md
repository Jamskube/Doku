# AGENTS.md

Context for AI coding assistants. Read at the start of every session.

## Project goal
Doku — petite application pour **ouvrir, lire et éditer des fichiers Markdown**, avec extension prévue plus tard vers d'autres formats (**PDF**, etc.).

## Stack
- Language: TypeScript (frontend) + Rust borné à trois rôles : secrets et réseau authentifié, sidecar, API système (ADR-0030 ; l'I/O fichiers reste en TS via plugin-fs, ADR-0004)
- Framework: Tauri 2 + Svelte 5 + Vite — décidé, ADR-0001 accepted (`docs/adr/`)
- Machine de développement principale : **Windows ARM64** — Surface Pro 11, Snapdragon X Elite. Distribution prise en charge : installateurs Windows ARM64 et x64, chacun avec son sidecar Ollama CPU natif ; **AppImage Linux x64** construite en CI, sur l'Ollama du système (ADR-0025)
- Référence : `G:\KUDE` (mode lecture/édition Markdown + design system AIR) ; maquettes officielles dans `docs/design/w1/`
- Éditeur : CodeMirror 6 « live preview » (ADR-0002) — `src/lib/editor/`
- Database / ORM: aucune (fichiers locaux)
- IA : Ollama local par défaut ; OpenAI optionnel via connexion du compte ChatGPT/Codex (ADR-0014, jamais de clé API pour OpenAI) ; MiniMax optionnel via clé API validée avant stockage (ADR-0018 — seule voie d'auth existante chez eux). Tous les secrets au coffre du système (`secrets.rs`) — Gestionnaire d'identifiants sous Windows, Secret Service via `keyring` ailleurs (ADR-0026) ; aucune base URL configurable côté frontend
- Package manager: npm

## Setup commands
- Install : `npm install`
- Dev (UI navigateur, APIs Tauri neutralisées) : `npm run dev` → http://localhost:1420
- Dev (app native) : `npm run tauri dev` (première compile Rust longue)
- Build : `npm run build` · installateurs Windows : `npm run build:installer:arm64` / `npm run build:installer:x64`
- AppImage Linux : **CI uniquement** (WebKitGTK ne se cross-compile pas depuis Windows) — workflow `Build Linux x64`, `gh workflow run "Build Linux x64" --ref main`
- Typecheck : `npm run check`
- Tests : `npm test` (vitest)
- Icônes : `npm run subset:icons` (réseau requis) — à relancer quand `icons.test.ts` échoue (icône ajoutée hors subset), puis committer `src/assets/material-symbols-*`

## Conventions
- Commentaires uniquement sur le code non évident (des identifiants bien nommés font le reste)
- Un README.md par dossier, maintenu en phase avec les fichiers
- Langue : documentation projet en français ; code et identifiants en anglais

## Architecture
| Folder | Purpose |
|---|---|
| `src/` | Frontend Svelte 5 (components/, lib/, lib/editor/, assets/) |
| `src-tauri/` | Hôte Rust : plugins officiels + commandes bornées aux secrets, au réseau authentifié, au sidecar et aux API système (ADR-0030) |
| `spike/` | Bancs d'essai conservés (WYSIWYG S0, RAG 15.1, NPU 17.1) |
| `scripts/` | Outillage de build manuel (subset d'icônes) — sorties committées |
| `docs/` | Documentation (planning, adr, design, sprints, journal, plans, autopilot, archives) |
| `public/` | Assets statiques servis tels quels par Vite |
| `packaging/` | Recettes d'empaquetage hors CI (PKGBUILD Arch) |
| `.github/workflows/` | Chaînes de construction CI : `Build Windows x64`, `Build Linux x64` (AppImage) |

## Patterns
- ALWAYS: garder le cœur « lecture/édition de documents » extensible — le Markdown est le premier format, pas le seul (PDF et autres suivront)
- ALWAYS: décider la stack via PRD + architecture avant d'écrire du code
- ALWAYS: préférer une connexion de compte type OAuth quand le fournisseur en offre une (OpenAI : jamais de clé API) ; une clé API n'est acceptable que si c'est la seule voie (MiniMax, ADR-0018) et alors validée avant stockage, gardée au coffre du système, jamais renvoyée à la webview
- NEVER: créer des dossiers spécifiques à une technologie avant que la stack soit choisie

## Context & compaction
When compacting this session, always preserve: the list of modified files, the exact test/build commands, the current task and its next step.

## Project knowledge

Detailed records: `docs/agent-knowledge/index.md`.
Before non-trivial work, retrieve by task terms and affected paths; load at most 5 records/800 tokens. Pass the resulting capsule to subagents. Subagents never mutate the knowledge store; they return `lesson_candidates` to the coordinator.

### Active critical lessons
<!-- knowledge:generated:start -->
- [LES-20260716-001] Le « done » d'un spike doit énumérer ce qu'il NE couvre PAS.
- [LES-20260818-001] Jeter la cause d'un échec coûte un aller-retour complet avec l'utilisateur — un message honnête sur le FAIT mais muet sur la RAISON ne vaut guère mieux que le silence.
- [LES-20260818-002] Un repli qui n'est jamais exercé n'est pas un repli : c'est LE comportement.
- [LES-20260820-001] Rendre une dimension RÉGLABLE ouvre un domaine de valeurs que personne n'avait jamais exploré — et le défaut qui y dormait devient un défaut livré.
<!-- knowledge:generated:end -->

<!-- knowledge:migrated version=1 -->
