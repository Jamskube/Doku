# Next session pointer
_Updated: 2026-07-24 23:30 — reprise prévue **lundi 2026-07-27**_

## Where I left off
Grosse session en trois temps. **(1)** Le **NPU est tranché : NO-GO**, acté par l'utilisateur — ADR-0016 `rejected`, Epic 17 clos, 17.2 annulée sans avoir été codée, provider `'npu'` retiré du produit (banc conservé dans `spike/npu-17.1/`). **(2)** Sprint 15 clos J+0 + **rétro faite**. **(3)** Backlog vide → l'utilisateur pointe une vraie dette : les boutons de l'interface qui ne font rien. Naissance de l'**Epic 19 « affordances mortes »**.

**Décision modèle, close** : `qwen2.5:1.5b-instruct-q4_0`, définitivement. Le 3b a été rejeté **deux fois** — le critère est « copilote = **gadget discret** », pas la qualité brute.

## Open work
- Branch: `main` — **tout commité et poussé**.
- Sprint 15 : `Completed`. Sprint 16 : **pas encore planifié** (l'Epic 19 est décomposé dans `epics.md` et sert de backlog).
- Ledger : **68 features, 65 PASS**. Ouvertes : `17.2` (annulée, branche fermée — pas de la dette), **`19.2`**, **`19.3`**.
- Vérifs au vert : `svelte-check` 0 err / 0 warning, `vitest` 274/274, `npm run build` OK.

## Next concrete step
**1. Valider 19.2 + 19.3 en natif** (`npm run tauri dev`) — c'est le seul blocage :
- ⚙ du ruban → modale Paramètres (Échap + clic sur le fond ferment, focus piégé).
- **Section « Données » = suppression DÉFINITIVE** → à éprouver sur un vrai historique avant de flipper le ledger. C'est le genre de bouton qu'on ne veut pas découvrir cassé.
- Logo → modale avec « À propos » surligné.

**2. Trancher le bump de version** : `package.json` et `src-tauri/tauri.conf.json` disent `0.1.0`, toute la doc dit **v2.2** → la carte « À propos » afficherait *Doku v0.1.0*. Décision de release, volontairement laissée à l'utilisateur. Passer les deux fichiers à `2.2.0` ?

**3. Ensuite** : `/sprint plan` pour un sprint 16 sur ce qui reste de l'Epic 19 et la suite. Rappel de la rétro S15 : l'action retenue était **« utiliser Doku pour de vrai »** et laisser le prochain epic émerger de l'usage — ce qui vient d'arriver avec l'Epic 19.

**Ne pas rouvrir** : le NPU (3 conditions dans l'ADR-0016) ni le choix du modèle (tranché, voir mémoires).
