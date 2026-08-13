# ADR-0021 : Citations Markdown portables avec ancrage Doku facultatif

_Date : 2026-08-13 · Status : accepted · Tags : notes, citations, markdown, sécurité, portabilité_

## Context

Une note liée doit rester utile hors de Doku tout en permettant de revenir au passage source. Une base AppData seule rendrait la relation invisible et fragile lors du déplacement de la note ; un lien `file:` ou une URL locale navigable exposerait la webview à des chemins forgés et contournerait les primitives d’ouverture contrôlées.

## Decision

- Le contenu visible est un bloc de citation Markdown standard suivi d’une ligne de provenance humaine.
- Un commentaire HTML `doku-citation:v1` facultatif contient un chemin local, position indicative, longueur, hash SHA-256 du passage normalisé et contexte borné.
- L’absence ou la suppression du commentaire n’altère jamais la lisibilité de la note.
- Doku reconnaît la provenance par son parser applicatif, jamais par un `href` navigué dans la webview.
- Les chemins URL, UNC, périphérique Windows, traversal résiduel, caractères de contrôle et extensions non prises en charge sont refusés avant `openPath`.
- La relocalisation est déterministe : position + hash, texte exact unique, texte exact + contexte, puis échec honnête.

## Alternatives rejected

### Base AppData comme source unique

Rejetée : la note perd sa provenance quand elle est copiée ou ouverte ailleurs et la relation devient opaque.

### Lien `file:` ou protocole custom cliquable

Rejeté : le contenu Markdown est non fiable ; une navigation directe élargit la surface d’attaque et contourne les validations de Doku.

### Correspondance floue automatique

Rejetée : un faux passage est plus dangereux qu’un passage déclaré introuvable. La similarité pourra être proposée plus tard comme choix utilisateur, jamais comme révélation silencieuse.

## Consequences

- `linked-note.ts` doit être une primitive pure et testée avec un corpus hostile.
- Le live-preview peut enrichir la ligne de provenance par une affordance, mais le fichier reste un Markdown lisible sans ce widget.
- Une citation peut survivre à des déplacements mineurs du passage grâce au hash et au contexte, sans garantie trompeuse.
