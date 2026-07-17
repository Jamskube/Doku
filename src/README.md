# src

## Purpose
Frontend Svelte 5 de Doku (lecteur/éditeur de documents — shell W1 + éditeur Markdown live preview).

## Files
| File | Purpose |
|---|---|
| `main.ts` | Point d'entrée : fonts bundlées, CSS global, montage de App |
| `app.css` | Tokens AIR (crème + sombre), styles de base, icônes Material Symbols |
| `App.svelte` | Assemblage shell (sidebar + titlebar + stage) + raccourcis clavier globaux |
| `components/TitleBar.svelte` | Barre 40px : onglets Chrome-style, menu ⋯ du document, pin/thème/contrôles fenêtre |
| `components/Sidebar.svelte` | Ruban d'icônes 46px + panneau (Fichiers / Plan / Historique), repliée = 0px |
| `components/DocumentView.svelte` | Hôte CM6 plein espace, cache d'états par onglet, menu contextuel de sélection |
| `components/CopilotPanel.svelte` | Chat Doku-San, choix Ollama/OpenAI et composeur superposé Question / Contexte |
| `lib/openai.ts` | Client IPC OpenAI : connexion du compte Codex, statut, streaming et annulation sans exposer les jetons |
| `lib/stores.svelte.ts` | État global (runes) : onglets, thème, sidebar, TOC, dirty tracking |
| `lib/editor/editor.ts` | Extensions CM6 : thème typographique du design, coloration, Compartment preview/source |
| `lib/editor/live-preview.ts` | Décorations live preview (ADR-0002) : masquage syntaxe, checkboxes, wikilinks |
| `lib/tauri.ts` | Garde Tauri : fenêtre, dialogues, écriture atomique — no-op en navigateur |
| `lib/demo.ts` | Contenu de démonstration (mode navigateur) |
| `assets/doku-mark-rounded.svg` | Logo officiel (mark « D » pli de page) |

## Dependencies
- Internal: `docs/design/w1/` (maquette de référence), tokens AIR
- External: CodeMirror 6, fonts @fontsource (Geist, Geist Mono, Source Serif 4), material-symbols, @tauri-apps/*
