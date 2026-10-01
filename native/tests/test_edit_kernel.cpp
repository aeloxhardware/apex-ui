// Tests du noyau d'edition (J1). Executable autonome, sans dependance : `ctest` ou lancement direct.
// Chaque resultat accelere (grille, graphe de contacts, parcours) est compare a une reference
// brute O(n^2) ou a une propriete exacte (identite, rigidite, aller-retour bit a bit).
#include <algorithm>
#include <cmath>
#include <cstdio>
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
  kernel.load(path.size(), path.r.data(), path.c.data(), path.z.data(), path.b.data(), path.ext.data(), params);
}

// Empilement de cordons droits : `layers` couches de `rows` rangees paralleles a x, `steps` pas de
// 0,1 mm par rangee, rangees a 0,4 mm, couches a 0,2 mm, tete verticale, bloc decentre (x0 = 40).
// Un point de degagement a vide (+1 mm) separe deux rangees.
struct Stack {
  Path path;
  std::vector<std::vector<std::vector<uint32_t>>> idx;  // [couche][rangee][pas]
  std::vector<uint32_t> lifts;
};

Stack make_stack(int layers, int rows, int steps) {
  Stack s;
  s.idx.assign(layers, std::vector<std::vector<uint32_t>>(rows));
  bool first = true;
  Vec3 last{};
  for (int l = 0; l < layers; ++l) {
    const double zz = 0.2 * (l + 1);
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
    const double* v = &k.deformed()[4 * s];
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
    const double* v = &k.deformed()[4 * s];
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
  const double* v = &kernel.deformed()[4 * s];
  CHECK_NEAR(v[3], 10.0, 1e-9);
  CHECK_NEAR(kernel.residual_deg()[s], 0.0, 1e-5);
  const Vec3 moved = tip_of_firmware(v[0], v[1], v[2], v[3]);
  CHECK_NEAR(dist(moved, kernel.tip(h)), 0.0, 1e-9);  // la poignee est le centre de rotation

  t.axis = radial;
  kernel.drag(t);
  CHECK_NEAR(kernel.deformed()[4 * s + 3], 0.0, 1e-9);
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
    const double* v = &k.deformed()[4 * s];
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
      {"trajectoires adjacentes", test_adjacency_hops},
      {"le long des cordons", test_along_columns},
      {"produit / maximum", test_combine_modes},
      {"verrous et accroche", test_locks_and_snap},
      {"deplacements a vide", test_travel_interpolation},
      {"boucle fermee", test_closed_loop},
      {"hauteurs", test_heights},
      {"validation / annulation / retablissement", test_commit_undo_redo},
      {"independance au nombre de fils", test_threads_equivalence},
  };
  for (const Test& test : tests) {
    const int before = g_failures;
    test.fn();
    std::printf("[%s] %s\n", g_failures == before ? " OK " : "ECHEC", test.name);
  }
  std::printf("\n%d verifications, %d echecs\n", g_checks, g_failures);
  return g_failures == 0 ? 0 : 1;
}
