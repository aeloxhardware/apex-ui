#pragma once
// Noyau d'edition d'un G-code polaire par poignees (espace Previsualisation, onglet Edition).
// Voir CLAUDE.md, section « G-code editing: handle-based deformation ».
//
// Conventions (identiques au rendu, gcodeParse.ts / gcodeLayer.ts) :
//  - entree firmware par point : R (mm, pivot de l'axe B), C (degres, JAMAIS replie modulo 360),
//    Z (mm, calé sur la pointe a B = 0), B (degres, tete penchee vers +R) ;
//  - pointe de buse : r' = R - L sin B, z' = Z + L (1 - cos B), L = pivot_mm ;
//  - repere plateau du noyau : DROIT, z vers le haut, pointe = (r' cos C, r' sin C, z'), axe de
//    tete (pointe -> pivot) = (sin B cos C, sin B sin C, cos B). Babylon (y vers le haut, main
//    gauche) correspond a (x, z, y) : une rotation Babylon d'angle t autour de (ux, uy, uz) est
//    ici une rotation d'angle -t autour de (ux, uz, uy) ;
//  - extruding[k] : le segment k-1 -> k depose de la matiere (k = 0 ignore). L'ordre des points
//    est l'ordre de depot.
//  - e[k] : extrusion du segment k-1 -> k (mm de filament, delta E du fichier). Recalculee apres
//    deformation au prorata du volume depose : longueur du segment x epaisseur locale.
//  - valeurs par point echangees avec l'interface : kValuesPerPoint = R, C, Z, B, E.
//
// « Couches » n'existent pas en 5 axes : le voisinage traverse les TRAJECTOIRES ADJACENTES,
// c'est-a-dire les points deposes avant (qui portent) et apres (qui reposent dessus). Le noyau en
// tire un graphe de contacts : chaque point retient ses kSupportSlots supports les plus proches
// (anterieurs, sous sa tete dans un cone, a moins de support_radius_mm).
//
// L'OBJET GARDE SA FORME, seule celle des couches change (decision de l'utilisateur, 2026-10-06) :
//  - les points poses sur le plateau et ceux de la surface libre (rien ne repose dessus) sont fixes ;
//    le poids s'annule en s'en approchant, au prorata de la profondeur dans le graphe de contacts
//    (le long de l'empilement) rapportee a celle du noeud ;
//  - les points de COQUE (trajectoires sans matiere d'un cote, dans leur couche) glissent sur la
//    paroi : la composante de leur deplacement normale a la paroi est retiree (plan tangent) ;
//  - l'epaisseur locale reste entre min_layer_mm et max_layer_mm : la translation demandee est
//    freinee en approchant la limite, vitesse relative 1 - x / x_lim (0 a la limite) ; une couche
//    deja a moins de kLayerTolerance d'une borne garde cette tolerance (sinon elle figerait tout) ;
//  - glissement le long de l'empilement (sens non nul, cf. drag_direction) : chaque point avance
//    le long de SON axe de tete de w * tau (tau = translation le long de l'axe du noeud), les couches
//    inclinees d'un coude restent coherentes ; la part laterale de la translation ne deplace que
//    l'interieur (w * T_lat), les coques restent sur leur paroi.
#include <cstddef>
#include <algorithm>
#include <cstdint>
#include <vector>

