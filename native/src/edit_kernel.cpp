#include "edit_kernel.hpp"

#include <algorithm>
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
                           const uint8_t* extruding, const KernelParams& params) {
  const auto t0 = Clock::now();
  LoadStats stats;
  params_ = params;
  threads_ = params.threads ? params.threads : std::max(1u, std::thread::hardware_concurrency());

  r_.assign(r, r + n);
  c_.assign(c, c + n);
  z_.assign(z, z + n);
  b_.assign(b, b + n);
  extruding_.assign(extruding, extruding + n);
  locked_.assign(n, 0);
  tip_.resize(n);
  axis_.resize(n);
  parallel_for(n, threads_, kParallelGrain, [&](size_t lo, size_t hi) {
    for (size_t i = lo; i < hi; ++i) update_point_geometry(i);
  });
  build_passes();
  stats.geometry_ms = ms_since(t0);

  const auto t1 = Clock::now();
  setup_grid();
  rebuild_grid();
  stats.grid_ms = ms_since(t1);

  const auto t2 = Clock::now();
  supports_.assign(n * kSupportSlots, kNoIndex);
  parallel_for(pass_points_.size(), threads_, 1024, [&](size_t lo, size_t hi) {
    for (size_t k = lo; k < hi; ++k) compute_supports(pass_points_[k]);
  });
  build_reverse();
  stats.supports_ms = ms_since(t2);

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
  undo_.clear();
  redo_.clear();
  last_indices_.clear();
  last_values_.clear();

  stats.points = n;
  stats.pass_points = pass_points_.size();
  stats.passes = pass_start_.size();
  stats.cells = nx_ * ny_ * nz_;
  stats.cell_mm = cell_;
  stats.support_edges = rev_.size();
  stats.total_ms = ms_since(t0);
  return stats;
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

bool EditKernel::set_handle(uint32_t index, const InfluenceParams& p) {
  clear_handle();
  const size_t n = r_.size();
  if (index >= n) return false;
  const uint32_t h = snap_to_pass_point(index);
  if (h == kNoIndex || locked_[h]) return false;

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
    while (!queue.empty()) {
      const uint32_t u = queue.front();
      queue.pop_front();
      const uint32_t hu = hops_[u];
      for_each_along(u, [&](uint32_t v) {
        if (hu >= hops_[v] || !allowed(v)) return;
        if (hops_[v] == kUnreached) touched_hops.push_back(v);
        hops_[v] = hu;
        queue.push_front(v);
      });
      if (hu >= cap) continue;
      for_each_contact(u, [&](uint32_t v) {
        if (hu + 1 >= hops_[v] || !allowed(v)) return;
        if (hops_[v] == kUnreached) touched_hops.push_back(v);
        hops_[v] = hu + 1;
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
      const Vec3 offset = sub(tip_[q], center);
      const double reach = spatial_reach(p, offset);
      use(reach > 0.0 ? falloff(p.spatial.falloff, norm(offset) / reach) : (norm(offset) <= 0.0 ? 1.0 : 0.0));
    }
    if (p.along.enabled) use(along_[q] == kInf ? 0.0 : distance_factor(p.along, along_[q]));
    if (p.adjacency.enabled) use(hop_factor(q));
    double w = any ? (product ? prod : best) : 0.0;
    if (!p.anchors.empty()) w *= anchor_factor(p, tip_[q]);
    if (q == h) w = 1.0;
    else if (locked_[q]) w = 0.0;
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

  deformed_.resize(4 * m);
  residual_.resize(m);
  dtip_.resize(m);
  daxis_.resize(m);
  // Phase 1 : points de matiere.
  parallel_for(m, threads_, kParallelGrain, [&](size_t lo, size_t hi) {
    for (size_t s = lo; s < hi; ++s) {
      const uint32_t q = affected_[s];
      if (pass_[q] < 0) continue;
      const double w = weights_[s];
      Vec3 rel = sub(tip_[q], center);
      Vec3 a = axis_[q];
      if (rotating) {
        const double angle = w * transform.angle_rad;
        const double ct = std::cos(angle), st = std::sin(angle);
        rel = rotate(rel, k, ct, st);
        a = rotate(a, k, ct, st);
      }
      dtip_[s] = add(add(center, rel), scale(w, transform.translation));
      daxis_[s] = a;
      firmware_from(q, dtip_[s], a, &deformed_[4 * s], residual_[s]);
    }
  });

  // Phase 2 : points de deplacement a vide, a partir des extremites calculees en phase 1.
  auto endpoint_shift = [&](uint32_t j, Vec3& shift, double& b_shift) {
    shift = Vec3{};
    b_shift = 0.0;
    if (j == kNoIndex || slot_[j] < 0) return;
    const auto s = static_cast<size_t>(slot_[j]);
    shift = sub(dtip_[s], tip_[j]);
    b_shift = deformed_[4 * s + 3] - b_[j];
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
      firmware_from_b(q, dtip_[s], b_deg, &deformed_[4 * s]);
      const double br = b_deg * kDeg, cr = deformed_[4 * s + 1] * kDeg;
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
          heights_[s] = height_of(affected_[s], dtip_[s], daxis_[s], current_tip);
        } else {
          const uint32_t q = dependents_[s - m];
          heights_[s] = height_of(q, tip_[q], axis_[q], current_tip);
        }
      }
    });
  } else {
    heights_.clear();
  }
  last_transform_ = transform;
  dragged_ = true;
}

