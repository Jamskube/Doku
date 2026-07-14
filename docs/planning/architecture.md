# Architecture : Doku

_Date : 2026-07-08 · Status : Draft_

## Context

Doku est une app desktop Windows ARM64 légère pour ouvrir, lire et éditer des documents (Markdown en WYSIWYG, HTML ; PDF en v2), spécifiée dans `PRD.md` et `ux-spec.md`. L'architecture privilégie : démarrage < 1,5 s, zéro perte de données (round-trip Markdown fidèle), 100 % offline, et un cœur « noyau + une vue par format » pour que l'ajout du PDF (v2) ne touche pas l'existant. Le repo `G:\KUDE` (Tauri 2 + Svelte 5) sert de référence éprouvée sur la machine cible — on en reprend les briques saines (design system AIR, sanitize, patterns onglets/sidebar) et on évite ses pièges documentés.

## Constraints

- **Scale** : mono-utilisateur, mono-machine ; dossiers de notes ~10²-10³ fichiers ; documents jusqu'à ~5 Mo réactifs (NFR).
- **Latency** : démarrage à froid → document < 1,5 s ; nouvel onglet < 500 ms (< 1 Mo) ; frappe sans gel > 100 ms.
- **Plateforme** : binaire **ARM64 Windows natif** (`aarch64-pc-windows-msvc`), WebView2 ARM64 ; aucune dépendance x64-only.
- **Compliance** : aucune (fichiers locaux, zéro réseau au runtime — polices et assets bundlés).
- **Budget** : projet perso — biais fort vers les libs éprouvées plutôt que le sur-mesure.

## High-level shape

```
┌─ Fenêtre Tauri 2 (WebView2, instance unique) ──────────────────────────────┐
│  Frontend Svelte 5 + TypeScript (Vite)                                     │
│                                                                            │
│  ┌ Shell ────────────────────────────────────────────────────────────────┐ │
│  │ Sidebar (0↔240px) · Titlebar 32px · Stage (onglets + panneau 268px)  │ │
│  └──────────────┬────────────────────────────────────────────────────────┘ │
│                 │ affiche                                                   │
│  ┌ DocumentView (interface par format) ──────────────────────────────────┐ │
│  │ MarkdownEditor (CM6 + live preview ⇄ source via Compartment)          │ │
│  │ HtmlView (iframe sandbox + source CM6)      TxtView (CM6)             │ │
│  │ [v2 : PdfView]                                                        │ │
│  └──────────────┬────────────────────────────────────────────────────────┘ │
│                 │ consomme                                                  │
│  ┌ Stores (runes Svelte 5) ──────────┐  ┌ Services TS ────────────────────┐ │
│  │ tabs · session · settings · theme │  │ FileService (open/save/watch)   │ │
│  └───────────────────────────────────┘  │ SnapshotService · Wikilink      │ │
│                                         │ Resolver · SanitizeService      │ │
│                                         └───────┬─────────────────────────┘ │
├─────────────────────────────────────────────────┼───────────────────────────┤
│  Hôte Rust minimal (pas de logique métier)      ▼                           │
│  plugin-fs · plugin-dialog · single-instance · window (pin/focus)           │
│  associations de fichiers (bundler NSIS) · plugin-log                       │
└──────────────────────────────────────────────────────────────────────────────┘
             │ lit/écrit                                    │ snapshots/settings
             ▼                                              ▼
   Fichiers de l'utilisateur (.md/.html/.txt)      %APPDATA%\Doku\ (proposé, ADR-0003)
```

## Components

| Component | Responsibility | Technology |
|---|---|---|
| Shell | Grille sidebar/titlebar/stage, onglets, panneaux (Fichiers/Plan/Historique), mode focus, accueil | Svelte 5, tokens AIR repris de KUDE `App.css` (épurés des alias legacy) |
| DocumentView | Interface commune par format : `load/render/save/dirty/serialize` — le point d'extension v2 (PDF) | TS interface + un composant Svelte par format |
| MarkdownEditor | Édition à la Typora (FR-3) : CM6 + couche « live preview » maison (décorations sélection-aware, checkbox-widgets, wikilinks) — base : `spike/src/live-preview.ts` | CodeMirror 6 — **ADR-0002** (Milkdown rejeté sur mesures : round-trip destructif, perf) |
| SourceEditor | Mode source Ctrl+/ (FR-5) = **le même** éditeur CM6, décorations désactivées via `Compartment` (pas de destroy/remount) ; sert aussi aux .html/.txt | CodeMirror 6 (config héritée de KUDE `CodeViewer`) |
| HtmlView | Rendu .html sandboxé : `<iframe sandbox>` sans script ni réseau, CSP stricte | iframe + CSP ; bascule source via SourceEditor |
| Stores | tabs (ouverts, actif, dirty), session (restauration), settings (thème, largeur, sidebar), persistés en JSON debouncé | Runes Svelte 5 + fichier `settings.json`/`session.json` |
| FileService | Ouverture (détection encodage), **écriture atomique** (tmp + rename), watcher de fichiers ouverts, dialogues | `@tauri-apps/plugin-fs` + `plugin-dialog` **directement** (leçon KUDE : pas de commandes Rust custom, pas de `fs_read` numéroté) |
| SnapshotService | Copie avant écrasement à chaque save, purge (20 versions / 30 j), listing/restauration | TS + plugin-fs, stockage ADR-0003 |
| WikilinkResolver | Résolution `[[note]]` dans dossier + sous-dossiers, désambiguïsation, création | Scan à l'ouverture du dossier + cache invalidé par watcher (pas d'index persistant en v1) |
| SanitizeService | Pipeline marked + DOMPurify allowlist pour tout HTML issu de contenu | Copié de KUDE `src/lib/sanitize.ts` |
| Hôte Tauri | Instance unique (2e lancement → focus + onglet), args fichier, always-on-top, fenêtre custom (drag, min/max/close), log fichier | Rust minimal : plugins officiels (`single-instance`, `fs`, `dialog`, `log`) — zéro logique métier |