namespace apex::edit {

struct Vec3 {
  double x = 0.0, y = 0.0, z = 0.0;
};

enum class Falloff : uint8_t { Linear = 0, Gaussian = 1, Cubic = 2, Plateau = 3 };
enum class Combine : uint8_t { Product = 0, Max = 1 };
// Recalcul de E : desactive (E d'origine garde) ou automatique (volume conserve).
enum class ExtrusionMode : uint8_t { Off = 0, Auto = 1 };

constexpr int kValuesPerPoint = 5;  // R, C, Z, B, E

// Decroissance sur x normalise : 1 pour x <= 0, 0 pour x >= 1 (et pour NaN). Lineaire et cubique
// reprennent core/constraints.py du moteur ; le gaussien exp(-4x^2) y est renormalise pour tomber
// EXACTEMENT a 0 au bord (le saut de 1,8 % du moteur ferait une marche visible sur une
// deformation de plusieurs millimetres). Plateau : 1 jusqu'a x = 0,5, puis cubique.
double falloff(Falloff kind, double x);

struct DistanceMetric {
  bool enabled = false;
  double radius_mm = 5.0;
  Falloff falloff = Falloff::Cubic;
};

struct AdjacencyMetric {
  bool enabled = false;
  bool before = true;   // trajectoires deposees avant (supports)
  bool after = true;    // trajectoires deposees apres (qui reposent dessus)
  uint32_t hops_before = 3;
  uint32_t hops_after = 3;
  Falloff falloff = Falloff::Linear;
};

// Portee preferentielle de la metrique 3D dans une direction (poignee du noeud d'edition, comme
// la tangente d'un editeur de Bezier : sa longueur fixe la portee, son orientation le sens).
struct DirectionalReach {
  Vec3 direction;          // unitaire (normalisee en interne), repere plateau du noyau
  double reach_mm = 0.0;
};

// Point d'ancrage (poignee verrouillee) : la matiere y reste fixe, le poids s'annule en
// s'approchant du point (lissage sur radius_mm).
struct Anchor {
  Vec3 point;
  double radius_mm = 1.0;
};

// Chaque metrique activee donne un facteur dans [0, 1]. Produit : les metriques se RESTREIGNENT
// (intersection) ; maximum : elles s'ETENDENT (union). Aucune metrique : seule la poignee bouge.
struct InfluenceParams {
  DistanceMetric spatial{true, 5.0, Falloff::Cubic};   // distance 3D a la poignee
  DistanceMetric along{false, 10.0, Falloff::Cubic};   // abscisse curviligne le long des cordons
  AdjacencyMetric adjacency{};                         // nombre de trajectoires adjacentes franchies
  Combine combine = Combine::Product;
  // Metrique 3D anisotrope : portee dans la direction u = max(spatial.radius_mm,
  // max_i reach_i * max(0, u . dir_i)^direction_sharpness). Vide : sphere de rayon spatial.radius_mm.
  std::vector<DirectionalReach> directions;
  double direction_sharpness = 2.0;
  std::vector<Anchor> anchors;
  // E d'un segment touche : automatique = E x (longueur x epaisseur apres) / (longueur x epaisseur
  // avant) ; le facteur manuel amplifie la correction : E x (1 + facteur x (rapport - 1)).
  ExtrusionMode extrusion = ExtrusionMode::Auto;
  double extrusion_factor = 1.0;
  // L'objet garde sa forme (plateau et surface libre fixes, coques glissantes, epaisseur bornee
  // avec freinage). Desactive : deformation rigide ponderee seule (tests du mecanisme).
  bool keep_shape = true;
  // Sens du glissement (repere du noyau ; nul : inconnu). Le long de l'axe de tete du noeud, le
  // poids entre plateau et noeud (et entre noeud et surface) croit selon la MARGE d'epaisseur des
  // couches traversees, pas selon la distance : une couche deja a sa limite ne se deforme plus,
  // les autres absorbent, et toutes atteignent leur limite ensemble.
  Vec3 drag_direction;
  // Lissage automatique de B apres deformation (option) : 0 = aucun, 1 = fort. Chaque point touche
  // (hors poignee) rapproche son B de la moyenne de ses voisins le long du cordon, au prorata de son
  // poids ; la pointe ne bouge pas (R et Z sont recalcules pour la garder en place).
  double smooth_b = 0.0;
  uint32_t smooth_b_iterations = 8;
  // Barriere d'influence : seuls les points de MEME TYPE DE LIGNE que la poignee (set_types) se deforment.
  bool type_barrier = false;
  // Rognage (specification du 2026-10-06, revue le 2026-10-07) : seules la couche de la poignee et
  // `layers` couches au-dessus et au-dessous (trajectoires adjacentes franchies) se deforment ; la
  // matiere fixe ne freine pas la deformation : les trajectoires fixes que la matiere deplacee envahit
  // (cordon de la matiere deplacee, balaye de sa position d'origine a sa position deformee, qui
  // recouvre le leur) sont rognees, leur extrusion est supprimee. `clearance_mm` : demi-recouvrement
  // lateral retenu (defaut : 0,9 x largeur de cordon). Le plateau reste fixe ; la surface libre, non.
  struct Trim {
    bool enabled = false;
    uint32_t layers = 0;
    double clearance_mm = -1.0;
  } trim;
  // Re-tranchage (decision de l'utilisateur, 2026-10-07) : la borne maximale d'epaisseur ne freine plus
  // l'etirement (jusqu'a reslice_max_layers couches inserees par intervalle) ; a la validation, les
  // couches dont l'epaisseur depasse le maximum sont subdivisees par des couches INTERPOLEES entre le
  // point et son support (passes partielles inserees dans le fichier, cf. ResliceInsert). Ignore avec
  // le rognage ou sans keep_shape.
  bool reslice = false;
  uint32_t reslice_max_layers = 4;
};

// Portee de la metrique 3D dans la direction de `offset` (offset = point - poignee).
double spatial_reach(const InfluenceParams& p, const Vec3& offset);
// Facteur d'ancrage dans [0, 1] : 0 sur un ancrage, 1 au-dela de son rayon.
double anchor_factor(const InfluenceParams& p, const Vec3& point);

struct KernelParams {
  double pivot_mm = 46.0;                // DOIT etre celui du rendu (NOZZLE_PIVOT_MM)
  double min_layer_mm = 0.06;            // epaisseur minimale (profil d'imprimante)
  double max_layer_mm = 0.3;             // epaisseur maximale (profil d'imprimante)
  // Largeur variable : une couche peut descendre jusqu'a min_layer_mm / width_factor, son cordon
  // s'elargissant (jusqu'a width_factor x la largeur nominale) pour garder au moins la section de
  // min_layer_mm x largeur. 1 : desactive (bornes strictes).
  double width_factor = 1.0;
  double support_radius_mm = 0.5;        // ~2,5 hauteurs de couche
  double support_cone_deg = 60.0;        // angle max entre (point - support) et l'axe de tete
  double bead_width_mm = 0.45;           // largeur de cordon (rognage : recouvrement lateral)
  double lift_mm = 1.0;                  // degagement des deplacements a vide des couches inserees (re-tranchage)
  double reslice_min_run_mm = 2.0;       // longueur minimale d'une passe partielle inseree (sauf epaisseur > 1,5 x le maximum)
  double closed_loop_tolerance_mm = 0.05;
  double grid_margin_mm = 10.0;          // marge de la grille pour la matiere deplacee
  unsigned threads = 0;                  // 0 : std::thread::hardware_concurrency()
};

struct Transform {
  Vec3 translation;          // mm, repere plateau du noyau
  Vec3 axis{0.0, 0.0, 1.0};  // axe de rotation (normalise en interne), passant par la poignee
  double angle_rad = 0.0;
};

struct LoadStats {
  double geometry_ms = 0.0, grid_ms = 0.0, supports_ms = 0.0, total_ms = 0.0;
  size_t points = 0, pass_points = 0, passes = 0, cells = 0, support_edges = 0;
  double cell_mm = 0.0;
};

constexpr uint32_t kNoIndex = 0xFFFFFFFFu;
constexpr int kSupportSlots = 4;

// Points inseres dans la trajectoire (re-tranchage) : `at` = indice du premier point inséré DANS L'ETAT
// APRES insertion, `values` kValuesPerPoint par point (R, C, Z, B, E), `extruding` : le segment qui arrive
// au point depose. Les blocs d'une meme operation sont donnes par `at` croissant.
struct InsertBlock {
  uint32_t at = 0;
  std::vector<double> values;
  std::vector<uint8_t> extruding;
  size_t count() const { return extruding.size(); }
};

// Dernier changement de topologie (commit, annulation, retablissement) : `inserted` vrai = blocs inseres,
// faux = blocs retires. Les indices de `last_indices()` sont toujours ceux de l'etat AVEC les blocs ; a
// l'insertion, inserer avant d'appliquer les valeurs, au retrait, appliquer les valeurs avant de retirer.
struct Splice {
  bool inserted = false;
  std::vector<InsertBlock> blocks;
};

// Pourquoi set_handle refuse un point.
enum class HandleRefusal : uint8_t { None = 0, Invalid = 1, Locked = 2, Plate = 3, Surface = 4 };

// Freinage de la translation : limite a s fois la translation demandee (s infini : aucune limite).
// Integrale de la vitesse relative 1 - x / x_lim : rendu s (1 - exp(-1 / s)), dans [0, 1).
double brake_factor(double limit_scale);

// --- Validation physique (CLAUDE.md, « Physical validity ») : calculee ici, jamais en TypeScript.
// Limites de la machine (profil d'imprimante lisible par l'interface : defauts = machine actuelle,
// slicer_engine/main.py::_default_machine_profile) et reglages du controle de collision.
struct MachineLimits {
  double b_min_deg = 0.0, b_max_deg = 185.0;
  double b_speed_deg_s = 1666.7;       // vitesse angulaire maximale de B
  double b_accel_deg_s2 = 1300.0;      // acceleration angulaire maximale de B
  double plate_radius_mm = 150.0;      // plateau : disque de rayon donne, surface a z = 0
  double collision_margin_mm = 1.0;    // marge de securite tete / plateau
  // Tete / matiere deja deposee : le modele de tete est exact, effleurer ou mordre un peu la couche n'est pas un
  // choc (mesure sur deux G-code : contacts a marge 0 jusqu'a 0,18 mm).
  // Deux tolerances de recouvrement avec la matiere deja deposee (decision de l'utilisateur, 2026-10-27) :
  //  - zone de la buse (echantillons a moins de nozzle_zone_mm de la pointe) : on tolere 0,18 mm, la marge
  //    nominale etant 0 (surface du cordon) ;
  //  - reste de la tete : on tolere 0,7 mm sur la marge de securite nominale (collision_margin_mm = 1 mm),
  //    donc la tete garde 0,3 mm de la surface des cordons.
  double nozzle_tolerance_mm = 0.18;
  double body_tolerance_mm = 0.7;
  double nozzle_zone_mm = 10.0;
  double bead_radius_mm = 0.2;         // rayon d'un cordon (moitie du diametre de buse)
  double contact_clearance_mm = 3.0;   // echantillons de la tete a moins de ca de la pointe : ignores
  double pose_spacing_mm = 2.0;        // une pose de tete tous les 2 mm de trajet (comme l'etape 9 du moteur)
  double densify_step_mm = 0.25;       // pas de densification des cordons (comme le moteur)
  size_t max_poses = 400000;           // poses de tete testees au plus (echantillonnage regulier)
};

enum ViolationBit : uint8_t {
  kViolationBRange = 1,
  kViolationBSpeed = 2,
  kViolationBAccel = 4,
  kViolationHeadPart = 8,    // tete contre matiere deja deposee
  kViolationHeadPlate = 16,  // tete contre le plateau
};

struct Validation {
  // Points juges, indices croissants : points touches puis les points qui les suivent (leur segment
  // d'arrivee change). Tableaux paralleles.
  std::vector<uint32_t> indices;
  std::vector<uint8_t> flags;           // ViolationBit
  std::vector<float> normal_deviation;  // degres entre l'axe de tete et la normale de couche ; NaN : inconnue
  size_t b_range = 0, b_speed = 0, b_accel = 0, head_part = 0, head_plate = 0;  // nombre de points
  size_t poses_tested = 0;
  bool collision_checked = false;       // faux sans modele de tete (set_head_samples)
  bool timing_known = false;            // faux sans temps par mouvement (set_times)
};

class EditKernel {
 public:
  // `e` peut etre nul (extrusions inconnues : 0, rien a recalculer).
  LoadStats load(size_t n, const double* r, const double* c, const double* z, const double* b,
                 const double* e, const uint8_t* extruding, const KernelParams& params);

