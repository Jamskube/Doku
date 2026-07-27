# Doku

Application de bureau pour **ouvrir, lire et éditer des documents** — Markdown en premier, PDF en lecture, export HTML/DOCX — avec un copilote IA **100 % local** (Ollama, RAG sur dossier). Native Windows ARM64.

## État du projet
📦 **v2.2.0** — feature-complete (Epics 1-16, 18, 19 livrés ; ledger 69 features / 68 PASS). Phase actuelle : usage réel quotidien, le prochain chantier émergera de l'usage.

## Stack
Tauri 2 + Svelte 5 + Vite (TypeScript) · CodeMirror 6 « live preview » · pdf.js · sidecar Ollama (`qwen2.5:1.5b-instruct-q4_0`) · hôte Rust minimal (ADR-0004). Décisions : `docs/adr/` (16 ADR).

## Démarrer
```
npm install
npm run dev          # UI navigateur (APIs Tauri neutralisées) — http://localhost:1420
npm run tauri dev    # app native (première compile Rust longue)
npm run check        # svelte-check
npm test             # vitest
npm run tauri build  # installateur NSIS ARM64 (habillé D.A. Doku)
```

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
