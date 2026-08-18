# planning

## Purpose
Artefacts produit, dans l'ordre où ils tranchent : brainstorm → PRD → UX → architecture → epics. Les epics servent de backlog aux sprints (`docs/sprints/`).

## Files
| File | Purpose |
|---|---|
| `brainstorm-doku.md` | Idéation initiale |
| `brainstorm-atelier-documentaire.md` | Convergence SCAMPER sur la lecture, l'édition multi-format et la prise de notes |
| `feasibility-v3-split-workspace.md` | Gate GO et kill-test ARM64 du bureau scindé v3 |
| `feasibility-pdf-annotations.md` | Gate GO conditionnel pour un carnet PDF non destructif fondé sur TextLayer et un manifeste AppData |
| `feasibility-pdf-edition.md` | Paliers d'édition PDF et leur coût — palier 4 (formulaires AcroForm) toujours non commencé |
| `feasibility-selection-pdf-et-okular.md` | Précision de la sélection PDF (mécanisme pdf.js essayé et ÉCARTÉ), et comparaison honnête avec Okular |
| `PRD.md` · `PRD-v1.5.md` · `PRD-v2.md` · `PRD-v3.md` | Exigences produit par palier (v2 = copilote IA local ; v3 = bureau scindé et notes liées) |
| `ux-spec.md` · `ux-spec-v3.md` | Flows et wireframes (socle, puis bureau scindé v3) |
| `architecture.md` · `architecture-v2-copilot.md` · `architecture-v3-workspace.md` | Architecture technique (base, copilote, puis bureau scindé) |
| `epics.md` | Décomposition en epics/stories — source des sprints. État : backlog vide (Epics 1-16, 18, 19 livrés ; 17 clos NO-GO) |
| `claude-design-prompt.md` | Prompt de génération des maquettes |

## Dependencies
- Internal: `docs/adr/` (les choix gravés), `docs/sprints/` (exécution)
- External: —
