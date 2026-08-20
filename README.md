# Doku

A desktop application to **open, read and write documents** — Markdown, DOCX and PDF — with an AI copilot that runs **locally by default**. Windows (ARM64 · x64) and Linux (x86_64).

## Project status
📦 **v3.1.0** — feature-complete. Epics 1-16, 18 and 19 shipped (ledger: 69 features, 68 PASS), plus DOCX editing, PDF annotation and free-form rewriting. Current phase: daily real-world use, which is where 3.1 comes from: the copilot panel is now resizable and its reading size adjustable.

## What it does

**Markdown** — a CodeMirror 6 *live preview* editor ([ADR-0002](docs/adr/0002-moteur-wysiwyg-cm6-live-preview.md)): syntax markers fade as you leave a line, but the file on disk stays exactly what you typed. No round-trip through an AST, so your formatting is never rewritten behind your back.

**DOCX** — real editing through SuperDoc, with a contextual format bubble. Open, edit, save, export to PDF.

**PDF** — a selectable text layer, a non-destructive annotation notebook (comments, pins), freehand drawing (pencil, highlighter, rectangle, ellipse), page reorganisation (rotate, delete, move, insert from another PDF) and in-place text editing. Your source file is never overwritten — the code enforces it, not just the UI.

**Copilot "Doku-San"** — a right-hand panel that reads the open document or a whole folder (RAG, [ADR-0015](docs/adr/0015-stack-rag-embeddings-locaux.md)) and answers with citations you can click straight back into the text. Select any passage and rewrite it with a preset verb or your own instruction, previewed as a word-level diff before you accept.

Also: split workspace, full-text search, wikilinks, snapshots/history, image paste, and export to HTML, DOCX, PDF or print.

## AI providers

| Provider | Auth | Notes |
|---|---|---|
| **Ollama** (default) | none | Runs locally. `qwen2.5:1.5b-instruct-q4_0` for chat, `granite-embedding:278m` for RAG. Nothing leaves the machine. |
| **OpenAI** | account connection | Device-code flow — **never an API key** ([ADR-0014](docs/adr/0014-connexion-compte-openai-codex.md)). |
| **MiniMax** | API key | Validated *before* being stored ([ADR-0018](docs/adr/0018-fournisseur-cloud-compatible-openai.md)). The only auth route they offer. |

Secrets live in the OS vault — Windows Credential Manager, or the session Secret Service on Linux ([ADR-0026](docs/adr/0026-coffre-de-secrets-multiplateforme.md)). They cross the IPC boundary once and are never handed back to the webview. Cloud providers are strictly opt-in, and the UI says so while they are active.

## Stack
Tauri 2 · Svelte 5 (runes) · Vite · TypeScript · CodeMirror 6 · pdf.js + MuPDF · SuperDoc · a deliberately minimal Rust host with zero business logic ([ADR-0004](docs/adr/0004-io-fichiers-plugins-officiels.md)).

Every significant decision is written down in [`docs/adr/`](docs/adr/) — 26 of them, including the ones that were rejected and why.

## Getting started

```bash
npm install
npm run dev          # browser UI, Tauri APIs stubbed — http://localhost:1420
npm run tauri dev    # native app (first Rust build is slow)
npm run check        # svelte-check
npm test             # vitest
```

## Building

**Windows** — NSIS installers, each bundling a native CPU-only Ollama sidecar:

```bash
npm run build:installer:arm64
npm run build:installer:x64
```

**Linux** — **CI only**: Tauri links against WebKitGTK, which does not cross-compile from Windows. Run the *Build Linux x64* workflow (`workflow_dispatch`, or push a `v*` tag) and download the artifact. It contains two formats.

`.deb` — **the one to use on Arch and anything that is not Ubuntu-shaped.** It declares its system libraries instead of carrying them:

```bash
cd packaging/arch && makepkg -si    # Arch: builds doku-bin from the .deb
```

`.AppImage` — one file, nothing to install, convenient where it works (Ubuntu and derivatives):

```bash
chmod +x Doku_3.1.0_amd64.AppImage && ./Doku_3.1.0_amd64.AppImage
```

> The AppImage bundles the runner's GTK **and Mesa** stack, which cannot enumerate another distribution's drivers — on Arch, GDK aborts with `EGL_BAD_PARAMETER` before a window ever opens, and no `WEBKIT_*` variable helps because the failure sits below WebKit. See [`packaging/`](packaging/).

Two deliberate differences on Linux ([ADR-0025](docs/adr/0025-distribution-linux-appimage.md)): Doku launches the **system** Ollama (`pacman -S ollama`, `apt install ollama`) instead of shipping a 1.4 GB sidecar to duplicate what your package manager already does better — and secrets go to the session Secret Service (GNOME Keyring, KWallet, KeePassXC) rather than the Windows vault.

A *Build Windows x64* workflow produces the x64 installer with its SHA-256 the same way.

## Layout

| Folder | Role |
|---|---|
| `src/` | Svelte 5 frontend — components, lib, CM6 editor, exporters |
| `src-tauri/` | Minimal Rust host, Tauri config, NSIS template, Ollama sidecar |
| `docs/` | Planning, ADRs, design, sprints, journal, plans |
| `scripts/` | Hand-run build tooling (icon subsetting) — outputs are committed |
| `spike/` | Preserved experiments (WYSIWYG S0, RAG 15.1, NPU 17.1) |
| `public/` | Static assets served as-is by Vite |
| `packaging/` | Distro packaging recipes not produced by CI (Arch `PKGBUILD`) |
| `.github/workflows/` | Windows x64 and Linux x64 build pipelines |

## Documentation

The project documentation is **in French** — it is written for the people building it. This README is in English because the repository is public.

- [`AGENTS.md`](AGENTS.md) — context for AI coding assistants: stack, conventions, and 80 hard-won lessons. Read it first.
- [`docs/journal/_next-session.md`](docs/journal/_next-session.md) — where the last session stopped and what comes next.
- [`docs/adr/`](docs/adr/) — the decisions, including [ADR-0024](docs/adr/0024-correction-pdf-assistee-par-le-modele.md), a feature that was built, tested, then **hidden** because it turned out not to be useful. That one is worth reading.

## Licence
**AGPL-3.0-or-later** — see [`LICENSE`](LICENSE). Copyright © 2026 Kubo.

This choice unlocks the AGPL document engines Doku depends on (MuPDF.js, SuperDoc); the reasoning is in [ADR-0023](docs/adr/0023-licence-agpl.md). Any redistribution, modified or not, must stay under AGPL and ship the corresponding source.
