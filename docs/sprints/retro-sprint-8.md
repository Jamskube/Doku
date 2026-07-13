# Retrospective: Sprint 8

**Date**: 2026-07-13
**Velocity**: 4 completed / 4 planned (100%)

## Stats
- Stories completed: 4 — **9.1** spike (S), **9.2** moteur (M), **9.3** panneau (M), **9.4** saut+cadre (S)
- Stories carried over: 0
- Blockers encountered: 0
- Fenêtre : 2026-07-13 → 2026-07-20 (livré le 07-13, en avance). **Epic 9 (Recherche) clos** ; ledger **39/39** ; 1ère feature v1.5 livrée de bout en bout.

## What Went Well 👍
- **Spike-avant-de-coder (9.1) payant** : la mesure (index-mémoire 0,4-1,6 ms vs scan 20-50 ms) a tranché l'archi **par des chiffres** et donné à 9.2 une forme précise (ADR-0007). Zéro hésitation ensuite.
- **`code-reviewer` a rattrapé 2 vrais Majors sur 9.2** (index périmé sur création/reload ; builds concurrents non coalescés) — **invisibles aux tests unitaires et à l'auto-revue**. Revue adversariale = filet réel sur une feature à état/cache.
- **Discipline ledger tenue** : 9.2/9.3 gardés `false` jusqu'au smoke natif réel, flippés ensemble ; jamais prétendu valider le scan natif depuis un test navigateur-démo.
- **Vérif en couches** : tests purs (`search.ts`) + Playwright (démo, offsets/req-token/surlignage) + smoke natif. Chacune a couvert une classe distincte.
- **Raffinement piloté utilisateur (9.4)** : le « pas assez bien » est devenu une story propre (saut + cadre) — 9.3 avait laissé le clic-pour-sauter minimal exprès, 9.4 s'y est inséré sans dette.

## What Didn't Go Well 👎
- **Le chemin démo navigateur ne teste pas le scan natif** (`buildSearchIndex` = IPC + skip binaires) : la vérif navigateur seule ne pouvait pas valider le cœur de 9.2 → smoke natif indispensable. L'index-démo est un **aide au dev**, pas une preuve complète.
- **Frictions Playwright** : clic sur le bouton-résultat (adjacent à l'éditeur CM) intercepté (« cm-scroller intercepts ») → repli sur `browser_evaluate` (clic DOM). Et le **localStorage persisté entre sessions de test** a rouvert la sidebar « search » → mon `Ctrl+Maj+F` l'a togglée fermée (confusion d'état). Bruit d'environnement, pas de bug produit.

## Action Items for Next Sprint
| Action | Priority |
|--------|----------|
| Sprint 9 (Export/PDF) : même rythme — **spiker d'abord le pipeline risqué** (10.1 print) puis `code-reviewer` sur le chemin d'écriture/export | High |
| Vider le `localStorage` en tête de vérif Playwright (éviter l'état persisté qui fausse les raccourcis toggle) | Medium |
| Pour les boutons adjacents à CM : `browser_evaluate` clic DOM en repli si l'actionnabilité Playwright échoue | Low |

## Lessons Learned
→ /start learn gotcha: Pour piloter l'éditeur CM6 après avoir ouvert un onglet (montage **asynchrone**), poser une intention dans l'état (`app.pendingReveal`) et la consommer dans un `$effect` de `DocumentView` **déclaré APRÈS** l'effet de switch d'onglet (contenu prêt) — un appel direct après `openPath` court-circuite le montage. `revealMatch` = sélection + `scrollIntoView` + décoration transitoire (`search-flash.ts`)
→ /start learn gotcha: Recherche plein-texte — les offsets d'un **extrait fenêtré** (avec ellipses) ne sont PAS la position dans le document : porter séparément la **colonne brute dans la ligne** (`col`) pour le saut éditeur. De plus `toLowerCase()` peut **changer la longueur** (ex. U+0130 « İ ») et désaligner les offsets → retomber sur une correspondance casse-sensible pour ce document (offsets garantis)
→ /start learn workaround: Vérif Playwright d'une app qui persiste son état (localStorage `doku-settings`) — l'état **survit entre sessions de test** et peut inverser un raccourci **toggle** (ex. sidebar déjà ouverte → `Ctrl+Maj+F` la ferme). Vider le storage au début, ou en tenir compte. Un bouton **adjacent à l'éditeur CM** peut faire échouer le clic Playwright (interception `cm-scroller`) → repli `browser_evaluate(() => el.click())`
