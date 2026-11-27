# Gate qualité FR — lfm3-q4_0-text vs qwen-q4_0

Généré par `quality-fr.mjs` le 2026-11-27T09:35:28.582Z · llama.cpp b12810 CPU · temp 0,2, top_k 40, top_p 0,9, repeat 1,1, seed 42. Prompts = ceux de `src/lib/copilot-service.ts` (persona local).

## Résumé d'un document (ADR-0001)

### lfm3-q4_0-text — 33892 ms

> *   **Stack technique :** Tauri 2 + Svelte 5 + TypeScript sur Surface Pro 11 ARM64.
> *   **Binaire requis :** ARM64 Windows natif, pas d'émulation x64.
> *   **Réutilisation KUDE :** Tokens AIR, `sanitize.ts`, patterns onglets/sidebar, config CM6.
> *   **Moteur WYSIWYG :** Tauri 2 (WebView2) pour les éditeurs web, vs Electron/Flutter.
> *   **Synthèse :** C'est la solution optimale pour légèreté et réutilisation de capital KUDE sur cette machine.
> 
> **En résumé :** Doku choisit le stack Tauri 2 + Svelte 5 + TypeScript car il combine légèreté, accès aux éditeurs web et réutilisation du capital KUDE déjà validée.

### qwen-q4_0 — 32202 ms

> **Résumé en cinq piques courtes :**
> 
> - **Stack:** Tauri 2 + Svelte 5 + TypeScript
> - **Date:** 2026-07-08
> - **Status:** accepted
> - **Deciders:** nicos (+ Claude)
> - **Tags:** stack, desktop, arm64
> 
> **Synthèse de synthèse :**
> 
> La décision a été prise pour le choix du Stack applicatif Tauri 2 + Svelte 5 + TypeScript. Ce choix répond à plusieurs critères: légèreté (démarrage rapide), réutilisation des briques KUDE, et accès aux éditeurs web indispensables au WYSIWYG. Le projet est basé sur le succès de Tauri 2 + Svelte 5 + CodeMirror 6 dans la machine cible ARM64.

## Points clés

### lfm3-q4_0-text — 26079 ms

> 1. Choisi : Option 1 — Tauri 2 + Svelte 5 + TypeScript.
> 2. Seule option qui satisfait à la fois la légèreté (vs Electron), l'accès aux éditeurs web indispensables au WYSIWYG (vs WinUI/Flutter) et la réutilisation du capital KUDE — le tout déjà validé en conditions réelles sur la machine ARM64 cible.
> 3. Positive : binaire léger et démarrage rapide ; briques KUDE réimportables telles quelles ; même modèle mental entre les deux projets.

### qwen-q4_0 — 24410 ms

> Les trois points clés de ce document sont :
> 
> 1. **Légèreté** : Le produit doit être léger pour permettre un démarrage rapide et une gestion efficace des mémoires.
> 
> 2. **Réutilisation du capital KUDE** : Les briques réutilisables doivent être disponibles directement sans avoir besoin de créer d'API supplémentaires.
> 
> 3. **Démarrage rapide** : Le démarrage doit être inférieur à 1,5 secondes pour une utilisation quotidienne efficace.

## Actions à suivre (brainstorm)

### lfm3-q4_0-text — 25268 ms

> - Périmètre v1 du PRD
> - Examiner le repo existant
> - Spec UX avec Claude design
> - v1 (explorateur + wikilinks)
> - v1.5 (recherche)

### qwen-q4_0 — 28103 ms

> ```markdown
> - **DO FIRST** : Cœur visionneuse multi-format à onglets
> - **DO FIRST** : Lecture/édition Markdown fluide
> - **QUICK WINS** : Navigation dossier, wikilinks, recherche
> - **QUICK WINS** : Petits plus quotidiens (Coller intelligent)
> - **CONSIDER** : Export un clic (Md → PDF / HTML / DOCX ; inverse)
> ```

## Q&A citée (extraits RAG)

### lfm3-q4_0-text — 15425 ms

> Doku évite de corrompre un document lors d'une panne de courant grâce à la sauvegarde atomique : écriture d'un fichier temporaire puis renommage [2]. La recherche plein-texte balaie le dossier de contexte et la cible de latence reste sous trois cents millisecondes [3].

### qwen-q4_0 — 11610 ms

> Doku évite de corrompre un document lors d'une panne de courant grâce à une sauvegarde atomique. Cette sauvegarde consiste en la création d'un fichier temporaire et son renommage après la coupure, ce qui assure que le document ne reste jamais à moitié écrit. La recherche plein-texte est effectuée sur un millier de notes avec une latence visée de moins de trois cents millisecondes pour maintenir l'efficacité même en cas d'interruption du réseau.

## Q&A piège (information absente)

### lfm3-q4_0-text — 20481 ms

> Je ne trouve pas cette information dans ce document.

### qwen-q4_0 — 27621 ms

> Je ne trouve pas cette information dans ce document.

## Reformuler une sélection (clarify)

### lfm3-q4_0-text — 27339 ms

> Il faut noter que, puisque l'application doit rester légère et fonctionner sur une machine ARM64, il est essentiel de choisir une pile technique qui n'impose pas d'émulation x64. Une telle pile dégraderait les performances, donc elle est indispensable.

### qwen-q4_0 — 31360 ms

> Il est important de noter que, dans la mesure où l'application doit rester légère et fonctionner sur une machine ARM64, il faut choisir une pile technique qui n'impose pas d'émulation x64. Cette option permettrait de maintenir les performances élevées sans dégrader les performances.

## Corriger (orthographe/grammaire)

### lfm3-q4_0-text — 28758 ms

> Les fichiers que nous avons ouverts hier étaient corrompus, mais la sauvegarde atomique nous a permis de les récupérer sans perte. Il faudrait quand même vérifier les autres dossiers

### qwen-q4_0 — 24768 ms

> """
> Les fichiers que nous avons ouverts hier étaient corrompus, mais la sauvegarde atomique nous a permis de les récupérer sans perte. Il faudrait toutefois vérifier les autres dossiers.
> """

## Traduction FR→EN (consigne libre)

### lfm3-q4_0-text — 23241 ms

> The copilot operates entirely offline: no request leaves the machine during generation. This is the guarantee of confidentiality that distinguishes Doku from cloud-based assistants.

### qwen-q4_0 — 20810 ms

> **Translation in English:**
> 
> "The co-pilot operates entirely offline: no request leaves the machine during generation. This is the guarantee of confidentiality that distinguishes Doku from cloud-based assistants."
