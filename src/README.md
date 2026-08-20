# src

## Purpose
Frontend Svelte 5 de Doku : shell applicatif, éditeur Markdown *live preview*, lecteur/éditeur PDF et DOCX, copilote « Doku-San », exports.

## Racine
| File | Purpose |
|---|---|
| `main.ts` | Point d'entrée : fonts bundlées, montage de `App`, affichage sans flash puis activation du backdrop natif |
| `app.css` | Tokens du design AIR, repli CSS du chrome, styles de base et icônes Material Symbols |
| `App.svelte` | Assemblage du shell (sidebar + titlebar + bureau + copilote) et raccourcis clavier globaux |

## components/
| File | Purpose |
|---|---|
| `TitleBar.svelte` | Barre 40 px : onglets, onglets de volets en mode scindé, menu compact, options et contrôles fenêtre |
| `Sidebar.svelte` | Ruban d'icônes 46 px + panneau (Fichiers / Plan / Historique) ; repliée = 0 px |
| `WorkspaceView.svelte` | Orchestration du bureau simple/scindé, séparateur redimensionnable, orientation responsive |
| `DocumentPane.svelte` | Enveloppe de volet : document actif, état vide, sélecteur local quand les volets sont empilés |
| `PaneTabSelector.svelte` | Sélecteur compact partagé entre le header global et le volet secondaire |
| `SplitDivider.svelte` | Séparateur souris et clavier, ratio borné à 25–75 % |
| `DocumentView.svelte` | Hôte CM6 par volet, cache d'états par onglet, menu contextuel de sélection et consigne libre de réécriture |
| `DocxView.svelte` | Édition DOCX via SuperDoc (ADR-0023) : ouverture, édition, enregistrement, export |
| `DocxFormatBubble.svelte` | Bulle de formatage contextuelle du DOCX (styles, gras/italique, listes) |
| `PdfView.svelte` | Lecteur PDF adaptatif : TextLayer sélectionnable, carnet d'annotations, dessin vectoriel non destructif |
| `PdfPagesDialog.svelte` | Modale « Organiser les pages » : vignettes paresseuses, glisser-déposer, insertion d'un autre PDF |
| `PdfTextEditDialog.svelte` | Modale d'édition du texte d'une page PDF (la correction par consigne y est **masquée**, voir ADR-0024) |
| `CopilotPanel.svelte` | Chat Doku-San : fournisseurs, composeur Question/Contexte, mémoire cloud, citations cliquables |
| `CopilotEvidence.svelte` | Trace compacte d’activité et bloc unifié des sources, réutilisés dans les réponses et le panneau temporaire |
| `SettingsDialog.svelte` | Réglages : modèles et fournisseurs, apparence, à propos (version lue dans `package.json`) |
| `ConfirmDialog.svelte` | Confirmation modale générique (actions destructrices) |
| `WikilinkPrompt.svelte` | Résolution interactive d'un `[[wikilink]]` ambigu ou absent |

## lib/ — socle
| File | Purpose |
|---|---|
| `stores.svelte.ts` | État global (runes) : onglets, workspace, thème, sidebar, plan du document, dirty tracking, sauvegarde |
| `workspace.ts` | Machine d'état pure des deux volets et invariants anti-duplication |
| `session.ts` | Session v2, migration depuis v1, restauration des chemins par volet |
| `editor-registry.svelte.ts` | Registre runtime des `EditorView` et des sélections propres à chaque volet |
| `tabs.ts` | Nom du dossier parent d'un chemin (séparateurs `\` ou `/`) |
| `paths.ts` | Découpe de chemins sans aucune dépendance — correcte sur les chemins mixtes |
| `doc-kind.ts` | Ce qu'est un document pour Doku, et lesquels sont binaires — module pur partagé |
| `tauri.ts` | Garde Tauri : Mica Windows 11, fenêtre, dialogues, écriture atomique — no-op en navigateur |
| `explorer.ts` | Helpers purs de l'explorateur de dossier, sans dépendance Tauri |
| `encoding.ts` | Détection des fichiers non affichables (binaire, octet NUL) |
| `reload.ts` | Décision de rechargement sur modification externe du fichier |
| `snapshot.ts` | Versions locales à chaque sauvegarde (ADR-0003) |
| `save-as.ts` | Transaction pure « Enregistrer sous » : extension, collision, rollback |
| `search.ts` | Recherche plein-texte, logique pure |
| `wikilink.ts` | Résolution des `[[note]]`, logique pure |
| `citations.ts` | Citations ancrées, logique pure et testable |
| `notes.ts` | Sauvegarde d'une réponse de Doku-San en note `.md` (nommage + contenu) |
| `auto-dismiss.ts` | Minuterie d'effacement des notifications : suspension au survol, reprise sur le temps restant |
| `demo.ts` | Contenu de démonstration (mode navigateur / premier lancement) |
| `sanitize.ts` | Assainit tout HTML issu de contenu non fiable |
| `html.ts` | Prépare un document HTML pour l'aperçu sandboxé |
| `images.ts` | Résolution des sources d'images Markdown, logique pure |
| `paste-image.ts` | Helpers purs du collage d'image |
| `format.ts` | Formatage Markdown de la sélection — couche pure, calculs sur chaînes |
| `table.ts` | Parse un tableau GFM pour le rendu en widget |
| `json-reply.ts` | Extraction tolérante d'un objet JSON dans une réponse de modèle |

