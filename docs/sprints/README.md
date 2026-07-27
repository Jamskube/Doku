# sprints

## Purpose
Exécution : un fichier par sprint (`sprint-N.md`), une rétro par sprint (`retro-sprint-N.md`), et **`ledger.json` = vérité canonique de complétion** (une story n'est Done que si son entrée `passes: true`, quoi qu'en dise le Markdown).

## Files
| File | Purpose |
|---|---|
| `ledger.json` | 69 features ; seuls `passes`/`verified_by` sont mutables, jamais de suppression/réécriture d'entrée |
| `sprint-1.md` … `sprint-16.md` | Fichiers de sprint (goal, stories, checkpoints STOP/GO, log) |
| `retro-sprint-*.md` | Rétros — les leçons finissent dans `AGENTS.md` via `/start learn` |

État : sprint 16 clos (2026-07-27), pas de sprint actif — période d'usage réel.

## Dependencies
- Internal: `docs/planning/epics.md` (backlog source), `AGENTS.md` (leçons)
- External: —
