# Fichier piège — variété de syntaxes

Ce fichier exerce les cas qui font trébucher les serializers.

## Emphases mélangées

Du *italique étoile*, du _italique underscore_, du **gras étoiles**, du __gras underscores__, du ***gras-italique***, du `code inline`, du ~~barré~~.

## Listes

- puce tiret
- deuxième
  - imbriquée deux espaces
    avec continuation de paragraphe
* puce étoile

1. numérotée
2. suite
   1. sous-numérotée

## Tâches

- [ ] tâche à faire
- [x] tâche cochée
- [ ] tâche avec **gras** et [[wikilink-dans-tache]]

## Wikilinks et liens

Un [[note-simple]] et un [[dossier/note-imbriquee]] et un [lien classique](https://example.com) et un [lien référence][ref].

[ref]: https://example.com/ref "titre de référence"

## Code

```javascript
const x = 42; // fence js
```

~~~python
print("fence tilde")
~~~

    code indenté quatre espaces

## Citations et règles

> citation simple
> sur deux lignes
>
> > citation imbriquée

---

***

___

## Tableau

| Colonne A | Colonne B | Alignée |
|---|:---:|---:|
| a | b | 12 |
| c *avec emphase* | `code` | 3 400 |

## Divers pièges

Ligne avec deux espaces en fin pour hard break  
ligne suivante.

Ligne avec backslash en fin\
autre ligne.

Titre Setext
============

Sous-titre Setext
-----------------

Du HTML inline : <kbd>Ctrl</kbd>+<kbd>S</kbd> et <br> et un <span style="color:red">span</span>.

<div align="center">
Un bloc HTML.
</div>

Caractères à échapper : \* étoile littérale, \_ underscore, \# dièse, 5 \* 3 = 15.

Une image : ![logo de doku](../src/assets/doku-mark-rounded.svg "Le logo")

Entités : &amp; &lt; &gt; &nbsp; — et de l'unicode : éàüßæ日本語🎉

Fin du fichier sans newline final ? Non, avec.