## lib/ — copilote et IA
| File | Purpose |
|---|---|
| `copilot.svelte.ts` | État runtime du copilote : runs, streaming, annulation, résumés, réécritures |
| `copilot-service.ts` | CopilotService + ContextBuilder : assemblage du contexte et des prompts, purs et testables |
| `copilot-context.ts` | Éléments de contexte ajoutés à la main (sélection, presse-papiers, fichier) et leurs plafonds |
| `copilot-memory.ts` | Mémoire durable du copilote cloud : schéma Markdown, validation, déduplication, prompts purs |
| `copilot-memory.svelte.ts` | Chargement, rappel, extraction, mutations atomiques et annulation de la mémoire cloud |
| `copilot-width.ts` | Bornes de la largeur du panneau copilote (séparateur, préférence persistée) |
| `copilot-activity.ts` | Étapes factuelles d’une réponse (contexte, mémoire, Web, rédaction), sans exposer le raisonnement interne |
| `web-search.ts` | Recherche Web pilotée par Doku pour Ollama/MiniMax et injection sûre des extraits |
| `web-citations.ts` | Normalisation HTTPS et rendu des citations Web OpenAI ou pilotées par Doku |
| `ollama.ts` | Client du sidecar Ollama local (ADR-0006/0012) |
| `openai.ts` | Client IPC OpenAI : connexion du compte Codex, statut, streaming, annulation — jamais de jeton exposé |
| `compat.ts` | Fournisseurs cloud compatibles OpenAI (ADR-0018, MiniMax) — miroir d'`openai.ts` pour le chemin « clé API » |
| `think-scrub.ts` | Scrubber avec état des blocs `<think>…</think>` streamés |
| `rag.ts` | Cœur pur de l'index d'embeddings (ADR-0015) : chunking, hachage, diff |
| `rag-index.svelte.ts` | Service de l'index d'embeddings du dossier : orchestration seule |

## lib/ — PDF
| File | Purpose |
|---|---|
| `pdf.ts` | Pipeline de rendu PDF.js (ADR-0011) — pur JS/WASM, 100 % hors-ligne |
| `pdf-layout.ts` | Ajustement d'une page au lecteur : niveaux de zoom, échelle de rendu, plafond du backing store |
| `pdf-text.ts` | Assemblage du texte d'un PDF et détection « scanné » — couche pure |
| `pdf-annotations.ts` | Identité, migration et manifeste local des annotations non destructives ; carnet unifié |
| `pdf-drawing.ts` | Primitives pures des tracés (crayon, surligneur, rectangle, ellipse) : épaisseur, lissage, déplacement borné |
| `pdf-highlight-text.ts` | Citation d'un trait de surligneur : quelles boîtes de texte il balaie, et sur quelle plage |
| `pdf-write.ts` | Gravure des annotations dans le PDF (ADR-0022) ; le manifeste reste la source de vérité |
| `pdf-pages.ts` | Recomposition des pages, pur : pivoter, supprimer, déplacer, insérer, résumer |
| `pdf-content-text.ts` | Lecture et réécriture du texte dans le flux de contenu d'une page |
| `pdf-correction.ts` | Correction d'une page par consigne libre — cœur pur. **⛔ Interface masquée** (`PDF_CORRECTION_ENABLED = false`, ADR-0024) |

## lib/ — DOCX
| File | Purpose |
|---|---|
| `docx-structure.ts` | Lecture de la structure d'un DOCX (ADR-0023) : `word/document.xml`, corps du document |
| `docx-text.ts` | Texte d'un DOCX pour le copilote ; document sans texte **signalé**, jamais silencieux |

## lib/editor/
| File | Purpose |
|---|---|
| `editor.ts` | Extensions CM6 : thème typographique, coloration, Compartment preview/source |
| `live-preview.ts` | Couche live preview (ADR-0002) : le buffer reste du Markdown, seules les décorations changent |
| `reveal.ts` | Révélation de la syntaxe Markdown à la demande (ADR-0017) |
| `format-commands.ts` | Commandes de formatage de la sélection (Ctrl+B / Ctrl+I / Ctrl+K, titres, listes, blocs) |
| `rephrase-preview.ts` | Aperçu de reformulation en place : la plage sélectionnée est recouverte par le diff mot à mot |
| `search-flash.ts` | Saut vers une occurrence de recherche et surlignage transitoire |

## lib/export/
| File | Purpose |
|---|---|
| `render-md.ts` | Renderer Markdown → HTML pour l'export |
| `standalone.ts` | Export HTML autonome : un seul `.html` portable, ouvrable hors-ligne |
| `img-data.ts` | Encodage des images locales en `data:` URI pour l'export autonome |
| `print.ts` | Pipeline d'export PDF via `window.print()` (ADR-0008) |
| `docx.ts` | Export DOCX (ADR-0010) : walker `marked.lexer` → modèle `docx` |
| `docx-to-pdf.ts` | Export DOCX → PDF (ADR-0023), la marche retour écrite par Doku |
| `pdf-annotated.ts` | Export « PDF annoté » (ADR-0022) : une copie contenant réellement les annotations |
| `pdf-edit-text.ts` | Édition du texte d'un PDF en place — rendue possible par le passage en AGPL |

## Dependencies
- Internal : `docs/design/w1/` (maquette de référence et source de vérité des tokens), `src-tauri/` (IPC)
- External : CodeMirror 6, pdf.js, MuPDF, SuperDoc, `@cantoo/pdf-lib`, `docx`, `marked`, DOMPurify, fonts @fontsource (Inter Variable, Geist Mono, Source Serif 4), material-symbols, `@tauri-apps/*`

> Les fichiers `*.test.ts` ne sont pas listés : chaque module testé a son test à côté de lui.
