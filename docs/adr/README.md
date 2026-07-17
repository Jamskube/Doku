# ADRs — Doku

Registre des décisions d'architecture. Une décision par fichier ; on ne supprime jamais, on supersède (`/create-adr supersede <N> <titre>`).

| # | Titre | Status | Date | Tags |
|---|---|---|---|---|
| [0001](./0001-stack-tauri-svelte.md) | Stack applicative : Tauri 2 + Svelte 5 + TypeScript | accepted | 2026-07-08 | stack, desktop, arm64 |
| [0002](./0002-moteur-wysiwyg-cm6-live-preview.md) | Moteur d'édition Markdown : CM6 « live preview » | accepted | 2026-07-08 | éditeur, wysiwyg, fr-3 |
| [0003](./0003-stockage-snapshots-appdata.md) | Snapshots centralisés dans %APPDATA%\Doku | accepted | 2026-07-08 | données, snapshots, fiabilité |
| [0004](./0004-io-fichiers-plugins-officiels.md) | I/O via plugins officiels Tauri, zéro commande Rust custom | accepted | 2026-07-08 | tauri, io, maintenance |
| [0005](./0005-scope-fs-large-assume.md) | Scope fs/asset `**` : tradeoff assumé | accepted | 2026-07-10 | sécurité, fs, tradeoff |
| [0006](./0006-copilote-ia-ollama-sidecar-cpu.md) | Copilote IA : Ollama sidecar CPU (GGUF libre), NPU écarté | accepted | 2026-07-13 | ia, llm, npu, arm64, copilote |
| [0007](./0007-recherche-index-memoire.md) | Recherche plein-texte : index en mémoire (scan-once, watcher-invalidé) | accepted | 2026-07-13 | recherche, perf, arm64 |
| [0008](./0008-pipeline-export-pdf-window-print.md) | Export PDF : `window.print()` + `@media print` (iframe isolé) | accepted | 2026-07-13 | export, pdf, webview2, arm64, fr-2 |
| [0009](./0009-renderer-markdown-marked.md) | Renderer Markdown → HTML pour l'export : `marked` | accepted | 2026-07-13 | export, markdown, rendu, fr-2 |
| [0010](./0010-export-docx-lib-lazy.md) | Export DOCX : lib `docx` (lazy-loadée, marked.lexer → OOXML) | accepted | 2026-07-13 | export, docx, ooxml, fr-5 |
| [0011](./0011-lecture-pdf-pdfjs.md) | Lecture PDF : PDF.js (canvas, worker Vite, offline) | accepted | 2026-07-13 | pdf, viewer, csp, arm64, fr-3 |
| [0012](./0012-cycle-de-vie-sidecar-ollama.md) | Cycle de vie du sidecar Ollama : instance dédiée, port éphémère, modèles isolés, spawn paresseux | accepted | 2026-07-14 | ia, sidecar, ollama, process-lifecycle, arm64, csp |
| [0013](./0013-fournisseur-openai-optionnel.md) | Fournisseur OpenAI par clé API — approche rejetée au profit d’une connexion de compte | rejected | 2026-07-17 | ia, openai, cloud, oauth, confidentialité |
| [0014](./0014-connexion-compte-openai-codex.md) | Connexion optionnelle du compte OpenAI via Codex | accepted | 2026-07-17 | ia, openai, codex, oauth, cloud, secret |
