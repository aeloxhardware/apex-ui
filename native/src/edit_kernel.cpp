#include "edit_kernel.hpp"

#include <algorithm>
#include <cstdlib>
#include <mutex>
#include <chrono>
#include <cmath>
#include <deque>
#include <functional>
#include <limits>
#include <queue>
#include <thread>
#include <utility>

#include "parallel.hpp"

namespace apex::edit {
namespace {

using Clock = std::chrono::steady_clock;

constexpr double kPi = 3.14159265358979323846;
constexpr double kDeg = kPi / 180.0;
constexpr double kInf = std::numeric_limits<double>::infinity();
constexpr uint32_t kUnreached = 0xFFFFFFFFu;
// Plafond de la grille dense (4 octets par cellule) : au-dela, les cellules grossissent.
constexpr size_t kMaxCells = 8'000'000;
constexpr double kMinWeight = 1e-6;
constexpr size_t kParallelGrain = 4096;

inline Vec3 add(const Vec3& a, const Vec3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 sub(const Vec3& a, const Vec3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 scale(double s, const Vec3& a) { return {s * a.x, s * a.y, s * a.z}; }
inline double dot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 cross(const Vec3& a, const Vec3& b) {
  return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline double norm(const Vec3& a) { return std::sqrt(dot(a, a)); }
inline double smoothstep01(double x) {
  if (!(x > 0.0)) return 0.0;
  if (x >= 1.0) return 1.0;
  return x * x * (3.0 - 2.0 * x);
}
// Coque : decalage lateral minimal d'un voisin de couche pour compter d'un cote (mm), et rayon de
// recherche en multiple de support_radius_mm.
constexpr double kShellSideMm = 0.15;
constexpr double kShellSearchFactor = 2.0;
// Glissement compte « le long de l'empilement » au-dela de ce cosinus avec l'axe de tete du noeud.
constexpr double kStackThreshold = 0.3;
// Tolerance des bornes d'epaisseur pour une couche qui en est deja a moins de cette distance (mm).
constexpr double kLayerTolerance = 0.005;
constexpr double kResliceTolerance = 0.015;   // depassement du maximum toleré avant d'inserer des couches (mm)

// Rodrigues autour d'un axe unitaire.
inline Vec3 rotate(const Vec3& v, const Vec3& k, double cos_t, double sin_t) {
  return add(add(scale(cos_t, v), scale(sin_t, cross(k, v))), scale(dot(k, v) * (1.0 - cos_t), k));
}

// Representant de `angle_deg` (modulo 360) le plus proche de `reference_deg` : C n'est jamais
// replie dans le fichier, et B doit rester continu autour de sa valeur d'origine.
inline double unwrap_near(double angle_deg, double reference_deg) {
  return angle_deg + 360.0 * std::round((reference_deg - angle_deg) / 360.0);
}

inline double ms_since(Clock::time_point t0) {
  return std::chrono::duration<double, std::milli>(Clock::now() - t0).count();
}

// Rapport d'epaisseur apres / avant ; inconnue d'un cote (NaN, pas de support) : inchangee.
// Matiere enfoncee dans celle du dessous (epaisseur <= 0) : plus rien a deposer.
inline double height_ratio(float before, float after) {
  if (!std::isfinite(before) || !std::isfinite(after) || !(before > 0.0f)) return 1.0;
  return after > 0.0f ? static_cast<double>(after) / before : 0.0;
}

// Facteur d'une metrique de distance ; un rayon nul ou negatif ne retient que le centre.
inline double distance_factor(const DistanceMetric& metric, double distance) {
  if (!(metric.radius_mm > 0.0)) return distance <= 0.0 ? 1.0 : 0.0;
  return falloff(metric.falloff, distance / metric.radius_mm);
}

}  // namespace

double spatial_reach(const InfluenceParams& p, const Vec3& offset) {
  const double base = std::max(p.spatial.radius_mm, 0.0);
  const double d = norm(offset);
  if (p.directions.empty() || d <= 0.0) return base;
  const Vec3 u = scale(1.0 / d, offset);
  double reach = base;
  for (const DirectionalReach& r : p.directions) {
    const double len = norm(r.direction);
    if (!(len > 0.0) || !(r.reach_mm > reach)) continue;
    const double c = dot(u, r.direction) / len;
    if (c <= 0.0) continue;
    reach = std::max(reach, r.reach_mm * std::pow(c, p.direction_sharpness));
  }
  return reach;
}

double anchor_factor(const InfluenceParams& p, const Vec3& point) {
  double f = 1.0;
  for (const Anchor& a : p.anchors) {
    if (!(a.radius_mm > 0.0)) continue;
    const double x = std::min(norm(sub(point, a.point)) / a.radius_mm, 1.0);
    f = std::min(f, x * x * (3.0 - 2.0 * x));
  }
  return f;
}

double brake_factor(double limit_scale) {
  if (!(limit_scale > 0.0)) return 0.0;
  if (std::isinf(limit_scale)) return 1.0;
  // s (1 - e^(-1/s)) ; pour s grand, 1 - 1/(2s) sans perte de precision.
  if (limit_scale > 1e6) return 1.0 - 0.5 / limit_scale;
  return limit_scale * -std::expm1(-1.0 / limit_scale);
}

double falloff(Falloff kind, double x) {
  if (std::isnan(x) || x >= 1.0) return 0.0;
  if (x <= 0.0) return 1.0;
  switch (kind) {
    case Falloff::Linear:
      return 1.0 - x;
    case Falloff::Gaussian: {
      const double edge = std::exp(-4.0);
      return (std::exp(-4.0 * x * x) - edge) / (1.0 - edge);
    }
    case Falloff::Cubic: {
      const double t = 1.0 - x * x * x;
      return t * t * t;
    }
    case Falloff::Plateau: {
      if (x <= 0.5) return 1.0;
      const double u = 2.0 * (x - 0.5);
      const double t = 1.0 - u * u * u;
      return t * t * t;
    }
  }
  return 0.0;
}

// ---------------------------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------------------------

LoadStats EditKernel::load(size_t n, const double* r, const double* c, const double* z, const double* b,
                           const double* e, const uint8_t* extruding, const KernelParams& params) {
  const auto t0 = Clock::now();
  LoadStats stats;
  params_ = params;
  threads_ = params.threads ? params.threads : std::max(1u, std::thread::hardware_concurrency());

  r_.assign(r, r + n);
  c_.assign(c, c + n);
  z_.assign(z, z + n);
  b_.assign(b, b + n);
  if (e) e_.assign(e, e + n);
  else e_.assign(n, 0.0);
  extruding_.assign(extruding, extruding + n);
  locked_.assign(n, 0);
  init_derived(&stats);
  undo_.clear();
  redo_.clear();
  last_indices_.clear();
  last_values_.clear();
  last_splice_ = Splice{};
  times_.clear();
  type_.clear();

  stats.points = n;
  stats.pass_points = pass_points_.size();
  stats.passes = pass_start_.size();
  stats.cells = nx_ * ny_ * nz_;
  stats.cell_mm = cell_;
  stats.support_edges = rev_.size();
  stats.total_ms = ms_since(t0);
  return stats;
}

// Tout ce qui derive des tableaux de base (r_, c_, z_, b_, e_, extruding_, locked_) : pointes et axes, passes,
// grille, supports, graphe inverse, profondeurs, coques, brouillons. Sans effet sur l'historique.
void EditKernel::init_derived(LoadStats* stats) {
  const auto t0 = Clock::now();
  const size_t n = r_.size();
  tip_.resize(n);
  axis_.resize(n);
  parallel_for(n, threads_, kParallelGrain, [&](size_t lo, size_t hi) {
    for (size_t i = lo; i < hi; ++i) update_point_geometry(i);
  });
  build_passes();
  if (stats) stats->geometry_ms = ms_since(t0);

  const auto t1 = Clock::now();
  setup_grid();
  rebuild_grid();
  if (stats) stats->grid_ms = ms_since(t1);

  const auto t2 = Clock::now();
  supports_.assign(n * kSupportSlots, kNoIndex);
  parallel_for(pass_points_.size(), threads_, 1024, [&](size_t lo, size_t hi) {
    for (size_t k = lo; k < hi; ++k) compute_supports(pass_points_[k]);
  });
  build_reverse();
  compute_depths();
  shell_state_.assign(n, -1);
  shell_normal_.assign(n, Vec3{});
  if (stats) stats->supports_ms = ms_since(t2);

  slot_.assign(n, -1);
  along_.assign(n, kInf);
  hops_.assign(n, kUnreached);
  mark_.assign(n, 0);
  handle_ = kNoIndex;
  affected_.clear();
  weights_.clear();
  dependents_.clear();
  base_heights_.clear();
  dragged_ = false;
}

// Insere des blocs de points (positions `at` apres insertion, croissantes). Les points inseres prennent le
// type de ligne du point devant lequel ils entrent ; le temps machine est a redonner (set_times).
void EditKernel::insert_blocks(const std::vector<InsertBlock>& blocks) {
  clear_handle();
  size_t extra = 0;
  for (const InsertBlock& b : blocks) extra += b.count();
  if (extra == 0) return;
  const size_t n = r_.size(), n2 = n + extra;
  std::vector<double> r2, c2, z2, b2, e2;
  std::vector<uint8_t> x2, l2, t2;
  for (auto* v : {&r2, &c2, &z2, &b2, &e2}) v->reserve(n2);
  x2.reserve(n2);
  l2.reserve(n2);
  const bool typed = type_.size() == n;
  if (typed) t2.reserve(n2);
  size_t src = 0, added = 0;
  auto copy_old = [&](size_t upto) {
    for (; src < upto; ++src) {
      r2.push_back(r_[src]);
      c2.push_back(c_[src]);
      z2.push_back(z_[src]);
      b2.push_back(b_[src]);
      e2.push_back(e_[src]);
      x2.push_back(extruding_[src]);
      l2.push_back(locked_[src]);
      if (typed) t2.push_back(type_[src]);
    }
  };
  for (const InsertBlock& blk : blocks) {
    const size_t old_at = blk.at - added;
    copy_old(std::min(old_at, n));
    for (size_t i = 0; i < blk.count(); ++i) {
      const double* v = &blk.values[kValuesPerPoint * i];
      r2.push_back(v[0]);
      c2.push_back(v[1]);
      z2.push_back(v[2]);
      b2.push_back(v[3]);
      e2.push_back(v[4]);
      x2.push_back(blk.extruding[i]);
      l2.push_back(0);
      if (typed) t2.push_back(old_at < n ? type_[old_at] : type_[n - 1]);
    }
    added += blk.count();
  }
  copy_old(n);
  r_ = std::move(r2);
  c_ = std::move(c2);
  z_ = std::move(z2);
  b_ = std::move(b2);
  e_ = std::move(e2);
  extruding_ = std::move(x2);
  locked_ = std::move(l2);
  if (typed) type_ = std::move(t2);
  times_.clear();
  init_derived(nullptr);
}

// Inverse de insert_blocks : retire les plages [at, at + count) (indices de l'etat avec les blocs).
void EditKernel::remove_blocks(const std::vector<InsertBlock>& blocks) {
  clear_handle();
  const size_t n = r_.size();
  std::vector<uint8_t> drop(n, 0);
  size_t removed = 0;
  for (const InsertBlock& b : blocks) {
    for (size_t i = 0; i < b.count() && b.at + i < n; ++i) {
      drop[b.at + i] = 1;
      ++removed;
    }
  }
  if (removed == 0) return;
  const size_t n2 = n - removed;
  auto squeeze = [&](auto& v) {
    size_t w = 0;
    for (size_t i = 0; i < n; ++i) if (!drop[i]) v[w++] = v[i];
    v.resize(n2);
  };
  squeeze(r_);
  squeeze(c_);
  squeeze(z_);
  squeeze(b_);
  squeeze(e_);
  squeeze(extruding_);
  squeeze(locked_);
  if (type_.size() == n) squeeze(type_);
  times_.clear();
  init_derived(nullptr);
}

void EditKernel::set_threads(unsigned threads) {
  threads_ = threads ? threads : std::max(1u, std::thread::hardware_concurrency());
}

void EditKernel::update_point_geometry(size_t i) {
  const double br = b_[i] * kDeg;
  const double cr = c_[i] * kDeg;
  const double sb = std::sin(br), cb = std::cos(br);
  const double cc = std::cos(cr), sc = std::sin(cr);
  const double tip_r = r_[i] - params_.pivot_mm * sb;
  const double tip_z = z_[i] + params_.pivot_mm * (1.0 - cb);
  tip_[i] = {tip_r * cc, tip_r * sc, tip_z};
  axis_[i] = {sb * cc, sb * sc, cb};
}

void EditKernel::build_passes() {
  const size_t n = r_.size();
  pass_.assign(n, -1);
  pass_start_.clear();
  pass_end_.clear();
  pass_points_.clear();
  size_t k = 1;
  while (k < n) {
    if (!extruding_[k]) {
      ++k;
      continue;
    }
    size_t end = k;
    while (end + 1 < n && extruding_[end + 1]) ++end;
    const auto id = static_cast<int32_t>(pass_start_.size());
    pass_start_.push_back(static_cast<uint32_t>(k - 1));
    pass_end_.push_back(static_cast<uint32_t>(end));
    for (size_t i = k - 1; i <= end; ++i) {
      pass_[i] = id;
      pass_points_.push_back(static_cast<uint32_t>(i));
    }
    k = end + 1;
  }
  refresh_closed_flags();
}

void EditKernel::refresh_closed_flags() {
  pass_closed_.assign(pass_start_.size(), 0);
  for (size_t p = 0; p < pass_start_.size(); ++p) {
    const uint32_t s = pass_start_[p], e = pass_end_[p];
    if (e >= s + 2 && norm(sub(tip_[e], tip_[s])) <= params_.closed_loop_tolerance_mm) pass_closed_[p] = 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Grille spatiale et graphe de contacts
// ---------------------------------------------------------------------------------------------

void EditKernel::setup_grid() {
  Vec3 lo{kInf, kInf, kInf}, hi{-kInf, -kInf, -kInf};
  for (const uint32_t i : pass_points_) {
    const Vec3& p = tip_[i];
    lo = {std::min(lo.x, p.x), std::min(lo.y, p.y), std::min(lo.z, p.z)};
    hi = {std::max(hi.x, p.x), std::max(hi.y, p.y), std::max(hi.z, p.z)};
  }
  if (pass_points_.empty()) lo = hi = Vec3{};
  const double margin = std::max(params_.grid_margin_mm, 0.0);
  lo = sub(lo, {margin, margin, margin});
  hi = add(hi, {margin, margin, margin});
  cell_ = std::max(params_.support_radius_mm, 1e-3);
  for (;;) {
    nx_ = std::max<size_t>(1, static_cast<size_t>(std::ceil((hi.x - lo.x) / cell_)));
    ny_ = std::max<size_t>(1, static_cast<size_t>(std::ceil((hi.y - lo.y) / cell_)));
    nz_ = std::max<size_t>(1, static_cast<size_t>(std::ceil((hi.z - lo.z) / cell_)));
    const double total = static_cast<double>(nx_) * static_cast<double>(ny_) * static_cast<double>(nz_);
    if (total <= static_cast<double>(kMaxCells)) break;
    cell_ *= std::cbrt(total / static_cast<double>(kMaxCells)) * 1.001;
  }
  grid_lo_ = lo;
}

// Coordonnee de cellule bornee a la grille : la matiere deplacee hors de la grille tombe dans les
// cellules du bord, ce qui reste exact (le bornage ne rapproche jamais deux points d'une cellule).
size_t EditKernel::cell_coord(double v, double lo, size_t dim) const {
  const double f = std::floor((v - lo) / cell_);
  if (!(f > 0.0)) return 0;
  if (f >= static_cast<double>(dim - 1)) return dim - 1;
  return static_cast<size_t>(f);
}

void EditKernel::rebuild_grid() {
  const size_t cells = nx_ * ny_ * nz_;
  cell_start_.assign(cells + 1, 0);
  cell_items_.resize(pass_points_.size());
  auto cell_of = [&](uint32_t i) {
    const Vec3& p = tip_[i];
    return cell_coord(p.x, grid_lo_.x, nx_) +
           nx_ * (cell_coord(p.y, grid_lo_.y, ny_) + ny_ * cell_coord(p.z, grid_lo_.z, nz_));
  };
  for (const uint32_t i : pass_points_) ++cell_start_[cell_of(i) + 1];
  for (size_t cell = 0; cell < cells; ++cell) cell_start_[cell + 1] += cell_start_[cell];
  // Tri par comptage : cell_start_[c] sert de curseur, puis le tableau est decale d'un cran.
  for (const uint32_t i : pass_points_) cell_items_[cell_start_[cell_of(i)]++] = i;
  for (size_t cell = cells; cell > 0; --cell) cell_start_[cell] = cell_start_[cell - 1];
  cell_start_[0] = 0;
}

// Supports de i : points de trajectoire deposes AVANT lui, a moins de support_radius_mm, et sous
// sa tete (dans un cone autour de -axe). Les kSupportSlots plus proches, departages par indice.
void EditKernel::compute_supports(uint32_t i) {
  const Vec3 p = tip_[i];
  const Vec3 a = axis_[i];
  const double rho = params_.support_radius_mm;
  const double rho2 = rho * rho;
  const double cos_cone = std::cos(params_.support_cone_deg * kDeg);
  double best_d[kSupportSlots];
  uint32_t best_i[kSupportSlots];
  int count = 0;
  for_each_in_box(sub(p, {rho, rho, rho}), add(p, {rho, rho, rho}), [&](uint32_t q) {
    if (q >= i) return;
    const Vec3 d = sub(p, tip_[q]);
    const double d2 = dot(d, d);
    if (d2 > rho2 || d2 <= 1e-18) return;
    const double dist = std::sqrt(d2);
    if (dot(d, a) < cos_cone * dist) return;
    int pos = count;
    while (pos > 0 && (best_d[pos - 1] > dist || (best_d[pos - 1] == dist && best_i[pos - 1] > q))) --pos;
    if (pos >= kSupportSlots) return;
    for (int j = std::min(count, kSupportSlots - 1); j > pos; --j) {
      best_d[j] = best_d[j - 1];
      best_i[j] = best_i[j - 1];
    }
    best_d[pos] = dist;
    best_i[pos] = q;
    if (count < kSupportSlots) ++count;
  });
  uint32_t* out = &supports_[static_cast<size_t>(i) * kSupportSlots];
  for (int j = 0; j < kSupportSlots; ++j) out[j] = j < count ? best_i[j] : kNoIndex;
}

// Graphe inverse (CSR) : pour chaque point, ceux qui reposent sur lui, par indice croissant.
void EditKernel::build_reverse() {
  const size_t n = r_.size();
  rev_start_.assign(n + 1, 0);
  for (size_t i = 0; i < n; ++i) {
    const uint32_t* s = &supports_[i * kSupportSlots];
    for (int j = 0; j < kSupportSlots && s[j] != kNoIndex; ++j) ++rev_start_[s[j] + 1];
  }
  for (size_t i = 0; i < n; ++i) rev_start_[i + 1] += rev_start_[i];
  rev_.resize(rev_start_[n]);
  std::vector<uint32_t> cursor(rev_start_.begin(), rev_start_.end() - 1);
  for (size_t i = 0; i < n; ++i) {
    const uint32_t* s = &supports_[i * kSupportSlots];
    for (int j = 0; j < kSupportSlots && s[j] != kNoIndex; ++j) rev_[cursor[s[j]]++] = static_cast<uint32_t>(i);
  }
}

// Profondeurs dans le graphe de contacts (plus court chemin, pas = distance entre pointes) :
//  - jusqu'au plateau : 0 pour un point sans support pres du plateau (premiere couche) ; les
//    supports sont deposes avant, un parcours dans l'ordre des indices suffit ;
//  - jusqu'a la surface libre : 0 pour un point sur lequel rien ne repose ; ceux qui reposent sont
//    deposes apres, parcours dans l'ordre inverse.
void EditKernel::compute_depths() {
  const size_t n = r_.size();
  height_all_.assign(n, std::numeric_limits<float>::quiet_NaN());
  parallel_for(pass_points_.size(), threads_, kParallelGrain, [&](size_t lo, size_t hi) {
    for (size_t k = lo; k < hi; ++k) {
      const uint32_t i = pass_points_[k];
      height_all_[i] = height_of(i, tip_[i], axis_[i], [&](uint32_t j) -> const Vec3& { return tip_[j]; });
    }
  });
  depth_plate_.assign(n, kInf);
  depth_top_.assign(n, kInf);
  drift_.assign(n, 0.0f);
  // Abscisse curviligne de la trajectoire et plus long segment de matiere (rognage).
  arc_.assign(n, 0.0);
  max_step_mm_ = 0.0;
  for (size_t i = 1; i < n; ++i) {
    const double step = norm(sub(tip_[i], tip_[i - 1]));
    arc_[i] = arc_[i - 1] + step;
    if (extruding_[i]) max_step_mm_ = std::max(max_step_mm_, std::min(step, 5.0));
  }
  const double near_plate = 2.0 * params_.support_radius_mm;
  for (const uint32_t i : pass_points_) {
    const uint32_t* s = supports(i);
    if (s[0] == kNoIndex) {
      if (tip_[i].z <= near_plate) depth_plate_[i] = 0.0;
      continue;
    }
    double best = kInf;
    for (int j = 0; j < kSupportSlots && s[j] != kNoIndex; ++j) {
      best = std::min(best, depth_plate_[s[j]] + norm(sub(tip_[i], tip_[s[j]])));
    }
    depth_plate_[i] = best;
  }
  for (size_t k = pass_points_.size(); k-- > 0;) {
    const uint32_t i = pass_points_[k];
    if (rev_start_[i] == rev_start_[i + 1]) {
      depth_top_[i] = 0.0;
      continue;
    }
    double best = kInf;
    for (uint32_t r = rev_start_[i]; r < rev_start_[i + 1]; ++r) {
      best = std::min(best, depth_top_[rev_[r]] + norm(sub(tip_[rev_[r]], tip_[i])));
    }
    depth_top_[i] = best;
  }
}

// Profondeurs en marge d'epaisseur pour un glissement dans le sens `sign` de l'empilement. Une
// couche est le pas entre un point et son support ; sa marge est ce qu'elle peut encore gagner
// (etiree : max_layer - h) ou perdre (comprimee : h - min_layer). Sous le noeud, les couches sont
// etirees en montant (sign > 0) et comprimees en descendant ; au-dessus, l'inverse. Epaisseur
// inconnue : marge nulle (la couche suit sans se deformer). Points fixes, d'ou partent les
// profondeurs : plateau et surface libre, et tout point hors de la portee recommandee (la portee
// se comporte comme un ancrage tant qu'elle n'est pas elargie).
void EditKernel::compute_slack_depths(int sign, const InfluenceParams& p, const Vec3& center) {
  auto outside = [&](uint32_t i) {
    if (!p.spatial.enabled) return false;
    const Vec3 offset = sub(tip_[i], center);
    return norm(offset) > spatial_reach(p, offset);
  };
  const size_t n = r_.size();
  const double hmin = min_layer_floor(), hmax = hmax_eff();
  auto stretch = [&](uint32_t i) {
    const float h = height_all_[i];
    return std::isfinite(h) ? std::max(0.0, hmax - static_cast<double>(h)) : 0.0;
  };
  auto compress = [&](uint32_t i) {
    const float h = height_all_[i];
    return std::isfinite(h) ? std::max(0.0, static_cast<double>(h) - hmin) : 0.0;
  };
  slack_plate_.assign(n, kInf);
  slack_top_.assign(n, kInf);
  for (const uint32_t i : pass_points_) {
    if (depth_plate_[i] <= 0.0 || outside(i)) {
      slack_plate_[i] = 0.0;
      continue;
    }
    const uint32_t* s = supports(i);
    if (s[0] == kNoIndex) continue;
    double best = kInf;
    for (int j = 0; j < kSupportSlots && s[j] != kNoIndex; ++j) best = std::min(best, slack_plate_[s[j]]);
    slack_plate_[i] = best + (sign > 0 ? stretch(i) : compress(i));
  }
  for (size_t k = pass_points_.size(); k-- > 0;) {
    const uint32_t i = pass_points_[k];
    if (depth_top_[i] <= 0.0 || outside(i)) {
      slack_top_[i] = 0.0;
      continue;
    }
    double best = kInf;
    for (uint32_t r = rev_start_[i]; r < rev_start_[i + 1]; ++r) {
      const uint32_t above = rev_[r];
      best = std::min(best, slack_top_[above] + (sign > 0 ? compress(above) : stretch(above)));
    }
    slack_top_[i] = best;
  }
}

// Coque : dans la couche du point (decalage le long de l'axe de tete inferieur a la moitie de son
// epaisseur), aucun voisin d'un des deux cotes de la trajectoire. Normale de paroi : perpendiculaire
// a la trajectoire et a la direction vers son plus proche support (la paroi monte par la), ou a
// l'axe de tete sans support.
void EditKernel::classify_shell(uint32_t i) {
  if (shell_state_[i] >= 0) return;
  const int32_t pass = pass_[i];
  if (pass < 0) {
    shell_state_[i] = 0;
    return;
  }
  uint32_t prev = i, next = i;
  if (i > 0 && pass_[i - 1] == pass) prev = i - 1;
  else if (pass_closed_[pass] && i == pass_start_[pass]) prev = pass_end_[pass] - 1;
  if (i + 1 < r_.size() && pass_[i + 1] == pass) next = i + 1;
  else if (pass_closed_[pass] && i == pass_end_[pass]) next = pass_start_[pass] + 1;
  const Vec3 a = axis_[i];
  Vec3 t = sub(tip_[next], tip_[prev]);
  t = sub(t, scale(dot(t, a), a));
  const double tl = norm(t);
  if (!(tl > 1e-9)) {
    shell_state_[i] = 0;
    return;
  }
  t = scale(1.0 / tl, t);
  const Vec3 side = cross(t, a);  // unitaire : t et a orthonormes
  const float h = height_of(i, tip_[i], a, [&](uint32_t j) -> const Vec3& { return tip_[j]; });
  const double half = 0.5 * (std::isfinite(h) && h > 0.0f ? static_cast<double>(h) : 0.2);
  const double radius = kShellSearchFactor * params_.support_radius_mm;
  const Vec3 p = tip_[i];
  bool plus = false, minus = false;
  for_each_in_box(sub(p, {radius, radius, radius}), add(p, {radius, radius, radius}), [&](uint32_t q) {
    if (q == i || (plus && minus)) return;
    const Vec3 o = sub(tip_[q], p);
    if (std::abs(dot(o, a)) > half || dot(o, o) > radius * radius) return;
    const double lateral = dot(o, side);
    if (lateral > kShellSideMm) plus = true;
    else if (lateral < -kShellSideMm) minus = true;
  });
  const bool shell = !(plus && minus);
  if (shell) {
    const uint32_t s0 = supports(i)[0];
    const Vec3 up = s0 != kNoIndex ? sub(p, tip_[s0]) : a;
    Vec3 nrm = cross(t, up);
    const double nl = norm(nrm);
    shell_normal_[i] = nl > 1e-9 * std::max(1.0, norm(up)) ? scale(1.0 / nl, nrm) : side;
  }
  shell_state_[i] = shell ? 1 : 0;
}

bool EditKernel::is_shell(uint32_t i) {
  classify_shell(i);
  return shell_state_[i] == 1;
}

// Hauteur locale : distance, le long de l'axe de tete, au plus proche de ses supports. Negative si
// la deformation fait traverser la matiere d'en dessous. Sans support : hauteur au-dessus du
// plateau pres de celui-ci, inconnue (NaN) ailleurs (debut de surplomb, point isole).
template <class TipOf>
float EditKernel::height_of(uint32_t i, const Vec3& tip, const Vec3& axis, TipOf&& tip_of) const {
  constexpr float kUnknown = std::numeric_limits<float>::quiet_NaN();
  if (pass_[i] < 0) return kUnknown;
  const uint32_t* s = supports(i);
  if (s[0] == kNoIndex) return tip.z <= 2.0 * params_.support_radius_mm ? static_cast<float>(tip.z) : kUnknown;
  double best = kInf;
  for (int j = 0; j < kSupportSlots && s[j] != kNoIndex; ++j) best = std::min(best, dot(sub(tip, tip_of(s[j])), axis));
  return static_cast<float>(best);
}

// ---------------------------------------------------------------------------------------------
// Verrous
// ---------------------------------------------------------------------------------------------

void EditKernel::set_locked(const uint32_t* indices, size_t count, bool locked) {
  for (size_t k = 0; k < count; ++k) {
    if (indices[k] < locked_.size()) locked_[indices[k]] = locked ? 1 : 0;
  }
}

std::vector<uint32_t> EditKernel::lock_region(uint32_t index, double radius_mm, bool locked) {
  std::vector<uint32_t> out;
  if (index >= r_.size() || !(radius_mm > 0.0)) return out;
  const uint32_t h = snap_to_pass_point(index);
  if (h == kNoIndex) return out;
  const Vec3 c = tip_[h];
  const double rr = radius_mm;
  for_each_in_box(sub(c, {rr, rr, rr}), add(c, {rr, rr, rr}), [&](uint32_t q) {
    if (norm(sub(tip_[q], c)) <= rr) out.push_back(q);
  });
  std::sort(out.begin(), out.end());
  for (const uint32_t q : out) locked_[q] = locked ? 1 : 0;
  return out;
}

std::vector<uint32_t> EditKernel::locked_indices() const {
  std::vector<uint32_t> out;
  for (size_t i = 0; i < locked_.size(); ++i) if (locked_[i]) out.push_back(static_cast<uint32_t>(i));
  return out;
}

void EditKernel::clear_locks() { std::fill(locked_.begin(), locked_.end(), uint8_t{0}); }

// ---------------------------------------------------------------------------------------------
// Poignee et influence
// ---------------------------------------------------------------------------------------------

uint32_t EditKernel::snap_to_pass_point(uint32_t index) const {
  if (pass_[index] >= 0) return index;
  const size_t n = r_.size();
  for (size_t d = 1; d < n; ++d) {
    bool inside = false;
    if (index >= d) {
      inside = true;
      if (pass_[index - d] >= 0) return static_cast<uint32_t>(index - d);
    }
    if (index + d < n) {
      inside = true;
      if (pass_[index + d] >= 0) return static_cast<uint32_t>(index + d);
    }
    if (!inside) break;
  }
  return kNoIndex;
}

bool EditKernel::set_handle(uint32_t index, const InfluenceParams& p_in) {
  clear_handle();
  InfluenceParams p = p_in;
  if (p.trim.enabled) {
    // Rognage : seules la couche de la poignee et `layers` couches de part et d'autre se deforment
    // (la sphere d'influence reste la limite laterale) ; le reste est rogne, pas comprime.
    p.adjacency.enabled = true;
    p.adjacency.before = p.adjacency.after = true;
    p.adjacency.hops_before = p.adjacency.hops_after = p.trim.layers;
    p.combine = Combine::Product;
  }
  trim_enabled_ = p.trim.enabled;
  trim_clearance_ = p.trim.clearance_mm > 0.0 ? p.trim.clearance_mm : 0.9 * params_.bead_width_mm;
  smooth_b_ = std::clamp(p.smooth_b, 0.0, 1.0);
  type_barrier_ = p.type_barrier && type_.size() == r_.size();
  smooth_b_iterations_ = p.smooth_b_iterations;
  extrusion_mode_ = p.extrusion;
  extrusion_factor_ = p.extrusion_factor;
  refusal_ = HandleRefusal::Invalid;
  const size_t n = r_.size();
  if (index >= n) return false;
  const uint32_t h = snap_to_pass_point(index);
  if (h == kNoIndex) return false;
  refusal_ = HandleRefusal::Locked;
  if (locked_[h]) return false;
  // L'objet garde sa forme : la premiere couche et la surface libre ne bougent pas.
  keep_shape_ = p.keep_shape;
  reslice_ = p.reslice && keep_shape_ && !p.trim.enabled;
  reslice_max_ = std::max<uint32_t>(1, p.reslice_max_layers);
  refusal_ = HandleRefusal::Plate;
  if (keep_shape_ && depth_plate_[h] <= 0.0) return false;
  refusal_ = HandleRefusal::Surface;
  if (keep_shape_ && !p.trim.enabled && depth_top_[h] <= 0.0) return false;
  refusal_ = HandleRefusal::None;

  const Vec3 center = tip_[h];
  const bool product = p.combine == Combine::Product;
  // En mode produit, la sphere RESTREINT les parcours ; en mode maximum, elle s'y AJOUTE.
  const bool restrict_to_sphere = product && p.spatial.enabled;
  // « Sphere » au sens large : la portee depend de la direction quand des poignees l'orientent.
  auto in_sphere = [&](uint32_t q) {
    const Vec3 offset = sub(tip_[q], center);
    return norm(offset) <= spatial_reach(p, offset);
  };
  double max_reach = std::max(p.spatial.radius_mm, 0.0);
  for (const DirectionalReach& r : p.directions) max_reach = std::max(max_reach, r.reach_mm);
  auto allowed = [&](uint32_t q) { return !restrict_to_sphere || in_sphere(q); };

  // Plateau et surface libre fixes : le poids s'annule en s'en approchant, selon la profondeur du
  // point rapportee a celle du noeud (bornee a la portee : une limite hors de portee n'affaiblit
  // que la bordure de l'influence).
  const double plate_scale = std::min(depth_plate_[h], std::max(max_reach, 1e-6));
  const double top_scale = std::min(depth_top_[h], std::max(max_reach, 1e-6));
  // Sens d'empilement du glissement : monter etire les couches sous le noeud et comprime celles du
  // dessus ; descendre, l'inverse. Profondeurs alors comptees en marge d'epaisseur.
  stack_sign_ = 0;
  direction_stale_ = false;
  if (keep_shape_) {
    const double dl = norm(p.drag_direction);
    if (dl > 0.0) {
      const double along = dot(p.drag_direction, axis_[h]) / dl;
      stack_sign_ = along > kStackThreshold ? 1 : along < -kStackThreshold ? -1 : 0;
    }
  }
  if (stack_sign_ != 0 && !p.trim.enabled) compute_slack_depths(stack_sign_, p, center);
  const bool slack_ready = stack_sign_ != 0 && !p.trim.enabled;
  const double slack_plate_h = slack_ready ? slack_plate_[h] : 0.0;
  const double slack_top_h = slack_ready ? slack_top_[h] : 0.0;
  capacity_mm_ = slack_ready ? std::min(slack_plate_h, slack_top_h) : kInf;
  // Rampe lineaire en marge : chaque couche se deforme au prorata de sa marge.
  auto slack_ramp = [](double depth, double scale) {
    if (!(depth < kInf)) return 1.0;
    if (!(scale > 0.0)) return depth > 0.0 ? 1.0 : 0.0;
    return std::min(1.0, depth / scale);
  };
  auto boundary_factor = [&](uint32_t q) {
    if (!keep_shape_) return 1.0;
    // Rognage : la matiere fixe ne retient rien (elle est rognee) ; seul le plateau reste en place.
    if (p.trim.enabled) return depth_plate_[q] <= 0.0 ? 0.0 : 1.0;
    // Fixes : premiere couche et surface libre, quel que soit le sens.
    if (depth_plate_[q] <= 0.0 || depth_top_[q] <= 0.0) return 0.0;
    if (stack_sign_ != 0) return slack_ramp(slack_plate_[q], slack_plate_h) * slack_ramp(slack_top_[q], slack_top_h);
    return smoothstep01(depth_plate_[q] / plate_scale) * smoothstep01(depth_top_[q] / top_scale);
  };

  // Voisins le long du cordon (meme passe), raccord des boucles fermees compris.
  auto for_each_along = [&](uint32_t u, auto&& visit) {
    const int32_t pass = pass_[u];
    if (u > 0 && pass_[u - 1] == pass) visit(u - 1);
    if (u + 1 < n && pass_[u + 1] == pass) visit(u + 1);
    if (pass_closed_[pass]) {
      if (u == pass_start_[pass]) visit(pass_end_[pass]);
      else if (u == pass_end_[pass]) visit(pass_start_[pass]);
    }
  };
  // Contacts avec les trajectoires adjacentes : supports (avant), puis points poses dessus (apres).
  auto for_each_contact = [&](uint32_t u, auto&& visit) {
    const uint32_t* s = supports(u);
    for (int j = 0; j < kSupportSlots && s[j] != kNoIndex; ++j) visit(s[j]);
    for (uint32_t k = rev_start_[u]; k < rev_start_[u + 1]; ++k) visit(rev_[k]);
  };

  std::vector<uint32_t> touched_along, touched_hops, sphere;

  // Abscisse curviligne (Dijkstra) : un pas le long du cordon coute sa longueur, un contact entre
  // cordons coute son seul decalage LATERAL (perpendiculaire a l'axe de tete). Un contact gratuit
  // laisserait une colonne deriver de cote de couche en couche sans rien payer.
  if (p.along.enabled) {
    using Item = std::pair<double, uint32_t>;
    std::priority_queue<Item, std::vector<Item>, std::greater<Item>> queue;
    const double limit = p.along.radius_mm;
    along_[h] = 0.0;
    touched_along.push_back(h);
    queue.push({0.0, h});
    while (!queue.empty()) {
      const double d = queue.top().first;
      const uint32_t u = queue.top().second;
      queue.pop();
      if (d > along_[u]) continue;
      auto relax = [&](uint32_t v, double cost) {
        const double nd = d + cost;
        if (nd > limit || nd >= along_[v] || !allowed(v)) return;
        if (along_[v] == kInf) touched_along.push_back(v);
        along_[v] = nd;
        queue.push({nd, v});
      };
      for_each_along(u, [&](uint32_t v) { relax(v, norm(sub(tip_[v], tip_[u]))); });
      const Vec3 a = axis_[u];
      for_each_contact(u, [&](uint32_t v) {
        const Vec3 d3 = sub(tip_[v], tip_[u]);
        relax(v, norm(sub(d3, scale(dot(d3, a), a))));
      });
    }
  }

  // Nombre de trajectoires adjacentes franchies (parcours 0-1) : avancer le long d'un cordon est
  // gratuit, chaque contact entre deux cordons compte 1.
  if (p.adjacency.enabled) {
    const uint32_t cap = std::max(p.adjacency.before ? p.adjacency.hops_before : 0u,
                                  p.adjacency.after ? p.adjacency.hops_after : 0u);
    std::deque<uint32_t> queue;
    hops_[h] = 0;
    touched_hops.push_back(h);
    queue.push_back(h);
    // Rognage : ecart cumule le long de l'axe de tete depuis l'entree dans la couche (pas a pas, axe
    // local). Une couche, meme courbe, reste a ecart nul (la tete lui est normale) ; on la quitte des
    // qu'il depasse une demi-epaisseur : une spirale continue (toutes les couches en une passe)
    // s'arrete apres un tour, un enchainement de petits pas ne derive pas jusqu'a la couche voisine.
    auto half_layer = [&](uint32_t i) {
      const float hl = height_all_[i];
      return 0.5 * (std::isfinite(hl) && hl > 0.0f ? static_cast<double>(hl) : params_.max_layer_mm);
    };
    if (p.trim.enabled) drift_[h] = 0.0f;
    while (!queue.empty()) {
      const uint32_t u = queue.front();
      queue.pop_front();
      const uint32_t hu = hops_[u];
      const Vec3 tu = tip_[u];
      const Vec3 au = axis_[u];
      auto reach_free = [&](uint32_t v) {
        if (hu >= hops_[v] || !allowed(v)) return;
        if (p.trim.enabled) {
          const double step = dot(sub(tip_[v], tu), au);
          const double o = static_cast<double>(drift_[u]) + step;
          if (std::abs(step) > half_layer(u) || std::abs(o) > half_layer(v)) return;
          // Deux points en contact (l'un repose sur l'autre) ne sont jamais de la meme couche.
          bool touches = false;
          for_each_contact(v, [&](uint32_t x) { if (hops_[x] == hu) touches = true; });
          if (touches) return;
          drift_[v] = static_cast<float>(o);
        }
        if (hops_[v] == kUnreached) touched_hops.push_back(v);
        hops_[v] = hu;
        queue.push_front(v);
      };
      for_each_along(u, reach_free);
      // Rognage : les trajectoires voisines de la MEME couche (decalage lateral de quelques largeurs
      // de cordon, meme niveau le long de l'axe) comptent comme la meme couche, gratuitement ; le
      // graphe de contacts, lui, ne relie que des couches differentes.
      if (p.trim.enabled && pass_[u] >= 0) {
        const double lateral = 2.0 * params_.bead_width_mm;
        for_each_in_box(sub(tu, {lateral, lateral, lateral}), add(tu, {lateral, lateral, lateral}), [&](uint32_t v) {
          if (v == u || pass_[v] < 0 || norm(sub(tip_[v], tu)) > lateral) return;
          reach_free(v);
        });
      }
      if (hu >= cap) continue;
      for_each_contact(u, [&](uint32_t v) {
        if (hu + 1 >= hops_[v] || !allowed(v)) return;
        if (hops_[v] == kUnreached) touched_hops.push_back(v);
        hops_[v] = hu + 1;
        if (p.trim.enabled) drift_[v] = 0.0f;   // autre couche : l'ecart repart de zero
        queue.push_back(v);
      });
    }
  }

  // Sphere : seule source de candidats en produit sans autre metrique, une source de plus en maximum.
  if (p.spatial.enabled && (!product || (!p.along.enabled && !p.adjacency.enabled))) {
    const double rr = max_reach;
    for_each_in_box(sub(center, {rr, rr, rr}), add(center, {rr, rr, rr}), [&](uint32_t q) {
      if (in_sphere(q)) sphere.push_back(q);
    });
  }

  std::vector<uint32_t> candidates;
  auto add_candidate = [&](uint32_t q) {
    if (mark_[q]) return;
    mark_[q] = 1;
    candidates.push_back(q);
  };
  add_candidate(h);
  if (product) {
    if (p.along.enabled) {
      for (const uint32_t q : touched_along) {
        if (!p.adjacency.enabled || hops_[q] != kUnreached) add_candidate(q);
      }
    } else if (p.adjacency.enabled) {
      for (const uint32_t q : touched_hops) add_candidate(q);
    } else {
      for (const uint32_t q : sphere) add_candidate(q);
    }
  } else {
    for (const uint32_t q : touched_along) add_candidate(q);
    for (const uint32_t q : touched_hops) add_candidate(q);
    for (const uint32_t q : sphere) add_candidate(q);
  }

  // Le cote (avant / apres) d'un point se lit dans l'ordre de depot, relativement a la poignee.
  auto hop_factor = [&](uint32_t q) -> double {
    const uint32_t k = hops_[q];
    if (k == kUnreached) return 0.0;
    if (k == 0) return 1.0;
    const bool before = q < h;
    if (before ? !p.adjacency.before : !p.adjacency.after) return 0.0;
    const uint32_t limit = before ? p.adjacency.hops_before : p.adjacency.hops_after;
    if (k > limit) return 0.0;
    return falloff(p.adjacency.falloff, static_cast<double>(k) / (static_cast<double>(limit) + 1.0));
  };

  struct Entry {
    uint32_t index;
    float weight;
    uint32_t left = kNoIndex, right = kNoIndex;
    float frac = 0.0f;
  };
  std::vector<Entry> chosen;
  chosen.reserve(candidates.size());
  for (const uint32_t q : candidates) {
    bool any = false;
    double prod = 1.0, best = 0.0;
    auto use = [&](double f) {
      any = true;
      prod *= f;
      best = std::max(best, f);
    };
    if (p.spatial.enabled) {
      Vec3 offset = sub(tip_[q], center);
      // Le long de l'empilement, la repartition suit la marge d'epaisseur (boundary_factor) : la
      // decroissance ne porte plus que sur l'ecart lateral au noeud.
      if (stack_sign_ != 0) offset = sub(offset, scale(dot(offset, axis_[h]), axis_[h]));
      const double reach = spatial_reach(p, offset);
      use(reach > 0.0 ? falloff(p.spatial.falloff, norm(offset) / reach) : (norm(offset) <= 0.0 ? 1.0 : 0.0));
    }
    if (p.along.enabled) use(along_[q] == kInf ? 0.0 : distance_factor(p.along, along_[q]));
    if (p.adjacency.enabled) use(hop_factor(q));
    double w = any ? (product ? prod : best) : 0.0;
    if (!p.anchors.empty()) w *= anchor_factor(p, tip_[q]);
    w *= boundary_factor(q);
    if (q == h) w = 1.0;
    else if (locked_[q]) w = 0.0;
    if (type_barrier_ && q != h && type_[q] != type_[h]) w = 0.0;
    if (w > kMinWeight) chosen.push_back({q, static_cast<float>(w)});
  }
  for (const uint32_t q : candidates) mark_[q] = 0;
  for (const uint32_t q : touched_along) along_[q] = kInf;
  for (const uint32_t q : touched_hops) hops_[q] = kUnreached;

  // Points de deplacement a vide : chaque suite est encadree par deux points de matiere (ou un
  // seul en debut / fin de fichier). Son poids (pour l'affichage) et son deplacement sont
  // interpoles selon l'indice entre ces deux extremites : un degagement suit la fin de passe
  // qu'il quitte, une approche la passe qu'elle rejoint.
  auto by_index = [](const Entry& x, const Entry& y) { return x.index < y.index; };
  std::sort(chosen.begin(), chosen.end(), by_index);
  for (size_t k = 0; k < chosen.size(); ++k) slot_[chosen[k].index] = static_cast<int32_t>(k);
  auto weight_of = [&](uint32_t q) -> double {
    return slot_[q] >= 0 ? static_cast<double>(chosen[static_cast<size_t>(slot_[q])].weight) : 0.0;
  };
  std::vector<Entry> travel;
  std::vector<uint32_t> runs;
  auto take_run = [&](size_t start_hint) {
    size_t a = start_hint, e = start_hint;
    while (a > 0 && pass_[a - 1] < 0) --a;
    while (e < n && pass_[e] < 0) ++e;
    if (mark_[a]) return;
    mark_[a] = 1;
    runs.push_back(static_cast<uint32_t>(a));
    const bool has_left = a > 0, has_right = e < n;
    const uint32_t left = has_left ? static_cast<uint32_t>(a - 1) : kNoIndex;
    const uint32_t right = has_right ? static_cast<uint32_t>(e) : kNoIndex;
    const double wl = has_left ? weight_of(left) : weight_of(right);
    const double wr = has_right ? weight_of(right) : wl;
    const double span = static_cast<double>(e - a + 1);
    for (size_t t = a; t < e; ++t) {
      const double f = has_left && has_right ? static_cast<double>(t - a + 1) / span : (has_left ? 0.0 : 1.0);
      const double w = wl + (wr - wl) * f;
      if (!locked_[t] && w > kMinWeight) {
        travel.push_back({static_cast<uint32_t>(t), static_cast<float>(w), left, right, static_cast<float>(f)});
      }
    }
  };
  for (const Entry& entry : chosen) {
    const uint32_t q = entry.index;
    if (q + 1 < n && pass_[q + 1] < 0) take_run(q + 1);
    if (q > 0 && pass_[q - 1] < 0) take_run(q - 1);
  }
  for (const uint32_t a : runs) mark_[a] = 0;
  for (const Entry& entry : chosen) slot_[entry.index] = -1;
  chosen.insert(chosen.end(), travel.begin(), travel.end());
  std::sort(chosen.begin(), chosen.end(), by_index);

  const size_t m = chosen.size();
  affected_.resize(m);
  weights_.resize(m);
  link_left_.resize(m);
  link_right_.resize(m);
  link_frac_.resize(m);
  for (size_t k = 0; k < m; ++k) {
    affected_[k] = chosen[k].index;
    weights_[k] = chosen[k].weight;
    link_left_[k] = chosen[k].left;
    link_right_[k] = chosen[k].right;
    link_frac_[k] = chosen[k].frac;
    slot_[chosen[k].index] = static_cast<int32_t>(k);
  }

  // Coques des points de matiere touches (normale de paroi) ; nulle pour les autres.
  slide_.assign(3 * m, 0.0f);
  if (keep_shape_) parallel_for(m, threads_, 1024, [&](size_t lo, size_t hi) {
    for (size_t k = lo; k < hi; ++k) {
      const uint32_t q = affected_[k];
      if (pass_[q] < 0) continue;
      classify_shell(q);
      if (shell_state_[q] != 1) continue;
      slide_[3 * k] = static_cast<float>(shell_normal_[q].x);
      slide_[3 * k + 1] = static_cast<float>(shell_normal_[q].y);
      slide_[3 * k + 2] = static_cast<float>(shell_normal_[q].z);
    }
  });

  // Dependants : points immobiles qui reposent sur un point deplace (leur hauteur change).
  for (const uint32_t q : affected_) {
    for (uint32_t k = rev_start_[q]; k < rev_start_[q + 1]; ++k) {
      const uint32_t v = rev_[k];
      if (slot_[v] >= 0 || mark_[v]) continue;
      mark_[v] = 1;
      dependents_.push_back(v);
    }
  }
  for (const uint32_t v : dependents_) mark_[v] = 0;
  std::sort(dependents_.begin(), dependents_.end());

  auto committed_tip = [&](uint32_t j) -> const Vec3& { return tip_[j]; };
  base_heights_.resize(affected_.size() + dependents_.size());
  for (size_t k = 0; k < affected_.size(); ++k) {
    const uint32_t q = affected_[k];
    base_heights_[k] = height_of(q, tip_[q], axis_[q], committed_tip);
  }
  for (size_t k = 0; k < dependents_.size(); ++k) {
    const uint32_t q = dependents_[k];
    base_heights_[affected_.size() + k] = height_of(q, tip_[q], axis_[q], committed_tip);
  }

  handle_ = h;
  return true;
}

// ---------------------------------------------------------------------------------------------
// Deformation
// ---------------------------------------------------------------------------------------------

// C est IMPOSE par la position (machine actuelle). Des deux representants (r', C) et (-r', C + 180)
// d'une meme pointe, on garde celui qui prolonge l'angle d'origine du point : la pointe peut etre
// de l'autre cote du centre que le pivot (R - L sin B < 0). Au centre, C est herite.
void EditKernel::polar_of(uint32_t i, const Vec3& tip, double& c_deg, double& tip_r) const {
  const double rt = std::hypot(tip.x, tip.y);
  c_deg = c_[i];
  tip_r = 0.0;
  if (!(rt > 1e-9)) return;
  const double polar = std::atan2(tip.y, tip.x) / kDeg;
  const double direct = unwrap_near(polar, c_[i]);
  const double flipped = unwrap_near(polar + 180.0, c_[i]);
  if (std::abs(flipped - c_[i]) < std::abs(direct - c_[i])) {
    c_deg = flipped;
    tip_r = -rt;
  } else {
    c_deg = direct;
    tip_r = rt;
  }
}

// Pointe et axe de tete -> valeurs firmware. B est l'inclinaison de l'axe dans le plan radial ; sa
// composante tangentielle, que la machine ne peut pas produire, est rendue comme residu (jamais
// ignoree).
void EditKernel::firmware_from(uint32_t i, const Vec3& tip, const Vec3& axis, double* out, float& residual) const {
  double c_deg = 0.0, tip_r = 0.0;
  polar_of(i, tip, c_deg, tip_r);
  const double cr = c_deg * kDeg;
  const double cc = std::cos(cr), sc = std::sin(cr);
  const double ar = axis.x * cc + axis.y * sc;
  const double at = -axis.x * sc + axis.y * cc;
  const double b_deg = unwrap_near(std::atan2(ar, axis.z) / kDeg, b_[i]);
  const double br = b_deg * kDeg;
  residual = static_cast<float>(std::asin(std::min(1.0, std::abs(at))) / kDeg);
  out[0] = tip_r + params_.pivot_mm * std::sin(br);
  out[1] = c_deg;
  out[2] = tip.z - params_.pivot_mm * (1.0 - std::cos(br));
  out[3] = b_deg;
}

// Meme conversion quand B est donne directement (points de deplacement a vide).
void EditKernel::firmware_from_b(uint32_t i, const Vec3& tip, double b_deg, double* out) const {
  double c_deg = 0.0, tip_r = 0.0;
  polar_of(i, tip, c_deg, tip_r);
  const double br = b_deg * kDeg;
  out[0] = tip_r + params_.pivot_mm * std::sin(br);
  out[1] = c_deg;
  out[2] = tip.z - params_.pivot_mm * (1.0 - std::cos(br));
  out[3] = b_deg;
}

void EditKernel::drag(const Transform& transform, bool with_heights) {
  if (!has_handle()) return;
  const size_t m = affected_.size();
  const Vec3 center = tip_[handle_];
  const double axis_len = norm(transform.axis);
  const bool rotating = axis_len > 1e-12 && transform.angle_rad != 0.0;
  const Vec3 k = rotating ? scale(1.0 / axis_len, transform.axis) : Vec3{};

  deformed_.resize(kValuesPerPoint * m);
  residual_.resize(m);
  dtip_.resize(m);
  daxis_.resize(m);

  // Projection d'une coque sur sa paroi (plan tangent) ; sans effet hors coque.
  auto slid = [&](size_t s, const Vec3& v) {
    if (slide_.empty()) return v;
    const Vec3 nrm{slide_[3 * s], slide_[3 * s + 1], slide_[3 * s + 2]};
    return sub(v, scale(dot(v, nrm), nrm));
  };
  auto is_shell_slot = [&](size_t s) {
    return !slide_.empty() && (slide_[3 * s] != 0.0f || slide_[3 * s + 1] != 0.0f || slide_[3 * s + 2] != 0.0f);
  };
  // Deplacement du point de matiere touche (rang s) du a la translation T (meme formule que le
  // shader) : le long de l'empilement, avance le long de son axe ; sinon translation glissee.
  const Vec3 handle_axis = axis_[handle_];
  auto translated = [&](size_t s, const Vec3& T) -> Vec3 {
    const double w = weights_[s];
    if (stack_sign_ == 0) return slid(s, scale(w, T));
    const double tau = dot(T, handle_axis);
    const Vec3 lateral = sub(T, scale(tau, handle_axis));
    Vec3 d = scale(w * tau, axis_[affected_[s]]);
    if (!is_shell_slot(s)) d = add(d, scale(w, lateral));
    return d;
  };
  // Freinage : chaque couple (point, support) ne doit ni passer sous min(min_layer, epaisseur
  // actuelle) ni, pour le support le plus proche, depasser max(max_layer, epaisseur actuelle).
  // Pour une translation, l'epaisseur varie lineairement : s_max = plus petite borne atteinte le
  // long de la translation demandee (la rotation n'est pas freinee).
  const Vec3 wanted = transform.translation;
  double limit = kInf;
  limit_point_ = limit_support_ = kNoIndex;
  if (keep_shape_ && norm(wanted) > 0.0) {
    const double hmin = min_layer_floor(), hmax = hmax_eff();
    auto shift_of = [&](uint32_t j) -> Vec3 {
      const int32_t s = slot_[j];
      if (s < 0) return Vec3{};
      return translated(static_cast<size_t>(s), wanted);
    };
    const size_t total = m + dependents_.size();
    const size_t chunks = std::max<size_t>(1, (total + kParallelGrain - 1) / kParallelGrain);
    std::vector<double> part(chunks, kInf);
    std::vector<uint32_t> part_point(chunks, kNoIndex), part_support(chunks, kNoIndex);
    parallel_for(total, threads_, kParallelGrain, [&](size_t lo, size_t hi) {
      double local = kInf;
      uint32_t local_point = kNoIndex, local_support = kNoIndex;
      auto bound = [&](double v, uint32_t q, uint32_t sj) {
        if (v < local) {
          local = v;
          local_point = q;
          local_support = sj;
        }
      };
      for (size_t s = lo; s < hi; ++s) {
        const uint32_t q = s < m ? affected_[s] : dependents_[s - m];
        if (pass_[q] < 0) continue;
        const uint32_t* sup = supports(q);
        if (sup[0] == kNoIndex) continue;
        const Vec3 a = axis_[q];
        const Vec3 dq = shift_of(q);
        // Epaisseur = plus petite hauteur au-dessus des supports (cf. height_of) : elle ne passe pas
        // sous min(min_layer, actuelle) (aucun couple ne descend sous ce plancher), et la couche qui
        // la porte (le couple le plus bas) ne depasse pas max(max_layer, actuelle).
        double h0_min = kInf;
        int j_min = 0;
        for (int j = 0; j < kSupportSlots && sup[j] != kNoIndex; ++j) {
          const double h0 = dot(sub(tip_[q], tip_[sup[j]]), a);
          if (h0 < h0_min) {
            h0_min = h0;
            j_min = j;
          }
        }
        const double floor_h = std::min(hmin, h0_min - kLayerTolerance);
        // Rognage : un couple qui touche de la matiere fixe ne freine pas, ni compresse (elle est rognee)
        // ni etire ; seuls les couples de matiere deplacee (couches deformables) gardent leurs bornes.
        if (trim_enabled_ && s >= m) continue;
        for (int j = 0; j < kSupportSlots && sup[j] != kNoIndex; ++j) {
          if (trim_enabled_ && slot_[sup[j]] < 0) continue;
          const double h0 = dot(sub(tip_[q], tip_[sup[j]]), a);
          const double rate = dot(sub(dq, shift_of(sup[j])), a);
          if (rate < 0.0) bound(std::max(0.0, h0 - floor_h) / -rate, q, sup[j]);
          if (j == j_min && rate > 0.0) bound(std::max(0.0, std::max(hmax, h0 + kLayerTolerance) - h0) / rate, q, sup[j]);
        }
      }
      const size_t c = lo / kParallelGrain;
      if (local < part[c]) {
        part[c] = local;
        part_point[c] = local_point;
        part_support[c] = local_support;
      }
    });
    for (size_t c = 0; c < chunks; ++c) {
      if (part[c] < limit) {
        limit = part[c];
        limit_point_ = part_point[c];
        limit_support_ = part_support[c];
      }
    }
  }
  limit_scale_ = limit;
  applied_translation_ = scale(brake_factor(limit), wanted);
  if (keep_shape_ && norm(wanted) > 0.0) {
    const double along = dot(wanted, axis_[handle_]) / norm(wanted);
    const int sign = along > kStackThreshold ? 1 : along < -kStackThreshold ? -1 : 0;
    direction_stale_ = sign != stack_sign_;
  } else {
    direction_stale_ = false;
  }
  const Vec3 T = applied_translation_;

  // Freinage de la rotation : la plus grande fraction f de l'angle demande qui garde chaque couple
  // (point, support) entre les memes bornes d'epaisseur que la translation (recherche par bissection :
  // l'epaisseur ne varie pas lineairement avec l'angle).
  double angle_used = rotating ? transform.angle_rad : 0.0;
  if (keep_shape_ && rotating) {
    const double hmin = min_layer_floor(), hmax = hmax_eff();
    auto deform_tip = [&](size_t s, double ang, Vec3& tip_out, Vec3& axis_out) {
      const uint32_t q = affected_[s];
      Vec3 rel = sub(tip_[q], center);
      Vec3 a = axis_[q];
      const double w = weights_[s];
      if (ang != 0.0) {
        const double ct = std::cos(w * ang), st = std::sin(w * ang);
        rel = rotate(rel, k, ct, st);
        a = rotate(a, k, ct, st);
      }
      tip_out = add(add(tip_[q], slid(s, sub(add(center, rel), tip_[q]))), translated(s, T));
      axis_out = a;
    };
    const size_t total = m + dependents_.size();
    std::vector<Vec3> trial_tip(m), trial_axis(m);
    auto within_bounds = [&](double ang) -> bool {
      // Pointes et axes deformes calcules UNE fois par angle d'essai (les supports les relisent).
      parallel_for(m, threads_, kParallelGrain, [&](size_t lo, size_t hi) {
        for (size_t s = lo; s < hi; ++s) deform_tip(s, ang, trial_tip[s], trial_axis[s]);
      });
      std::vector<uint8_t> bad((total + kParallelGrain - 1) / kParallelGrain, 0);
      auto tip_at = [&](uint32_t j) -> const Vec3& {
        const int32_t s = slot_[j];
        return s < 0 ? tip_[j] : trial_tip[static_cast<size_t>(s)];
      };
      parallel_for(total, threads_, kParallelGrain, [&](size_t lo, size_t hi) {
        bool any = false;
        for (size_t s = lo; s < hi && !any; ++s) {
          const uint32_t q = s < m ? affected_[s] : dependents_[s - m];
          if (pass_[q] < 0) continue;
          if (trim_enabled_ && s >= m) continue;   // rognage : la matiere fixe ne freine pas
          const uint32_t* sup = supports(q);
          if (sup[0] == kNoIndex) continue;
          const Vec3& tq = s < m ? trial_tip[s] : tip_[q];
          const Vec3& aq = s < m ? trial_axis[s] : axis_[q];
          double h0_min = kInf;
          int j_min = 0;
          for (int j = 0; j < kSupportSlots && sup[j] != kNoIndex; ++j) {
            const double h0 = dot(sub(tip_[q], tip_[sup[j]]), axis_[q]);
            if (h0 < h0_min) { h0_min = h0; j_min = j; }
          }
          const double floor_h = std::min(hmin, h0_min - kLayerTolerance);
          for (int j = 0; j < kSupportSlots && sup[j] != kNoIndex; ++j) {
            if (trim_enabled_ && slot_[sup[j]] < 0) continue;
            const double h0 = dot(sub(tip_[q], tip_[sup[j]]), axis_[q]);
            const double h1 = dot(sub(tq, tip_at(sup[j])), aq);
            // Marge de 1 nm : la translation freinee tombe EXACTEMENT sur une borne, que l'arrondi flottant
            // ferait sinon compter comme franchie (et interdirait toute rotation).
            constexpr double kBoundSlack = 1e-6;
            if (h1 < std::min(floor_h, h0) - kBoundSlack) { any = true; break; }
            if (j == j_min && h1 > std::max(hmax, h0 + kLayerTolerance) + kBoundSlack) { any = true; break; }
          }
        }
        if (any) bad[lo / kParallelGrain] = 1;
      });
      for (const uint8_t b : bad) if (b) return false;
      return true;
    };
    if (within_bounds(transform.angle_rad)) {
      rot_fraction_ = 1.0;
    } else {
      // Fraction f de l'angle demande, recherchee d'abord autour de celle de l'image precedente (un
      // glissement continu la fait varier de peu : 3 essais au lieu de 12), puis par bissection.
      double f = -1.0;
      const double guess = rot_fraction_;
      if (guess > 0.0 && guess < 1.0 && within_bounds(transform.angle_rad * guess) &&
          !within_bounds(transform.angle_rad * std::min(1.0, guess * 1.03))) {
        f = guess;
      }
      if (f < 0.0) {
        double lo_f = 0.0, hi_f = 1.0;
        if (!within_bounds(0.0)) hi_f = 0.0;  // deja hors bornes sans rotation : on ne tourne pas
        for (int it = 0; it < 12 && hi_f != 0.0; ++it) {
          const double mid = 0.5 * (lo_f + hi_f);
          if (within_bounds(transform.angle_rad * mid)) lo_f = mid; else hi_f = mid;
        }
        f = lo_f;
      }
      rot_fraction_ = f;
      angle_used = transform.angle_rad * f;
    }
  }
  applied_angle_ = angle_used;

  // Phase 1 : points de matiere.
  parallel_for(m, threads_, kParallelGrain, [&](size_t lo, size_t hi) {
    for (size_t s = lo; s < hi; ++s) {
      const uint32_t q = affected_[s];
      if (pass_[q] < 0) continue;
      const double w = weights_[s];
      Vec3 rel = sub(tip_[q], center);
      Vec3 a = axis_[q];
      if (rotating && angle_used != 0.0) {
        const double angle = w * angle_used;
        const double ct = std::cos(angle), st = std::sin(angle);
        rel = rotate(rel, k, ct, st);
        a = rotate(a, k, ct, st);
      }
      const Vec3 turned = add(center, rel);
      dtip_[s] = add(add(tip_[q], slid(s, sub(turned, tip_[q]))), translated(s, T));
      daxis_[s] = a;
      firmware_from(q, dtip_[s], a, &deformed_[kValuesPerPoint * s], residual_[s]);
    }
  });

  if (smooth_b_ > 0.0 && smooth_b_iterations_ > 0) smooth_deformed_b();

  // Phase 2 : points de deplacement a vide, a partir des extremites calculees en phase 1.
  auto endpoint_shift = [&](uint32_t j, Vec3& shift, double& b_shift) {
    shift = Vec3{};
    b_shift = 0.0;
    if (j == kNoIndex || slot_[j] < 0) return;
    const auto s = static_cast<size_t>(slot_[j]);
    shift = sub(dtip_[s], tip_[j]);
    b_shift = deformed_[kValuesPerPoint * s + 3] - b_[j];
  };
  parallel_for(m, threads_, kParallelGrain, [&](size_t lo, size_t hi) {
    for (size_t s = lo; s < hi; ++s) {
      const uint32_t q = affected_[s];
      if (pass_[q] >= 0) continue;
      Vec3 left, right;
      double b_left = 0.0, b_right = 0.0;
      endpoint_shift(link_left_[s], left, b_left);
      endpoint_shift(link_right_[s], right, b_right);
      if (link_left_[s] == kNoIndex) {
        left = right;
        b_left = b_right;
      }
      if (link_right_[s] == kNoIndex) {
        right = left;
        b_right = b_left;
      }
      const double f = link_frac_[s];
      dtip_[s] = add(tip_[q], add(scale(1.0 - f, left), scale(f, right)));
      const double b_deg = b_[q] + (1.0 - f) * b_left + f * b_right;
      firmware_from_b(q, dtip_[s], b_deg, &deformed_[kValuesPerPoint * s]);
      const double br = b_deg * kDeg, cr = deformed_[kValuesPerPoint * s + 1] * kDeg;
      daxis_[s] = {std::sin(br) * std::cos(cr), std::sin(br) * std::sin(cr), std::cos(br)};
      residual_[s] = 0.0f;
    }
  });

  if (with_heights) {
    const size_t total = m + dependents_.size();
    heights_.resize(total);
    auto current_tip = [&](uint32_t j) -> const Vec3& {
      const int32_t s = slot_[j];
      return s >= 0 ? dtip_[static_cast<size_t>(s)] : tip_[j];
    };
    parallel_for(total, threads_, kParallelGrain, [&](size_t lo, size_t hi) {
      for (size_t s = lo; s < hi; ++s) {
        if (s < m) {
          // Rognage : un cordon qui ne repose que sur de la matiere fixe (rognee la ou il l'envahit)
          // garde son epaisseur ; seuls les appuis sur d'autres couches deformables la changent.
          const uint32_t q = affected_[s];
          bool on_moved = false;
          if (trim_enabled_ && pass_[q] >= 0) {
            const uint32_t* sup = supports(q);
            for (int j = 0; j < kSupportSlots && sup[j] != kNoIndex; ++j) on_moved = on_moved || slot_[sup[j]] >= 0;
          }
          heights_[s] = trim_enabled_ && pass_[q] >= 0 && !on_moved
                            ? base_heights_[s]
                            : height_of(q, dtip_[s], daxis_[s], current_tip);
        } else {
          const uint32_t q = dependents_[s - m];
          heights_[s] = height_of(q, tip_[q], axis_[q], current_tip);
        }
      }
    });
    if (reslice_) compute_layer_counts();
    else layer_count_.clear();
  } else {
    heights_.clear();
    layer_count_.clear();
  }

  // E des segments des points deplaces (le segment arrive au point) : longueur entre positions
  // courantes, epaisseur courante si les hauteurs sont calculees.
  auto current_tip = [&](uint32_t j) -> const Vec3& {
    const int32_t s = slot_[j];
    return s >= 0 ? dtip_[static_cast<size_t>(s)] : tip_[j];
  };
  const bool heights_ready = heights_.size() == m + dependents_.size();
  for (size_t s = 0; s < m; ++s) {
    const uint32_t q = affected_[s];
    double& e_out = deformed_[kValuesPerPoint * s + 4];
    if (pass_[q] < 0 || q == 0) {
      e_out = e_[q];
      continue;
    }
    const double ratio = heights_ready ? e_height_ratio(base_heights_[s], effective_height(s)) : 1.0;
    e_out = recomputed_e(q, dtip_[s], current_tip(q - 1), ratio);
  }
  last_transform_ = transform;
  dragged_ = true;
  compute_trimmed();
}

// Lissage de B des points de matiere touches (Jacobi) : B' = B + lambda w (moyenne des voisins - B).
// La poignee garde son B exact ; la pointe reste en place (R, Z recalcules a partir de B).
void EditKernel::smooth_deformed_b() {
  const size_t m = affected_.size();
  std::vector<double> cur(m), next(m);
  for (size_t s = 0; s < m; ++s) cur[s] = deformed_[kValuesPerPoint * s + 3];
  auto neighbour_b = [&](uint32_t q, int dir, bool& ok) -> double {
    ok = false;
    if (dir < 0 ? q == 0 : q + 1 >= r_.size()) return 0.0;
    const uint32_t v = static_cast<uint32_t>(static_cast<int64_t>(q) + dir);
    if (pass_[v] < 0 || pass_[v] != pass_[q]) return 0.0;
    ok = true;
    const int32_t t = slot_[v];
    return t >= 0 ? cur[static_cast<size_t>(t)] : b_[v];
  };
  for (uint32_t it = 0; it < smooth_b_iterations_; ++it) {
    for (size_t s = 0; s < m; ++s) {
      const uint32_t q = affected_[s];
      next[s] = cur[s];
      if (pass_[q] < 0 || q == handle_) continue;
      bool lok = false, rok = false;
      const double lb = neighbour_b(q, -1, lok);
      const double rb = neighbour_b(q, 1, rok);
      if (!lok && !rok) continue;
      const double avg = lok && rok ? 0.5 * (lb + rb) : (lok ? lb : rb);
      next[s] = cur[s] + smooth_b_ * static_cast<double>(weights_[s]) * (avg - cur[s]);
    }
    cur.swap(next);
  }
  for (size_t s = 0; s < m; ++s) {
    const uint32_t q = affected_[s];
    if (pass_[q] < 0 || q == handle_) continue;
    double* out = &deformed_[kValuesPerPoint * s];
    if (cur[s] == out[3]) continue;
    firmware_from_b(q, dtip_[s], cur[s], out);
    const double br = out[3] * kDeg, cr = out[1] * kDeg;
    daxis_[s] = {std::sin(br) * std::cos(cr), std::sin(br) * std::sin(cr), std::cos(br)};
    residual_[s] = 0.0f;
  }
}

// Points les plus proches de deux segments [a0, a1] et [b0, b1] : parametres sa, sb dans [0, 1].
static void closest_on_segments(const Vec3& a0, const Vec3& a1, const Vec3& b0, const Vec3& b1, double& sa, double& sb) {
  const Vec3 u = sub(a1, a0), v = sub(b1, b0), w = sub(a0, b0);
  const double a = dot(u, u), b = dot(u, v), c = dot(v, v), d = dot(u, w), e = dot(v, w);
  const double den = a * c - b * b;
  sa = 0.0;
  sb = 0.0;
  if (a <= 1e-18 && c <= 1e-18) return;
  if (a <= 1e-18) { sb = std::clamp(e / c, 0.0, 1.0); return; }
  if (c <= 1e-18) { sa = std::clamp(-d / a, 0.0, 1.0); return; }
  sa = den > 1e-18 * a * c ? std::clamp((b * e - c * d) / den, 0.0, 1.0) : 0.0;
  sb = (b * sa + e) / c;
  if (sb < 0.0) { sb = 0.0; sa = std::clamp(-d / a, 0.0, 1.0); }
  else if (sb > 1.0) { sb = 1.0; sa = std::clamp((b - d) / a, 0.0, 1.0); }
}

// Rognage : segments de matiere IMMOBILES (hors des couches deformables, segment j = de j - 1 a j) dont
// le cordon recouvre celui d'un point de matiere deplace, en un point quelconque du segment que ce
// point a parcouru (de sa position d'origine a sa position deformee : un controle a l'arrivee seule
// manquerait la matiere traversee de part en part). Segments, pas points : sur un fichier echantillonne
// grossierement (0,4 mm entre points), un cordon passe entre deux points voisins sans les approcher.
// Un cordon s'etend sous sa pointe sur son epaisseur, le long de l'axe de tete, et sur sa largeur de
// cote : deux cordons se recouvrent quand ils sont a moins de `trim_clearance_` lateralement et que
// leurs epaisseurs se chevauchent le long de l'axe. Une meme trajectoire (spirale continue : toutes
// les couches en une passe) n'est ignoree que pres du point, le long du cordon.
void EditKernel::compute_trimmed() {
  trimmed_.clear();
  if (!trim_enabled_ || !has_handle()) return;
  const double lateral = trim_clearance_;
  const double tolerance = 0.25 * params_.min_layer_mm;
  const double own_bead = 3.0 * lateral;
  auto thickness = [&](uint32_t i) {
    const float h = height_all_[i];
    return std::isfinite(h) && h > 0.0f ? static_cast<double>(h) : params_.min_layer_mm;
  };
  // Un segment fixe qui passe pres de la matiere deplacee a une extremite a moins de la moitie de sa
  // longueur de ce point le long du segment : chaque point trouve teste ses deux segments.
  const double reach = lateral + params_.max_layer_mm + 0.5 * std::min(max_step_mm_, 1.0);
  // Tous les coeurs : chaque fil garde ses trouvailles (doublons compris), fusionnees puis triees.
  std::vector<uint32_t> found;
  std::mutex merge;
  parallel_for(affected_.size(), threads_, 64, [&](size_t lo_s, size_t hi_s) {
  std::vector<uint32_t> local;
  for (size_t s = lo_s; s < hi_s; ++s) {
    const uint32_t q = affected_[s];
    if (pass_[q] < 0) continue;
    const Vec3 p0 = tip_[q], p1 = dtip_[s];
    if (norm(sub(p1, p0)) < tolerance) continue;
    const Vec3 lo{std::min(p0.x, p1.x) - reach, std::min(p0.y, p1.y) - reach, std::min(p0.z, p1.z) - reach};
    const Vec3 hi{std::max(p0.x, p1.x) + reach, std::max(p0.y, p1.y) + reach, std::max(p0.z, p1.z) + reach};
    const Vec3 seg = sub(p1, p0);
    const Vec3 a = axis_[q];
    const double hq = thickness(q);
    auto overlaps = [&](const Vec3& d, double hj) {
      const double ax = dot(d, a);
      return norm(sub(d, scale(ax, a))) < lateral && ax > -hq + tolerance && ax < hj - tolerance;
    };
    auto test_segment = [&](uint32_t j) {
      if (j == 0 || j >= r_.size() || slot_[j] >= 0 || pass_[j] < 0 || !extruding_[j]) return;
      if (pass_[j] == pass_[q] && std::abs(arc_[j] - arc_[q]) < own_bead) return;
      const Vec3 f0 = tip_[j - 1], f1 = tip_[j];
      const double hj = thickness(j);
      // Deja recouvert avant la deformation (epaisseur mesuree sur un support plus bas que la couche
      // voisine decalee, hors du cone) et la matiere deplacee s'en eloigne : rien n'est envahi.
      double sa = 0.0, sb = 0.0;
      closest_on_segments(f0, f1, p0, p0, sa, sb);
      const Vec3 d0 = sub(add(f0, scale(sa, sub(f1, f0))), p0);
      if (dot(seg, d0) <= 0.0 && overlaps(d0, hj)) return;
      closest_on_segments(f0, f1, p0, p1, sa, sb);
      const Vec3 d = sub(add(f0, scale(sa, sub(f1, f0))), add(p0, scale(sb, seg)));
      if (overlaps(d, hj)) {
        local.push_back(j);
      }
    };
    for_each_in_box(lo, hi, [&](uint32_t j) {
      test_segment(j);
      test_segment(j + 1);
    });
  }
  std::lock_guard<std::mutex> lock(merge);
  found.insert(found.end(), local.begin(), local.end());
  });
  std::sort(found.begin(), found.end());
  found.erase(std::unique(found.begin(), found.end()), found.end());
  trimmed_ = std::move(found);
}

void EditKernel::set_layer_limits(double min_mm, double max_mm, double width_factor) {
  if (min_mm > 0.0) params_.min_layer_mm = min_mm;
  if (max_mm > params_.min_layer_mm) params_.max_layer_mm = max_mm;
  params_.width_factor = std::max(1.0, width_factor);
}

// Epaisseur « efficace » pour E : sous le minimum, le cordon s'elargit (largeur x min(f, hmin / h)), sa
// section vaut alors largeur x min(f h, hmin) au lieu de largeur x h.
double EditKernel::extrusion_height(double h) const {
  const double f = params_.width_factor, hmin = params_.min_layer_mm;
  if (!(f > 1.0) || !std::isfinite(h) || !(h > 0.0) || h >= hmin) return h;
  return std::min(f * h, hmin);
}

double EditKernel::e_height_ratio(float before, float after) const {
  return height_ratio(static_cast<float>(extrusion_height(before)), static_cast<float>(extrusion_height(after)));
}

// ---------------------------------------------------------------------------------------------
// Re-tranchage : couches interpolees
// ---------------------------------------------------------------------------------------------

float EditKernel::effective_height(size_t idx) const {
  const float h = heights_[idx];
  if (layer_count_.size() != heights_.size() || layer_count_[idx] == 0 || !std::isfinite(h)) return h;
  return h / static_cast<float>(layer_count_[idx] + 1);
}

// Nombre de couches a inserer sous chaque point dont l'epaisseur depasse le maximum : n = ceil(h / max) - 1,
// plafonne. Une suite de points consecutifs d'une meme passe (au moins deux) partage le plus grand n :
// les couches inserees ont toutes le meme nombre d'etages, leur epaisseur varie avec h (aucun saut de
// position entre deux points voisins).
void EditKernel::compute_layer_counts() {
  const size_t m = affected_.size(), total = m + dependents_.size();
  layer_count_.assign(total, 0);
  reslice_runs_.clear();
  reslice_order_.resize(total);
  {
    size_t a = 0, d = 0, k = 0;
    while (a < m || d < dependents_.size()) {
      if (d >= dependents_.size() || (a < m && affected_[a] < dependents_[d])) reslice_order_[k++] = static_cast<uint32_t>(a++);
      else reslice_order_[k++] = static_cast<uint32_t>(m + d++);
    }
  }
  const double hmax = params_.max_layer_mm;
  auto point_of = [&](uint32_t slot) { return slot < m ? affected_[slot] : dependents_[slot - m]; };
  auto tip_cur = [&](uint32_t q) -> const Vec3& {
    const int32_t sl = slot_[q];
    return sl >= 0 ? dtip_[static_cast<size_t>(sl)] : tip_[q];
  };
  auto layers_needed = [&](uint32_t slot) -> uint32_t {
    const float h = heights_[slot];
    const uint32_t q = point_of(slot);
    // Tolerance : un depassement de quelques pour cent du maximum ne justifie pas une passe partielle.
    if (!std::isfinite(h) || !(static_cast<double>(h) > hmax + std::max(kResliceTolerance, 0.05 * hmax))) return 0;
    if (q == 0 || pass_[q] < 0 || !extruding_[q] || pass_[q - 1] != pass_[q]) return 0;
    const double n = std::ceil(static_cast<double>(h) / hmax - 1e-9) - 1.0;
    return static_cast<uint32_t>(std::clamp(n, 1.0, static_cast<double>(reslice_max_)));
  };
  size_t k = 0;
  while (k < total) {
    if (layers_needed(reslice_order_[k]) == 0) {
      ++k;
      continue;
    }
    size_t e = k;
    uint32_t n = 0;
    while (e < total && layers_needed(reslice_order_[e]) > 0 &&
           (e == k || point_of(reslice_order_[e]) == point_of(reslice_order_[e - 1]) + 1)) {
      n = std::max(n, layers_needed(reslice_order_[e]));
      ++e;
    }
    // Une passe partielle coute un degagement et une reprise : en dessous de reslice_min_run_mm de trajectoire,
    // elle n'est inseree que si l'epaisseur est nettement hors norme (1,5 x le maximum).
    double length = 0.0, worst = 0.0;
    for (size_t t = k; t < e; ++t) {
      const uint32_t q = point_of(reslice_order_[t]);
      worst = std::max(worst, static_cast<double>(heights_[reslice_order_[t]]));
      if (t > k) length += norm(sub(tip_cur(q), tip_cur(q - 1)));
    }
    if (e - k >= 2 && (length >= params_.reslice_min_run_mm || worst >= 1.5 * hmax)) {
      reslice_runs_.push_back({static_cast<uint32_t>(k), static_cast<uint32_t>(e - 1), n});
      for (size_t t = k; t < e; ++t) layer_count_[reslice_order_[t]] = static_cast<uint8_t>(n);
    }
    k = e;
  }
}

// Plan d'insertion de la validation en cours (cf. ResliceInsert). Pour une suite a..b qui demande n
// couches, chaque point q_i recoit n points s_j(i) (j = 1..n) a la fraction j / (n + 1) du segment qui
// va de son support le plus bas a lui : la couche d'origine garde l'epaisseur h / (n + 1), chaque couche
// inseree la meme. Les couches sont imprimees de bas en haut, AVANT q_a (leurs supports sont anterieurs) ;
// le dernier point ramene la buse au point qui precede q_a, d'ou le segment d'origine q_{a-1} -> q_a
// repart inchange (son depot est conserve). Appele par commit(), avant que l'etat ne change.
void EditKernel::build_reslice_plan() {
  reslice_plan_.clear();
  if (!reslice_ || layer_count_.empty() || reslice_runs_.empty()) return;
  const size_t m = affected_.size();
  auto point_of = [&](uint32_t slot) { return slot < m ? affected_[slot] : dependents_[slot - m]; };
  auto tip_at = [&](uint32_t q) -> const Vec3& {
    const int32_t s = slot_[q];
    return s >= 0 ? dtip_[static_cast<size_t>(s)] : tip_[q];
  };
  auto axis_at = [&](uint32_t q) -> const Vec3& {
    const int32_t s = slot_[q];
    return s >= 0 ? daxis_[static_cast<size_t>(s)] : axis_[q];
  };
  for (const ResliceRun& run : reslice_runs_) {
    const uint32_t a = point_of(reslice_order_[run.first]);
    if (a == 0) continue;
    const uint32_t n = run.layers;
    const size_t count = run.last - run.first + 1;
    ResliceInsert ins;
    ins.before = a;
    auto push = [&](const Vec3& tip, const Vec3& axis, uint32_t ref, double e, bool extruding) {
      double v[kValuesPerPoint];
      float residual = 0.0f;
      firmware_from(ref, tip, axis, v, residual);
      v[4] = e;
      ins.values.insert(ins.values.end(), v, v + kValuesPerPoint);
      ins.extruding.push_back(extruding ? 1 : 0);
    };
    auto lifted = [&](const Vec3& tip, const Vec3& axis) { return add(tip, scale(params_.lift_mm, axis)); };

    // Support le plus bas de chaque point (hauteur minimale le long de l'axe, comme height_of), axe de
    // tete et rapport d'epaisseur (E) : h / (n + 1) contre l'epaisseur d'origine.
    std::vector<uint32_t> pts(count);
    std::vector<Vec3> base(count), up(count), axes(count);
    std::vector<double> ratio(count);
    for (size_t k = 0; k < count; ++k) {
      const uint32_t slot = reslice_order_[run.first + k];
      const uint32_t q = point_of(slot);
      pts[k] = q;
      axes[k] = axis_at(q);
      const uint32_t* sup = supports(q);
      uint32_t best = kNoIndex;
      double best_h = kInf;
      for (int j = 0; j < kSupportSlots && sup[j] != kNoIndex; ++j) {
        const double h = dot(sub(tip_at(q), tip_at(sup[j])), axes[k]);
        if (h < best_h) {
          best_h = h;
          best = sup[j];
        }
      }
      base[k] = best == kNoIndex ? tip_at(q) : tip_at(best);
      up[k] = sub(tip_at(q), base[k]);
      const double t = static_cast<double>(heights_[slot]) / (n + 1.0);
      ratio[k] = e_height_ratio(base_heights_[slot], static_cast<float>(t));
    }

    const uint32_t prev = a - 1;
    const Vec3 prev_tip = tip_at(prev), prev_axis = axis_at(prev);
    push(lifted(prev_tip, prev_axis), prev_axis, prev, 0.0, false);
    std::vector<Vec3> layer(count);
    for (uint32_t j = 1; j <= n; ++j) {
      const double f = static_cast<double>(j) / (n + 1.0);
      for (size_t k = 0; k < count; ++k) layer[k] = add(base[k], scale(f, up[k]));
      push(lifted(layer[0], axes[0]), axes[0], pts[0], 0.0, false);
      push(layer[0], axes[0], pts[0], 0.0, false);
      for (size_t k = 1; k < count; ++k) {
        push(layer[k], axes[k], pts[k], recomputed_e(pts[k], layer[k], layer[k - 1], ratio[k]), true);
      }
      push(lifted(layer[count - 1], axes[count - 1]), axes[count - 1], pts[count - 1], 0.0, false);
    }
    push(lifted(prev_tip, prev_axis), prev_axis, prev, 0.0, false);
    push(prev_tip, prev_axis, prev, 0.0, false);
    reslice_plan_.push_back(std::move(ins));
  }
}

double EditKernel::recomputed_e(uint32_t j, const Vec3& tip_j, const Vec3& tip_prev, double ratio_h) const {
  const double e0 = e_[j];
  if (extrusion_mode_ == ExtrusionMode::Off || j == 0 || !extruding_[j] || !(e0 > 0.0)) return e0;
  const double len0 = norm(sub(tip_[j], tip_[j - 1]));
  if (!(len0 > 1e-9)) return e0;
  const double ratio = norm(sub(tip_j, tip_prev)) / len0 * ratio_h;
  return std::max(0.0, e0 * (1.0 + extrusion_factor_ * (ratio - 1.0)));
}

// ---------------------------------------------------------------------------------------------
// Validation et historique
// ---------------------------------------------------------------------------------------------

bool EditKernel::commit() {
  reslice_plan_.clear();
  if (!has_handle() || !dragged_) {
    clear_handle();
    return false;
  }
  const Transform& t = last_transform_;
  const bool identity = t.translation.x == 0.0 && t.translation.y == 0.0 && t.translation.z == 0.0 &&
                        (applied_angle_ == 0.0 || norm(t.axis) <= 1e-12);
  if (identity) {
    clear_handle();
    return false;
  }
  // Les epaisseurs entrent dans E : elles doivent etre a jour pour la transformation finale.
  const size_t m = affected_.size();
  if (heights_.size() != m + dependents_.size()) drag(last_transform_, true);

  // Points qui ne bougent pas mais dont E change : ceux qui reposent sur la matiere deplacee
  // (epaisseur) et ceux dont le segment d'arrivee part d'un point deplace (longueur).
  auto current_tip = [&](uint32_t j) -> const Vec3& {
    const int32_t s = slot_[j];
    return s >= 0 ? dtip_[static_cast<size_t>(s)] : tip_[j];
  };
  std::vector<std::pair<uint32_t, double>> e_only;  // indice, nouvel E
  {
    std::vector<uint32_t> candidates(dependents_.begin(), dependents_.end());
    for (const uint32_t q : affected_) {
      if (q + 1 < r_.size() && slot_[q + 1] < 0) candidates.push_back(q + 1);
    }
    std::sort(candidates.begin(), candidates.end());
    candidates.erase(std::unique(candidates.begin(), candidates.end()), candidates.end());
    for (const uint32_t j : candidates) {
      if (slot_[j] >= 0 || j == 0 || pass_[j] < 0) continue;
      double ratio = 1.0;
      const auto it = std::lower_bound(dependents_.begin(), dependents_.end(), j);
      if (it != dependents_.end() && *it == j) {
        const size_t d = m + static_cast<size_t>(it - dependents_.begin());
        ratio = e_height_ratio(base_heights_[d], effective_height(d));
      }
      const double e1 = recomputed_e(j, tip_[j], current_tip(j - 1), ratio);
      if (std::abs(e1 - e_[j]) > 1e-12) e_only.push_back({j, e1});
    }
  }

  // Une entree d'historique : points deplaces et points dont seul E change, par indice croissant.
  Edit edit;
  edit.indices.reserve(m + e_only.size());
  edit.before.reserve(kValuesPerPoint * (m + e_only.size()));
  edit.after.reserve(kValuesPerPoint * (m + e_only.size()));
  auto push_before = [&](uint32_t q) {
    for (const double v : {r_[q], c_[q], z_[q], b_[q], e_[q]}) edit.before.push_back(v);
  };
  size_t a = 0, x = 0;
  while (a < m || x < e_only.size()) {
    if (x >= e_only.size() || (a < m && affected_[a] < e_only[x].first)) {
      const uint32_t q = affected_[a];
      edit.indices.push_back(q);
      push_before(q);
      for (int v = 0; v < kValuesPerPoint; ++v) edit.after.push_back(deformed_[kValuesPerPoint * a + v]);
      ++a;
    } else {
      const auto [j, e1] = e_only[x];
      edit.indices.push_back(j);
      push_before(j);
      for (const double v : {r_[j], c_[j], z_[j], b_[j], e1}) edit.after.push_back(v);
      ++x;
    }
  }
  // Points rognes : leur segment d'arrivee ne depose plus (E = 0, depot retire). Ils rejoignent
  // l'entree, avec leurs valeurs d'avant inchangees (seul E tombe a 0).
  for (const uint32_t j : trimmed_) {
    const auto pos = std::lower_bound(edit.indices.begin(), edit.indices.end(), j);
    const size_t at = static_cast<size_t>(pos - edit.indices.begin());
    if (pos != edit.indices.end() && *pos == j) {
      edit.after[kValuesPerPoint * at + 4] = 0.0;
    } else {
      edit.indices.insert(pos, j);
      const double v[kValuesPerPoint] = {r_[j], c_[j], z_[j], b_[j], e_[j]};
      edit.before.insert(edit.before.begin() + static_cast<std::ptrdiff_t>(kValuesPerPoint * at), v, v + kValuesPerPoint);
      const double w[kValuesPerPoint] = {r_[j], c_[j], z_[j], b_[j], 0.0};
      edit.after.insert(edit.after.begin() + static_cast<std::ptrdiff_t>(kValuesPerPoint * at), w, w + kValuesPerPoint);
    }
  }
  edit.trimmed = trimmed_;
  build_reslice_plan();
  clear_handle();
  apply(edit.indices, edit.after, &edit.trimmed, true);
  last_splice_ = Splice{};
  if (!reslice_plan_.empty()) {
    // Topologie : les blocs entrent dans l'etat, les indices de l'entree passent dans l'indexation d'apres.
    std::vector<InsertBlock> blocks;
    std::vector<uint32_t> before_old;
    std::vector<size_t> shift;   // points inseres avant (cumul), a chaque bloc
    size_t added = 0;
    for (const ResliceInsert& ins : reslice_plan_) {
      InsertBlock b;
      b.at = static_cast<uint32_t>(ins.before + added);
      b.values = ins.values;
      b.extruding = ins.extruding;
      before_old.push_back(ins.before);
      added += b.count();
      shift.push_back(added);
      blocks.push_back(std::move(b));
    }
    auto post = [&](uint32_t k) {
      // Nombre de blocs inseres avant ou a l'indice k (avant <= k).
      const auto it = std::upper_bound(before_old.begin(), before_old.end(), k);
      const size_t m = static_cast<size_t>(it - before_old.begin());
      return static_cast<uint32_t>(k + (m ? shift[m - 1] : 0));
    };
    for (uint32_t& q : edit.indices) q = post(q);
    for (uint32_t& q : edit.trimmed) q = post(q);
    edit.inserted = blocks;
    insert_blocks(blocks);
    last_indices_ = edit.indices;
    last_splice_.inserted = true;
    last_splice_.blocks = std::move(blocks);
  }
  undo_.push_back(std::move(edit));
  redo_.clear();
  return true;
}

void EditKernel::cancel() { clear_handle(); }

bool EditKernel::restore_history(std::vector<HistoryEntry> undo, std::vector<HistoryEntry> redo) {
  const size_t n = r_.size();
  auto valid = [&](const HistoryEntry& h) {
    const size_t m = h.indices.size();
    if (h.before.size() != kValuesPerPoint * m || h.after.size() != kValuesPerPoint * m) return false;
    for (size_t k = 0; k < m; ++k) {
      if (h.indices[k] >= n || (k > 0 && h.indices[k] <= h.indices[k - 1])) return false;
    }
    for (size_t k = 0; k < h.trimmed.size(); ++k) {
      if (h.trimmed[k] >= n || (k > 0 && h.trimmed[k] <= h.trimmed[k - 1])) return false;
      if (!std::binary_search(h.indices.begin(), h.indices.end(), h.trimmed[k])) return false;
    }
    return true;
  };
  for (const auto& h : undo) if (!valid(h)) return false;
  for (const auto& h : redo) if (!valid(h)) return false;
  clear_handle();
  undo_ = std::move(undo);
  redo_ = std::move(redo);
  return true;
}

bool EditKernel::undo() {
  reslice_plan_.clear();
  last_splice_ = Splice{};
  if (undo_.empty()) return false;
  clear_handle();
  Edit edit = std::move(undo_.back());
  undo_.pop_back();
  last_splice_ = Splice{};
  apply(edit.indices, edit.before, &edit.trimmed, false);
  if (!edit.inserted.empty()) {
    remove_blocks(edit.inserted);
    last_splice_.inserted = false;
    last_splice_.blocks = edit.inserted;
  }
  redo_.push_back(std::move(edit));
  return true;
}

bool EditKernel::redo() {
  if (redo_.empty()) return false;
  clear_handle();
  Edit edit = std::move(redo_.back());
  redo_.pop_back();
  last_splice_ = Splice{};
  if (!edit.inserted.empty()) {
    insert_blocks(edit.inserted);
    last_splice_.inserted = true;
    last_splice_.blocks = edit.inserted;
  }
  apply(edit.indices, edit.after, &edit.trimmed, true);
  undo_.push_back(std::move(edit));
  return true;
}

// Ecrit des valeurs firmware puis remet a jour ce qui en derive. Seuls les supports des points
// situes a moins de support_radius_mm d'une position ancienne ou nouvelle peuvent changer : les
// autres ne voient aucun point deplace dans leur voisinage, et leur propre position est intacte.
void EditKernel::apply(const std::vector<uint32_t>& indices, const std::vector<double>& values,
                       const std::vector<uint32_t>* trim_flips, bool trimmed_state) {
  last_indices_ = indices;
  last_values_ = values;
  last_trimmed_ = trim_flips ? *trim_flips : std::vector<uint32_t>{};
  last_trim_state_ = trimmed_state;
  Vec3 lo{kInf, kInf, kInf}, hi{-kInf, -kInf, -kInf};
  auto grow = [&](const Vec3& p) {
    lo = {std::min(lo.x, p.x), std::min(lo.y, p.y), std::min(lo.z, p.z)};
    hi = {std::max(hi.x, p.x), std::max(hi.y, p.y), std::max(hi.z, p.z)};
  };
  // Depots rognes (ou retablis) : la structure en passes change. Les points concernes sortent (ou
  // rejoignent) la grille : leurs voisins doivent recalculer leurs supports.
  if (trim_flips && !trim_flips->empty()) {
    for (const uint32_t j : *trim_flips) {
      if (pass_[j] >= 0) grow(tip_[j]);
      extruding_[j] = trimmed_state ? 0 : 1;
    }
    build_passes();
    rebuild_grid();
    for (const uint32_t j : *trim_flips) grow(tip_[j]);
  }
  // Les points de deplacement a vide n'ont ni support ni place dans la grille : ils n'elargissent
  // pas la zone a recalculer (une traversee lointaine la gonflerait a tout le modele).
  for (size_t k = 0; k < indices.size(); ++k) {
    const uint32_t q = indices[k];
    const bool matter = pass_[q] >= 0;
    if (matter) grow(tip_[q]);
    const double* v = &values[kValuesPerPoint * k];
    r_[q] = v[0];
    c_[q] = v[1];
    z_[q] = v[2];
    b_[q] = v[3];
    e_[q] = v[4];
    update_point_geometry(q);
    if (matter) grow(tip_[q]);
  }
  if (indices.empty() || !(lo.x <= hi.x)) return;
  refresh_closed_flags();
  rebuild_grid();
  const double rho = params_.support_radius_mm;
  lo = sub(lo, {rho, rho, rho});
  hi = add(hi, {rho, rho, rho});
  std::vector<uint32_t> region;
  for (const uint32_t q : pass_points_) {
    const Vec3& p = tip_[q];
    if (p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y && p.z >= lo.z && p.z <= hi.z) region.push_back(q);
  }
  parallel_for(region.size(), threads_, 1024, [&](size_t a, size_t e) {
    for (size_t k = a; k < e; ++k) compute_supports(region[k]);
  });
  build_reverse();
  compute_depths();
  // Coques a reclasser : voisinage de recherche autour de la matiere deplacee.
  const double reach = kShellSearchFactor * rho;
  lo = sub(lo, {reach, reach, reach});
  hi = add(hi, {reach, reach, reach});
  for (const uint32_t q : pass_points_) {
    const Vec3& p = tip_[q];
    if (p.x >= lo.x && p.x <= hi.x && p.y >= lo.y && p.y <= hi.y && p.z >= lo.z && p.z <= hi.z) shell_state_[q] = -1;
  }
  for (const uint32_t q : indices) shell_state_[q] = -1;
}

void EditKernel::clear_handle() {
  for (const uint32_t q : affected_) slot_[q] = -1;
  handle_ = kNoIndex;
  affected_.clear();
  weights_.clear();
  link_left_.clear();
  link_right_.clear();
  link_frac_.clear();
  dependents_.clear();
  base_heights_.clear();
  dragged_ = false;
  deformed_.clear();
  residual_.clear();
  heights_.clear();
  dtip_.clear();
  daxis_.clear();
  slide_.clear();
  applied_translation_ = Vec3{};
  applied_angle_ = 0.0;
  limit_scale_ = 0.0;
  trimmed_.clear();
  rot_fraction_ = 1.0;
}

}  // namespace apex::edit
