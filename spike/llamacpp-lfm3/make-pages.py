# Génère 3 pages PNG à vérité terrain connue pour le test vision (mmproj) :
# une lettre « numérisée » (penchée, bruitée), un tableau de budget, un formulaire rempli.
# Usage : py -I make-pages.py <dossier_sortie>
import sys, random
from PIL import Image, ImageDraw, ImageFont, ImageFilter

out = sys.argv[1]
F = lambda n, s: ImageFont.truetype(f"C:/Windows/Fonts/{n}", s)
W, H = 1240, 1754  # A4 à 150 dpi

# 1. Lettre numérisée
img = Image.new("L", (W, H), 245)
d = ImageDraw.Draw(img)
lines = [
    ("Mairie de Saint-Aubin-sur-Loire", F("timesbd.ttf", 40)),
    ("Service de l'urbanisme — 12 rue des Tilleuls, 45230 Saint-Aubin", F("times.ttf", 28)),
    ("", None),
    ("Objet : permis de construire n° PC 045 287 26 B0031", F("timesbd.ttf", 30)),
    ("Le 14 octobre 2026", F("times.ttf", 30)),
    ("", None),
    ("Madame Durand,", F("times.ttf", 30)),
    ("Nous accusons réception de votre demande de permis de construire", F("times.ttf", 30)),
    ("déposée le 2 septembre 2026 pour l'extension de 38 m² de votre", F("times.ttf", 30)),
    ("habitation. Le dossier est incomplet : il manque le plan de masse", F("times.ttf", 30)),
    ("(pièce PCMI2) et la notice descriptive (pièce PCMI4).", F("times.ttf", 30)),
    ("Vous disposez d'un délai de trois mois pour transmettre ces pièces,", F("times.ttf", 30)),
    ("faute de quoi la demande sera rejetée tacitement.", F("times.ttf", 30)),
    ("", None),
    ("Veuillez agréer, Madame, nos salutations distinguées.", F("times.ttf", 30)),
    ("Le responsable du service, Jean-Marc Lefèvre", F("timesi.ttf", 30)),
]
y = 140
for t, f in lines:
    if f: d.text((120, y), t, fill=30, font=f)
    y += 62
img = img.rotate(1.3, resample=Image.BICUBIC, fillcolor=235, expand=False)
random.seed(1)
px = img.load()
for _ in range(60000):
    x, yy = random.randrange(W), random.randrange(H)
    px[x, yy] = max(0, min(255, px[x, yy] + random.randint(-70, 70)))
img.filter(ImageFilter.GaussianBlur(0.8)).save(f"{out}/page-scan.png")

# 2. Tableau de budget
img = Image.new("RGB", (W, 1000), "white")
d = ImageDraw.Draw(img)
d.text((80, 60), "Budget prévisionnel 2027 — Association Les Amis du Livre", fill="black", font=F("arialbd.ttf", 34))
rows = [("Poste", "T1", "T2", "T3", "T4", "Total"),
        ("Location salle", "1 200", "1 200", "1 200", "1 200", "4 800"),
        ("Achat de livres", "2 500", "800", "650", "3 100", "7 050"),
        ("Communication", "300", "450", "200", "900", "1 850"),
        ("Assurance", "620", "0", "0", "0", "620"),
        ("Total", "4 620", "2 450", "2 050", "5 200", "14 320")]
cols = [80, 420, 570, 720, 870, 1020, 1180]
y0, rh = 160, 70
for i, r in enumerate(rows):
    y = y0 + i * rh
    if i in (0, len(rows) - 1): d.rectangle([cols[0], y, cols[-1], y + rh], fill="#e8eef7")
    for j, c in enumerate(r):
        d.text((cols[j] + 12, y + 20), c, fill="black", font=F("arialbd.ttf" if i in (0, len(rows) - 1) else "arial.ttf", 26))
for i in range(len(rows) + 1): d.line([cols[0], y0 + i * rh, cols[-1], y0 + i * rh], fill="black", width=2)
for x in cols: d.line([x, y0, x, y0 + len(rows) * rh], fill="black", width=2)
d.text((80, y0 + len(rows) * rh + 30), "Montants en euros TTC.", fill="black", font=F("ariali.ttf", 24))
img.save(f"{out}/page-table.png")

# 3. Formulaire rempli
img = Image.new("RGB", (W, 1100), "white")
d = ImageDraw.Draw(img)
d.text((80, 60), "FORMULAIRE D'INSCRIPTION — Médiathèque municipale", fill="black", font=F("arialbd.ttf", 34))
hand = F("segoepr.ttf", 34) if __import__("os").path.exists("C:/Windows/Fonts/segoepr.ttf") else F("comic.ttf", 34)
fields = [("Nom", "MARTIN"), ("Prénom", "Élodie"), ("Date de naissance", "03/11/1987"),
          ("Adresse", "7 impasse des Glycines, 69007 Lyon"), ("Téléphone", "06 12 34 56 78"), ("Courriel", "e.martin@exemple.fr")]
y = 170
for k, v in fields:
    d.text((80, y), f"{k} :", fill="black", font=F("arial.ttf", 28))
    d.line([420, y + 40, 1160, y + 40], fill="#888", width=2)
    d.text((440, y - 4), v, fill="#1a3caa", font=hand)
    y += 90
d.text((80, y + 10), "Formule choisie :", fill="black", font=F("arial.ttf", 28))
opts = [("Adulte (15 €)", False), ("Famille (25 €)", True), ("Étudiant (gratuit)", False)]
x = 360
for label, checked in opts:
    d.rectangle([x, y + 12, x + 30, y + 42], outline="black", width=3)
    if checked:
        d.line([x + 4, y + 26, x + 13, y + 38], fill="#1a3caa", width=5); d.line([x + 13, y + 38, x + 30, y + 6], fill="#1a3caa", width=5)
    d.text((x + 42, y + 10), label, fill="black", font=F("arial.ttf", 28))
    x += 280
d.text((80, y + 110), "Signature :", fill="black", font=F("arial.ttf", 28))
d.text((300, y + 100), "É. Martin", fill="#1a3caa", font=hand)
img.save(f"{out}/page-form.png")
print("ok")