  size_t size() const { return r_.size(); }
  const KernelParams& params() const { return params_; }

  // Temps machine cumule a l'arrivee de chaque mouvement (s, taille = nombre de points) : vitesse et
  // acceleration de B. Facultatif ; sans lui, seule la plage de B est controlee.
  void set_times(const double* times, size_t count);
  // Type de ligne de chaque point (indice d'une enumeration de l'interface) : barriere d'influence.
  void set_types(const uint8_t* types, size_t count);
  // Point de matiere le plus proche de `p` a moins de `max_distance_mm` (kNoIndex : aucun). Symetries.
  uint32_t nearest_point(const Vec3& p, double max_distance_mm) const;
  // Points d'echantillonnage de la tete (repere tete, mm : x = sens de l'inclinaison B (+R), y = axe
  // pointe -> pivot, z = tangentiel), pointe a l'origine : controle des collisions. Facultatif.
  void set_head_samples(const float* xyz, size_t count);
  // Valide l'etat courant : la deformation en cours si une poignee est posee et glissee, sinon l'etat
  // valide des points [lo, hi) (intervalle vide : tous). `collisions` : controle tete / matiere /
  // plateau en plus (couteux ; limite a limits.max_poses poses).
  const Validation& validate(const MachineLimits& limits, bool collisions, uint32_t lo = 0, uint32_t hi = 0);
  const Validation& last_validation() const { return validation_; }
  // Nombre de fils des boucles paralleles (0 : tous les coeurs). Le resultat n'en depend pas.
  void set_threads(unsigned threads);

