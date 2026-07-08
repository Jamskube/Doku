# 0004. I/O fichiers via plugins officiels Tauri — zéro commande Rust custom

**Date** : 2026-07-08 · **Status** : accepted · **Deciders** : nicos (+ Claude) · **Tags** : tauri, io, maintenance

## Context

Dans une app Tauri, l'accès disque peut passer par les plugins officiels appelés depuis TypeScript (`@tauri-apps/plugin-fs`, `plugin-dialog`) ou par des commandes Rust custom (`invoke('...')`). Le repo de référence KUDE a choisi le Rust custom (`fs_read`/`fs_write`) et en paie le prix : `fs_read` renvoie des lignes numérotées que chaque appelant doit stripper, le plugin-fs est en dépendance mais inutilisé, et toute évolution I/O exige de toucher deux langages.

## Decision drivers

- Leçon KUDE documentée : la double surface d'API a produit des bizarreries durables (lignes numérotées)
- Mono-développeur : un seul langage de logique (TS) = moins de friction et de bugs
- Sécurité : les capabilities Tauri des plugins officiels offrent un scoping déclaratif éprouvé
- Besoins I/O de Doku couverts par les plugins : lecture/écriture texte et binaire, rename (→ écriture atomique tmp+rename), watch, dialogues

## Considered options

### Option 1 : commandes Rust custom
· Pros : contrôle total, opérations exotiques possibles, potentiellement plus rapide sur de très gros volumes.
· Cons : boilerplate invoke/serde, logique dupliquée en deux langages, précédent KUDE défavorable, surface d'audit doublée.

### Option 2 : plugins officiels uniquement, logique en TS
· Pros : API typée et maintenue par l'équipe Tauri, capabilities scoped déclaratives, tout le métier au même endroit (FileService TS), watch inclus.
· Cons : limité aux primitives exposées ; opérations composées (écriture atomique) à assembler côté TS ; IPC sur les gros fichiers à surveiller.

## Decision

**Choisi : Option 2.** Tout l'I/O passe par `plugin-fs`/`plugin-dialog` depuis le `FileService` TypeScript. L'écriture atomique est composée en TS (écrire `*.tmp` puis `rename`). Le Rust de `src-tauri` reste une coquille : configuration, plugins (`single-instance`, `fs`, `dialog`, `log`), fenêtrage. **Toute commande Rust custom future exige un ADR qui supersède celui-ci** (avec la preuve qu'une primitive manque ou qu'un besoin de perf est mesuré).

## Consequences

**Positive** : un seul endroit à lire pour comprendre l'I/O ; pas de resucée du bug « lignes numérotées » ; capabilities minimales auditables dans `capabilities/*.json`.
**Negative** : dépendance aux choix d'API du plugin-fs ; opérations composées légèrement plus verbeuses en TS.
**Risks** : latence IPC sur fichiers ~5 Mo (NFR) → mesurée au spike S0 ; si insuffisante, l'escape hatch est défini (ADR de supersession ciblé sur l'opération en cause, pas un retour général au Rust custom).

## Related

- [ADR-0001](./0001-stack-tauri-svelte.md) — la stack qui rend ce choix possible
- `docs/planning/architecture.md` — FileService, hôte Tauri
- Rapport d'exploration KUDE (session 2026-07-08) — pièges documentés
