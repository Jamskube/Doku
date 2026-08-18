# Doku

Application de bureau pour **ouvrir, lire et éditer des documents** — Markdown en premier, PDF en lecture, export HTML/DOCX — avec un copilote IA **100 % local** (Ollama, RAG sur dossier). Native Windows ARM64 et x64.

## État du projet
📦 **v3.0.0** — feature-complete (Epics 1-16, 18, 19 livrés ; ledger 69 features / 68 PASS), plus l'édition DOCX, l'annotation PDF et la réécriture par consigne libre. Phase actuelle : usage réel quotidien, le prochain chantier émergera de l'usage.

## Stack
Tauri 2 + Svelte 5 + Vite (TypeScript) · CodeMirror 6 « live preview » · pdf.js · sidecar Ollama (`qwen2.5:1.5b-instruct-q4_0`) · hôte Rust minimal (ADR-0004). Décisions : `docs/adr/` (16 ADR).

## Démarrer
```
npm install
npm run dev          # UI navigateur (APIs Tauri neutralisées) — http://localhost:1420
npm run tauri dev    # app native (première compile Rust longue)
npm run check        # svelte-check
npm test             # vitest
npm run build:installer:arm64  # installateur NSIS ARM64
npm run build:installer:x64    # installateur NSIS Intel/AMD x64
```

## Linux (AppImage)
Construite en CI seulement — WebKitGTK ne se cross-compile pas depuis Windows. Lancer le
workflow **Build Linux x64** (`workflow_dispatch` ou tag `v*`), récupérer l'artefact,
`chmod +x` et exécuter : aucune installation.

Deux différences avec Windows, voir [ADR-0025](docs/adr/0025-distribution-linux-appimage.md)
et [ADR-0026](docs/adr/0026-coffre-de-secrets-multiplateforme.md) : Doku lance l'**Ollama du
système** (`sudo pacman -S ollama`, `apt install ollama`…) plutôt qu'un sidecar empaqueté, et
les clés du copilote cloud vivent dans le **Secret Service** de la session (GNOME Keyring,
KWallet, KeePassXC) au lieu du Gestionnaire d'identifiants Windows.

Le build x64 automatisé est aussi disponible dans GitHub Actions via le workflow
`Build Windows x64`. Il publie un artefact contenant l'installateur et son SHA-256.

## Structure
| Dossier | Rôle |
|---|---|
| `src/` | Frontend Svelte 5 (components, lib, éditeur CM6) |
| `src-tauri/` | Hôte Rust minimal, config Tauri, installateur NSIS, sidecar |
| `docs/` | Documentation : planning, ADR, design, sprints, journal |
| `spike/` | Bancs d'essai conservés (WYSIWYG S0, RAG 15.1, NPU 17.1) |
| `public/` | Assets statiques servis tels quels par Vite |

## Contexte IA
Le fichier `AGENTS.md` contient le contexte pour les assistants de code — à lire en début de session. Reprise de session : `docs/journal/_next-session.md`.

## Licence
**AGPL-3.0-or-later** — voir [`LICENSE`](./LICENSE). Copyright © 2026 Kubo.

Ce choix ouvre l'accès aux moteurs documentaires sous AGPL (MuPDF.js, SuperDoc) dont Doku a besoin pour l'édition de documents ; le raisonnement est dans [ADR-0023](./docs/adr/0023-licence-agpl.md). Toute redistribution, modifiée ou non, doit rester sous AGPL et fournir le code source correspondant.