  // Etat courant (valeurs firmware validees par commit).
  const std::vector<double>& r() const { return r_; }
  const std::vector<double>& c() const { return c_; }
  const std::vector<double>& z() const { return z_; }
  const std::vector<double>& b() const { return b_; }
  const std::vector<double>& e() const { return e_; }
  Vec3 tip(uint32_t i) const { return tip_[i]; }
  Vec3 axis(uint32_t i) const { return axis_[i]; }
  int32_t pass_of(uint32_t i) const { return pass_[i]; }
  size_t pass_count() const { return pass_start_.size(); }
  // kSupportSlots indices tries par distance croissante, completes par kNoIndex.
  const uint32_t* supports(uint32_t i) const { return &supports_[static_cast<size_t>(i) * kSupportSlots]; }
  const std::vector<uint32_t>& raw_supports() const { return supports_; }
  // Profondeur (mm, le long du graphe de contacts) jusqu'au plateau / a la surface libre ; infinie
  // si aucun chemin (debut de surplomb, point de deplacement a vide).
  double plate_depth(uint32_t i) const { return depth_plate_[i]; }
  double surface_depth(uint32_t i) const { return depth_top_[i]; }
  // Point de coque (trajectoire sans matiere d'un cote dans sa couche) ; calcule a la demande.
  bool is_shell(uint32_t i);

