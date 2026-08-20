# Next session pointer
_Updated: 2026-08-20 15:21_

## Where I left off
La v3.1.0 reste publiée, puis une nouvelle capacité **Recherche Web** a été câblée dans le `+` du copilote pour OpenAI, MiniMax et Ollama. Un test réel MiniMax sur une facture a révélé que la première version cherchait la question vague mot pour mot et affichait des liens hors sujet ; le flux prépare maintenant la requête depuis le document, filtre les résultats, fournit la date locale et ne montre que les sources citées. Le code est vérifié et commité (`161159a`) ; le nouveau backend Rust exige un redémarrage complet de Doku avant le smoke utilisateur.

## Open work
- Branch: `main` — propre après le commit du journal
- Open PRs: indisponible (`gh pr list` échoue sur une configuration JSON invalide)
- Drafts/plans: `docs/plans/_latest.md`, `docs/plans/correction-pdf-par-consigne.md`

## Next concrete step
Redémarrer Doku en natif, réactiver Recherche Web et rejouer la question sur la facture OpenAI ; si les résultats et citations sont pertinents, reconstruire les installateurs concernés.
