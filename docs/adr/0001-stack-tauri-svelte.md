# 0001. Stack applicative : Tauri 2 + Svelte 5 + TypeScript

**Date** : 2026-07-08 · **Status** : accepted · **Deciders** : nicos (+ Claude) · **Tags** : stack, desktop, arm64

## Context

Doku est une app desktop Windows légère pour lire/éditer des documents (Markdown WYSIWYG, HTML, PDF en v2). La machine cible est une Surface Pro 11 **ARM64** (Snapdragon X Elite). Les NFRs imposent : démarrage < 1,5 s, mémoire < 400 Mo à 5 onglets, 100 % offline, binaire ARM64 natif. Le repo de référence `G:\KUDE` (Tauri 2 + Svelte 5 + CodeMirror 6) tourne déjà sur cette machine et fournit un design system et des briques directement réutilisables.

## Decision drivers

- Binaire **ARM64 Windows natif** obligatoire (pas d'émulation x64)
- Légèreté réelle (démarrage, mémoire) — c'est la raison d'être du produit
- Les meilleurs éditeurs riches Markdown (CodeMirror 6, ProseMirror/Milkdown) sont des libs **web**
- Réutilisation de KUDE : tokens AIR, `sanitize.ts`, patterns onglets/sidebar, config CM6 — et compétence déjà acquise
- Mono-développeur : minimiser les langages et le sur-mesure

## Considered options

### Option 1 : Tauri 2 + Svelte 5 + TypeScript
Coquille Rust + WebView2 système, UI web.
· Pros : binaire ~10 Mo, WebView2 déjà dans Windows 11 ARM64 (evergreen, natif), cible `aarch64-pc-windows-msvc` supportée, **combo prouvé sur la machine cible par KUDE**, réutilisation directe des briques, accès complet à l'écosystème d'éditeurs web.
· Cons : dépendance au WebView2 de l'OS, toolchain Rust nécessaire au build, écosystème de plugins plus jeune qu'Electron.

### Option 2 : Electron
· Pros : écosystème le plus mature, ARM64 Windows supporté, mêmes libs web accessibles.
· Cons : Chromium embarqué → bundle 150 Mo+, mémoire de base élevée, démarrage plus lent — à contre-courant direct des NFRs de légèreté.

### Option 3 : .NET 8 / WinUI 3
· Pros : natif Windows, excellent support ARM64, perfs UI.
· Cons : aucun éditeur WYSIWYG Markdown comparable dans l'écosystème XAML (il faudrait… un WebView), zéro réutilisation de KUDE, compétence moindre.

### Option 4 : Flutter desktop
· Pros : perfs de rendu, ARM64 Windows supporté.
· Cons : l'édition riche Markdown serait à construire presque entièrement, pas d'équivalent CM6/ProseMirror, zéro réutilisation.

## Decision

**Choisi : Option 1 — Tauri 2 + Svelte 5 + TypeScript.** Seule option qui satisfait à la fois la légèreté (vs Electron), l'accès aux éditeurs web indispensables au WYSIWYG (vs WinUI/Flutter) et la réutilisation du capital KUDE — le tout déjà validé en conditions réelles sur la machine ARM64 cible.

## Consequences

**Positive** : binaire léger et démarrage rapide ; briques KUDE réimportables telles quelles ; même modèle mental entre les deux projets.
**Negative** : deux langages dans le repo (TS + Rust minimal — mitigé par ADR-0004 : zéro logique métier en Rust) ; dépendance au cycle de release WebView2.
**Risks** : perf du WYSIWYG dans la webview sur un doc de 500 Ko → mesurée explicitement par le spike S0 sur la machine cible ; plugin Tauri manquant pour un besoin futur → n'écrire un plugin custom qu'en dernier recours (ADR-0004).

## Related

- `docs/planning/architecture.md` — architecture consommatrice
- [ADR-0004](./0004-io-fichiers-plugins-officiels.md) — corollaire : périmètre du code Rust
- ADR-0002 (à venir) — choix du moteur WYSIWYG après spike S0
