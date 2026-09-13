export interface SlicingStep {
  slug: string;
  label: string;
}

// Ordre = ordre logique du pipeline de tranchage.
export const SLICING_STEPS: SlicingStep[] = [
  { slug: '01-lancement-reseau-programmes', label: 'Lancement du réseau de programmes' },
  { slug: '02-import', label: 'Import' },
  { slug: '03-lecture-fichier-maillage', label: 'Lecture du fichier de maillage' },
  { slug: '04-tetraedralisation-maillage-triangule', label: 'Tétraédralisation du maillage triangulé' },
  { slug: '05-definition-champ-scalaire', label: 'Définition du champ scalaire' },
  { slug: '06-champ-normales', label: 'Champ de normales' },
  { slug: '07-champs-deformation', label: 'Champs de déformation' },
  { slug: '08-encartage', label: 'Encartage' },
  { slug: '09-deformation-maillage-tetraedrique', label: 'Déformation du maillage tétraédrique' },
  { slug: '10-detetraedralisation-retriangulation-maillage-deforme', label: 'Dététraédralisation et retriangulation du maillage déformé' },
  { slug: '11-generation-couches-porte-a-faux', label: 'Génération des couches en porte-à-faux' },
  { slug: '12-generation-schemas-remplissage-3d-dynamiques', label: 'Génération des schémas de remplissage tridimensionnels dynamiques' },
  { slug: '13-generation-supports', label: 'Génération des supports' },
  { slug: '14-trajectoires', label: 'Trajectoires' },
  { slug: '15-ordonnancement', label: 'Ordonnancement' },
  { slug: '16-vecteurs-buse', label: 'Vecteurs buse' },
  { slug: '17-conversion-cinematique', label: 'Conversion cinématique' },
  { slug: '18-gestion-singularites-division-zero', label: 'Gestion des occurrences de singularité et réglage des erreurs de division par zéro' },
  { slug: '19-deballage', label: 'Déballage' },
  { slug: '20-interpolation', label: 'Interpolation' },
  { slug: '21-lissage', label: 'Lissage' },
  { slug: '22-calcul-debits-extrusion', label: "Calcul des débits d'extrusion" },
  { slug: '23-execution-tests-collision', label: 'Exécution des tests de collision' },
  { slug: '24-generation-fichier-gcode', label: 'Génération du fichier G-Code' },
  { slug: '25-succes-operation', label: "Succès de l'opération" },
  { slug: '26-chargement-previsualisation', label: 'Chargement de la prévisualisation en cours' },
];
