# journal

## Purpose
Journal de bord par session de travail, et pointeur de reprise pour la session suivante.

## Files
| File | Purpose |
|---|---|
| `YYYY-MM-DD.md` | Journal du jour : Summary, Added/Modified/Fixed, Discoveries, Decisions, Commits |
| `_next-session.md` | **Pointeur de reprise** (réécrit à chaque `/wrap`) — lu par `/start` en début de session |

## Dependencies
- Internal: alimenté par `/wrap`, lu par `/start`
- External: —
