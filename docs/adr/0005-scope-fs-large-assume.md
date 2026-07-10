# ADR-0005 — Scope fs/asset `**` : tradeoff assumé

**Statut** : Accepté — 2026-07-10
**Contexte** : audit sécurité jalon v1 (`.agent/security/audit-2026-07-10.md`, finding Medium)

## Contexte
Doku est un lecteur/éditeur qui doit pouvoir **ouvrir n'importe quel fichier supporté n'importe où** sur le disque (dialogue, explorateur, glisser-déposer, association de fichiers, restauration de session). Les capabilities Tauri (`src-tauri/capabilities/default.json`) accordent donc `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-rename` et l'`assetProtocol` (`tauri.conf.json`) avec un scope `["**"]` — tout le système de fichiers.

L'audit a relevé que c'est le grant le plus large de l'app : un renderer compromis obtiendrait lecture+écriture sur tout le disque, et c'est ce qui transformait le bug d'image UNC en primitive de lecture locale arbitraire (ce dernier étant désormais corrigé côté JS + CSP `img-src`, commit `8c85607`).

## Décision
On **conserve** le scope `**` pour v1, en connaissance de cause :
- La surface d'exécution de code dans le renderer est faible et défendue en profondeur : Markdown jamais rendu en HTML (décorations CodeMirror, aucun `{@html}`/`innerHTML`), aperçu HTML en `<iframe sandbox="">` + CSP `default-src 'none'` + `sanitizeHtml`, hôte Rust minimal sans commande custom ni shell/exec.
- Les écritures ne visent **que** le `tab.path` choisi par l'utilisateur (jamais influencé par le contenu d'un document) ; les lectures sont initiées par l'utilisateur.
- Restreindre le scope aux dossiers des documents ouverts exigerait une **gestion dynamique** des scopes de capabilities (statiques dans la config Tauri) ou une **racine de bibliothèque** configurée — ce qui contredit l'UX « ouvre-tout » et n'apporte de bénéfice qu'en cas de faille d'exécution, déjà très contenue.

## Conséquences
- **Positif** : UX sans friction (ouvrir tout fichier), config simple, aucune gestion de scope runtime.
- **Négatif** : blast radius maximal si une faille d'exécution apparaissait dans le renderer ; toute future commande custom ou bug d'injection de chemin deviendrait à l'échelle du disque.
- **Revisiter si** : ajout d'une commande Tauri custom, d'un moteur de rendu HTML actif, ou d'une distribution multi-utilisateurs → passer à une **racine de bibliothèque** configurable (least privilege) et resserrer `fs:*` + asset au sous-arbre ouvert.
