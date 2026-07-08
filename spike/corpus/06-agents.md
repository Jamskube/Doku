# AGENTS.md

Context for AI coding assistants. Read at the start of every session.

## Project goal
Doku — petite application pour **ouvrir, lire et éditer des fichiers Markdown**, avec extension prévue plus tard vers d'autres formats (**PDF**, etc.).

## Stack
- Language: TypeScript (frontend) + Rust minimal (hôte Tauri, zéro logique métier — ADR-0004)
- Framework: Tauri 2 + Svelte 5 + Vite — décidé, ADR-0001 accepted (`docs/adr/`)
- Contrainte machine : **Windows ARM64** — Surface Pro 11, Snapdragon X Elite, NPU (IA locale envisagée en v2) → la stack doit tourner nativement en ARM64
- Référence : un repo local existant de l'utilisateur contient un mode lecture/édition Markdown (design + implémentation de référence — chemin à demander)
- Database / ORM: aucune prévue pour l'instant (fichiers locaux)
- Package manager: à définir

## Setup commands
- Install : _à définir une fois la stack choisie_
- Dev : _à définir_
- Build : _à définir_
- Test : _à définir_
- Lint : _à définir_

## Conventions
- Commentaires uniquement sur le code non évident (des identifiants bien nommés font le reste)
- Un README.md par dossier, maintenu en phase avec les fichiers
- Langue : documentation projet en français ; code et identifiants en anglais

## Architecture
| Folder | Purpose |
|---|---|
| `src/` | Code source (sous-dossiers créés plus tard selon la stack choisie) |
| `docs/` | Documentation (planning, journal, archives) |

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

### Gotchas
<!-- non-obvious behaviors discovered -->

### Workarounds
<!-- working solutions to known issues -->

### Performance Notes
<!-- perf learnings -->
