# 0014. Connexion optionnelle du compte OpenAI via Codex

**Date** : 2026-07-17 · **Status** : accepted · **Deciders** : nicos (+ Codex) · **Tags** : ia, openai, codex, oauth, cloud, secret

## Contexte

Doku-San utilise Ollama localement par défaut (ADR-0006/0012). L’utilisateur veut aussi pouvoir employer `gpt-5.6-luna` avec son compte ChatGPT/Codex, sans créer ni copier de clé API. L’approche par `OPENAI_API_KEY` étudiée dans l’ADR-0013 est donc rejetée.

Hermes Agent fournit une implémentation MIT récente du flux de code d’appareil utilisé par Codex. OpenAI documente la connexion ChatGPT pour ses clients Codex, mais ne publie pas cette route comme une API OAuth générique pour les applications tierces. Cette intégration dépend donc d’un contrat Codex susceptible d’évoluer.

## Décision

- Ollama reste le fournisseur par défaut, entièrement local.
- OpenAI reste un choix cloud explicite. Aucun appel n’est lancé au démarrage de Doku.
- La connexion utilise le flux de code d’appareil Codex : Doku obtient un code temporaire, ouvre `auth.openai.com/codex/device`, attend l’autorisation, puis échange le résultat contre une session.
- Doku ne reçoit jamais le mot de passe et ne demande jamais de clé API.
- Les jetons d’accès et de renouvellement restent dans le **Gestionnaire d’identifiants Windows**, dans deux entrées séparées. Ils ne sont jamais envoyés à la webview, à `localStorage` ou aux journaux.
- L’hôte Rust renouvelle la session et appelle la route Responses de Codex. Le frontend reçoit uniquement le statut, le catalogue des modèles et les deltas de texte.
- Le modèle demandé est `gpt-5.6-luna`. Après connexion, Doku interroge le catalogue du compte. Si Luna n’y figure pas, Doku le signale et ne substitue pas silencieusement un autre modèle.
- Le persona dépend du fournisseur : Ollama conserve un cadre court et très direct, tandis que Luna reçoit davantage d’autonomie pour structurer, synthétiser, inférer et proposer. Les mêmes garde-fous demeurent : ne jamais inventer un fait du document et distinguer explicitement faits, inférences et éventuel contexte extérieur.
- Les requêtes utilisent `store: false`, le streaming SSE et l’annulation déjà employés par le chat local.
- « Déconnecter » supprime les jetons locaux de Doku. La révocation complète d’un accès côté OpenAI reste une action à effectuer dans le compte OpenAI si nécessaire.

Cette intégration constitue une exception ciblée à l’ADR-0004 : le réseau et les secrets doivent rester hors de la webview. La logique documentaire et les prompts restent en TypeScript.

## Conséquences

**Positif** : aucune clé manuelle ; expérience de connexion familière ; secrets protégés par Windows ; disponibilité de Luna vérifiée par compte ; mode local inchangé.

**Négatif** : le document quitte la machine lorsque l’utilisateur choisit OpenAI ; dépendance au réseau, aux limites de l’abonnement et à une route Codex non documentée comme contrat tiers stable ; maintenance nécessaire si OpenAI modifie ce flux.

**Garde-fous** : fournisseur cloud explicite ; aucune substitution de modèle ; aucun jeton dans le frontend ; messages clairs en cas de session expirée ou de Luna indisponible ; tests sans compte réel et smoke test natif avec validation humaine.

## Références

- [OpenAI — Utiliser Codex avec une offre ChatGPT](https://help.openai.com/fr-fr/articles/11369540-utiliser-codex-avec-votre-offre-chatgpt)
- [OpenAI — Codex CLI et connexion avec ChatGPT](https://help.openai.com/en/articles/11381614-api-codex-cli-and-sign-in-with-chatgpt)
- `G:\AgenticOs\hermes-agent-main\hermes-agent-main\hermes_cli\auth.py` — flux de code d’appareil de référence
- `G:\AgenticOs\hermes-agent-main\hermes-agent-main\hermes_cli\codex_models.py` — découverte des modèles Codex
- [ADR-0004](./0004-io-fichiers-plugins-officiels.md) — exception Rust ciblée
- [ADR-0013](./0013-fournisseur-openai-optionnel.md) — approche par clé API rejetée
