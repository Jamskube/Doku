# autopilot

## Purpose
Journaux de vol des runs autonomes (`/autopilot`). Chaque fichier garde, pour un objectif donné : la **demande originale mot pour mot**, les itérations, les décisions prises sans demander, les escalades sur blocage, ce qui a été parqué — et ce qui a été **infirmé**.

Ce dernier point est la raison d'être du dossier. Un run qui se corrige laisse une trace utilisable ; un run qui n'écrit que ses succès n'apprend rien à personne.

## Files
| File | Purpose |
|---|---|
| `run-2026-08-15.md` | Annotation PDF et écriture non destructive |
| `run-2026-08-17.md` | Édition DOCX, dette de sécurité, passage de propreté |
| `run-2026-08-17-2.md` | Correction de PDF par consigne : 17 itérations, 6 portails, deux corruptions trouvées — puis fonctionnalité **masquée** faute d'utilité ([ADR-0024](../adr/0024-correction-pdf-assistee-par-le-modele.md)) |

## Dependencies
- Internal: `docs/plans/` (le plan exécuté), `docs/journal/` (le récit du jour), `AGENTS.md` (les leçons qui en sortent)
- External: —
