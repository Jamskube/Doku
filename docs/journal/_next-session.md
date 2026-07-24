# Next session pointer
_Updated: 2026-07-24 23:00_

## Where I left off
**Le GO/NO-GO NPU est tranché : NO-GO, acté par l'utilisateur.** Sprint 15 clos J+0 sur un verdict chiffré (c'était le contrat du checkpoint STOP/GO : un NO-GO documenté est une livraison valide).

Ce qui a été gravé : **ADR-0016 → `rejected`** (mesures réelles + verdict contre les 6 seuils pré-enregistrés + 3 conditions de réouverture), **Epic 17 clos**, **story 17.2 annulée sans avoir été codée** (sa gate ne s'est jamais ouverte), ledger **64/65**, sprint-15 `Done`. Le provider `'npu'` et l'onglet « NPU (essai) » ont été **retirés du produit** (un NO-GO ne laisse pas un provider expérimental dans l'app) ; le banc et le sidecar restent dans `spike/npu-17.1/`, autonomes et relançables.

**Décision produit associée** : le repli prévu par l'ADR (basculer sur `qwen2.5:3b-instruct-q4_0`) est **écarté lui aussi** — trop lent, trop de RAM. **`qwen2.5:1.5b-instruct-q4_0` est confirmé définitivement** : le critère est « copilote = gadget discret », pas la qualité brute. **Aucun changement de code copilote** — statu quo assumé, pas subi.

## Open work
- Branch: `main` (propre, poussé)
- Open PRs: aucune
- **Sprint 15 : Done.** Rétro S15 **pas encore faite**.
- **Backlog vide** : Epics 1-16 + 18 livrés, Epic 17 clos par la mesure. Le produit est feature-complete côté v2.2.
- `svelte-check` 0 erreur, `vitest` 260/260 après retrait du provider NPU.

## Next concrete step
**`/sprint retro`** pour clore proprement le sprint 15 (1 story, verdict NO-GO — rétro courte, mais la leçon « spike-first + seuils pré-enregistrés » mérite d'être consignée).

**Ensuite, le backlog est vide** — il faut décider ce que devient Doku. Pistes possibles à proposer, pas à présumer : polir/packager une **release v2.2**, ouvrir un nouvel epic produit (à partir d'un vrai besoin d'usage), ou faire une passe de dette/qualité. **Ne pas rouvrir le NPU** (3 conditions dans l'ADR-0016) **ni le sujet du modèle** (tranché, voir mémoires).