## Data model

Pas de base de données. Quatre familles de données, toutes fichiers :

- **Documents utilisateur** : source de vérité unique = le fichier sur disque. Le buffer en mémoire (par onglet) porte `path, content, savedContent, dirty, mode (wysiwyg|source), scroll/cursor`.
- **Session** (`session.json`) : onglets ouverts, actif, état sidebar/panneau, dernière fenêtre. Écrit debouncé (500 ms) et au quit.
- **Settings** (`settings.json`) : thème (défaut crème), largeur de colonne, récents (8), associations refusées.
- **Snapshots** : `snapshots/<sha1(chemin-absolu)>/<ISO-timestamp>.md` + `meta.json` (chemin original, tailles). Purge au démarrage et à chaque save.

Emplacement proposé : `%APPDATA%\Doku\` centralisé (ADR-0003 — alternative `.doku/` à côté des fichiers, rejetée en draft : pollue les dossiers de notes et casse les syncs).

## External dependencies

Aucun service externe au runtime (NFR offline). Dépendances de build/libs notables :

- **Tauri 2 + plugins officiels** — coquille native ; fallback : aucun (choix structurel, ADR-0001).
- **CodeMirror 6** — moteur unique : live preview (ADR-0002) + mode source + txt/html (déjà maîtrisé via KUDE) ; fallback toujours assumé par le PRD si la couche live-preview déçoit : bascule preview↔source, FR-5 promu P0.
- **marked + DOMPurify** — rendu/sanitization (repris de KUDE).
- **WebView2** — présent sur Windows 11 ARM64 (composant OS, evergreen).

## Cross-cutting

- **Auth** : aucune (app locale mono-utilisateur).
- **Sécurité** : tout contenu de document est non-fiable → sanitization allowlist (MD) ; iframe `sandbox` sans `allow-scripts` + CSP `default-src 'none'` (HTML) ; liens externes ouverts dans le navigateur système uniquement ; capabilities Tauri minimales (fs scoped, pas de shell).
- **Observability** : `tauri-plugin-log` → fichier rotatif dans AppData (erreurs I/O, watcher, panics) ; marqueurs de perf (démarrage, ouverture d'onglet) en dev.
- **Deployment** : `tauri build --target aarch64-pc-windows-msvc` → installateur **NSIS ARM64** avec `fileAssociations` (.md/.markdown ; .txt à trancher — PRD Q3) ; pas d'updater en v1 (installation manuelle, perso).
- **Failure modes** :
  - Échec d'écriture → buffer intact + bannière rouge [Réessayer / Enregistrer sous] ; jamais d'écrasement partiel (écriture atomique).
  - Fichier modifié/supprimé à l'extérieur → watcher + vérif au focus → bannières UX §3.3.
  - Document énorme → seuil (~2 Mo) : ouverture en mode source (CM6 gère nativement les gros buffers), WYSIWYG proposé sur confirmation.
  - Encodage non-UTF-8 → détection BOM/heuristique, lecture seule ou refus doux — jamais de sauvegarde corrompante.
  - Crash → session.json + snapshots = récupération au relancement.

## Decisions (link to ADRs)

- [ADR-0001](../adr/0001-stack-tauri-svelte.md) Stack : Tauri 2 + Svelte 5 + TypeScript — **accepted** (2026-07-08)
- [ADR-0002](../adr/0002-moteur-wysiwyg-cm6-live-preview.md) Moteur d'édition : CM6 « live preview » — **accepted** (2026-07-08, sur mesures du spike S0)
- [ADR-0003](../adr/0003-stockage-snapshots-appdata.md) Snapshots centralisés dans `%APPDATA%\Doku` — **accepted** (2026-07-08)
- [ADR-0004](../adr/0004-io-fichiers-plugins-officiels.md) I/O via plugins officiels, zéro commande Rust custom — **accepted** (2026-07-08)

### Spike S0 — moteur WYSIWYG ✅ (exécuté le 2026-07-08)
Protocole, prototypes et mesures dans `spike/` (conservé comme référence et base de tests). Verdict : CM6 live preview — ADR-0002. Chiffres clés : round-trip 8/8 vs 0/8 ; 500 Ko en 27 ms vs 1 727 ms ; frappe 17 ms vs 69 ms par frame.

## Open questions

- Association `.txt` par défaut : conflit Notepad (PRD Q3 — décision produit à l'installation, « proposer sans forcer »).
- Tableaux et images en live preview : widget rendu + édition source au clic (compromis Obsidian) — phasage exact v1 vs v1.5 à trancher à `/epics`.
- Wordmark/iconographie : icône app à dériver de `src/assets/doku-mark-rounded.svg` (fill blanc du pli à corriger → transparent/`currentColor`).

## Out of scope

- PDF (lecture v2, annotations v2+) — l'interface DocumentView le prépare, rien d'autre n'est construit.
- Copilote IA locale (v2) — architecture dédiée : [architecture-v2-copilot.md](./architecture-v2-copilot.md) (Ollama sidecar, ADR-0006). Aucune provision d'archi en v1 au-delà de l'isolation des services.
- Recherche plein texte multi-fichiers, export, coller intelligent (v1.5).
- Sync/cloud/multi-machine, mise à jour automatique, télémétrie : jamais en v1.