  void set_locked(const uint32_t* indices, size_t count, bool locked);
  void clear_locks();
  bool is_locked(uint32_t i) const { return locked_[i] != 0; }

  // Pose (ou reprend) la poignee sur le point `index` (ramene au point de trajectoire le plus
  // proche si c'est un point de deplacement a vide) et calcule l'influence sur l'etat courant.
  // Faux si l'indice est invalide, ou si la poignee tombe sur un point verrouille.
  bool set_handle(uint32_t index, const InfluenceParams& params);
  HandleRefusal refusal() const { return refusal_; }
  // Normale de paroi des points touches (3 par point, repere du noyau) : nulle hors coque. Le
  // deplacement d'un point de coque perd sa composante selon cette normale.
  const std::vector<float>& slide_normals() const { return slide_; }
  // Sens d'empilement retenu par set_handle (-1, 0, 1) et axe de tete du noeud.
  int stack_sign() const { return stack_sign_; }
  Vec3 handle_axis() const { return handle_ == kNoIndex ? Vec3{} : axis_[handle_]; }
  bool has_handle() const { return handle_ != kNoIndex; }
  uint32_t handle() const { return handle_; }
  const std::vector<uint32_t>& affected() const { return affected_; }  // indices croissants
  const std::vector<float>& weights() const { return weights_; }       // parallele a affected()
  // Points qui ne bougent pas mais dont la hauteur change (ils reposent sur des points deplaces).
  const std::vector<uint32_t>& dependents() const { return dependents_; }
  // Hauteurs avant deformation : affected() puis dependents().
  const std::vector<float>& base_heights() const { return base_heights_; }

