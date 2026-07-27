# Next session pointer
_Updated: 2026-07-27 13:15_

## Where I left off
**Sprint 16 clos J+0 (3/3) et v2.2.0 scellée.** 19.2 + 19.3 validées en natif par l'utilisateur (purges « Données » éprouvées), version bumpée partout (`2.2.0`), installateur NSIS ARM64 généré, installé et smoke-testé. **Epic 19 soldé — plus aucun bouton muet.** Bonus design hors sprint, sur retour utilisateur : l'installateur est désormais **entièrement en D.A. Doku** (BMPs + template NSIS custom base tauri-cli 2.11.4, français). Rétro S16 gravée. Ledger : **69 features, 68 PASS** (seule 17.2 reste false — annulée par conception, pas une dette).

## Open work
- Branch: `main` — clean, tout poussé (`aebf19d`)
- Open PRs: aucune
- Drafts/plans: aucun
- **Backlog : VIDE.** Epics 1-16, 18, 19 livrés ; Epic 17 clos NO-GO. Pas de sprint actif, pas de sprint 17 à planifier d'office.
- Dette documentée (pas urgente) : re-diff `src-tauri/installer/installer.nsi` à chaque upgrade du CLI Tauri (procédure : `docs/design/installer-nsis/README.md`). Le MSI WiX reste non habillé (chantier séparé si demandé).
- Leçons de la rétro S16 : 3 suggestions `/start learn` (périphérie D.A. / template forké / encodage PowerShell) — proposées à l'utilisateur au wrap, voir `retro-sprint-16.md` si non appliquées.

## Next concrete step
**Rien à coder.** L'action High des rétros S15 + S16 est : **l'utilisateur utilise Doku v2.2.0 au quotidien** et le prochain chantier émerge de l'usage réel (remarques, manques, frictions). À la prochaine session : recueillir ce que l'usage a révélé → `/sprint plan` seulement s'il y a une vraie matière. Ne pas rouvrir : NPU (3 conditions ADR-0016), modèle copilote (tranché `qwen2.5:1.5b-instruct-q4_0`).
