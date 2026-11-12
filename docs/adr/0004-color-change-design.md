# ADR 0004 — Le changement de couleur : l'interface décrit, le moteur génère

Date : 2026-11-11. Demande de l'utilisateur : concevoir la génération de G-code avec changement de couleur.

**Contexte.** L'AMS de l'interface (slots, profils de filament, copies utilisateur) décrit déjà quelle matière est où. Le G-code, lui, est
écrit par le moteur ; l'interface sait l'éditer (noyau d'édition) et l'afficher (`gcodeParse.ts`), pas le tranchage. Règle 6 de CLAUDE.md :
aucune constante de machine dans l'interface.

**Décision.**
1. Le slot 1 de l'AMS est le **filament actif** (`apex.filament`) ; l'ordre de l'AMS fait foi pour les numéros d'outil (`T(slot − 1)`).
2. L'interface **ne génère pas** de changement de couleur dans un tranchage : elle envoie au moteur la liste des slots, les changements et
   les affectations, et lit en retour des marqueurs en commentaire. Contrat dans `docs/COLOR_CHANGE.md` §4 et §5, à déposer comme demande
   dans `apex/integration/REQUESTS.md`.
3. Les commandes de changement (`M600`, `T<n>`, séquences de machine) et les volumes de purge sont des **données du profil
   d'imprimante** (`apex.multi_material`), `null` tant qu'elles ne sont pas sourcées : jamais deviné.
4. Un **post-traitement** dans l'onglet d'édition insère un changement dans un G-code existant (copie à l'export, fichier d'origine
   intact), protégé par les tests d'aller-retour du parseur et de l'écriveur.

**Conséquences.** Le mode manuel (M600) peut avancer sans le moteur ; les modes à changement d'outil et à purge attendent le contrat. Une
imprimante sans bloc `multi_material` reste mono-matière. Rien de ce qui précède n'est implémenté côté G-code à la date de cet ADR.