  // Deformation en direct (sans modifier l'etat). Matiere : p' = h + R(w t)(p - h) + w T. Points de
  // deplacement a vide : deplacement (position et B) interpole entre ceux des deux points de
  // matiere qui les encadrent, sans rotation propre (un point a vide eloigne ne doit pas subir le
  // bras de levier d'une rotation autour de la poignee).
  void drag(const Transform& transform, bool with_heights = true);
  bool dragging() const { return dragged_; }
  // Translation reellement appliquee par le dernier drag (demandee x brake_factor), et limite en
  // multiple de la demandee (infini : aucune).
  const Vec3& applied_translation() const { return applied_translation_; }
  // Angle reellement applique (freine comme la translation quand l'epaisseur atteint une borne).
  double applied_angle() const { return applied_angle_; }
  // La translation du dernier drag va dans l'autre sens, le long de l'empilement, que celui pour
  // lequel les poids ont ete calcules : les recalculer (set_handle avec drag_direction).
  bool weights_direction_stale() const { return direction_stale_; }
  // Epaisseur locale du point (height_of sur l'etat valide ; NaN : inconnue).
  float layer_height(uint32_t i) const { return height_all_[i]; }
  double limit_scale() const { return limit_scale_; }
  // Couches inserees par la derniere validation (re-tranchage) : series de points a inserer AVANT
  // l'indice `before` (indices de l'etat qui precedait la validation), dans l'ordre du fichier :
  // degagement, couches de bas en haut (premier point d'une couche : approche sans depot), retour au
  // point qui precede. `values` : kValuesPerPoint par point (R, C, Z, B, E = delta E du segment qui
  // arrive) ; `extruding` : le segment arrive en deposant.
  struct ResliceInsert {
    uint32_t before = 0;
    std::vector<double> values;
    std::vector<uint8_t> extruding;
  };
  const std::vector<ResliceInsert>& last_reslice() const { return reslice_plan_; }
  const Splice& last_splice() const { return last_splice_; }
  bool reslice_active() const { return reslice_; }
  // Nombre de couches a inserer par point (parallele a affected() puis dependents()) pour la
  // deformation en cours ; vide hors re-tranchage.
  const std::vector<uint8_t>& layer_counts() const { return layer_count_; }
  // Epaisseur plancher effective (min_layer_mm / width_factor).
  double min_layer_floor() const { return params_.min_layer_mm / std::max(1.0, params_.width_factor); }
  // Change les bornes d'epaisseur sans recharger (profil d'imprimante modifie dans l'interface).
  void set_layer_limits(double min_mm, double max_mm, double width_factor);
  // Section equivalente d'un cordon d'epaisseur h pour le calcul de E (largeur variable).
  double extrusion_height(double h) const;
  double e_height_ratio(float before, float after) const;
  // Capacite d'epaisseur de la poignee courante le long de l'empilement (mm) : deplacement axial
  // maximal que les couches de la portee absorbent avant d'atteindre leurs bornes ; infini si le
  // sens d'empilement est inconnu ou le rognage actif.
  double capacity_mm() const { return capacity_mm_; }
  // Couple (point, support) qui fixe la limite (kNoIndex : aucune) : la couche qui bloque.
  uint32_t limit_point() const { return limit_point_; }
  uint32_t limit_support() const { return limit_support_; }
  const std::vector<double>& deformed() const { return deformed_; }      // kValuesPerPoint par point
  const std::vector<float>& residual_deg() const { return residual_; }   // inclinaison hors plan radial
  const std::vector<float>& heights() const { return heights_; }         // affected() puis dependents()

  // Valide la derniere deformation (une entree d'historique) et libere la poignee.
  bool commit();
  void cancel();
  bool undo();
  bool redo();
  size_t undo_depth() const { return undo_.size(); }
  size_t redo_depth() const { return redo_.size(); }
  // Derniere modification appliquee par commit / undo / redo : points et nouvelles valeurs
  // (kValuesPerPoint par point), pour que l'interface mette a jour sa copie et sa geometrie. Une
  // validation touche les points deplaces, mais aussi ceux dont seul E change (epaisseur ou
  // longueur de leur segment modifiee par la deformation).
  const std::vector<uint32_t>& last_indices() const { return last_indices_; }
  // Points dont le depot a change par la derniere modification (rognes : `last_trim_state()` vrai ;
  // retablis par une annulation : faux). Sous-ensemble de last_indices().
  const std::vector<uint32_t>& last_trimmed() const { return last_trimmed_; }
  bool last_trim_state() const { return last_trim_state_; }
  // Points rognes par la deformation en cours (rognage actif), indices croissants.
  const std::vector<uint32_t>& trimmed() const { return trimmed_; }
  // Positions deformees des points touches (parallele a affected()), repere du noyau.
  const std::vector<Vec3>& deformed_tips() const { return dtip_; }
  // Verrous par zone : tous les points de matiere a moins de `radius_mm` (3D) de la pointe de
  // `index`. Retourne les indices touches (croissants).
  std::vector<uint32_t> lock_region(uint32_t index, double radius_mm, bool locked);
  std::vector<uint32_t> locked_indices() const;
  const std::vector<double>& last_values() const { return last_values_; }

