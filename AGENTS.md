# AGENTS.md

Context for AI coding assistants. Read at the start of every session.

## Project goal
Doku — petite application pour **ouvrir, lire et éditer des fichiers Markdown**, avec extension prévue plus tard vers d'autres formats (**PDF**, etc.).

## Stack
- Language: TypeScript (frontend) + Rust minimal (hôte Tauri, zéro logique métier — ADR-0004)
- Framework: Tauri 2 + Svelte 5 + Vite — décidé, ADR-0001 accepted (`docs/adr/`)
- Contrainte machine : **Windows ARM64** — Surface Pro 11, Snapdragon X Elite, NPU (IA locale envisagée en v2) → la stack doit tourner nativement en ARM64
- Référence : `G:\KUDE` (mode lecture/édition Markdown + design system AIR) ; maquettes officielles dans `docs/design/w1/`
- Éditeur : CodeMirror 6 « live preview » (ADR-0002) — `src/lib/editor/`
- Database / ORM: aucune (fichiers locaux)
- Package manager: npm

## Setup commands
- Install : `npm install`
- Dev (UI navigateur, APIs Tauri neutralisées) : `npm run dev` → http://localhost:1420
- Dev (app native) : `npm run tauri dev` (première compile Rust longue)
- Build : `npm run build` · installateur : `npm run tauri build`
- Typecheck : `npm run check`

## Conventions
- Commentaires uniquement sur le code non évident (des identifiants bien nommés font le reste)
- Un README.md par dossier, maintenu en phase avec les fichiers
- Langue : documentation projet en français ; code et identifiants en anglais

## Architecture
| Folder | Purpose |
|---|---|
| `src/` | Frontend Svelte 5 (components/, lib/, lib/editor/, assets/) |
| `src-tauri/` | Hôte Rust minimal — plugins officiels uniquement (ADR-0004) |
| `spike/` | Spike S0 (comparatif moteurs WYSIWYG) — conservé comme référence |
| `docs/` | Documentation (planning, adr, design, journal, archives) |

## Patterns
- ALWAYS: garder le cœur « lecture/édition de documents » extensible — le Markdown est le premier format, pas le seul (PDF et autres suivront)
- ALWAYS: décider la stack via PRD + architecture avant d'écrire du code
- NEVER: créer des dossiers spécifiques à une technologie avant que la stack soit choisie

## Context & compaction
When compacting this session, always preserve: the list of modified files, the exact test/build commands, the current task and its next step.

## Memories & Lessons Learned

_Append via `/start learn <type>: <lesson>`. NEVER delete this section on update._

### Critical Warnings
<!-- things that broke or caused issues -->
- [2026-07-08] Ne jamais sérialiser le markdown utilisateur via ProseMirror/remark-stringify : réécriture systématique des fichiers (mesuré au spike S0 : 0/8 fichiers préservés — voir ADR-0002)

### Gotchas
<!-- non-obvious behaviors discovered -->
- [2026-07-08] CodeMirror 6 ne rend que le viewport : tout test DOM/Playwright sur l'éditeur doit d'abord scroller la cible en vue ; un conteneur scrollable externe garde son scrollTop entre `setState`
- [2026-07-08] tauri-build exige `icons/icon.ico` même avec `bundle.active: false` — et l'erreur ne tombe qu'en toute fin de compilation (~350/370 crates)
- [2026-07-08] Svelte 5 élague les sélecteurs CSS scopés « inutilisés » : une classe posée en JS (`classList`) est invisible pour le compilateur → toujours déclarer via `class:` dans le template (le warning `css_unused_selector` est un vrai signal)
- [2026-07-09] CodeMirror 6 : `state.doc.toString()` renvoie **toujours** du `\n` ; le facet `lineSeparator` n'agit que sur le découpage, pas la sérialisation. Pour préserver le round-trip (fichiers CRLF), détecter la fin de ligne du fichier et la restituer soi-même (`detectLineEnding` + `serializeDoc`, `src/lib/editor/editor.ts`)
- [2026-07-09] Icône barre des tâches Windows = **double cache** : l'icône est gravée dans l'exe **au build** (ajouter `println!("cargo:rerun-if-changed=icons/icon.ico")` dans `build.rs`, sinon `tauri dev` ne la ré-embarque pas) ET Windows cache la miniature (`ie4uinit.exe -show`, ou reset Explorer). Toujours rebuild propre + vider le cache avant de conclure
- [2026-07-09] Tauri v2 : **ne jamais rappeler `window.close()` depuis un handler `onCloseRequested`** — la ré-entrance ne se propage pas (surtout en profil **release** : la fenêtre ne se ferme plus). Après confirmation, utiliser `window.destroy()` (+ permission `core:window:allow-destroy`)
- [2026-07-09] Certains comportements natifs (fermeture de fenêtre, `windows_subsystem`) **diffèrent entre dev (debug) et release** → smoke-tester en **build release** avant de marquer « done » une story fenêtre/OS (le bug de fermeture ci-dessus n'apparaissait qu'en release)
- [2026-07-09] **DOMPurify est incompatible avec happy-dom** (sanitization dégradée : déstructure le HTML au lieu de le nettoyer) → tester avec **jsdom** (`// @vitest-environment jsdom`)
- [2026-07-09] CodeMirror 6 : **ne pas muter le DOM d'un `WidgetType` via `replaceWith`** — CM6 réconcilie et clobber la modif (le widget disparaît). Retourner un **conteneur stable** (span) et muter son contenu/classe (ex. `<img>` → placeholder à l'erreur de chargement dans `live-preview.ts`)

### Workarounds
<!-- working solutions to known issues -->
- [2026-07-08] `fs:default` (plugin-fs Tauri) ne couvre pas la lecture/écriture hors dossiers app → déclarer explicitement `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-rename` avec un scope dans `capabilities/default.json`

### Performance Notes
<!-- perf learnings -->
