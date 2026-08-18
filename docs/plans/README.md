# plans

## Purpose
Plans au **niveau fichier**, écrits avant de coder (`/plan`) : ce qui change, dans quel ordre, comment le vérifier, ce qu'on ne fait pas. Un plan relu et critiqué coûte moins cher qu'un chantier repris.

Ces plans sont des **instantanés d'intention**, pas de la documentation vivante : ils gardent la trace de ce qui était prévu, y compris quand la revue l'a changé. On ne les met pas à jour après coup.

## Files
| File | Purpose |
|---|---|
| `_latest.md` | Copie du dernier plan produit — point d'entrée de `/critic` et `/epct --from-plan` |
| `bureau-scinde-fondation.md` | Fondation du bureau scindé (deux volets, registre d'éditeurs, session v2) |
| `ajouter-contexte-chat.md` | Ajout de sources de contexte au copilote (sélection, presse-papiers, fichier) |
| `fournisseur-minimax.md` | Second fournisseur cloud par clé API (ADR-0018) |
| `nettoyage-backend.md` | Passage de propreté sur l'hôte Rust |
| `notes-ia-et-reecritures-structurelles.md` | Notes issues du copilote et réécritures de structure |
| `edition-texte-pdf-en-place.md` | Édition du texte d'un PDF sans passer par une conversion |
| `correction-pdf-par-consigne.md` | Correction d'une page de PDF par consigne — **chantier masqué**, voir [ADR-0024](../adr/0024-correction-pdf-assistee-par-le-modele.md) |

## Dependencies
- Internal: `docs/adr/` (ce que le plan a fini par graver), `docs/autopilot/` (les runs qui les ont exécutés)
- External: —
