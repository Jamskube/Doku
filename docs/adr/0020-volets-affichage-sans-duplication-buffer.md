# ADR-0020 : Volets d’affichage sans duplication des buffers

_Date : 2026-08-13 · Status : accepted · Tags : workspace, split-view, éditeur, fiabilité_

## Context

Doku v3 doit afficher et éditer deux documents simultanément. L’état actuel possède une collection `DocTab` qui porte les buffers et une seule vue active globale. Deux choix structurants existent : dupliquer le document dans chaque volet puis synchroniser les modifications, ou garder un seul `DocTab` et faire des volets une projection d’affichage.

La fidélité et l’absence de sauvegarde croisée priment sur la commodité. CodeMirror permet plusieurs vues indépendantes mais ne les synchronise pas automatiquement. Le premier incrément n’a aucune raison fonctionnelle d’afficher le même onglet dans les deux volets.

## Decision

- `DocTab` reste la source de vérité unique de chaque document.
- Un `WorkspaceState` référence les onglets par `tabId` dans deux `PaneState` légers.
- Un même `tabId` ne peut pas être affecté aux deux volets.
- Les `EditorView`, sélections et focus sont rangés dans un registre runtime indexé par `paneId`.
- Toute commande asynchrone capture `{paneId, tabId, content}` avant le premier `await`.
- `activeId` reste temporairement un miroir de l’onglet du volet actif pendant la migration du code existant.

## Alternatives rejected

### Deux copies de buffer synchronisées

Rejetée : il faut réconcilier transactions, undo, sélection, rechargements externes et sauvegardes. Une divergence silencieuse pourrait écrire la mauvaise version sur disque.

### Une seule instance d’éditeur déplacée entre les volets

Rejetée : les deux documents ne seraient pas réellement simultanés ; scroll et sélection seraient perdus à chaque déplacement.

### Autoriser le même onglet dans les deux volets

Différée : elle exige un protocole de synchronisation officiel et un modèle clair d’undo partagé, sans valeur nécessaire pour la prise de notes initiale.

## Consequences

- `DocumentView` devient paramétré par `paneId`/`tabId` et cesse de déduire son document depuis `activeTab()`.
- Les fonctions globales de sauvegarde, révélation et formatage doivent cibler un volet explicite.
- Le risque de mutation croisée est testable avec des états purs et un registre de vues.
- Les onglets restent ordinaires ; fermer la vue scindée ne ferme aucun document.
