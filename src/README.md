# src

## Purpose
Frontend Svelte 5 de Doku (lecteur/éditeur de documents — shell W1 + éditeur Markdown live preview).

## Files
| File | Purpose |
|---|---|
| `main.ts` | Point d'entrée : fonts bundlées, montage de App, affichage sans flash puis activation du backdrop natif |
| `app.css` | Tokens AIR, repli CSS du chrome, styles de base et icônes Material Symbols |
| `App.svelte` | Assemblage shell (sidebar + titlebar + bureau + copilote) + raccourcis clavier globaux |
| `components/TitleBar.svelte` | Barre 40px : onglets Chrome-style, onglets de volets alignés en split, menu compact partagé, options et contrôles fenêtre |
| `components/Sidebar.svelte` | Ruban d'icônes 46px + panneau (Fichiers / Plan / Historique), repliée = 0px |
| `components/WorkspaceView.svelte` | Orchestration du bureau simple/scindé, séparateur redimensionnable et orientation responsive |
| `components/DocumentPane.svelte` | Enveloppe de volet : document actif, état vide et sélecteur local lorsque les volets sont empilés |
| `components/PaneTabSelector.svelte` | Sélecteur compact partagé entre le header global et le volet secondaire responsive |
| `components/SplitDivider.svelte` | Séparateur redimensionnable à la souris et au clavier, ratio borné à 25–75 % |
| `components/DocumentView.svelte` | Hôte CM6 par volet, cache d’états par onglet et menu contextuel de sélection |
| `components/PdfView.svelte` | Lecteur PDF adaptatif, TextLayer sélectionnable, commentaires et mode dessin vectoriel non destructif |
| `components/CopilotPanel.svelte` | Chat Doku-San, choix des fournisseurs, composeur Question / Contexte et gestion de la mémoire cloud |
| `lib/openai.ts` | Client IPC OpenAI : connexion du compte Codex, statut, streaming et annulation sans exposer les jetons |
| `lib/copilot-memory.ts` | Schéma Markdown, validation, déduplication et prompts purs de la mémoire de travail |
| `lib/copilot-memory.svelte.ts` | Chargement, rappel, extraction, mutations atomiques et annulation de la mémoire cloud |
| `lib/stores.svelte.ts` | État global (runes) : onglets, workspace, thème, sidebar, TOC, dirty tracking et sauvegarde |
| `lib/workspace.ts` | Machine d'état pure des deux volets et invariants anti-duplication |
| `lib/session.ts` | Session v2, migration v1 et restauration des chemins par volet |
| `lib/editor-registry.svelte.ts` | Registre runtime des EditorView et sélections propres à chaque volet |
| `lib/save-as.ts` | Transaction pure « Enregistrer sous » avec extension, collision et rollback |
| `lib/pdf-annotations.ts` | Identité, migration et manifeste local des annotations PDF non destructives ; carnet unifié (notes) et regroupement des épingles |
| `lib/pdf-drawing.ts` | Primitives pures des tracés PDF (crayon, surligneur, rectangle, ellipse) : épaisseur, normalisation, simplification et déplacement borné |
| `lib/pdf-highlight-text.ts` | Géométrie pure de la citation d'un surlignage : quelles lignes de texte le trait balaie, et sur quelle plage |
| `lib/editor/editor.ts` | Extensions CM6 : thème typographique du design, coloration, Compartment preview/source |
| `lib/editor/live-preview.ts` | Décorations live preview (ADR-0002) : masquage syntaxe, checkboxes, wikilinks |
| `lib/tauri.ts` | Garde Tauri : Mica Windows 11, fenêtre, dialogues et écriture atomique — no-op en navigateur |
| `lib/demo.ts` | Contenu de démonstration (mode navigateur) |
| `assets/doku-mark-rounded.svg` | Logo officiel (mark « D » pli de page) |

## Dependencies
- Internal: `docs/design/w1/` (maquette de référence), tokens AIR
- External: CodeMirror 6, fonts @fontsource (Inter Variable, Geist Mono, Source Serif 4), material-symbols, @tauri-apps/*