  // Entree d'historique : points (indices croissants) et valeurs avant / apres (kValuesPerPoint
  // par indice).
  struct HistoryEntry {
    std::vector<uint32_t> indices;
    std::vector<double> before;
    std::vector<double> after;
    // Points dont le segment d'arrivee a ete rogne par cette modification (indices croissants, sous-
    // ensemble de `indices`) : leur extrusion passe a 0 et ils ne deposent plus.
    std::vector<uint32_t> trimmed;
    // Points inseres par cette modification (re-tranchage) ; `indices` et `trimmed` sont alors ceux de l'etat
    // apres insertion. Les entrees plus anciennes restent dans l'indexation d'avant : on ne les atteint
    // qu'apres avoir retire les blocs (annulation dans l'ordre inverse).
    std::vector<InsertBlock> inserted;
  };
  // Remplace l'historique d'annulation par celui relu dans le journal du fichier (reouverture) :
  // l'etat courant est deja celui d'apres `undo`. Faux (et rien de change) si une entree ne
  // correspond pas au chargement (indice hors limites, tailles incoherentes).
  bool restore_history(std::vector<HistoryEntry> undo, std::vector<HistoryEntry> redo);

 private:
  using Edit = HistoryEntry;

  // E recalcule du segment arrivant en j, extremites a leurs positions courantes.
  double recomputed_e(uint32_t j, const Vec3& tip_j, const Vec3& tip_prev, double height_ratio) const;

  void update_point_geometry(size_t i);
  void compute_depths();
  void compute_slack_depths(int sign, const InfluenceParams& p, const Vec3& center);
  void classify_shell(uint32_t i);
  void build_passes();
  void refresh_closed_flags();
  void setup_grid();
  void rebuild_grid();
  size_t cell_coord(double v, double lo, size_t dim) const;
  template <class Fn> void for_each_in_box(const Vec3& lo, const Vec3& hi, Fn&& fn) const;
  void compute_supports(uint32_t i);
  void build_reverse();
  void apply(const std::vector<uint32_t>& indices, const std::vector<double>& values,
             const std::vector<uint32_t>* trim_flips = nullptr, bool trimmed_state = false);
  void smooth_deformed_b();
  double hmax_eff() const { return reslice_ ? (reslice_max_ + 1.0) * params_.max_layer_mm : params_.max_layer_mm; }
  float effective_height(size_t idx) const;
  void compute_layer_counts();
  void build_reslice_plan();
  void init_derived(LoadStats* stats);
  void insert_blocks(const std::vector<InsertBlock>& blocks);
  void remove_blocks(const std::vector<InsertBlock>& blocks);
  void compute_trimmed();
  void clear_handle();
  uint32_t snap_to_pass_point(uint32_t index) const;
  void polar_of(uint32_t i, const Vec3& tip, double& c_deg, double& tip_r) const;
  void firmware_from(uint32_t i, const Vec3& tip, const Vec3& axis, double* out, float& residual) const;
  void firmware_from_b(uint32_t i, const Vec3& tip, double b_deg, double* out) const;
  template <class TipOf> float height_of(uint32_t i, const Vec3& tip, const Vec3& axis, TipOf&& tip_of) const;

  KernelParams params_;
  unsigned threads_ = 1;

  std::vector<double> r_, c_, z_, b_, e_;
  ExtrusionMode extrusion_mode_ = ExtrusionMode::Auto;
  double extrusion_factor_ = 1.0;
  std::vector<uint8_t> extruding_, locked_;
  std::vector<Vec3> tip_, axis_;
  std::vector<int32_t> pass_;
  std::vector<uint32_t> pass_start_, pass_end_, pass_points_;
  std::vector<uint8_t> pass_closed_;

  // Grille dense des points de trajectoire (tri par comptage).
  Vec3 grid_lo_;
  double cell_ = 1.0;
  size_t nx_ = 1, ny_ = 1, nz_ = 1;
  std::vector<uint32_t> cell_start_, cell_items_;

  std::vector<uint32_t> supports_;              // n * kSupportSlots
  std::vector<uint32_t> rev_start_, rev_;       // CSR inverse : points qui reposent sur i

