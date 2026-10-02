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
//
// « Couches » n'existent pas en 5 axes : le voisinage traverse les TRAJECTOIRES ADJACENTES,
// c'est-a-dire les points deposes avant (qui portent) et apres (qui reposent dessus). Le noyau en
// tire un graphe de contacts : chaque point retient ses kSupportSlots supports les plus proches
// (anterieurs, sous sa tete dans un cone, a moins de support_radius_mm).
#include <cstddef>
#include <cstdint>
#include <vector>

namespace apex::edit {

struct Vec3 {
  double x = 0.0, y = 0.0, z = 0.0;
};

enum class Falloff : uint8_t { Linear = 0, Gaussian = 1, Cubic = 2, Plateau = 3 };
enum class Combine : uint8_t { Product = 0, Max = 1 };

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
};

// Portee de la metrique 3D dans la direction de `offset` (offset = point - poignee).
double spatial_reach(const InfluenceParams& p, const Vec3& offset);
// Facteur d'ancrage dans [0, 1] : 0 sur un ancrage, 1 au-dela de son rayon.
double anchor_factor(const InfluenceParams& p, const Vec3& point);

struct KernelParams {
  double pivot_mm = 46.0;                // DOIT etre celui du rendu (NOZZLE_PIVOT_MM)
  double support_radius_mm = 0.5;        // ~2,5 hauteurs de couche
  double support_cone_deg = 60.0;        // angle max entre (point - support) et l'axe de tete
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

class EditKernel {
 public:
  LoadStats load(size_t n, const double* r, const double* c, const double* z, const double* b,
                 const uint8_t* extruding, const KernelParams& params);

  size_t size() const { return r_.size(); }
  const KernelParams& params() const { return params_; }
  // Nombre de fils des boucles paralleles (0 : tous les coeurs). Le resultat n'en depend pas.
  void set_threads(unsigned threads);

  // Etat courant (valeurs firmware validees par commit).
  const std::vector<double>& r() const { return r_; }
  const std::vector<double>& c() const { return c_; }
  const std::vector<double>& z() const { return z_; }
  const std::vector<double>& b() const { return b_; }
  Vec3 tip(uint32_t i) const { return tip_[i]; }
  Vec3 axis(uint32_t i) const { return axis_[i]; }
  int32_t pass_of(uint32_t i) const { return pass_[i]; }
  size_t pass_count() const { return pass_start_.size(); }
  // kSupportSlots indices tries par distance croissante, completes par kNoIndex.
  const uint32_t* supports(uint32_t i) const { return &supports_[static_cast<size_t>(i) * kSupportSlots]; }
  const std::vector<uint32_t>& raw_supports() const { return supports_; }

  void set_locked(const uint32_t* indices, size_t count, bool locked);
  void clear_locks();
  bool is_locked(uint32_t i) const { return locked_[i] != 0; }

  // Pose (ou reprend) la poignee sur le point `index` (ramene au point de trajectoire le plus
  // proche si c'est un point de deplacement a vide) et calcule l'influence sur l'etat courant.
  // Faux si l'indice est invalide, ou si la poignee tombe sur un point verrouille.
  bool set_handle(uint32_t index, const InfluenceParams& params);
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
  const std::vector<double>& deformed() const { return deformed_; }      // 4 par point : R C Z B
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
  // firmware (4 par point), pour que l'interface mette a jour sa copie et sa geometrie.
  const std::vector<uint32_t>& last_indices() const { return last_indices_; }
  const std::vector<double>& last_values() const { return last_values_; }

 private:
  struct Edit {
    std::vector<uint32_t> indices;
    std::vector<double> before;  // 4 par indice
    std::vector<double> after;
  };

  void update_point_geometry(size_t i);
  void build_passes();
  void refresh_closed_flags();
  void setup_grid();
  void rebuild_grid();
  size_t cell_coord(double v, double lo, size_t dim) const;
  template <class Fn> void for_each_in_box(const Vec3& lo, const Vec3& hi, Fn&& fn) const;
  void compute_supports(uint32_t i);
  void build_reverse();
  void apply(const std::vector<uint32_t>& indices, const std::vector<double>& values);
  void clear_handle();
  uint32_t snap_to_pass_point(uint32_t index) const;
  void polar_of(uint32_t i, const Vec3& tip, double& c_deg, double& tip_r) const;
  void firmware_from(uint32_t i, const Vec3& tip, const Vec3& axis, double* out, float& residual) const;
  void firmware_from_b(uint32_t i, const Vec3& tip, double b_deg, double* out) const;
  template <class TipOf> float height_of(uint32_t i, const Vec3& tip, const Vec3& axis, TipOf&& tip_of) const;

  KernelParams params_;
  unsigned threads_ = 1;

  std::vector<double> r_, c_, z_, b_;
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

  // Poignee courante.
  uint32_t handle_ = kNoIndex;
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

  std::vector<Edit> undo_, redo_;
  std::vector<uint32_t> last_indices_;
  std::vector<double> last_values_;
};

}  // namespace apex::edit
