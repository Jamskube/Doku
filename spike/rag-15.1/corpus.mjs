// Corpus de test RAG (spike 15.1) — notes personnelles FR réalistes.
// 30 notes CIBLES écrites à la main (chacune contient le fait visé par une requête de
// queries.mjs) + ~120 notes de DIVERSION générées par gabarits, à fort recouvrement lexical
// intra-domaine (le difficile est de distinguer 20 recettes entre elles, pas recette vs impôt).

export const TARGETS = [
  // --- Cuisine -------------------------------------------------------------------------
  {
    id: 'recette-crepes',
    title: 'Crêpes de la Chandeleur',
    text: `250 g de farine, 4 œufs, 50 cl de lait, une pincée de sel, 50 g de beurre fondu.

Mélanger la farine et les œufs, détendre progressivement avec le lait pour éviter les grumeaux. La pâte doit reposer au moins une heure au réfrigérateur, idéalement deux : c'est ce qui rend les crêpes souples et pas caoutchouteuses.

Cuire à feu vif dans une poêle bien chaude, légèrement graissée au papier absorbant. La première est toujours ratée, c'est la loi.`,
  },
  {
    id: 'recette-risotto',
    title: 'Risotto aux champignons',
    text: `Le point qui change tout : la variété du riz. Prendre du carnaroli de préférence — il tient mieux la cuisson que l'arborio et pardonne une minute d'inattention.

Faire suer une échalote dans l'huile d'olive, nacrer le riz deux minutes, déglacer au vin blanc sec. Ajouter le bouillon chaud louche par louche en remuant, sur 18 minutes environ. Hors du feu, mantecare : beurre froid et parmesan, couvercle deux minutes.

Les champignons (cèpes ou pleurotes) sont poêlés à part et ajoutés à la fin, sinon ils rendent leur eau dans le riz.`,
  },
  {
    id: 'recette-pain-cocotte',
    title: 'Pain en cocotte',
    text: `500 g de farine T65, 350 g d'eau, 10 g de sel, 5 g de levure sèche. Pétrissage minimal, pointage une nuit au frais.

Préchauffer le four à 240 °C avec la cocotte en fonte dedans. Cuisson : 45 minutes couvercle fermé, puis 15 minutes à découvert pour la croûte. Ne pas ouvrir avant — c'est la vapeur piégée qui fait la mie.

Laisser ressuer sur une grille au moins une heure avant de trancher, même si ça sent trop bon.`,
  },
  {
    id: 'recette-blanquette',
    title: 'Blanquette de veau de mamie',
    text: `Épaule et tendron, départ eau froide, écumer soigneusement. Carottes, oignon clouté, bouquet garni, une heure trente à frémissement.

La liaison est le moment critique : crème et jaune d'œuf mélangés hors du feu, puis incorporés au dernier moment. Ne jamais laisser bouillir après l'ajout de la liaison, sinon la sauce tranche et rien ne la rattrape.

Servir avec un riz pilaf et un peu de jus de citron pour réveiller l'ensemble.`,
  },
  {
    id: 'recette-tiramisu',
    title: 'Tiramisu classique',
    text: `3 œufs, 250 g de mascarpone, 80 g de sucre, boudoirs, café serré refroidi, cacao amer.

Jaunes blanchis avec le sucre, mascarpone incorporé, puis blancs montés ajoutés délicatement. Tremper les biscuits une seconde par face, pas plus — ils continuent de boire dans le plat.

Le vrai secret est l'attente : prévoir six heures au frais minimum, et une nuit c'est encore mieux. Le cacao seulement au moment de servir, sinon il détrempe.`,
  },
  {
    id: 'recette-confiture-abricots',
    title: 'Confiture d\'abricots de juillet',
    text: `Proportion éprouvée : 1 kg de fruits dénoyautés pour 700 g de sucre, et le jus d'un demi-citron. Macération deux heures pour faire sortir le jus.

Cuisson 25 minutes à gros bouillons en écumant. Vérifier la prise avec le test de l'assiette froide : une goutte qui se fige en plissant, c'est prêt.

Mettre en pots ébouillantés, visser, retourner cinq minutes. Garder quelques noyaux : trois amandons par pot parfument légèrement.`,
  },

  // --- Réunions / projet ---------------------------------------------------------------
  {
    id: 'cr-reunion-migration-zitadel',
    title: 'CR réunion — avenir du SSO',
    text: `Présents : Sam, Alex, Jo. Sujet : sortir de notre instance vieillissante.

Le chiffrage présenté par Alex est sans appel : la migration de Keycloak vers Zitadel est estimée entre 100 et 160 jours, en comptant la reprise des royaumes, la réécriture des mappers custom et la double authentification pendant la transition.

Décision : pas de go tant que le chiffrage n'est pas descendu sous 80 jours. Alex explore une reprise partielle (clients OIDC seuls, pas les royaumes historiques).`,
  },
  {
    id: 'cr-budget-t3',
    title: 'CR arbitrage budget — juillet',
    text: `Arbitrage rendu en comité du 8 juillet.

L'enveloppe cloud du troisième trimestre est plafonnée à 12 000 € tout compris (calcul, stockage, egress). Dépassement soumis à validation du CODIR, plus de tolérance implicite comme au T2.

Actions : étiqueter toutes les ressources d'ici fin juillet, couper les environnements de démo le week-end, revoir les instances surdimensionnées.`,
  },
  {
    id: 'cr-choix-postgres',
    title: 'CR décision — hébergement base de données',
    text: `Après trois semaines de débat, décision actée : PostgreSQL managé plutôt qu'auto-hébergé.

Motifs : les sauvegardes point-in-time et le failover automatique valent le surcoût de 40 % ; l'équipe n'a personne pour astreinte DBA. La bascule est prévue au sprint 9, avec une répétition générale sur la préproduction au sprint 8.

Jo signale que les extensions exotiques ne sont pas toutes disponibles en managé — inventaire à faire avant la bascule.`,
  },
  {
    id: 'cr-retro-onboarding',
    title: 'Rétro — arrivée des nouveaux',
    text: `Point marquant de la rétro : l'accueil technique des recrues.

Grâce au script bootstrap écrit par Sam, le temps d'installation d'un poste de nouveau développeur est passé de deux jours à trois heures, vérifié sur les deux dernières arrivées. Le script clone, configure les secrets de dev et lance la stack complète.

Reste à faire : la documentation d'architecture n'est pas à jour, les nouveaux la découvrent périmée — c'est le prochain irritant à traiter.`,
  },
  {
    id: 'cr-incident-mars',
    title: 'Post-mortem — panne du 14 mars',
    text: `Durée : 40 minutes d'indisponibilité totale, détection par les alertes de sondes externes.

Cause racine : un certificat TLS expiré sur le reverse proxy d'entrée. Le renouvellement automatique échouait silencieusement depuis trois semaines (quota API atteint), et l'alerte d'expiration partait dans un canal muet.

Correctifs : alerte à J-15 dans le canal d'astreinte, sonde dédiée sur la date d'expiration, et revue trimestrielle des renouvellements.`,
  },

  // --- Tech ----------------------------------------------------------------------------
  {
    id: 'note-backup-nas',
    title: 'Stratégie de sauvegarde',
    text: `Règle 3-2-1 appliquée à la maison : trois copies des données, sur deux supports différents, dont une hors site.

Concrètement : les documents vivent sur le portable, répliqués sur le NAS, et le NAS envoie chaque nuit à 3 h un incrément chiffré vers Backblaze B2. Restauration testée en janvier — 20 minutes pour un dossier, une nuit pour tout.

Point de vigilance : les photos du téléphone ne rentrent dans le circuit que quand l'appli de synchro tourne, penser à la relancer après les mises à jour.`,
  },
  {
    id: 'note-docker-purge',
    title: 'Docker — grand nettoyage',
    text: `Quand le disque se remplit mystérieusement, ce sont presque toujours les images et caches de build.

La commande qui récupère vraiment l'espace : docker system prune -af --volumes. Attention, le drapeau --volumes supprime aussi les volumes anonymes — vérifier qu'aucune base de dev n'y vit avant de lancer.

Pour voir qui mange quoi : docker system df -v. Les caches de build se purgent seuls avec builder prune.`,
  },
  {
    id: 'note-ssh-jump',
    title: 'SSH à travers le bastion',
    text: `Plus de tunnels à la main : tout passe par ProxyJump dans ~/.ssh/config.

Host bastion → HostName bastion.exemple.fr, User admin. Puis Host prod-* → ProxyJump bastion. Une seule commande ssh prod-web1 et la connexion traverse le bastion de façon transparente, y compris pour scp et les tunnels de port.

Les clés restent locales (agent forwarding désactivé côté bastion, c'est voulu — ne pas le réactiver).`,
  },
  {
    id: 'note-dns-ttl',
    title: 'Checklist bascule DNS',
    text: `La veille d'un changement d'enregistrements, abaisser le TTL à 300 secondes sur les entrées concernées — sinon les anciens serveurs reçoivent du trafic pendant des heures.

Le jour J : modifier les enregistrements, vérifier la propagation depuis plusieurs résolveurs publics, garder l'ancienne cible active 24 h.

Une fois la bascule confirmée, remonter le TTL à 86 400 pour soulager les résolveurs. Noter la date dans le registre des changements.`,
  },
  {
    id: 'note-win-arm',
    title: 'Windows ARM64 — binaires natifs',
    text: `Sur la Surface, toujours chercher la version aarch64 native d'un outil avant d'installer quoi que ce soit.

L'émulation x64 fonctionne étonnamment bien mais coûte environ 30 % de performances, et davantage sur les charges soutenues où la traduction ne se met plus en cache. Pour les outils de build lancés cent fois par jour, la différence se sent vraiment.

Vérifier avec le gestionnaire des tâches, colonne Architecture. Node, Git et Python existent tous en natif désormais.`,
  },
  {
    id: 'note-pg-vacuum',
    title: 'PostgreSQL — table obèse',
    text: `Une table qui a subi des millions de suppressions garde son espace mort : le VACUUM ordinaire le rend réutilisable mais ne le restitue pas au système.

Le réflexe VACUUM FULL est un piège en production : il prend un verrou exclusif et bloque toutes les écritures pendant la reconstruction. Préférer pg_repack, qui reconstruit la table en ligne avec un verrou de quelques secondes seulement en fin d'opération.

Surveiller le bloat avec l'extension pgstattuple avant de décider — parfois un simple réglage d'autovacuum suffit.`,
  },

  // --- Jardin / maison -----------------------------------------------------------------
  {
    id: 'jardin-tomates',
    title: 'Tomates — routine d\'été',
    text: `Pincer les gourmands une fois par semaine, le matin quand les tiges cassent net.

Arrosage : deux fois par semaine copieusement, toujours au pied. Ne jamais mouiller le feuillage — l'humidité sur les feuilles est la porte d'entrée du mildiou, surtout les étés orageux.

Paillage épais renouvelé en juillet, et retirer les feuilles basses qui touchent le sol pour la même raison.`,
  },
  {
    id: 'jardin-compost',
    title: 'Compost qui sent bon',
    text: `L'équilibre qui marche : un tiers de matières vertes (épluchures, tontes) pour deux tiers de brunes (feuilles mortes, carton brut, broyat).

Trop de vert = odeur d'ammoniac et jus ; trop de brun = tas inerte. Retourner toutes les trois semaines pour l'aération, arroser seulement si une poignée pressée ne rend aucune goutte.

Éviter : agrumes en masse, viande, plantes malades. Le tas doit chauffer au centre — signe que ça travaille.`,
  },
  {
    id: 'maison-chauffe-eau',
    title: 'Entretien du ballon d\'eau chaude',
    text: `Régler le thermostat à 55 °C : en dessous de 50 la légionelle prospère, au-dessus de 60 on s'ébouillante et ça entartre plus vite.

Le groupe de sécurité doit être manœuvré une fois par mois (tourner la molette jusqu'à l'écoulement) pour éviter qu'il ne se bloque au tartre. S'il goutte en permanence hors chauffe, c'est lui qu'il faut changer — 30 € et une heure de travail.

Vidange complète et contrôle de l'anode tous les deux ans.`,
  },
  {
    id: 'maison-isolation-combles',
    title: 'Isolation des combles — bilan',
    text: `Chantier réalisé en octobre 2025 par l'entreprise Iso+ : 30 cm de ouate de cellulose soufflée sur le plancher des combles perdus, résistance thermique R = 7.

Coût total : 2 800 € pose comprise, avant déduction de la prime. Ressenti immédiat : la chambre du haut ne surchauffe plus l'après-midi, et la chaudière se déclenche visiblement moins.

Penser à re-vérifier l'épaisseur dans deux ans, la ouate tasse un peu.`,
  },

  // --- Voyages -------------------------------------------------------------------------
  {
    id: 'voyage-japon-jr',
    title: 'Japon — trains et pass',
    text: `Verdict après simulation des trajets : le JR Pass 14 jours n'est rentable qu'à partir de trois allers longs en shinkansen. Notre itinéraire Tokyo–Kyoto–Hiroshima–Tokyo passe tout juste le seuil.

L'échange du voucher se fait en gare — celle d'Ueno a le guichet le moins chargé le matin. Réserver les places assises dès l'échange pour les trajets du week-end.

Pour les trajets locaux, la carte Suica sur le téléphone suffit et se recharge partout.`,
  },
  {
    id: 'voyage-lisbonne',
    title: 'Lisbonne — carnet pratique',
    text: `Le tram 28 : y monter dès 8 h du matin au départ de Martim Moniz, avant les groupes — après 10 h c'est une boîte de sardines à pickpockets.

Pour les pasteis de nata, faire le déplacement jusqu'à Belém : la file avance vite et la version tiède saupoudrée de cannelle n'a rien à voir avec celles du centre.

Miradouro de Santa Catarina au coucher du soleil, puis remonter dîner au Bairro Alto.`,
  },
  {
    id: 'voyage-ecosse-distances',
    title: 'Écosse — leçons de conduite',
    text: `Grande leçon du voyage : ne pas se fier aux distances. Édimbourg–Skye affiché 3 h par le GPS, réellement 5 h 30 en comptant les routes single track, les moutons et les arrêts photo impossibles à refuser.

Prévoir la moitié des kilomètres qu'on ferait en France sur une journée. Faire le plein avant les Highlands, les stations se raréfient.

La conduite à gauche s'oublie surtout aux ronds-points et en sortant des parkings — le passager doit surveiller.`,
  },
  {
    id: 'voyage-assurance',
    title: 'Assurance voyage — ce qui est déjà couvert',
    text: `Vérifié auprès de la banque avant de souscrire quoi que ce soit : la carte Visa Premier couvre les frais médicaux et le rapatriement pendant les 90 premiers jours d'un séjour à l'étranger, pour le porteur et sa famille voyageant ensemble.

Condition : le voyage doit avoir été payé au moins en partie avec la carte. Au-delà de 90 jours, ou pour les sports à risque, souscrire une assurance dédiée type Chapka.

Garder le numéro du plateau d'assistance dans le téléphone ET sur papier.`,
  },

  // --- Santé / admin / divers ----------------------------------------------------------
  {
    id: 'sante-course-plan',
    title: 'Course — reprendre sans se blesser',
    text: `La règle d'or apprise à mes dépens : augmenter le volume hebdomadaire de 10 % par semaine maximum, pas davantage, même quand les jambes en redemandent.

Structure qui fonctionne : trois sorties dont une longue le dimanche, et une semaine allégée toutes les quatre semaines pour absorber la charge.

Le tibia qui tire n'est pas une courbature : c'est le signal de lever le pied immédiatement, pas dans une semaine.`,
  },
  {
    id: 'admin-impots-teletravail',
    title: 'Impôts — frais de télétravail',
    text: `Pour la déclaration 2025 : l'allocation forfaitaire de télétravail est exonérée à hauteur de 2,60 € par jour, plafonnée à 626 € par an.

Si l'employeur ne verse rien, on peut déduire ses frais réels de télétravail (quote-part d'électricité, internet, mobilier) à condition de renoncer à l'abattement de 10 % — faire le calcul, rarement gagnant en dessous de 1 500 € de frais.

Garder les factures trois ans en cas de contrôle.`,
  },
  {
    id: 'admin-prelevement-source',
    title: 'Prélèvement à la source — mise à jour',
    text: `Suite à la déclaration de printemps, le taux de prélèvement passe à 8,1 % à partir de septembre (contre 7,4 % actuellement).

Le simulateur d'impots.gouv permet de moduler en cours d'année si les revenus changent de plus de 5 % — utile en cas de prime exceptionnelle pour éviter la régularisation brutale l'été suivant.

Vérifier la première fiche de paie de septembre pour confirmer l'application du nouveau taux.`,
  },
  {
    id: 'lecture-notes-sf',
    title: 'Lu — Un souvenir nommé empire',
    text: `Terminé en trois soirs. Ce qui reste : l'idée que la poésie fonctionne comme protocole diplomatique — les ambassadeurs de Teixcalaan négocient en citations et allusions, et l'héroïne survit parce qu'elle maîtrise le corpus littéraire mieux que les natifs.

La mémoire implantée d'imago pose la vraie question du livre : qui parle quand je parle ?

À prêter à Claire, elle qui aime les intrigues de cour. La suite est achetée, à garder pour les vacances.`,
  },
  {
    id: 'idee-app-plantes',
    title: 'Idée en vrac — plantes d\'intérieur',
    text: `Constat : toutes les applis de plantes envoient des rappels d'arrosage au calendrier fixe, et on arrose par obéissance des plantes qui n'ont pas soif.

L'idée : brancher le rappel sur l'hygrométrie réelle mesurée par un petit capteur dans le pot — notification seulement quand la terre est effectivement sèche, avec l'historique par plante.

À creuser : coût du capteur (viser moins de 10 €), appairage sans appli propriétaire, et le mode « je pars deux semaines ».`,
  },
]

