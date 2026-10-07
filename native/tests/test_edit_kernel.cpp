// Tests du noyau d'edition (J1). Executable autonome, sans dependance : `ctest` ou lancement direct.
// Chaque resultat accelere (grille, graphe de contacts, parcours) est compare a une reference
// brute O(n^2) ou a une propriete exacte (identite, rigidite, aller-retour bit a bit).
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <limits>
#include <random>
#include <set>
#include <utility>
#include <vector>

#include "edit_kernel.hpp"

using namespace apex::edit;

namespace {

int g_failures = 0;
int g_checks = 0;

#define CHECK(cond)                                                         \
  do {                                                                      \
    ++g_checks;                                                             \
    if (!(cond)) {                                                          \
      ++g_failures;                                                         \
      std::printf("    ECHEC ligne %d : %s\n", __LINE__, #cond);            \
    }                                                                       \
  } while (0)

#define CHECK_NEAR(a, b, tol)                                                                    \
  do {                                                                                           \
    ++g_checks;                                                                                  \
    const double va_ = (a), vb_ = (b);                                                           \
    if (!(std::abs(va_ - vb_) <= (tol))) {                                                       \
      ++g_failures;                                                                              \
      std::printf("    ECHEC ligne %d : %s = %.12g, attendu %.12g (tol %g)\n", __LINE__, #a, va_, \
                  vb_, static_cast<double>(tol));                                                \
    }                                                                                            \
  } while (0)

constexpr double kDeg = 3.14159265358979323846 / 180.0;
constexpr double kPivot = 46.0;

struct Path {
  std::vector<double> r, c, z, b;
  std::vector<uint8_t> ext;
  std::vector<double> e;  // vide : extrusions inconnues (le noyau les met a 0)

  size_t size() const { return r.size(); }

  // Ajoute un point donne par sa pointe de buse (repere du noyau) et son inclinaison B, axe de
  // tete dans le plan radial (seul cas que la machine produit).
  uint32_t push_tip(double x, double y, double zz, double b_deg, bool extrude) {
    const double rt = std::hypot(x, y);
    const double br = b_deg * kDeg;
    r.push_back(rt + kPivot * std::sin(br));
    c.push_back(std::atan2(y, x) / kDeg);
    z.push_back(zz - kPivot * (1.0 - std::cos(br)));
    b.push_back(b_deg);
    ext.push_back(extrude ? 1 : 0);
    return static_cast<uint32_t>(r.size() - 1);
  }
};

Vec3 tip_of_firmware(double r, double c, double z, double b) {
  const double br = b * kDeg, cr = c * kDeg;
  const double rt = r - kPivot * std::sin(br);
  return {rt * std::cos(cr), rt * std::sin(cr), z + kPivot * (1.0 - std::cos(br))};
}

double dist(const Vec3& a, const Vec3& b) { return std::hypot(a.x - b.x, a.y - b.y, a.z - b.z); }

KernelParams default_params(unsigned threads = 1) {
  KernelParams params;
  params.pivot_mm = kPivot;
  params.support_radius_mm = 0.5;
  params.support_cone_deg = 60.0;
  params.threads = threads;
  return params;
}

void load(EditKernel& kernel, const Path& path, const KernelParams& params) {
  kernel.load(path.size(), path.r.data(), path.c.data(), path.z.data(), path.b.data(), path.e.empty() ? nullptr : path.e.data(), path.ext.data(), params);
}

// Empilement de cordons droits : `layers` couches de `rows` rangees paralleles a x, `steps` pas de
// 0,1 mm par rangee, rangees a 0,4 mm, couches a 0,2 mm, tete verticale, bloc decentre (x0 = 40).
// Un point de degagement a vide (+1 mm) separe deux rangees.
struct Stack {
  Path path;
  std::vector<std::vector<std::vector<uint32_t>>> idx;  // [couche][rangee][pas]
  std::vector<uint32_t> lifts;
};

// `heights` : epaisseur de chaque couche (vide : 0,2 mm partout).
Stack make_stack(int layers, int rows, int steps, const std::vector<double>& heights = {}) {
  Stack s;
  s.idx.assign(layers, std::vector<std::vector<uint32_t>>(rows));
  bool first = true;
  Vec3 last{};
  double zz = 0.0;
  for (int l = 0; l < layers; ++l) {
    zz += heights.empty() ? 0.2 : heights[static_cast<size_t>(l)];
    for (int j = 0; j < rows; ++j) {
      const double y = 0.4 * j;
      if (!first) s.lifts.push_back(s.path.push_tip(last.x, last.y, last.z + 1.0, 0.0, false));
      first = false;
      for (int k = 0; k <= steps; ++k) {
        const double x = 40.0 + 0.1 * k;
        s.idx[l][j].push_back(s.path.push_tip(x, y, zz, 0.0, k > 0));
        last = {x, y, zz};
      }
    }
  }
  return s;
}

InfluenceParams none() {
  InfluenceParams p;
  p.spatial.enabled = false;
  p.along.enabled = false;
  p.adjacency.enabled = false;
  // Tests du mecanisme de deformation seul : forme de l'objet non preservee (cf. tests « forme »).
  p.keep_shape = false;
  return p;
}

InfluenceParams everything_rigid() {
  InfluenceParams p = none();
  p.spatial = {true, 1e6, Falloff::Plateau};
  return p;
}

// Poids d'un point dans l'influence courante (0 s'il n'est pas touche).
double weight_of(const EditKernel& k, uint32_t q) {
  const auto& a = k.affected();
  const auto it = std::lower_bound(a.begin(), a.end(), q);
  return it != a.end() && *it == q ? static_cast<double>(k.weights()[static_cast<size_t>(it - a.begin())]) : 0.0;
}

std::set<uint32_t> affected_pass_points(const EditKernel& k) {
  std::set<uint32_t> out;
  for (const uint32_t q : k.affected()) {
    if (k.pass_of(q) >= 0) out.insert(q);
  }
  return out;
}

Path random_pass(int count, unsigned seed) {
  std::mt19937 rng(seed);
  std::uniform_real_distribution<double> ur(5.0, 80.0), uc(-5000.0, 5000.0), uz(0.0, 50.0), ub(0.0, 170.0);
  Path p;
  for (int i = 0; i < count; ++i) {
    p.r.push_back(ur(rng));
    p.c.push_back(uc(rng));
    p.z.push_back(uz(rng));
    p.b.push_back(ub(rng));
    p.ext.push_back(i > 0 ? 1 : 0);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------

void test_falloff() {
  for (const Falloff f : {Falloff::Linear, Falloff::Gaussian, Falloff::Cubic, Falloff::Plateau}) {
    CHECK(falloff(f, 0.0) == 1.0);
    CHECK(falloff(f, -1.0) == 1.0);
    CHECK(falloff(f, 1.0) == 0.0);
    CHECK(falloff(f, 2.0) == 0.0);
    CHECK(falloff(f, std::nan("")) == 0.0);
    CHECK(falloff(f, 1.0 - 1e-9) < 1e-6);  // continu au bord : pas de marche
    double previous = 1.0;
    bool monotone = true;
    for (int i = 0; i <= 1000; ++i) {
      const double v = falloff(f, i / 1000.0);
      if (v > previous + 1e-15 || v < 0.0 || v > 1.0) monotone = false;
      previous = v;
    }
    CHECK(monotone);
  }
  CHECK_NEAR(falloff(Falloff::Linear, 0.25), 0.75, 1e-15);
  CHECK_NEAR(falloff(Falloff::Cubic, 0.5), std::pow(1.0 - 0.125, 3), 1e-15);
  CHECK(falloff(Falloff::Plateau, 0.5) == 1.0);
}

// Transformation nulle : chaque point retrouve ses valeurs firmware, y compris quand la pointe est
// de l'autre cote du centre (R - L sin B < 0), ou C vaut des milliers de degres.
void test_identity_roundtrip() {
  const Path path = random_pass(400, 7);
  EditKernel k;
  load(k, path, default_params());
  CHECK(k.set_handle(200, everything_rigid()));
  CHECK(k.affected().size() == path.size());
  k.drag(Transform{});
  int flipped = 0;
  for (size_t s = 0; s < k.affected().size(); ++s) {
    const uint32_t q = k.affected()[s];
    const double* v = &k.deformed()[kValuesPerPoint * s];
    CHECK_NEAR(v[0], path.r[q], 1e-9);
    CHECK_NEAR(v[1], path.c[q], 1e-9);
    CHECK_NEAR(v[2], path.z[q], 1e-9);
    CHECK_NEAR(v[3], path.b[q], 1e-9);
    CHECK(k.residual_deg()[s] < 1e-6f);
    if (path.r[q] - kPivot * std::sin(path.b[q] * kDeg) < 0.0) ++flipped;
  }
  CHECK(flipped > 0);  // le cas « pointe de l'autre cote du centre » a bien ete exerce
  CHECK(!k.commit());  // une transformation nulle n'ouvre pas d'entree d'historique
  CHECK(k.undo_depth() == 0);
}

// Translation de poids 1 partout : chaque pointe se deplace exactement de T.
void test_rigid_translation() {
  const Path path = random_pass(300, 11);
  EditKernel k;
  load(k, path, default_params());
  CHECK(k.set_handle(10, everything_rigid()));
  Transform t;
  t.translation = {1.5, -2.0, 0.7};
  k.drag(t);
  for (size_t s = 0; s < k.affected().size(); ++s) {
    const uint32_t q = k.affected()[s];
    const double* v = &k.deformed()[kValuesPerPoint * s];
    const Vec3 moved = tip_of_firmware(v[0], v[1], v[2], v[3]);
    const Vec3 tip = k.tip(q);
    CHECK_NEAR(moved.x, tip.x + 1.5, 1e-9);
    CHECK_NEAR(moved.y, tip.y - 2.0, 1e-9);
    CHECK_NEAR(moved.z, tip.z + 0.7, 1e-9);
  }
}

// Rotation de la tete : autour de l'axe tangentiel, B suit exactement ; autour de l'axe radial,
// l'inclinaison n'est pas realisable et ressort comme residu.
void test_rotation_b_and_residual() {
  Path path;
  for (int k = 0; k <= 20; ++k) path.push_tip(40.0 + 0.1 * k, 0.0, 0.2, 0.0, k > 0);
  const uint32_t h = 10;
  EditKernel kernel;
  load(kernel, path, default_params());
  const double ch = path.c[h] * kDeg;
  const Vec3 radial{std::cos(ch), std::sin(ch), 0.0};
  const Vec3 tangential{-std::sin(ch), std::cos(ch), 0.0};

  CHECK(kernel.set_handle(h, everything_rigid()));
  Transform t;
  t.axis = tangential;
  t.angle_rad = 10.0 * kDeg;
  kernel.drag(t);
  const size_t s = static_cast<size_t>(std::lower_bound(kernel.affected().begin(), kernel.affected().end(), h) -
                                       kernel.affected().begin());
  const double* v = &kernel.deformed()[kValuesPerPoint * s];
  CHECK_NEAR(v[3], 10.0, 1e-9);
  CHECK_NEAR(kernel.residual_deg()[s], 0.0, 1e-5);
  const Vec3 moved = tip_of_firmware(v[0], v[1], v[2], v[3]);
  CHECK_NEAR(dist(moved, kernel.tip(h)), 0.0, 1e-9);  // la poignee est le centre de rotation

  t.axis = radial;
  kernel.drag(t);
  CHECK_NEAR(kernel.deformed()[kValuesPerPoint * s + 3], 0.0, 1e-9);
  CHECK_NEAR(kernel.residual_deg()[s], 10.0, 1e-4);
}

// Graphe de contacts : identique a une recherche brute des kSupportSlots plus proches.
void test_supports_bruteforce() {
  const Stack st = make_stack(6, 4, 30);
  EditKernel k;
  const KernelParams params = default_params();
  load(k, st.path, params);
  const double cos_cone = std::cos(params.support_cone_deg * kDeg);
  int mismatches = 0, with_support = 0;
  for (uint32_t i = 0; i < k.size(); ++i) {
    std::vector<std::pair<double, uint32_t>> expected;
    if (k.pass_of(i) >= 0) {
      for (uint32_t q = 0; q < i; ++q) {
        if (k.pass_of(q) < 0) continue;
        // Meme arithmetique que le noyau (carre puis racine) : sinon deux supports quasi
        // equidistants pourraient etre departages differemment par deux calculs corrects.
        const Vec3 p = k.tip(i), a = k.axis(i), t = k.tip(q);
        const Vec3 d{p.x - t.x, p.y - t.y, p.z - t.z};
        const double d2 = d.x * d.x + d.y * d.y + d.z * d.z;
        const double rho = params.support_radius_mm;
        if (d2 > rho * rho || d2 <= 1e-18) continue;
        const double len = std::sqrt(d2);
        if (d.x * a.x + d.y * a.y + d.z * a.z < cos_cone * len) continue;
        expected.emplace_back(len, q);
      }
      std::sort(expected.begin(), expected.end());
    }
    const uint32_t* got = k.supports(i);
    for (int j = 0; j < kSupportSlots; ++j) {
      const uint32_t want = j < static_cast<int>(expected.size()) ? expected[j].second : kNoIndex;
      if (got[j] != want) ++mismatches;
    }
    if (got[0] != kNoIndex) ++with_support;
  }
  CHECK(mismatches == 0);
  CHECK(with_support > 500);  // garde : le jeu d'essai produit bien des contacts
}

// Sphere seule : meme ensemble et memes poids qu'une recherche brute.
void test_spatial_bruteforce() {
  const Stack st = make_stack(6, 4, 30);
  EditKernel k;
  load(k, st.path, default_params());
  const uint32_t h = st.idx[3][1][15];
  InfluenceParams p = none();
  p.spatial = {true, 1.0, Falloff::Linear};
  CHECK(k.set_handle(h, p));
  std::set<uint32_t> expected;
  for (uint32_t q = 0; q < k.size(); ++q) {
    if (k.pass_of(q) < 0) continue;
    const double w = 1.0 - dist(k.tip(q), k.tip(h)) / 1.0;
    if (w > 1e-6) {
      expected.insert(q);
      CHECK_NEAR(weight_of(k, q), w, 1e-6);
    }
  }
  CHECK(affected_pass_points(k) == expected);
  CHECK(expected.size() > 30);
}

// Portee orientee (poignees du noeud) : memes poids qu'une recherche brute avec une formule
// recalculee ici, et l'anisotropie est bien la : loin dans le sens de la poignee, rien a l'oppose.
void test_directional_bruteforce() {
  const Stack st = make_stack(6, 4, 30);
  EditKernel k;
  load(k, st.path, default_params());
  const uint32_t h = st.idx[3][1][15];
  InfluenceParams p = none();
  p.spatial = {true, 0.6, Falloff::Linear};
  const Vec3 dir{1.0, 0.0, 0.0};
  p.directions.push_back({dir, 3.0});
  p.direction_sharpness = 2.0;
  CHECK(k.set_handle(h, p));
  std::set<uint32_t> expected;
  size_t ahead = 0, behind = 0;
  for (uint32_t q = 0; q < k.size(); ++q) {
    if (k.pass_of(q) < 0) continue;
    const Vec3 o{k.tip(q).x - k.tip(h).x, k.tip(q).y - k.tip(h).y, k.tip(q).z - k.tip(h).z};
    const double d = std::sqrt(o.x * o.x + o.y * o.y + o.z * o.z);
    const double c = d > 0.0 ? o.x / d : 0.0;
    const double reach = std::max(0.6, c > 0.0 ? 3.0 * c * c : 0.0);
    const double w = q == h ? 1.0 : 1.0 - d / reach;
    if (w > 1e-6) {
      expected.insert(q);
      CHECK_NEAR(weight_of(k, q), w, 1e-6);
      if (o.x > 1.0) ++ahead;
      if (o.x < -1.0) ++behind;
    }
  }
  CHECK(affected_pass_points(k) == expected);
  CHECK(ahead > 0);
  CHECK(behind == 0);
}

// Ancrage (poignee verrouillee) : poids nul sur l'ancrage, attenue autour, intact au-dela.
void test_anchor() {
  const Stack st = make_stack(6, 4, 30);
  EditKernel k;
  load(k, st.path, default_params());
  const uint32_t h = st.idx[3][1][15];
  const uint32_t a = st.idx[3][1][20];
  InfluenceParams p = none();
  p.spatial = {true, 4.0, Falloff::Linear};
  CHECK(k.set_handle(h, p));
  const double free_far = weight_of(k, st.idx[3][1][10]);
  CHECK(weight_of(k, a) > 0.0);  // garde : sans ancrage, le point bouge
  p.anchors.push_back({k.tip(a), 0.8});
  CHECK(k.set_handle(h, p));
  CHECK(weight_of(k, a) == 0.0);
  CHECK(weight_of(k, h) == 1.0);
  CHECK_NEAR(weight_of(k, st.idx[3][1][10]), free_far, 1e-6);  // loin de l'ancrage : inchange
  for (uint32_t q = 0; q < k.size(); ++q) {
    if (k.pass_of(q) < 0 || q == h) continue;
    const double d = dist(k.tip(q), k.tip(a));
    if (d >= 0.8) continue;
    const double x = d / 0.8;
    const double raw = std::max(0.0, 1.0 - dist(k.tip(q), k.tip(h)) / 4.0);
    CHECK_NEAR(weight_of(k, q), raw * x * x * (3.0 - 2.0 * x), 1e-6);
  }
}

// Extrusion : E constant par segment de matiere, pour les tests du recalcul.
constexpr double kE = 0.05;
Stack make_stack_with_e(int layers, int rows, int steps) {
  Stack st = make_stack(layers, rows, steps);
  st.path.e.assign(st.path.size(), 0.0);
  for (size_t i = 0; i < st.path.size(); ++i) {
    if (st.path.ext[i]) st.path.e[i] = kE;
  }
  return st;
}

std::vector<Vec3> all_tips(const EditKernel& k) {
  std::vector<Vec3> tips(k.size());
  for (uint32_t i = 0; i < k.size(); ++i) tips[i] = k.tip(i);
  return tips;
}

// Translation rigide horizontale de tout : longueurs et epaisseurs inchangees, E inchange partout.
// (Verticale, la premiere couche s'eloignerait du plateau : son epaisseur, mesuree au plateau,
// changerait legitimement.)
void test_extrusion_rigid() {
  const Stack st = make_stack_with_e(4, 3, 20);
  EditKernel k;
  load(k, st.path, default_params());
  CHECK(k.set_handle(st.idx[1][1][10], everything_rigid()));
  Transform t;
  t.translation = {0.4, -0.3, 0.0};
  k.drag(t);
  CHECK(k.commit());
  bool same = true;
  for (uint32_t i = 0; i < k.size(); ++i) same = same && std::abs(k.e()[i] - st.path.e[i]) < 1e-12;
  CHECK(same);
}

// Etirement horizontal de la couche du dessus : epaisseurs inchangees, E de CHAQUE segment
// (points deplaces et premier point fixe qui suit) au prorata de sa longueur — recherche brute.
void test_extrusion_stretch() {
  const Stack st = make_stack_with_e(3, 2, 30);
  EditKernel k;
  load(k, st.path, default_params());
  const std::vector<Vec3> before = all_tips(k);
  const uint32_t h = st.idx[2][0][15];
  InfluenceParams p = none();
  p.spatial = {true, 1.0, Falloff::Linear};
  CHECK(k.set_handle(h, p));
  Transform t;
  t.translation = {0.3, 0.0, 0.0};
  k.drag(t);
  CHECK(k.commit());
  const std::vector<Vec3> after = all_tips(k);
  size_t changed = 0;
  for (uint32_t i = 1; i < k.size(); ++i) {
    if (k.pass_of(i) < 0 || !st.path.ext[i]) continue;
    const double expected = kE * dist(after[i], after[i - 1]) / dist(before[i], before[i - 1]);
    CHECK_NEAR(k.e()[i], expected, 1e-9);
    if (std::abs(expected - kE) > 1e-6) ++changed;
  }
  CHECK(changed > 10);  // garde : l'etirement touche bien des segments
  // Le premier point fixe apres la zone deplacee fait partie de la modification (sa longueur change).
  const std::vector<uint32_t>& edited = k.last_indices();
  CHECK(std::find(edited.begin(), edited.end(), st.idx[2][0][30]) != edited.end() ||
        std::abs(k.e()[st.idx[2][0][30]] - kE) < 1e-12);
}

// Epaisseur : un point souleve s'epaissit (E augmente), le point pose dessus s'amincit dans le meme
// rapport (E diminue) ; mode desactive : E inchange ; annulation : E d'origine exact.
void test_extrusion_height() {
  const Stack st = make_stack_with_e(4, 1, 20);
  const uint32_t h = st.idx[1][0][10];
  const uint32_t above = st.idx[2][0][10];
  InfluenceParams p = none();
  p.spatial = {true, 0.15, Falloff::Linear};
  Transform t;
  t.translation = {0.0, 0.0, 0.05};
  {
    EditKernel k;
    load(k, st.path, default_params());
    CHECK(k.set_handle(h, p));
    k.drag(t);
    CHECK(k.commit());
    CHECK(k.e()[h] > kE * 1.2);                 // epaisseur 0,25 au lieu de 0,2
    CHECK_NEAR(k.e()[above], kE * 0.75, 1e-6);  // 0,15 au lieu de 0,2, longueur inchangee
    CHECK(k.undo());
    bool restored = true;
    for (uint32_t i = 0; i < k.size(); ++i) restored = restored && k.e()[i] == st.path.e[i];
    CHECK(restored);
  }
  {
    EditKernel k;
    load(k, st.path, default_params());
    InfluenceParams off = p;
    off.extrusion = ExtrusionMode::Off;
    CHECK(k.set_handle(h, off));
    k.drag(t);
    CHECK(k.commit());
    bool same = true;
    for (uint32_t i = 0; i < k.size(); ++i) same = same && k.e()[i] == st.path.e[i];
    CHECK(same);
  }
}

// Reouverture : un noyau charge avec l'etat d'apres une modification, et l'historique relu du
// journal, annule exactement vers l'etat d'avant puis retablit ; une entree incoherente est refusee.
void test_restore_history() {
  const Stack st = make_stack_with_e(3, 2, 20);
  EditKernel a;
  load(a, st.path, default_params());
  InfluenceParams p = none();
  p.spatial = {true, 1.0, Falloff::Linear};
  CHECK(a.set_handle(st.idx[1][0][10], p));
  Transform t;
  t.translation = {0.2, 0.1, 0.05};
  a.drag(t);
  CHECK(a.commit());
  EditKernel::HistoryEntry entry;
  entry.indices = a.last_indices();
  entry.after = a.last_values();
  for (const uint32_t q : entry.indices) {
    for (const double v : {st.path.r[q], st.path.c[q], st.path.z[q], st.path.b[q], st.path.e[q]}) entry.before.push_back(v);
  }

  Path reopened = st.path;  // fichier tel qu'enregistre apres la modification
  for (size_t k = 0; k < entry.indices.size(); ++k) {
    const uint32_t q = entry.indices[k];
    const double* v = &entry.after[kValuesPerPoint * k];
    reopened.r[q] = v[0]; reopened.c[q] = v[1]; reopened.z[q] = v[2]; reopened.b[q] = v[3]; reopened.e[q] = v[4];
  }
  EditKernel b;
  load(b, reopened, default_params());
  EditKernel::HistoryEntry bad = entry;
  bad.after.pop_back();
  CHECK(!b.restore_history({bad}, {}));
  CHECK(b.undo_depth() == 0);
  CHECK(b.restore_history({entry}, {}));
  CHECK(b.undo_depth() == 1);
  CHECK(b.undo());
  bool back = true;
  for (uint32_t i = 0; i < b.size(); ++i) {
    back = back && b.r()[i] == st.path.r[i] && b.c()[i] == st.path.c[i] && b.z()[i] == st.path.z[i] &&
           b.b()[i] == st.path.b[i] && b.e()[i] == st.path.e[i];
  }
  CHECK(back);
  CHECK(b.redo());
  bool forward = true;
  for (size_t k = 0; k < entry.indices.size(); ++k) forward = forward && b.e()[entry.indices[k]] == entry.after[kValuesPerPoint * k + 4];
  CHECK(forward);
}

// Trajectoires adjacentes seules : la rangee de la poignee (0 contact), puis celles empilees
// au-dessus et au-dessous, a raison d'un contact par cordon. Les rangees voisines dans la meme
// couche ne sont pas des supports (cone de 60 deg) : elles ne bougent pas.
void test_adjacency_hops() {
  const Stack st = make_stack(7, 4, 30);
  EditKernel k;
  load(k, st.path, default_params());
  const uint32_t h = st.idx[3][2][15];
  InfluenceParams p = none();
  p.adjacency = {true, true, true, 2, 2, Falloff::Linear};
  CHECK(k.set_handle(h, p));
  std::set<uint32_t> expected;
  for (int l = 1; l <= 5; ++l) {
    for (const uint32_t q : st.idx[l][2]) {
      expected.insert(q);
      CHECK_NEAR(weight_of(k, q), 1.0 - std::abs(l - 3) / 3.0, 1e-6);
    }
  }
  CHECK(affected_pass_points(k) == expected);

  p.adjacency.before = false;
  CHECK(k.set_handle(h, p));
  std::set<uint32_t> above;
  for (int l = 3; l <= 5; ++l) above.insert(st.idx[l][2].begin(), st.idx[l][2].end());
  CHECK(affected_pass_points(k) == above);
}

// Le long des cordons seul : abscisse = |dx| (la colonne ne derive pas de cote), sur toute la
// hauteur puisque rien d'autre ne la borne.
void test_along_columns() {
  const Stack st = make_stack(7, 4, 30);
  EditKernel k;
  load(k, st.path, default_params());
  const uint32_t h = st.idx[3][2][15];
  InfluenceParams p = none();
  p.along = {true, 1.0, Falloff::Linear};
  CHECK(k.set_handle(h, p));
  std::set<uint32_t> expected;
  for (int l = 0; l < 7; ++l) {
    for (int s = 0; s <= 30; ++s) {
      const double dx = std::abs(s - 15) * 0.1;
      if (1.0 - dx <= 1e-6) continue;
      const uint32_t q = st.idx[l][2][s];
      expected.insert(q);
      CHECK_NEAR(weight_of(k, q), 1.0 - dx, 1e-6);
    }
  }
  CHECK(affected_pass_points(k) == expected);
}

// Combinaison : maximum = union des metriques, produit = intersection.
void test_combine_modes() {
  const Stack st = make_stack(7, 4, 30);
  EditKernel k;
  load(k, st.path, default_params());
  const uint32_t h = st.idx[3][2][15];
  InfluenceParams p = none();
  p.spatial = {true, 0.35, Falloff::Linear};
  p.adjacency = {true, true, true, 1, 1, Falloff::Linear};

  p.combine = Combine::Max;
  CHECK(k.set_handle(h, p));
  std::set<uint32_t> rows;
  for (int l = 2; l <= 4; ++l) rows.insert(st.idx[l][2].begin(), st.idx[l][2].end());
  CHECK(affected_pass_points(k) == rows);
  for (const uint32_t q : st.idx[4][2]) CHECK_NEAR(weight_of(k, q), 0.5, 1e-6);
  for (const uint32_t q : st.idx[3][2]) CHECK_NEAR(weight_of(k, q), 1.0, 1e-6);

  p.combine = Combine::Product;
  CHECK(k.set_handle(h, p));
  std::set<uint32_t> expected;
  for (int l = 2; l <= 4; ++l) {
    for (const uint32_t q : st.idx[l][2]) {
      const double f3 = 1.0 - dist(k.tip(q), k.tip(h)) / 0.35;
      const double fc = l == 3 ? 1.0 : 0.5;
      if (f3 * fc > 1e-6) {
        expected.insert(q);
        CHECK_NEAR(weight_of(k, q), f3 * fc, 1e-6);
      }
    }
  }
  CHECK(affected_pass_points(k) == expected);
}

void test_locks_and_snap() {
  const Stack st = make_stack(4, 3, 20);
  EditKernel k;
  load(k, st.path, default_params());
  const uint32_t h = st.idx[2][1][10];
  const uint32_t locked[] = {st.idx[2][1][9], st.idx[2][1][11]};
  k.set_locked(locked, 2, true);
  InfluenceParams p = none();
  p.spatial = {true, 1.0, Falloff::Linear};
  CHECK(k.set_handle(h, p));
  CHECK(weight_of(k, locked[0]) == 0.0);
  CHECK(weight_of(k, locked[1]) == 0.0);
  CHECK(weight_of(k, st.idx[2][1][8]) > 0.0);
  CHECK(!k.set_handle(locked[0], p));
  k.clear_locks();
  CHECK(k.set_handle(locked[0], p));

  // Un point de degagement a vide ramene la poignee sur le point de trajectoire le plus proche.
  const uint32_t lift = st.lifts[3];
  CHECK(k.pass_of(lift) < 0);
  CHECK(k.set_handle(lift, p));
  CHECK(k.handle() == lift - 1);
}

// Un degagement a vide suit les deux passes qu'il relie, par interpolation selon l'indice.
void test_travel_interpolation() {
  const Stack st = make_stack(4, 3, 30);
  EditKernel k;
  load(k, st.path, default_params());
  const uint32_t start = st.idx[2][2][0];
  const uint32_t lift = start - 1, end_prev = start - 2;
  CHECK(k.pass_of(lift) < 0);
  InfluenceParams p = none();
  p.spatial = {true, 4.0, Falloff::Linear};
  CHECK(k.set_handle(start, p));
  const double wa = weight_of(k, end_prev), wb = weight_of(k, start);
  CHECK(wa > 0.0 && wb == 1.0);
  CHECK_NEAR(weight_of(k, lift), 0.5 * (wa + wb), 1e-6);

  // Deplacement (position et B) = moyenne de ceux des extremites, sans rotation propre.
  Transform t;
  t.translation = {0.4, -0.3, 0.5};
  t.axis = {0.0, 1.0, 0.0};
  t.angle_rad = 15.0 * kDeg;
  k.drag(t);
  auto moved = [&](uint32_t q, double& b_out) {
    const auto& a = k.affected();
    const size_t s = static_cast<size_t>(std::lower_bound(a.begin(), a.end(), q) - a.begin());
    const double* v = &k.deformed()[kValuesPerPoint * s];
    b_out = v[3];
    return tip_of_firmware(v[0], v[1], v[2], v[3]);
  };
  double b_lift = 0, b_a = 0, b_b = 0;
  const Vec3 pl = moved(lift, b_lift), pa = moved(end_prev, b_a), pb = moved(start, b_b);
  const Vec3 ta = k.tip(end_prev), tb = k.tip(start), tl = k.tip(lift);
  CHECK_NEAR(pl.x - tl.x, 0.5 * ((pa.x - ta.x) + (pb.x - tb.x)), 1e-9);
  CHECK_NEAR(pl.y - tl.y, 0.5 * ((pa.y - ta.y) + (pb.y - tb.y)), 1e-9);
  CHECK_NEAR(pl.z - tl.z, 0.5 * ((pa.z - ta.z) + (pb.z - tb.z)), 1e-9);
  CHECK_NEAR(b_lift - k.b()[lift], 0.5 * ((b_a - k.b()[end_prev]) + (b_b - k.b()[start])), 1e-9);
  CHECK(std::abs(b_b - k.b()[start]) > 1.0);  // garde : la rotation a bien incline la tete

  // Valider ne recalcule les contacts que pres de la matiere deplacee : une traversee a vide
  // lointaine n'elargit pas la zone (resultat identique a un rechargement complet).
  CHECK(k.commit());
  EditKernel fresh;
  Path committed{k.r(), k.c(), k.z(), k.b(), st.path.ext};
  load(fresh, committed, default_params());
  CHECK(fresh.raw_supports() == k.raw_supports());
}

// Boucle fermee : l'abscisse passe par le raccord.
void test_closed_loop() {
  Path path;
  const int count = 100;
  for (int i = 0; i <= count; ++i) {
    const double a = 2.0 * 3.14159265358979323846 * (i % count) / count;
    path.push_tip(60.0 + 5.0 * std::cos(a), 5.0 * std::sin(a), 0.2, 0.0, i > 0);
  }
  EditKernel k;
  load(k, path, default_params());
  InfluenceParams p = none();
  p.along = {true, 1.0, Falloff::Linear};
  CHECK(k.set_handle(2, p));
  const double chord = 2.0 * 5.0 * std::sin(3.14159265358979323846 / count);
  CHECK_NEAR(weight_of(k, 99), 1.0 - 3.0 * chord, 1e-6);  // 2 -> 1 -> 0 = 100 -> 99
  CHECK(weight_of(k, 98) == 0.0);
}

// Hauteurs : 0,2 mm dans l'empilement ; monter la poignee de 0,1 la porte a 0,3 et ecrase a 0,1
// ce qui repose sur elle.
void test_heights() {
  const Stack st = make_stack(6, 3, 30);
  EditKernel k;
  load(k, st.path, default_params());
  const uint32_t h = st.idx[3][1][15];
  InfluenceParams p = none();
  p.spatial = {true, 0.01, Falloff::Plateau};
  CHECK(k.set_handle(h, p));
  CHECK(k.affected().size() == 1);
  CHECK_NEAR(k.base_heights()[0], 0.2, 1e-6);
  CHECK(!k.dependents().empty());
  Transform t;
  t.translation = {0.0, 0.0, 0.1};
  k.drag(t);
  CHECK_NEAR(k.heights()[0], 0.3, 1e-6);
  bool above = false;
  for (size_t d = 0; d < k.dependents().size(); ++d) {
    CHECK_NEAR(k.heights()[1 + d], 0.1, 1e-6);
    if (k.dependents()[d] == st.idx[4][1][15]) above = true;
  }
  CHECK(above);

  // Premiere couche : hauteur au-dessus du plateau.
  CHECK(k.set_handle(st.idx[0][1][15], p));
  CHECK_NEAR(k.base_heights()[0], 0.2, 1e-6);
}

// Validation, annulation, retablissement : retour BIT A BIT, graphe de contacts compris, et la
// mise a jour incrementale des contacts egale une reconstruction complete.
void test_commit_undo_redo() {
  const Stack st = make_stack(6, 4, 30);
  EditKernel k;
  const KernelParams params = default_params();
  load(k, st.path, params);
  const auto r0 = k.r(), c0 = k.c(), z0 = k.z(), b0 = k.b();
  const auto s0 = k.raw_supports();

  InfluenceParams p = none();
  p.spatial = {true, 1.5, Falloff::Cubic};
  CHECK(k.set_handle(st.idx[3][1][15], p));
  Transform t;
  t.translation = {0.3, 0.1, 0.25};
  t.axis = {0.3, 0.2, 0.9};
  t.angle_rad = 7.0 * kDeg;
  k.drag(t);
  CHECK(k.commit());
  CHECK(!k.has_handle());
  CHECK(k.undo_depth() == 1);
  CHECK(k.r() != r0);
  const auto r1 = k.r(), c1 = k.c(), z1 = k.z(), b1 = k.b();
  const auto s1 = k.raw_supports();
  CHECK(s1 != s0);

  EditKernel fresh;
  Path committed{r1, c1, z1, b1, st.path.ext};
  load(fresh, committed, params);
  CHECK(fresh.raw_supports() == s1);

  CHECK(k.undo());
  CHECK(k.r() == r0 && k.c() == c0 && k.z() == z0 && k.b() == b0);
  CHECK(k.raw_supports() == s0);
  CHECK(k.redo());
  CHECK(k.r() == r1 && k.c() == c1 && k.z() == z1 && k.b() == b1);
  CHECK(k.raw_supports() == s1);
  CHECK(!k.redo());
}

// Le nombre de fils ne change aucun bit.
// --- L'objet garde sa forme (keep_shape) ---------------------------------------------------------

InfluenceParams shape_preserving(double radius_mm) {
  InfluenceParams p;
  p.spatial = {true, radius_mm, Falloff::Plateau};
  p.along.enabled = false;
  p.adjacency.enabled = false;
  p.keep_shape = true;
  return p;
}

Vec3 deformed_tip(const EditKernel& k, size_t slot) {
  const double* v = &k.deformed()[kValuesPerPoint * slot];
  return tip_of_firmware(v[0], v[1], v[2], v[3]);
}

size_t slot_of(const EditKernel& k, uint32_t q) {
  const auto& a = k.affected();
  return static_cast<size_t>(std::lower_bound(a.begin(), a.end(), q) - a.begin());
}

void test_brake_factor() {
  CHECK_NEAR(brake_factor(std::numeric_limits<double>::infinity()), 1.0, 0.0);
  CHECK_NEAR(brake_factor(0.0), 0.0, 0.0);
  CHECK_NEAR(brake_factor(1.0), 1.0 - std::exp(-1.0), 1e-15);
  CHECK_NEAR(brake_factor(1e-3), 1e-3, 1e-12);
  CHECK_NEAR(brake_factor(1e7), 1.0 - 0.5e-7, 1e-12);
  // Croissante, toujours sous la limite (s) et sous 1.
  double prev = 0.0;
  for (double s = 0.01; s < 100.0; s *= 1.3) {
    const double f = brake_factor(s);
    CHECK(f > prev);
    CHECK(f <= std::min(1.0, s) && f < 1.0);
    prev = f;
  }
}

// Premiere couche (sur le plateau) et derniere (rien ne repose dessus) : fixes, refusees comme noeud ;
// entre les deux, le poids monte de 0 au noeud.
void test_shape_boundaries() {
  Stack st = make_stack(10, 5, 40);
  EditKernel k;
  load(k, st.path, default_params());
  for (int l = 0; l < 10; ++l) {
    const uint32_t q = st.idx[l][2][20];
    CHECK_NEAR(k.plate_depth(q), 0.2 * l, 1e-9);
    CHECK_NEAR(k.surface_depth(q), 0.2 * (9 - l), 1e-9);
  }
  CHECK(!k.set_handle(st.idx[0][2][20], shape_preserving(1e6)));
  CHECK(k.refusal() == HandleRefusal::Plate);
  CHECK(!k.set_handle(st.idx[9][2][20], shape_preserving(1e6)));
  CHECK(k.refusal() == HandleRefusal::Surface);
  CHECK(k.set_handle(st.idx[5][2][20], shape_preserving(1e6)));
  CHECK(k.refusal() == HandleRefusal::None);
  CHECK_NEAR(weight_of(k, st.idx[5][2][20]), 1.0, 0.0);
  for (int j = 0; j < 5; ++j) {
    CHECK_NEAR(weight_of(k, st.idx[0][j][7]), 0.0, 0.0);
    CHECK_NEAR(weight_of(k, st.idx[9][j][7]), 0.0, 0.0);
  }
  CHECK(weight_of(k, st.idx[1][2][20]) < weight_of(k, st.idx[3][2][20]));
  CHECK(weight_of(k, st.idx[3][2][20]) < 1.0);
  // Le mecanisme seul (keep_shape desactive) deplace tout.
  InfluenceParams rigid = shape_preserving(1e6);
  rigid.keep_shape = false;
  CHECK(k.set_handle(st.idx[0][2][20], rigid));
  CHECK_NEAR(weight_of(k, st.idx[0][0][7]), 1.0, 0.0);
}

// Coques : rangees du bord (une seule voisine laterale) ; normale de paroi selon y.
void test_shell_detection() {
  Stack st = make_stack(6, 5, 40);
  EditKernel k;
  load(k, st.path, default_params());
  for (int l = 0; l < 6; ++l) {
    for (int j = 0; j < 5; ++j) {
      for (const int s : {0, 20, 40}) CHECK(k.is_shell(st.idx[l][j][s]) == (j == 0 || j == 4));
    }
  }
  CHECK(k.set_handle(st.idx[3][2][20], shape_preserving(1e6)));
  const uint32_t q = st.idx[3][0][20];
  const size_t s = slot_of(k, q);
  CHECK(s < k.affected().size());
  CHECK_NEAR(std::abs(k.slide_normals()[3 * s + 1]), 1.0, 1e-9);
  CHECK_NEAR(k.slide_normals()[3 * s], 0.0, 1e-9);
  CHECK_NEAR(k.slide_normals()[3 * s + 2], 0.0, 1e-9);
  const size_t inner = slot_of(k, st.idx[3][1][20]);
  for (int c = 0; c < 3; ++c) CHECK_NEAR(k.slide_normals()[3 * inner + c], 0.0, 0.0);
}

// Translation laterale : les coques ne quittent pas leur paroi (y inchange), l'interieur suit.
void test_shell_slide() {
  Stack st = make_stack(8, 5, 40);
  EditKernel k;
  load(k, st.path, default_params());
  CHECK(k.set_handle(st.idx[4][2][20], shape_preserving(1e6)));
  Transform t;
  t.translation = {0.05, 0.1, 0.0};
  k.drag(t, false);
  CHECK(k.limit_scale() > 0.0);
  for (int l = 1; l < 7; ++l) {
    for (int j = 0; j < 5; ++j) {
      const uint32_t q = st.idx[l][j][20];
      const size_t s = slot_of(k, q);
      const Vec3 before = k.tip(q), after = deformed_tip(k, s);
      if (j == 0 || j == 4) CHECK_NEAR(after.y, before.y, 1e-9);
      else CHECK(after.y > before.y + 1e-6);
      // Le long de la paroi (x), les coques suivent.
      CHECK(after.x > before.x + 1e-6);
    }
  }
}

// Epaisseur bornee : quelle que soit la translation demandee, aucun couple ne passe sous
// min(min_layer, epaisseur actuelle) ni, pour le support le plus proche, au-dessus du maximum ;
// le noeud ralentit puis s'arrete a la limite.
void test_thickness_brake() {
  Stack st = make_stack(10, 3, 30);
  EditKernel k;
  KernelParams params = default_params();
  params.min_layer_mm = 0.06;
  params.max_layer_mm = 0.3;
  load(k, st.path, params);
  CHECK(k.set_handle(st.idx[5][1][15], shape_preserving(0.6)));
  double prev = 0.0;
  for (const double dz : {0.01, 0.05, 0.2, 1.0, 5.0, 50.0}) {
    for (const double sign : {1.0, -1.0}) {
      Transform t;
      t.translation = {0.0, 0.0, sign * dz};
      k.drag(t, true);
      const double applied = k.applied_translation().z * sign;
      CHECK(applied >= 0.0);
      CHECK(applied <= dz + 1e-15);
      CHECK(applied <= k.limit_scale() * dz + 1e-12);
      const auto& base = k.base_heights();
      const auto& now = k.heights();
      for (size_t i = 0; i < now.size(); ++i) {
        if (!std::isfinite(base[i]) || !std::isfinite(now[i])) continue;
        CHECK(now[i] >= std::min(0.06f, base[i]) - 1e-6f);
        CHECK(now[i] <= std::max(0.3f, base[i]) + 1e-6f);
      }
      if (sign > 0.0) {
        CHECK(applied > prev);
        prev = applied;
      }
    }
  }
  // Tres loin : quasiment a la limite, jamais au-dela.
  Transform far;
  far.translation = {0.0, 0.0, 1e4};
  k.drag(far, false);
  CHECK_NEAR(k.applied_translation().z, k.limit_scale() * 1e4, 1e-6);
}

// Marge d'epaisseur : une couche deja a l'epaisseur maximale sous le noeud ne bloque pas la montee
// (elle ne s'etire plus, les autres absorbent) ; toutes atteignent leur limite ensemble.
void test_slack_distribution() {
  // Couches 0,2 mm sauf la 3e (0,3 mm, deja au maximum) ; noeud en couche 6.
  std::vector<double> heights(10, 0.2);
  heights[3] = 0.3;
  Stack st = make_stack(10, 3, 30, heights);
  EditKernel k;
  load(k, st.path, default_params());
  const uint32_t node = st.idx[6][1][15];
  InfluenceParams p = shape_preserving(1e6);
  p.drag_direction = {0.0, 0.0, 1.0};
  CHECK(k.set_handle(node, p));
  Transform t;
  t.translation = {0.0, 0.0, 0.2};
  k.drag(t, true);
  CHECK(!k.weights_direction_stale());
  // Marge d'etirement sous le noeud : couches 1, 2, 4, 5, 6 a 0,1 mm chacune (0,5 mm) ; la
  // compression au-dessus : couches 7, 8 et 9 (la 9e, surface fixe, se comprime par le dessous) a
  // 0,14 mm chacune, 0,42 mm : c'est elle qui limite.
  CHECK(k.limit_scale() > 1.0);
  const uint32_t q3 = st.idx[3][1][15];
  CHECK_NEAR(weight_of(k, q3), weight_of(k, st.idx[2][1][15]), 1e-6);
  // A la limite, chaque couche touchee atteint sa borne en meme temps (aucune avant les autres).
  Transform far;
  far.translation = {0.0, 0.0, 50.0};
  k.drag(far, true);
  const double lift = k.applied_translation().z;
  CHECK_NEAR(k.limit_scale() * 50.0, 0.42, 1e-6);
  CHECK(lift > 0.4199 && lift <= 0.42 + 1e-6);
  // Couches du dessus toutes a 0,06 mm ensemble ; la couche deja a 0,3 mm n'a pas bouge.
  for (const int l : {7, 8}) CHECK_NEAR(k.heights()[slot_of(k, st.idx[l][1][15])], 0.06, 1e-4);
  CHECK_NEAR(k.heights()[slot_of(k, q3)], 0.3, 1e-4);
  // Descendre : poids a recalculer pour l'autre sens.
  Transform down;
  down.translation = {0.0, 0.0, -0.1};
  k.drag(down, false);
  CHECK(k.weights_direction_stale());
  // Sans sens (glissement lateral), aucun recalcul demande.
  CHECK(k.set_handle(node, shape_preserving(1e6)));
  Transform side;
  side.translation = {0.0, 0.1, 0.0};
  k.drag(side, false);
  CHECK(!k.weights_direction_stale());
}

// Capacite d'epaisseur (deplacement axial que les couches de la portee absorbent) et largeur variable.
void test_capacity_and_width() {
  Stack st = make_stack(10, 3, 30);
  EditKernel k;
  load(k, st.path, default_params());
  const uint32_t node = st.idx[6][1][15];
  InfluenceParams p = shape_preserving(1e6);
  p.drag_direction = {0.0, 0.0, 1.0};
  CHECK(k.set_handle(node, p));
  // Etirement sous le noeud : couches 1..6 -> 6 couches (la 0 est sur le plateau) x 0,1 mm = 0,6 mm ; compression
  // au-dessus : couches 7, 8, 9 x 0,14 mm : la capacite est la plus petite.
  CHECK_NEAR(k.capacity_mm(), 0.42, 1e-6);
  Transform far;
  far.translation = {0.0, 0.0, 50.0};
  k.drag(far, false);
  CHECK_NEAR(k.applied_translation().z, k.capacity_mm(), 1e-6 * 50.0 + 1e-6);
  // Sans sens d'empilement : illimitee.
  CHECK(k.set_handle(node, shape_preserving(1e6)));
  CHECK(!std::isfinite(k.capacity_mm()));
  // Bornes modifiees sans rechargement : maximum 0,4 -> l'etirement (1,2 mm) ne limite plus.
  k.set_layer_limits(0.06, 0.4, 1.0);
  CHECK(k.set_handle(node, p));
  CHECK_NEAR(k.capacity_mm(), 0.42, 1e-6);
  // Largeur variable x2 : plancher 0,03 mm -> compression 3 x 0,17 = 0,51 mm (etirement 0,6 mm).
  k.set_layer_limits(0.06, 0.3, 2.0);
  CHECK_NEAR(k.min_layer_floor(), 0.03, 1e-12);
  CHECK(k.set_handle(node, p));
  CHECK_NEAR(k.capacity_mm(), 0.51, 1e-6);
  k.drag(far, true);
  CHECK_NEAR(k.applied_translation().z, 0.51, 1e-4);
  // Section pour E : inchangee au-dessus du minimum ; au-dessous, le cordon s'elargit (section
  // min(f h, hmin)), continue en hmin, constante a hmin pour h >= hmin / f.
  CHECK_NEAR(k.extrusion_height(0.2), 0.2, 1e-12);
  CHECK_NEAR(k.extrusion_height(0.06), 0.06, 1e-12);
  CHECK_NEAR(k.extrusion_height(0.05), 0.06, 1e-12);
  CHECK_NEAR(k.extrusion_height(0.03), 0.06, 1e-12);
  CHECK_NEAR(k.extrusion_height(0.02), 0.04, 1e-12);
  CHECK_NEAR(k.e_height_ratio(0.2f, 0.03f), 0.3, 1e-6);
  // Largeur variable desactivee : section = epaisseur.
  k.set_layer_limits(0.06, 0.3, 1.0);
  CHECK_NEAR(k.extrusion_height(0.03), 0.03, 1e-12);
}

// Re-tranchage : au-dela du maximum d'epaisseur, des couches sont interpolees (au lieu de freiner).
void test_reslice() {
  Stack st = make_stack(10, 3, 30);
  st.path.e.assign(st.path.size(), 0.0);
  for (size_t i = 0; i < st.path.size(); ++i) st.path.e[i] = st.path.ext[i] ? 0.02 : 0.0;
  const uint32_t node = st.idx[4][1][15];
  InfluenceParams p = shape_preserving(1e6);
  p.drag_direction = {0.0, 0.0, 1.0};
  Transform up;
  up.translation = {0.0, 0.0, 5.0};   // bien au-dela de ce que les couches absorbent

  // Sans re-tranchage : l'etirement freine (4 couches sous le noeud, 0,1 mm chacune).
  {
    EditKernel k;
    load(k, st.path, default_params());
    CHECK(k.set_handle(node, p));
    k.drag(up, true);
    CHECK(k.applied_translation().z < 0.41);
    CHECK(k.layer_counts().empty());
    CHECK(k.commit());
    CHECK(k.last_reslice().empty());
  }
  // Avec re-tranchage : la translation entiere passe, des couches sont inserees.
  EditKernel k;
  load(k, st.path, default_params());
  p.reslice = true;
  CHECK(k.set_handle(node, p));
  CHECK(k.reslice_active());
  k.drag(up, true);
  // La compression des 5 couches du dessus (0,14 mm chacune) limite : 0,7 mm ; l'etirement des 4 couches
  // du dessous (0,175 mm chacune) depasse le maximum, il est interpole.
  CHECK_NEAR(k.applied_translation().z, 0.7, 0.01);
  size_t needing = 0;
  for (const uint8_t n : k.layer_counts()) needing += n > 0 ? 1 : 0;
  CHECK(needing > 0);
  // E du point du noeud : calcule sur l'epaisseur d'un etage (h / (n + 1)), pas sur h entier.
  const size_t ns = slot_of(k, node);
  const double h_node = k.heights()[ns];
  CHECK(h_node > 0.3);
  CHECK(k.layer_counts()[ns] >= 1);
  CHECK(k.commit());
  const auto& plan = k.last_reslice();
  CHECK(!plan.empty());
  size_t printed = 0;
  for (const auto& ins : plan) {
    CHECK(ins.before > 0);
    CHECK(ins.values.size() == static_cast<size_t>(kValuesPerPoint) * ins.extruding.size());
    const size_t count = ins.extruding.size();
    CHECK(count >= 6);
    // Le dernier point rejoint le point qui precede (etat valide), le precedent est degage de lui.
    const uint32_t prev = ins.before - 1;
    const double* last = &ins.values[kValuesPerPoint * (count - 1)];
    CHECK_NEAR(last[0], k.r()[prev], 1e-9);
    CHECK_NEAR(last[1], k.c()[prev], 1e-9);
    CHECK_NEAR(last[2], k.z()[prev], 1e-9);
    CHECK_NEAR(last[3], k.b()[prev], 1e-9);
    CHECK(ins.extruding[0] == 0 && ins.extruding[count - 1] == 0 && ins.extruding[count - 2] == 0);
    const Vec3 lift = tip_of_firmware(ins.values[kValuesPerPoint * (count - 2)], ins.values[kValuesPerPoint * (count - 2) + 1],
                                      ins.values[kValuesPerPoint * (count - 2) + 2], ins.values[kValuesPerPoint * (count - 2) + 3]);
    CHECK_NEAR(lift.z - k.tip(prev).z, 1.0, 1e-9);   // tete verticale : degagement de lift_mm vers le haut
    // Points deposes : entre le support et le point d'origine, etage d'au plus le maximum.
    for (size_t i = 0; i < count; ++i) {
      if (!ins.extruding[i]) continue;
      ++printed;
      const double* v = &ins.values[kValuesPerPoint * i];
      CHECK(v[4] > 0.0);
      const Vec3 tip = tip_of_firmware(v[0], v[1], v[2], v[3]);
      CHECK(tip.z > 0.2 - 1e-9);
      // Entre deux couches existantes de meme (x, y) : les deux etages ainsi formes respectent les bornes.
      double below = -1.0, above = 1e9;
      for (size_t q = 0; q < k.size(); ++q) {
        if (k.pass_of(static_cast<uint32_t>(q)) < 0) continue;
        const Vec3 pq = k.tip(static_cast<uint32_t>(q));
        if (std::abs(pq.x - tip.x) > 1e-6 || std::abs(pq.y - tip.y) > 1e-6) continue;
        if (pq.z < tip.z - 1e-9) below = std::max(below, pq.z);
        else if (pq.z > tip.z + 1e-9) above = std::min(above, pq.z);
      }
      CHECK(below >= 0.0 && above < 1e8);
      CHECK(tip.z - below >= 0.06 - 1e-6 && tip.z - below <= 0.3 + 1e-6);
      CHECK(above - tip.z >= 0.06 - 1e-6 && above - tip.z <= 0.3 + 1e-6);
      CHECK_NEAR(tip.z - below, above - tip.z, 1e-6);   // une couche inseree : deux etages egaux
    }
  }
  CHECK(printed >= 2);
  // Chaque etage fait au plus le maximum : le point du noeud, une fois valide et la couche inseree
  // comprise, a h / (n + 1) <= 0,3.
  CHECK(h_node / (k.layer_counts()[ns] + 1.0) <= 0.3 + 1e-6);
  // Re-tranchage ignore avec le rognage.
  EditKernel k2;
  load(k2, st.path, default_params());
  InfluenceParams t = p;
  t.trim.enabled = true;
  CHECK(k2.set_handle(node, t));
  CHECK(!k2.reslice_active());
}

void test_threads_equivalence() {
  const Stack st = make_stack(10, 10, 100);
  EditKernel one, many;
  load(one, st.path, default_params(1));
  load(many, st.path, default_params(8));
  CHECK(one.raw_supports() == many.raw_supports());
  InfluenceParams p = everything_rigid();
  CHECK(one.set_handle(st.idx[5][5][50], p));
  CHECK(many.set_handle(st.idx[5][5][50], p));
  CHECK(one.affected().size() > 8192);  // garde : la boucle parallele est bien empruntee
  Transform t;
  t.translation = {0.2, -0.4, 0.3};
  t.axis = {1.0, 0.5, 0.2};
  t.angle_rad = 12.0 * kDeg;
  one.drag(t);
  many.drag(t);
  CHECK(one.deformed() == many.deformed());
  CHECK(one.heights().size() == many.heights().size());
  bool same_heights = true;
  for (size_t i = 0; i < one.heights().size(); ++i) {
    const float a = one.heights()[i], b = many.heights()[i];
    if (!(a == b || (std::isnan(a) && std::isnan(b)))) same_heights = false;
  }
  CHECK(same_heights);
}


// --- Validation physique ------------------------------------------------------------------------

uint8_t flags_of(const Validation& v, uint32_t q) {
  const auto it = std::lower_bound(v.indices.begin(), v.indices.end(), q);
  return it != v.indices.end() && *it == q ? v.flags[static_cast<size_t>(it - v.indices.begin())] : uint8_t{0};
}

// Plage, vitesse et acceleration de B, calculees contre des valeurs a la main.
void test_validation_b() {
  Path path;
  std::vector<double> times;
  // Cordon de 40 points a 0,1 mm, un point par centieme de seconde ; B monte de 0,5 deg par point
  // (50 deg/s), saute de 30 deg au point 20 (3000 deg/s), puis finit a 190 deg (> 185).
  double b = 0.0;
  for (int k = 0; k < 40; ++k) {
    if (k == 20) b += 30.0; else b += 0.5;
    if (k >= 36) b = 186.0 + (k - 36);
    path.push_tip(40.0 + 0.1 * k, 0.0, 0.2, b, k > 0);
    times.push_back(0.01 * k);
  }
  EditKernel kernel;
  load(kernel, path, default_params());
  MachineLimits limits;
  Validation v = kernel.validate(limits, false);
  CHECK(!v.timing_known);
  CHECK(!v.collision_checked);
  CHECK(v.b_range == 4);                   // points 36..39 > 185
  CHECK((flags_of(v, 36) & kViolationBRange) != 0);
  CHECK((flags_of(v, 35) & kViolationBRange) == 0);
  CHECK(v.b_speed == 0);                   // sans temps, aucune vitesse

  kernel.set_times(times.data(), times.size());
  v = kernel.validate(limits, false);
  CHECK(v.timing_known);
  CHECK((flags_of(v, 20) & kViolationBSpeed) != 0);  // 30 deg en 10 ms
  CHECK((flags_of(v, 19) & kViolationBSpeed) == 0);
  CHECK((flags_of(v, 10) & (kViolationBSpeed | kViolationBAccel)) == 0);
  // Acceleration : apres le saut, la vitesse retombe de 3000 a 50 deg/s en 10 ms : 295 000 deg/s2.
  CHECK((flags_of(v, 20) & kViolationBAccel) != 0);
  CHECK((flags_of(v, 21) & kViolationBAccel) != 0);
  // Intervalle : seuls les points demandes sont juges.
  v = kernel.validate(limits, false, 30, 38);
  CHECK(v.indices.size() == 8 && v.indices.front() == 30 && v.indices.back() == 37);
  CHECK(v.b_range == 2);                   // 36 et 37

  // Limites plus larges : tout passe.
  limits.b_max_deg = 400.0;
  limits.b_speed_deg_s = 1e6;
  limits.b_accel_deg_s2 = 1e9;
  v = kernel.validate(limits, false);
  CHECK(v.b_range == 0 && v.b_speed == 0 && v.b_accel == 0);
}

// Ecart entre l'axe de tete et la normale de couche : nul tete verticale, egal a l'inclinaison sinon.
void test_validation_normals() {
  Stack st = make_stack(4, 3, 20);
  // Un point de la couche 2 penche de 20 deg (la pointe reste en place).
  const uint32_t tilted = st.idx[2][1][10];
  st.path.b[tilted] = 20.0;
  st.path.r[tilted] += kPivot * std::sin(20.0 * kDeg);
  st.path.z[tilted] -= kPivot * (1.0 - std::cos(20.0 * kDeg));
  EditKernel kernel;
  load(kernel, st.path, default_params());
  const MachineLimits limits;
  const Validation& v = kernel.validate(limits, false);
  auto dev = [&](uint32_t q) {
    const auto it = std::lower_bound(v.indices.begin(), v.indices.end(), q);
    return v.normal_deviation[static_cast<size_t>(it - v.indices.begin())];
  };
  CHECK_NEAR(dev(st.idx[1][1][10]), 0.0f, 1e-3);   // tete verticale sur supports verticaux
  CHECK_NEAR(dev(st.idx[0][1][10]), 0.0f, 1e-3);   // premiere couche : normale = +z
  CHECK_NEAR(dev(tilted), 20.0f, 0.5);
  CHECK(std::isnan(dev(st.lifts[0])));             // point a vide : inconnue
}

// Collisions : tete contre matiere deja deposee et contre le plateau, y compris pendant un glissement.
void test_validation_collisions() {
  // Un mur horizontal a z = 15 depose en premier, puis un point au sol sous le mur (x = 40..).
  Path path;
  for (int k = 0; k <= 30; ++k) path.push_tip(40.0 + 0.1 * k, 0.0, 15.0, 0.0, k > 0);
  const uint32_t lift = path.push_tip(40.0, 0.0, 16.0, 0.0, false);
  (void)lift;
  std::vector<uint32_t> floor_points;
  for (int k = 0; k <= 30; ++k) floor_points.push_back(path.push_tip(40.0 + 0.1 * k, 0.0, 0.2, 0.0, k > 0));
  // Un point lateral, tete penchee a 90 deg a 0,2 mm du plateau : l'axe (horizontal) rase le plateau.
  const uint32_t low = path.push_tip(60.0, 0.0, 0.2, 90.0, true);
  EditKernel kernel;
  load(kernel, path, default_params());
  // Tete = ligne de points le long de l'axe, de 5 a 100 mm de la pointe.
  std::vector<float> head;
  for (int s = 1; s <= 20; ++s) { head.push_back(0.0f); head.push_back(5.0f * s); head.push_back(0.0f); }
  MachineLimits limits;
  Validation v = kernel.validate(limits, true);
  CHECK(!v.collision_checked);                      // pas de modele de tete : saute
  kernel.set_head_samples(head.data(), head.size() / 3);
  v = kernel.validate(limits, true);
  CHECK(v.collision_checked);
  // La tete verticale du point au sol traverse le mur a z = 15, 14,8 mm au-dessus de sa pointe.
  CHECK((flags_of(v, floor_points[15]) & kViolationHeadPart) != 0);
  // Le mur lui-meme (depose en premier) ne voit aucune matiere deposee avant lui.
  CHECK((flags_of(v, 15) & kViolationHeadPart) == 0);
  // Tete a l'horizontale a 0,2 mm du plateau : collision plateau (sous la marge de 1 mm).
  CHECK((flags_of(v, low) & kViolationHeadPlate) != 0);
  CHECK((flags_of(v, floor_points[15]) & kViolationHeadPlate) == 0);
  CHECK(v.head_part >= 1 && v.head_plate >= 1);

  // Mur retire (rien avant) : plus de collision avec la matiere. On reconstruit sans le mur.
  Path no_wall;
  for (int k = 0; k <= 30; ++k) no_wall.push_tip(40.0 + 0.1 * k, 0.0, 0.2, 0.0, k > 0);
  EditKernel free;
  load(free, no_wall, default_params());
  free.set_head_samples(head.data(), head.size() / 3);
  CHECK(free.validate(limits, true).head_part == 0);

  // Pendant un glissement : on monte la matiere du sol jusqu'au mur ; ses points deplaces sont testes
  // a leur position deformee (la grille du noyau les verrait a leur ancien lieu).
  InfluenceParams p = none();
  p.spatial = {true, 1e6, Falloff::Plateau};
  CHECK(free.set_handle(15, p));
  Transform t;
  t.translation = {0.0, 0.0, 15.0};   // tout le sol monte a z = 15.2 : sa tete rase le mur fantome ci-dessous
  free.drag(t);
  const Validation& live = free.validate(limits, true);
  CHECK(live.collision_checked);
  CHECK(live.indices.size() == free.affected().size());
}

// Lissage de B : la pointe ne bouge pas (seul B change), la poignee garde son B exact.
void test_smooth_b() {
  Path path;
  for (int k = 0; k < 61; ++k) path.push_tip(40.0 + 0.1 * k, 0.0, 0.2, k == 31 ? 20.0 : 0.0, k > 0);
  EditKernel plain, smooth;
  load(plain, path, default_params());
  load(smooth, path, default_params());
  InfluenceParams p = none();
  p.spatial = {true, 1e6, Falloff::Plateau};
  InfluenceParams ps = p;
  ps.smooth_b = 1.0;
  ps.smooth_b_iterations = 10;
  CHECK(plain.set_handle(30, p));
  CHECK(smooth.set_handle(30, ps));
  Transform t;
  t.translation = {0.0, 0.0, 0.05};
  plain.drag(t);
  smooth.drag(t);
  const auto& da = plain.deformed();
  const auto& db = smooth.deformed();
  const size_t s31 = static_cast<size_t>(std::lower_bound(plain.affected().begin(), plain.affected().end(), 31u) - plain.affected().begin());
  CHECK_NEAR(da[kValuesPerPoint * s31 + 3], 20.0, 1e-9);        // sans lissage : B inchange
  CHECK(db[kValuesPerPoint * s31 + 3] < 12.0);                  // lisse : le pic retombe
  CHECK(db[kValuesPerPoint * s31 + 3] > 0.0);
  // Pointes identiques (R et Z recalcules pour la garder en place).
  for (size_t s = 0; s < plain.affected().size(); ++s) {
    const Vec3 a = tip_of_firmware(da[kValuesPerPoint * s], da[kValuesPerPoint * s + 1], da[kValuesPerPoint * s + 2], da[kValuesPerPoint * s + 3]);
    const Vec3 b = tip_of_firmware(db[kValuesPerPoint * s], db[kValuesPerPoint * s + 1], db[kValuesPerPoint * s + 2], db[kValuesPerPoint * s + 3]);
    CHECK(dist(a, b) < 1e-9);
  }
  // La poignee garde exactement son B.
  const size_t s30 = static_cast<size_t>(std::lower_bound(plain.affected().begin(), plain.affected().end(), 30u) - plain.affected().begin());
  CHECK(db[kValuesPerPoint * s30 + 3] == da[kValuesPerPoint * s30 + 3]);
}

// Rognage : seules la couche de la poignee se deforme ; la matiere des couches voisines que la sienne
// envahit est rognee (E = 0, depot retire), puis retablie par annulation, bit a bit.
void test_trimming() {
  Stack st = make_stack(6, 2, 40, std::vector<double>(6, 0.1));
  st.path.e.assign(st.path.size(), 0.05);
  EditKernel k;
  load(k, st.path, default_params());
  InfluenceParams p = none();
  p.spatial = {true, 100.0, Falloff::Plateau};
  p.trim.enabled = true;
  p.trim.layers = 0;
  CHECK(k.set_handle(st.idx[2][0][20], p));
  // Seule la couche 2 bouge (matiere).
  std::set<uint32_t> layer2;
  for (const auto& row : st.idx[2]) for (const uint32_t q : row) layer2.insert(q);
  for (const uint32_t q : k.affected()) {
    if (k.pass_of(q) >= 0) CHECK(layer2.count(q) == 1);
  }
  const size_t passes_before = k.pass_count();
  Transform t;
  t.translation = {0.0, 0.0, 0.15};
  k.drag(t);
  CHECK(!k.trimmed().empty());
  // La couche 2 monte de 0,15 mm : les couches 3 (0,1 au-dessus) et 4 (0,2) sont a moins de 0,06 mm de
  // la matiere deplacee, pas la couche 5 (0,3) ni celles du dessous.
  std::set<uint32_t> layer3;
  for (const int l : {3, 4}) {
    for (const auto& row : st.idx[static_cast<size_t>(l)]) for (size_t s = 1; s < row.size(); ++s) layer3.insert(row[s]);
  }
  for (const uint32_t j : k.trimmed()) CHECK(layer3.count(j) == 1);
  CHECK(k.trimmed().size() == layer3.size());
  const std::vector<uint32_t> expected(k.trimmed());

  // Hors rognage, la meme deformation ne rogne rien.
  {
    EditKernel plain;
    load(plain, st.path, default_params());
    InfluenceParams q = p;
    q.trim.enabled = false;
    q.spatial = {true, 0.3, Falloff::Plateau};
    CHECK(plain.set_handle(st.idx[2][0][20], q));
    plain.drag(t);
    CHECK(plain.trimmed().empty());
  }

  std::vector<double> e_before(st.path.e);
  CHECK(k.commit());
  CHECK(k.last_trim_state());
  CHECK(k.last_trimmed() == expected);
  for (const uint32_t j : expected) CHECK(k.e()[j] == 0.0);          // depot retire
  CHECK(k.pass_count() < passes_before);                              // les cordons rognes ne deposent plus
  CHECK(k.undo());
  CHECK(!k.last_trim_state());
  CHECK(k.last_trimmed() == expected);
  for (const uint32_t j : expected) CHECK(k.e()[j] == e_before[j]);
  CHECK(k.pass_count() == passes_before);
  CHECK(k.redo());
  CHECK(k.last_trim_state());
  for (const uint32_t j : expected) CHECK(k.e()[j] == 0.0);
}

// Verrous par zone.
void test_lock_region() {
  const Stack st = make_stack(4, 3, 30);
  EditKernel k;
  load(k, st.path, default_params());
  const uint32_t c = st.idx[2][1][15];
  const std::vector<uint32_t> locked = k.lock_region(c, 0.25, true);
  CHECK(!locked.empty());
  for (const uint32_t q : locked) {
    CHECK(k.is_locked(q));
    CHECK(dist(k.tip(q), k.tip(c)) <= 0.25 + 1e-12);
  }
  CHECK(k.locked_indices() == locked);
  InfluenceParams p = everything_rigid();
  CHECK(!k.set_handle(c, p));                              // la poignee ne peut pas tomber dans une zone verrouillee
  CHECK(k.refusal() == HandleRefusal::Locked);
  CHECK(k.set_handle(st.idx[1][1][5], p));
  for (const uint32_t q : locked) CHECK(weight_of(k, q) == 0.0);  // matiere verrouillee : immobile
  CHECK(!k.lock_region(c, 0.25, false).empty());
  CHECK(k.locked_indices().empty());
}

// Freinage de la rotation : l'angle applique garde les epaisseurs entre les bornes.
void test_rotation_brake() {
  Stack st = make_stack(6, 1, 60, std::vector<double>(6, 0.2));
  EditKernel k;
  load(k, st.path, default_params());
  InfluenceParams p;
  p.spatial = {true, 2.0, Falloff::Plateau};
  p.keep_shape = true;
  const uint32_t h = st.idx[3][0][30];
  CHECK(k.set_handle(h, p));
  Transform t;
  t.axis = {0.0, 1.0, 0.0};          // autour de y, les points voisins le long de x montent / descendent
  t.angle_rad = 40.0 * kDeg;
  k.drag(t, true);
  CHECK(k.applied_angle() > 0.0);
  CHECK(k.applied_angle() < t.angle_rad);                       // freinee : 40 deg font sortir les couches de leurs bornes
  double lo = 1e9, hi = -1e9;
  for (size_t s = 0; s < k.affected().size(); ++s) {
    if (k.pass_of(k.affected()[s]) < 0) continue;
    const float hh = k.heights()[s];
    if (!std::isfinite(hh)) continue;
    lo = std::min<double>(lo, hh);
    hi = std::max<double>(hi, hh);
  }
  CHECK(lo >= 0.06 - 5e-3);
  CHECK(hi <= 0.3 + 5e-3);

  // Sans conservation de la forme : aucun freinage.
  EditKernel free;
  load(free, st.path, default_params());
  p.keep_shape = false;
  CHECK(free.set_handle(h, p));
  free.drag(t, true);
  CHECK_NEAR(free.applied_angle(), t.angle_rad, 1e-12);
}

// Barriere de type de ligne et point le plus proche.
void test_type_barrier_nearest() {
  const Stack st = make_stack(5, 2, 30);
  std::vector<uint8_t> types(st.path.size(), 0);
  for (const auto& row : st.idx[2]) for (const uint32_t q : row) types[q] = 1;   // la couche 2 est d'un autre type
  EditKernel k;
  load(k, st.path, default_params());
  k.set_types(types.data(), types.size());
  InfluenceParams p = everything_rigid();
  CHECK(k.set_handle(st.idx[2][0][10], p));
  const size_t without = k.affected().size();
  p.type_barrier = true;
  CHECK(k.set_handle(st.idx[2][0][10], p));
  CHECK(k.affected().size() < without);
  for (const uint32_t q : k.affected()) {
    if (k.pass_of(q) >= 0) CHECK(types[q] == 1);
  }
  // Point le plus proche.
  const Vec3 target = k.tip(st.idx[1][1][7]);
  CHECK(k.nearest_point({target.x + 0.01, target.y, target.z}, 0.05) == st.idx[1][1][7]);
  CHECK(k.nearest_point({0.0, 0.0, 0.0}, 1.0) == kNoIndex);
}

// Rognage : la matiere deplacee traverse plusieurs couches (le controle ne se limite pas a l'arrivee).
void test_trimming_sweep() {
  Stack st = make_stack(8, 2, 40, std::vector<double>(8, 0.1));
  EditKernel k;
  load(k, st.path, default_params());
  InfluenceParams p = none();
  p.spatial = {true, 100.0, Falloff::Plateau};
  p.trim.enabled = true;
  p.trim.layers = 0;
  CHECK(k.set_handle(st.idx[2][0][20], p));
  Transform t;
  t.translation = {0.0, 0.0, 0.35};   // balaye les couches 3, 4, 5 (0,1 / 0,2 / 0,3 au-dessus), et frole la 6 (0,05 de l'arrivee)
  k.drag(t);
  std::set<uint32_t> expected;
  for (const int l : {3, 4, 5, 6}) {
    for (const auto& row : st.idx[static_cast<size_t>(l)]) for (size_t s = 1; s < row.size(); ++s) expected.insert(row[s]);
  }
  CHECK(k.trimmed().size() == expected.size());
  for (const uint32_t j : k.trimmed()) CHECK(expected.count(j) == 1);
  // Rien en dessous (la matiere s'eloigne des couches inferieures).
  for (const uint32_t j : k.trimmed()) CHECK(j > st.idx[2][1].back());
}

// Rognage, forme conservee (cas reel) : cordons des couches voisines decales d'une demi-largeur, seule
// la couche du noeud se deforme (sans fuir de proche en proche vers les autres), la matiere fixe ne
// freine pas, et ce que la couche envahit en descendant est rogne, rien au-dessus.
Stack make_offset_stack(int layers, int rows, int steps, double layer_mm) {
  Stack st;
  st.idx.assign(layers, std::vector<std::vector<uint32_t>>(rows));
  bool first = true;
  Vec3 last{};
  for (int l = 0; l < layers; ++l) {
    const double zz = layer_mm * (l + 1);
    for (int j = 0; j < rows; ++j) {
      const double y = 0.4 * j + (l % 2 ? 0.2 : 0.0);
      if (!first) st.lifts.push_back(st.path.push_tip(last.x, last.y, last.z + 1.0, 0.0, false));
      first = false;
      for (int k = 0; k <= steps; ++k) {
        const double x = 40.0 + 0.1 * k;
        st.idx[l][j].push_back(st.path.push_tip(x, y, zz, 0.0, k > 0));
        last = {x, y, zz};
      }
    }
  }
  st.path.e.assign(st.path.size(), 0.05);
  return st;
}

void test_trimming_keep_shape() {
  const int layers = 8, rows = 6, steps = 60;
  Stack st = make_offset_stack(layers, rows, steps, 0.2);
  auto layer_of = [&](const Stack& st, uint32_t q) {
    for (int l = 0; l < layers; ++l) for (const auto& row : st.idx[l]) if (std::binary_search(row.begin(), row.end(), q)) return l;
    return -1;
  };
  EditKernel k;
  load(k, st.path, default_params());
  InfluenceParams p;
  p.spatial = {true, 100.0, Falloff::Plateau};
  p.keep_shape = true;
  p.trim.enabled = true;
  p.trim.layers = 0;
  p.drag_direction = {0.0, 0.0, -1.0};
  CHECK(k.set_handle(st.idx[4][2][30], p));
  size_t matter = 0;
  for (const uint32_t q : k.affected()) {
    if (k.pass_of(q) < 0) continue;
    ++matter;
    CHECK(layer_of(st, q) == 4);
  }
  CHECK(matter > 0);
  Transform t;
  t.translation = {0.0, 0.0, -0.5};
  k.drag(t, true);
  CHECK_NEAR(k.applied_translation().z, -0.5, 1e-12);            // aucun freinage par la matiere fixe
  // La couche garde son epaisseur (la matiere qu'elle traverse est rognee) : E ne tombe pas a zero.
  for (size_t s = 0; s < k.affected().size(); ++s) {
    if (k.pass_of(k.affected()[s]) < 0) continue;
    CHECK(k.heights()[s] == k.base_heights()[s]);
    CHECK(k.deformed()[kValuesPerPoint * s + 4] > 0.0);
  }
  CHECK(!k.trimmed().empty());
  std::set<int> trimmed_layers;
  for (const uint32_t j : k.trimmed()) trimmed_layers.insert(layer_of(st, j));
  CHECK(trimmed_layers.count(1) == 1 && trimmed_layers.count(2) == 1 && trimmed_layers.count(3) == 1);
  CHECK(trimmed_layers.count(0) == 0);                            // 0,3 sous l'arrivee : hors d'atteinte
  for (const int l : trimmed_layers) CHECK(l < 4);                // rien au-dessus en descendant

  // En montant, symetriquement : couches 5 a 7 rognees, rien dessous.
  p.drag_direction = {0.0, 0.0, 1.0};
  CHECK(k.set_handle(st.idx[4][2][30], p));
  t.translation = {0.0, 0.0, 0.5};
  k.drag(t);
  CHECK_NEAR(k.applied_translation().z, 0.5, 1e-12);
  CHECK(!k.trimmed().empty());
  for (const uint32_t j : k.trimmed()) CHECK(layer_of(st, j) > 4);

  // La couche du dessus (surface libre) peut porter un noeud en rognage.
  CHECK(k.set_handle(st.idx[7][2][30], p));

  // Couches fines (0,1 mm) : la couche voisine decalee sort du cone des supports, l'epaisseur se mesure
  // deux couches plus bas ; en montant, la couche du dessous n'est pas envahie pour autant.
  const Stack thin = make_offset_stack(layers, rows, steps, 0.1);
  EditKernel kt;
  load(kt, thin.path, default_params());
  CHECK(kt.set_handle(thin.idx[4][2][30], p));
  t.translation = {0.0, 0.0, 0.25};
  kt.drag(t);
  CHECK(!kt.trimmed().empty());
  for (const uint32_t j : kt.trimmed()) CHECK(layer_of(thin, j) > 4);
}

}  // namespace

int main() {
  struct Test {
    const char* name;
    void (*fn)();
  };
  const Test tests[] = {
      {"decroissances", test_falloff},
      {"transformation nulle (aller-retour firmware)", test_identity_roundtrip},
      {"translation rigide", test_rigid_translation},
      {"rotation : B et residu", test_rotation_b_and_residual},
      {"contacts = recherche brute", test_supports_bruteforce},
      {"sphere = recherche brute", test_spatial_bruteforce},
      {"portee orientee = recherche brute", test_directional_bruteforce},
      {"ancrage", test_anchor},
      {"extrusion : translation rigide", test_extrusion_rigid},
      {"extrusion : etirement = recherche brute", test_extrusion_stretch},
      {"extrusion : epaisseur, mode desactive, annulation", test_extrusion_height},
      {"historique relu a la reouverture", test_restore_history},
      {"trajectoires adjacentes", test_adjacency_hops},
      {"le long des cordons", test_along_columns},
      {"produit / maximum", test_combine_modes},
      {"verrous et accroche", test_locks_and_snap},
      {"deplacements a vide", test_travel_interpolation},
      {"boucle fermee", test_closed_loop},
      {"hauteurs", test_heights},
      {"validation / annulation / retablissement", test_commit_undo_redo},
      {"independance au nombre de fils", test_threads_equivalence},
      {"freinage", test_brake_factor},
      {"forme : plateau et surface fixes", test_shape_boundaries},
      {"forme : detection des coques", test_shell_detection},
      {"forme : coques glissantes", test_shell_slide},
      {"forme : epaisseur bornee et freinage", test_thickness_brake},
      {"forme : repartition selon la marge d'epaisseur", test_slack_distribution},
      {"capacite d'epaisseur et largeur variable", test_capacity_and_width},
      {"re-tranchage : couches interpolees", test_reslice},
      {"validation : limites de B", test_validation_b},
      {"validation : ecart tete / normale", test_validation_normals},
      {"validation : collisions", test_validation_collisions},
      {"lissage de B", test_smooth_b},
      {"rognage", test_trimming},
      {"rognage : matiere traversee", test_trimming_sweep},
      {"rognage : forme conservee, cordons decales", test_trimming_keep_shape},
      {"verrous par zone", test_lock_region},
      {"freinage de la rotation", test_rotation_brake},
      {"barriere de type et point le plus proche", test_type_barrier_nearest},
  };
  for (const Test& test : tests) {
    const int before = g_failures;
    test.fn();
    std::printf("[%s] %s\n", g_failures == before ? " OK " : "ECHEC", test.name);
    std::fflush(stdout);
  }
  std::printf("\n%d verifications, %d echecs\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
