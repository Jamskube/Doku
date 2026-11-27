# Vision LFM3-Omni-2B — lfm3-q4_0

## page-scan.png — Quel est le numéro du permis de construire, et quelles pièces manquent au dossier ?

*Vérité terrain* : PC 045 287 26 B0031 ; plan de masse (PCMI2) et notice descriptive (PCMI4) · **86204 ms** (prompt 2050 tok, prefill 34883 ms)

> Le numéro du permis de construire est **PC 045 287 26 B0031**.
> 
> Au dossier, deux pièces manquent :
> - la **pièce PCMI2**
> - la **notice descriptive (pièce PCMI4)**

## page-scan.png — Transcris le texte de ce courrier.

*Vérité terrain* : (transcription intégrale) · **41214 ms** (prompt 2040 tok, prefill 34866 ms)

> **Mairie de Saint-Aubin-sur-Loire**
> 
> Service de l'urbanisme — 12 rue des Tilleuls, 45230 Saint-Aubin
> 
> **Objet : permis de construire n° PC 045 287 26 B0031**
> 
> Le 14 octobre 2026
> 
> Madame Durand,
> 
> Nous accusons réception de votre demande de permis de construire déposée le 2 septembre 2026 pour l'extension de 38 m² de votre habitation. Le dossier est incomplet : il manque le plan de masse (pièce PCMI2) et la notice descriptive (pièce PCMI4).
> 
> Vous disposez d'un délai de trois mois pour transmettre ces pièces, faute de quoi la demande sera rejetée tacitement.
> 
> Veuillez agréer, Madame, nos salutations distinguées.
> 
> *Le responsable du service, Jean-Marc Lefèvre*

## page-table.png — Quel est le montant de l'achat de livres au T4, et le total annuel du budget ?

*Vérité terrain* : 3 100 € ; 14 320 € · **14244 ms** (prompt 1248 tok, prefill 13456 ms)

> Le montant de l'achat de livres au T4 est de **3 100 euros**, et le total annuel du budget est de **14 320 euros**.

## page-table.png — Convertis ce tableau en tableau Markdown.

*Vérité terrain* : (6 lignes × 6 colonnes) · **23356 ms** (prompt 1235 tok, prefill 16250 ms)

> **Budget prévisionnel 2027 — Association Les Amis du Livre**
> 
> | Poste | T1 | T2 | T3 | T4 | Total |
> |-------|----|----|----|----|-------|
> | Location salle | 1 200 | 1 200 | 1 200 | 1 200 | 4 800 |
> | Achat de livres | 2 500 | 800 | 650 | 3 100 | 7 050 |
> | Communication | 300 | 450 | 200 | 900 | 1 850 |
> | Assurance | 620 | 0 | 0 | 0 | 620 |
> | Total | 4 620 | 2 450 | 2 050 | 5 200 | 14 320 |
> 
> *Montants en euros TTC.*

## page-form.png — Extrais les champs de ce formulaire en JSON (nom, prénom, date de naissance, adresse, téléphone, courriel, formule).

*Vérité terrain* : MARTIN, Élodie, 03/11/1987, 7 impasse des Glycines 69007 Lyon, 06 12 34 56 78, e.martin@exemple.fr, Famille (25 €) · **22207 ms** (prompt 1375 tok, prefill 18617 ms)

> ```json
> {
>   "nom": "MARTIN",
>   "prénom": "Élodie",
>   "date_de_naissance": "03/11/1987",
>   "adresse": "7 impasse des Glycines, 69007 Lyon",
>   "téléphone": "06 12 34 56 78",
>   "courriel": "e.martin@example.fr",
>   "formule": "Famille (25 €)"
> }
> ```