// ---------------------------------------------------------------------------------------------
// Validation et historique
// ---------------------------------------------------------------------------------------------

bool EditKernel::commit() {
  if (!has_handle() || !dragged_) {
    clear_handle();
    return false;
  }
  const Transform& t = last_transform_;
  const bool identity = t.translation.x == 0.0 && t.translation.y == 0.0 && t.translation.z == 0.0 &&
                        (t.angle_rad == 0.0 || norm(t.axis) <= 1e-12);
  if (identity) {
    clear_handle();
    return false;
  }
  Edit edit;
  edit.indices = affected_;
  edit.before.resize(4 * affected_.size());
  for (size_t k = 0; k < affected_.size(); ++k) {
    const uint32_t q = affected_[k];
    edit.before[4 * k + 0] = r_[q];
    edit.before[4 * k + 1] = c_[q];
    edit.before[4 * k + 2] = z_[q];
    edit.before[4 * k + 3] = b_[q];
  }
  edit.after = deformed_;
  clear_handle();
  apply(edit.indices, edit.after);
  undo_.push_back(std::move(edit));
  redo_.clear();
  return true;
}

void EditKernel::cancel() { clear_handle(); }

bool EditKernel::undo() {
  if (undo_.empty()) return false;
  clear_handle();
  Edit edit = std::move(undo_.back());
  undo_.pop_back();
  apply(edit.indices, edit.before);
  redo_.push_back(std::move(edit));
  return true;
}

bool EditKernel::redo() {
  if (redo_.empty()) return false;
  clear_handle();
  Edit edit = std::move(redo_.back());
  redo_.pop_back();
  apply(edit.indices, edit.after);
  undo_.push_back(std::move(edit));
  return true;
}

// Ecrit des valeurs firmware puis remet a jour ce qui en derive. Seuls les supports des points
// situes a moins de support_radius_mm d'une position ancienne ou nouvelle peuvent changer : les
// autres ne voient aucun point deplace dans leur voisinage, et leur propre position est intacte.
void EditKernel::apply(const std::vector<uint32_t>& indices, const std::vector<double>& values) {
  last_indices_ = indices;
  last_values_ = values;
  Vec3 lo{kInf, kInf, kInf}, hi{-kInf, -kInf, -kInf};
  auto grow = [&](const Vec3& p) {
    lo = {std::min(lo.x, p.x), std::min(lo.y, p.y), std::min(lo.z, p.z)};
    hi = {std::max(hi.x, p.x), std::max(hi.y, p.y), std::max(hi.z, p.z)};
  };
  // Les points de deplacement a vide n'ont ni support ni place dans la grille : ils n'elargissent
  // pas la zone a recalculer (une traversee lointaine la gonflerait a tout le modele).
  for (size_t k = 0; k < indices.size(); ++k) {
    const uint32_t q = indices[k];
    const bool matter = pass_[q] >= 0;
    if (matter) grow(tip_[q]);
    r_[q] = values[4 * k + 0];
    c_[q] = values[4 * k + 1];
    z_[q] = values[4 * k + 2];
    b_[q] = values[4 * k + 3];
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
}

}  // namespace apex::edit
