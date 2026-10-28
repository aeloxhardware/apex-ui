// Libellés affichés des étapes du moteur (fenêtre de tranchage). Les étapes (identifiants et ordre) viennent de
// `main.py steps` (contrat C3) ; leur libellé est celui du moteur, sans accents (journal) : l'interface affiche
// le sien, en français correct, et retombe sur celui du moteur pour un identifiant inconnu.
const STEP_LABELS: Record<string, string> = {
  // Aujourd'hui une seule étape couvre l'import et la tétraédralisation ; dès que le moteur les sépare
  // (demande R-022), les deux libellés ci-dessous sont déjà prêts.
  ingest: 'Import et tétraédralisation du maillage triangulé',
  import: 'Import',
  tetrahedralization: 'Tétraédralisation du maillage triangulé',
  overhang: 'Détection des surplombs',
  segmentation: 'Segmentation en régions',
  field: 'Calcul du champ de couches',
  layers: 'Extraction des couches courbes',
  toolpath2d: 'Parois et remplissage',
  scheduling: 'Ordonnancement',
  machine_toolpath: 'Trajectoire machine',
  collision: 'Simulation de collision',
  adjustment: 'Ajustement des collisions',
  export: 'Écriture du G-code',
};

export function stepLabel(slug: string, engineLabel: string): string {
  return STEP_LABELS[slug] ?? engineLabel;
}