  std::vector<double> depth_plate_, depth_top_;
  std::vector<float> height_all_;
  // Rognage : ecart cumule le long de l'axe de tete depuis l'entree dans la couche (parcours de set_handle).
  std::vector<float> drift_;
  std::vector<double> arc_;   // abscisse curviligne de la pointe, du debut du fichier (mm)
  double max_step_mm_ = 0.0;  // plus long segment de matiere (borne a 5 mm)
  // Profondeurs en marge d'epaisseur (set_handle, sens d'empilement non nul).
  std::vector<double> slack_plate_, slack_top_;
  double capacity_mm_ = 0.0;
  bool reslice_ = false;
  uint32_t reslice_max_ = 4;
  std::vector<uint8_t> layer_count_;
  struct ResliceRun { uint32_t first = 0, last = 0, layers = 0; };  // rangs dans reslice_order_
  std::vector<uint32_t> reslice_order_;                              // rangs (affected puis dependents) par indice de point
  std::vector<ResliceRun> reslice_runs_;
  std::vector<ResliceInsert> reslice_plan_;
  Splice last_splice_;
  int stack_sign_ = 0;
  bool direction_stale_ = false;
  // Coques : -1 inconnu, 0 interieur, 1 coque ; normale de paroi (unitaire) si coque.
  std::vector<int8_t> shell_state_;
  std::vector<Vec3> shell_normal_;

  // Poignee courante.
  HandleRefusal refusal_ = HandleRefusal::None;
  bool keep_shape_ = true;
  uint32_t handle_ = kNoIndex;
  std::vector<float> slide_;                    // 3 par point touche
  Vec3 applied_translation_;
  double applied_angle_ = 0.0;
  double rot_fraction_ = 1.0;   // fraction d'angle retenue a l'image precedente (freinage de la rotation)
  double limit_scale_ = 0.0;
  uint32_t limit_point_ = kNoIndex, limit_support_ = kNoIndex;
  std::vector<uint32_t> affected_, dependents_;
  std::vector<float> weights_, base_heights_;
  std::vector<int32_t> slot_;                   // point -> rang dans affected_, -1 sinon
  // Points de deplacement a vide (paralleles a affected_) : extremites de matiere qui les encadrent
  // (kNoIndex si absente) et position relative entre elles, pour interpoler leur deplacement.
  std::vector<uint32_t> link_left_, link_right_;
  std::vector<float> link_frac_;
  bool dragged_ = false;
  Transform last_transform_;
  std::vector<double> deformed_;
  std::vector<float> residual_, heights_;
  std::vector<Vec3> dtip_, daxis_;

  // Brouillons de set_handle (remis a zero par listes de points touches).
  std::vector<double> along_;
  std::vector<uint32_t> hops_;
  std::vector<uint8_t> mark_;

  std::vector<double> times_;
  std::vector<uint8_t> type_;
  bool type_barrier_ = false;
  std::vector<float> head_;      // 3 par echantillon
  Validation validation_;

  bool trim_enabled_ = false;
  double trim_clearance_ = 0.0;
  double smooth_b_ = 0.0;
  uint32_t smooth_b_iterations_ = 0;
  std::vector<uint32_t> trimmed_;
  std::vector<uint32_t> last_trimmed_;
  bool last_trim_state_ = false;

  std::vector<Edit> undo_, redo_;
  std::vector<uint32_t> last_indices_;
  std::vector<double> last_values_;
};

template <class Fn>
void EditKernel::for_each_in_box(const Vec3& lo, const Vec3& hi, Fn&& fn) const {
  const size_t x0 = cell_coord(lo.x, grid_lo_.x, nx_), x1 = cell_coord(hi.x, grid_lo_.x, nx_);
  const size_t y0 = cell_coord(lo.y, grid_lo_.y, ny_), y1 = cell_coord(hi.y, grid_lo_.y, ny_);
  const size_t z0 = cell_coord(lo.z, grid_lo_.z, nz_), z1 = cell_coord(hi.z, grid_lo_.z, nz_);
  for (size_t iz = z0; iz <= z1; ++iz) {
    for (size_t iy = y0; iy <= y1; ++iy) {
      // Les cellules d'une meme rangee en x sont contigues : une seule plage a parcourir.
      const size_t row = nx_ * (iy + ny_ * iz);
      const uint32_t end = cell_start_[row + x1 + 1];
      for (uint32_t k = cell_start_[row + x0]; k < end; ++k) fn(cell_items_[k]);
    }
  }
}

}  // namespace apex::edit