// --- Diversion : gabarits à fort recouvrement lexical intra-domaine ---------------------
const R = (arr, i) => arr[i % arr.length]

const PLATS = ['tajine de poulet aux citrons confits', 'gratin dauphinois', 'soupe à l\'oignon gratinée', 'quiche lorraine', 'bœuf bourguignon', 'pâtes à la carbonara', 'salade niçoise', 'houmous maison', 'poulet basquaise', 'ratatouille du dimanche', 'chili sin carne', 'velouté de potimarron', 'gnocchis au beurre de sauge', 'curry de légumes au lait de coco', 'clafoutis aux cerises', 'tarte fine aux pommes', 'granola du matin', 'pesto de basilic', 'soupe de lentilles corail', 'gaspacho andalou']
const INGREDIENTS = ['oignons', 'ail et persil', 'tomates bien mûres', 'crème entière', 'lardons fumés', 'parmesan', 'huile d\'olive', 'thym frais', 'beurre demi-sel', 'citron']
const ASTUCES = ['saler en fin de cuisson seulement', 'laisser reposer avant de servir', 'goûter et rectifier l\'assaisonnement', 'préparer la veille, c\'est meilleur réchauffé', 'utiliser une poêle bien chaude', 'ne pas surcharger la casserole']

const SUJETS_CR = ['la refonte du tableau de bord', 'la dette technique du module de facturation', 'les alertes de supervision', 'le passage en revue des accès', 'la roadmap du second semestre', 'la migration du CI', 'les entretiens annuels', 'le plan de charge d\'août', 'la mise à jour de Keycloak en 24.x', 'les quotas d\'API du partenaire', 'la préparation de la démo client', 'le nettoyage des environnements', 'la rotation des secrets', 'le renouvellement des licences', 'l\'audit d\'accessibilité', 'la campagne de tests de charge', 'le tri du backlog support', 'la montée de version du framework', 'la charte des astreintes', 'le point sécurité mensuel']
const DECISIONS_CR = ['reporté au prochain sprint', 'validé sous réserve de chiffrage', 'confié à l\'équipe plateforme', 'découpé en deux lots', 'mis en pause faute de bande passante', 'accepté à l\'unanimité']

