# 0003. Snapshots stockés centralisés dans %APPDATA%\Doku

**Date** : 2026-07-08 · **Status** : accepted · **Deciders** : nicos (+ Claude) · **Tags** : données, snapshots, fiabilité

## Context

FR-12 du PRD : à chaque sauvegarde, Doku conserve une version du fichier (filet de sécurité, restauration en un clic, purge auto 20 versions / 30 jours). Il faut choisir où vivent ces copies. Les documents de l'utilisateur habitent des dossiers arbitraires, parfois synchronisés (OneDrive) ou versionnés (git).

## Decision drivers

- Ne **jamais polluer** les dossiers de notes de l'utilisateur (esprit « léger », pas de vault à la Obsidian)
- Éviter le bruit dans les mécanismes de sync/versionnage tiers (OneDrive uploaderait chaque snapshot, git les verrait en untracked)
- Purge et maintenance simples (un seul emplacement à parcourir)
- Restauration fiable même si le dossier d'origine a des droits restreints

## Considered options

### Option 1 : `.doku/` à côté de chaque fichier
· Pros : l'historique voyage avec le dossier (copie/déplacement du dossier = historique conservé) ; visible et inspectable.
· Cons : pollue chaque dossier touché ; snapshots aspirés par OneDrive/git à l'insu de l'utilisateur ; purge dispersée sur N emplacements ; échoue dans les dossiers en lecture seule.

### Option 2 : centralisé `%APPDATA%\Doku\snapshots\`
Structure : `snapshots/<sha1(chemin absolu normalisé)>/<horodatage ISO>.md` + `meta.json` (chemin original, tailles, dates).
· Pros : dossiers utilisateur intacts ; hors de portée des syncs ; purge en un seul scan ; écriture toujours possible.
· Cons : le lien fichier↔historique repose sur le chemin — un fichier déplacé/renommé démarre un historique neuf ; historique perdu si AppData est nettoyé.

### Option 3 : pas de snapshots (s'en remettre à git/OneDrive)
· Cons : rejeté — contredit FR-12 et le NFR « zéro perte de données » ; la plupart des notes ne sont ni versionnées ni synchronisées.

## Decision

**Choisi : Option 2 — centralisé dans `%APPDATA%\Doku\snapshots\`**, clé = `sha1(chemin absolu, casse normalisée)`. Les drivers dominants sont la non-pollution et l'isolation vis-à-vis des syncs ; la perte d'historique au renommage est un compromis acceptable pour un outil perso v1.

## Consequences

**Positive** : dossiers de notes strictement intacts ; purge triviale au démarrage ; pas d'interaction avec OneDrive/git.
**Negative** : renommer/déplacer un fichier repart d'un historique vide (le `meta.json` conserve le chemin original, ce qui permettra une future commande « rattacher un historique orphelin » si le besoin émerge).
**Risks** : croissance disque silencieuse → purge systématique (20 versions / 30 jours) exécutée au démarrage *et* à chaque sauvegarde ; collision de hash improbable (sha1 sur chemin) → acceptée.

## Related

- `docs/planning/PRD.md` FR-12 · `docs/planning/ux-spec.md` §4 W5 (panneau Historique)
- `docs/planning/architecture.md` — SnapshotService
