# Retrospective: Sprint 15

**Date**: 2026-07-24
**Velocity**: 1 story livrée / 1 exécutable (100 %) — 17.2 annulée, sa gate ne s'est jamais ouverte

## Stats
- Stories complétées : **1** (17.1, spike → verdict)
- Stories annulées : **1** (17.2, gated sur un GO qui n'est pas venu — par conception)
- Stories reportées : **0**
- Blockers rencontrés : **1** (externe : EP QNN de Foundry Local cassé — contourné, pas résolu)
- Durée : **J+0** (planifié, exécuté et clos le même jour)
- Commits : 5 (`7f3ed50` → `842cf9f`)
- Livrable : **une décision chiffrée**, pas du code produit. Le seul code survivant est un banc de mesure.

## What Went Well 👍
- **Tester en natif dans Doku a été le vrai juge.** Câbler un provider `'npu'` dans l'app pour *éprouver* l'expérience, plutôt que de trancher sur des tableaux de benchmarks. Le rejet du `1.5b-qnn` s'est fait en deux minutes d'usage réel — un chiffre de tok/s ne l'aurait jamais montré. **Le banc de mesure a produit les chiffres ; l'usage a produit le verdict.**
- (Observation du facilitateur, non retenue par l'utilisateur mais factuelle) Les **seuils pré-enregistrés** dans l'ADR-0016 avant toute mesure, et la **gate spike-first** sur 17.2, ont fait leur travail en silence : le verdict n'a pas pu être rationalisé après coup, et la réécriture lourde n'a jamais été entamée.

## What Didn't Go Well 👎
- **Foundry Local cassé = du temps brûlé sur un chemin mort.** L'EP QNN ne s'enregistre même pas (`AutoRegisterCertifiedEps: Failure`, `discoverEps()` ne voit que WebGpu). Il a fallu descendre dans les logs et le SDK pour établir que le bug était **amont**, pas dans notre config. Toute la direction technique de l'ADR reposait sur cet outil.
- **Le préalable CPU a été sauté — et ça se paie deux fois.** Le plan documenté disait « épuiser le levier CPU + Q4_0 avant le NPU ». On l'a sauté par choix produit. Résultat : le NPU était un cul-de-sac **et** le repli CPU (`3b`) a été rejeté dans la foulée. On termine exactement là où on a commencé, en ayant payé les deux investigations.
- **Le débogage du sidecar a coûté cher pour un artefact jetable** : `ADSP_LIBRARY_PATH`, `seqlens_k out of range` (fenêtre glissante à 64), boucles d'hallucination du décodage glouton, un OOM natif silencieux. Beaucoup de bricolage bas niveau pour un banc qui n'ira pas en production.

## Surprises 😲
- **Le mur n'était pas la vitesse — c'était un trou dans le catalogue.** On cherchait un gain de performance ; on a trouvé un problème de *disponibilité de modèles*. Le NPU tient ses promesses (prefill 4-6×), mais il n'existe **aucun 3B QNN francophone** entre le 1,5B trop bête et le 7B qui swappe. **Aucune quantité d'ingénierie ne comble un trou de catalogue.** C'est le genre de mur qu'on ne peut découvrir qu'en allant jusqu'au bout.

## Action Items for Next Sprint
| Action | Priority |
|--------|----------|
| **Utiliser Doku pour de vrai au quotidien** avant d'écrire une ligne de plus — laisser le prochain epic émerger de l'usage, pas du backlog | High |
| Ne pas rouvrir le NPU hors des **3 conditions** de l'ADR-0016, ni le sujet du modèle (tranché : `1.5b-q4_0`) | High |
| Quand la période d'usage aura parlé : décider entre release v2.2 packagée / nouvel epic / passe de dette | Medium |

## Lessons Learned

**1. Un verdict d'usage bat un verdict de benchmark.** Les mesures disent *combien* ; seul l'usage dit *si c'est acceptable*. Sur un spike qui touche à la qualité perçue (modèle, latence, ergonomie), prévoir dès le départ un chemin pour **essayer la chose dans le produit**, même jetable — c'est ce qui a tranché ici, pas le banc.

→ `/start learn process: sur un spike qui touche la qualité perçue (modèle IA, latence, UX), prévoir un câblage jetable dans l'app dès le protocole — le verdict d'usage tranche là où les tok/s ne disent rien`

**2. Un préalable documenté qu'on saute se paie, même si le raccourci est assumé.** Le plan disait « CPU d'abord » ; le sauter a fait payer les deux branches pour finir au point de départ. Sauter un préalable est un choix produit légitime — mais il faut le compter comme un **risque pris**, pas comme du temps gagné.

→ `/start learn process: sauter un préalable documenté n'est pas du temps gagné mais un risque pris — si la piste principale échoue, le repli reste à faire et les deux investigations sont payées`

**3. Vérifier que l'outil central du plan fonctionne AVANT de bâtir le protocole autour.** L'ADR-0016 entier était construit sur Foundry Local. Un « hello world » de 10 minutes sur l'EP QNN aurait révélé le blocage avant l'écriture du cadre de décision.

→ `/start learn process: avant de construire un protocole de spike autour d'un outil tiers, valider en 10 min que sa fonction critique marche sur la machine cible — sinon tout le cadre repose sur une hypothèse non testée`

**4. Un NO-GO est une livraison — à condition de laisser quelque chose derrière.** Ce sprint ne livre aucun code produit, mais il livre : un verdict incontestable (seuils figés d'avance), une recette NPU fonctionnelle et reproductible, des conditions de réouverture explicites, et une branche fermée proprement (17.2 jamais codée). **La valeur d'un spike se mesure aux décisions qu'il rend impossibles à re-litiger.**