const OUTILS = ['nginx', 'certbot et le renouvellement des certificats', 'git rebase', 'les alias du shell', 'tmux', 'vim et ses registres', 'systemd et les timers', 'fail2ban', 'rsync', 'les clés GPG', 'wireguard', 'htop et la charge', 'cron et les logs', 'jq pour le JSON', 'curl et ses options', 'les variables d\'environnement', 'le pare-feu ufw', 'logrotate', 'les conteneurs de dev', 'les hooks de pre-commit', 'le cache npm', 'les migrations de schéma', 'l\'éditeur de config réseau', 'la rotation des tokens', 'le proxy d\'entreprise']
const CONSEILS_TECH = ['toujours tester sur un environnement jetable d\'abord', 'noter la commande exacte dans ce fichier', 'lire le log avant de relancer', 'faire une copie du fichier de conf avant de toucher', 'vérifier la version installée, la doc en ligne est souvent en avance', 'un redémarrage du service suffit souvent']

const JARDIN_SUJETS = ['les semis de printemps', 'la taille des rosiers', 'le paillage des massifs', 'les courgettes envahissantes', 'le récupérateur d\'eau de pluie', 'la pelouse en été', 'les bulbes d\'automne', 'la haie de charmilles', 'les fraisiers en jardinière', 'les aromatiques sur le balcon', 'le figuier du fond', 'les limaces après la pluie', 'la serre froide', 'le potager en carrés', 'les auxiliaires du jardin']
const MAISON_SUJETS = ['le joint de la douche', 'la VMC qui siffle', 'le portail qui grince', 'les gouttières d\'automne', 'la peinture de la chambre', 'le radiateur qui chauffe mal', 'la chasse d\'eau qui fuit', 'les joints des fenêtres', 'la terrasse à déverdir', 'le grenier à ranger']

