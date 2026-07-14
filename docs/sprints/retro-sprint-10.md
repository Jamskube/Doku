# Retrospective: Sprint 10

**Date**: 2026-07-14
**Velocity**: 3 completed / 3 planned (100%)

## Stats
- Stories completed: **3/3** (11.1 L, 11.2 S, 12.1 M) — ledger **46/46**, **v1.5 feature-complete**
- Stories carried over: 0
- Blockers encountered: 0
- Dette Sprint 9 soldée dans la foulée : validations natives **10.3** (HTML autonome) + **10.4** (DOCX) + **11.1** groupées en un seul `tauri dev` (action retro S9 exécutée)
- Bugs data-loss HIGH interceptés en revue : **3** (Ctrl+S destructeur sur onglet PDF ; collage même-seconde s'écrasant ; insertion dans le mauvais onglet via éditeur partagé)
- Vélocité : S6=4 · S7=3 · S8=4 · S9=4 · **S10=3** (mais 1 L = sprint plein)

## What Went Well 👍
- **Tout le PRD-v1.5 livré** : recherche + export (PDF/HTML/DOCX) + lecture PDF + coller image. Épics 10-11-12 complets.
- **Validation native en lot** (action retro S9) : 3 validations soldées en un seul lancement → confirme la pratique, 2 sprints de suite.
- **critic sur le plan** a intercepté 2 bugs data-loss HIGH de 12.1 **avant toute ligne de code** ; code-reviewer 0 Critical/Major sur les 3 stories.
- **Réutilisation S9** : les permissions binaires (`fs:allow-read-file`/`write-file`, `writeFileAtomic`) ajoutées en S9 ont servi 11.1 (octets PDF) et 12.1 (image collée) → zéro nouveau plumbing Rust.
- Discipline **lazy-load** tenue : pdfjs (~1,3 Mo) hors bundle principal, comme docx/marked.

## What Didn't Go Well 👎
- **Flou PDF non anticipé au spike 11.1** : le spike a validé « ça rend » mais pas la **netteté HiDPI** → un aller-retour après validation (correctif `scrollbar-gutter` + plafond DPR). Le critère de « done » du spike était trop laxiste.
- **11.2 quasi entièrement déjà fait pendant 11.1** (le vrai reste = 1 entrée manifest) : découpage 11.1/11.2 flou, estimation S un peu creuse — bon signe (réutilisation) mais montre qu'on n'avait pas tracé la frontière.
- **Association OS `.pdf` non testable sans install** → validée « sur confiance » : dette de vérification reportée au prochain `tauri build` + install.

## Action Items for Next Sprint
| Action | Priority |
|--------|----------|
| Tout spike de **rendu graphique** (canvas/HiDPI) inclut un critère de **netteté** (DPR + gouttière scrollbar) dans son « done », pas seulement « ça s'affiche » | High |
| Pour des stories dépendantes (amont/aval), tracer ce que l'amont livre déjà **avant** d'estimer l'aval, pour éviter la story-fantôme | Medium |
| Au prochain build+install : **confirmer l'association `.pdf`** (dette 11.2) | Medium |

## Lessons Learned
→ /start learn tech: Canvas HiDPI net = rendre le backing-store à `cssWidth × dpr` **et** réserver la gouttière de scrollbar (`scrollbar-gutter: stable`) ; sinon la scrollbar apparaît après coup, rétrécit la largeur utile et `max-width:100%` rééchantillonne le canvas d'un facteur non-entier = flou léger.
→ /start learn tech: Un `EditorView` CodeMirror unique partagé entre onglets → toute insertion faite **après un await** doit re-vérifier `app.activeId === tabId` avant `dispatch`, sinon on écrit dans le document affiché entre-temps (mauvais fichier + chemin relatif faux).
→ /start learn tech: Les écritures de fichiers déclenchées par événement (collage image) doivent être **sérialisées** (chaîne de promesses) + boucle de nom unique ; deux events rapprochés voient sinon le même nom libre et se réécrivent l'un l'autre (`rename` remplace la cible sur Windows).
→ /start learn process: Valider le natif **en lot** (un seul `tauri dev` pour N stories code-complete) — pratique confirmée efficace 2 sprints de suite ; à inscrire comme routine de fin de sprint.
