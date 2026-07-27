# Next session pointer
_Updated: 2026-07-27 14:00_

## Where I left off
**Sprint 16 clos J+0 (3/3), v2.2.0 scellée, Epic 19 soldé — plus aucun bouton muet.** L'installateur NSIS est **entièrement en D.A. Doku** (BMPs + template custom base tauri-cli 2.11.4, français) — validé sur pièce par l'utilisateur. Rétro S16 faite, 3 leçons gravées dans AGENTS.md. **Premier fruit de l'usage réel déjà récolté** : Doku refusait d'ouvrir `AGENTS.md` (« fichier binaire ») → diagnostic : 2 octets NUL littéraux réels dans le fichier (hérités de la gotcha S5), la détection de l'app était correcte ; repo assaini (plus aucun fichier texte avec NUL). Passe `/tidy` faite : README racine remis au réel (il disait « stack pas choisie » depuis 16 sprints), 5 READMEs structurels créés, memories intactes (61).

## Open work
- Branch: `main` — clean, tout poussé (`e5096a6`)
- Open PRs: aucune
- Drafts/plans: aucun
- **Backlog : VIDE.** Ledger 69 features / 68 PASS (17.2 annulée par conception). Pas de sprint actif.
- Dettes documentées (pas urgentes) : re-diff `src-tauri/installer/installer.nsi` à chaque upgrade du CLI Tauri (`docs/design/installer-nsis/README.md`) ; MSI WiX non habillé ; READMEs de `src/*` non créés (choix : pas de tables de fichiers qui rotent).

## Next concrete step
**Rien à coder — l'utilisateur utilise Doku v2.2.0 au quotidien** (action High des rétros S15+S16) et note remarques/manques/frictions ; à la prochaine session, recueillir ce que l'usage a révélé et ne lancer `/sprint plan` que s'il y a une vraie matière. Ne pas rouvrir : NPU (3 conditions ADR-0016), modèle copilote (tranché `qwen2.5:1.5b-instruct-q4_0`).