const DESTINATIONS = ['Rome en trois jours', 'les Cinque Terre', 'Copenhague à vélo', 'les Açores', 'Séville en avril', 'la côte amalfitaine', 'Prague hors saison', 'les fjords norvégiens', 'Montréal en hiver', 'la Crète de l\'ouest', 'Porto et la vallée du Douro', 'les Dolomites', 'Budapest et ses bains', 'la Sicile en voiture', 'Amsterdam sans musées']
const VOYAGE_CONSEILS = ['réserver les visites incontournables en ligne', 'éviter le centre pour dormir', 'prendre les transports en commun dès l\'aéroport', 'goûter la spécialité locale au marché plutôt qu\'au restaurant', 'partir tôt le matin pour les sites connus', 'garder une journée sans rien de prévu']

const DIVERS_SUJETS = ['le budget des courses du mois', 'la mutuelle à comparer', 'le contrat d\'électricité', 'les étirements du soir', 'le club de lecture', 'la liste des films à voir', 'le vélo à réviser', 'les cadeaux d\'anniversaire', 'le tri des papiers', 'la cave à ranger', 'le renouvellement du passeport', 'les photos de l\'année à trier', 'le régime sans sucre du soir', 'la natation du jeudi', 'le cours de dessin']

function fillers() {
  const notes = []
  PLATS.forEach((plat, i) => notes.push({
    id: `filler-cuisine-${i}`,
    title: `Recette — ${plat}`,
    text: `Recette testée et approuvée de ${plat}. Faire revenir les ${R(INGREDIENTS, i)} avec les ${R(INGREDIENTS, i + 3)}, ajouter le reste et laisser mijoter à feu doux le temps qu'il faut.\n\nAstuce retenue : ${R(ASTUCES, i)}. Et comme toujours, ${R(ASTUCES, i + 2)}.\n\nServi dimanche dernier, tout le monde a repris deux fois. À refaire avec un peu plus de ${R(INGREDIENTS, i + 5)} la prochaine fois.`,
  }))
  SUJETS_CR.forEach((sujet, i) => notes.push({
    id: `filler-cr-${i}`,
    title: `CR réunion — ${sujet}`,
    text: `Réunion d'équipe du sprint ${14 + (i % 9)}. Sujet principal : ${sujet}.\n\nDiscussion animée sur la priorité par rapport au reste du backlog, la vélocité de l'équipe étant déjà bien entamée par le support. Le chiffrage reste à affiner, plusieurs zones d'ombre sur l'estimation.\n\nDécision : ${R(DECISIONS_CR, i)}. Prochain point au sprint suivant, avec un ordre du jour resserré.`,
  }))
  OUTILS.forEach((outil, i) => notes.push({
    id: `filler-tech-${i}`,
    title: `Note technique — ${outil}`,
    text: `Pense-bête sur ${outil}, après y avoir encore perdu une soirée.\n\nLa configuration qui fonctionne est notée ci-dessous, avec les options exactes et le chemin des fichiers. Le piège classique est de modifier le mauvais fichier ou d'oublier de recharger le service après coup.\n\nÀ retenir : ${R(CONSEILS_TECH, i)}. Et ${R(CONSEILS_TECH, i + 1)}.`,
  }))
  JARDIN_SUJETS.forEach((sujet, i) => notes.push({
    id: `filler-jardin-${i}`,
    title: `Jardin — ${sujet}`,
    text: `Où j'en suis avec ${sujet} cette saison.\n\nAprès l'échec de l'an dernier, changement de méthode : observer avant d'agir, arroser moins mais mieux, et noter ici les dates pour comparer d'une année sur l'autre.\n\nProchaine étape le week-end prochain si la météo le permet. Penser à racheter du terreau et vérifier les gants.`,
  }))
  MAISON_SUJETS.forEach((sujet, i) => notes.push({
    id: `filler-maison-${i}`,
    title: `Maison — ${sujet}`,
    text: `À traiter : ${sujet}. Le problème traîne depuis un moment et ça commence à se voir.\n\nDevis ou bricolage maison ? Un tour sur les forums suggère que c'est faisable soi-même avec les bons outils, en comptant une demi-journée et un aller-retour au magasin de bricolage.\n\nÀ planifier un samedi matin, avec la liste de courses préparée la veille.`,
  }))
  DESTINATIONS.forEach((dest, i) => notes.push({
    id: `filler-voyage-${i}`,
    title: `Idée voyage — ${dest}`,
    text: `Repérage pour ${dest}, peut-être pour le prochain long week-end.\n\nBudget estimé à la grosse louche en regardant les vols et deux ou trois hébergements. La bonne saison semble être hors vacances scolaires, évidemment.\n\nConseil glané : ${R(VOYAGE_CONSEILS, i)}. Et ${R(VOYAGE_CONSEILS, i + 2)}. À creuser avec l'autre moitié avant de réserver quoi que ce soit.`,
  }))
  DIVERS_SUJETS.forEach((sujet, i) => notes.push({
    id: `filler-divers-${i}`,
    title: `À faire — ${sujet}`,
    text: `Note rapide sur ${sujet}, avant que ça sorte de la tête.\n\nCe n'est pas urgent mais ça s'accumule, et chaque fois que j'y pense ce n'est jamais le bon moment. Fixer une échéance réaliste plutôt qu'un vague « bientôt ».\n\nDécision : traiter avant la fin du mois, quitte à y passer une soirée. Mettre un rappel.`,
  }))
  return notes
}

// Corpus de QUALITÉ : cibles + diversion (~150 notes, échelle 10²).
export function buildCorpus() {
  return [...TARGETS, ...fillers()]
}

// Corpus d'ÉCHELLE (perf d'indexation seulement) : réplique la diversion avec variantes
// jusqu'à `total` notes (échelle 10³). Les métriques de qualité ne s'y mesurent PAS.
export function buildScaledCorpus(total = 1000) {
  const base = buildCorpus()
  const out = [...base]
  let k = 0
  while (out.length < total) {
    const src = base[30 + (k % (base.length - 30))] // ne réplique que la diversion
    out.push({ id: `${src.id}-v${Math.floor(k / (base.length - 30)) + 2}`, title: `${src.title} (bis)`, text: src.text })
    k++
  }
  return out
}
