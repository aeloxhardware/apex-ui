// Validation physique du noyau d'edition (limites de B, collisions de la tete, ecart tete / normale).
// Meme repere que edit_kernel.cpp (droit, z vers le haut, mm / degres) ; la reference des
// collisions est slicer_engine/pipeline/step9_collision_sim.py (tete echantillonnee, matiere deja
// deposee, plateau en disque), portee ici pour tourner sur l'etat en cours de deformation.
#include <algorithm>
#include <cmath>
#include <limits>
#include <unordered_map>

#include "edit_kernel.hpp"
#include "parallel.hpp"

namespace apex::edit {
namespace {

constexpr double kPi = 3.14159265358979323846;
constexpr double kDeg = kPi / 180.0;
constexpr float kNaN = std::numeric_limits<float>::quiet_NaN();

inline Vec3 vsub(const Vec3& a, const Vec3& b) { return {a.x - b.x, a.y - b.y, a.z - b.z}; }
inline Vec3 vadd(const Vec3& a, const Vec3& b) { return {a.x + b.x, a.y + b.y, a.z + b.z}; }
inline Vec3 vscale(double s, const Vec3& a) { return {s * a.x, s * a.y, s * a.z}; }
inline double vdot(const Vec3& a, const Vec3& b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
inline Vec3 vcross(const Vec3& a, const Vec3& b) {
  return {a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x};
}
inline double vnorm(const Vec3& a) { return std::sqrt(vdot(a, a)); }

// Distance d'un point au segment [a, b].
double point_segment_distance(const Vec3& p, const Vec3& a, const Vec3& b) {
  const Vec3 ab = vsub(b, a);
  const double len2 = vdot(ab, ab);
  double t = len2 > 0.0 ? vdot(vsub(p, a), ab) / len2 : 0.0;
  t = std::clamp(t, 0.0, 1.0);
  return vnorm(vsub(p, vadd(a, vscale(t, ab))));
}

// Grille de hachage des points de matiere deplaces (la grille du noyau decrit l'etat valide).
struct HashGrid {
  double cell = 2.0;
  std::unordered_map<uint64_t, std::vector<uint32_t>> cells;
  static uint64_t key(int64_t x, int64_t y, int64_t z) {
    constexpr int64_t kBias = 1 << 20;
    return (static_cast<uint64_t>(x + kBias) & 0x1FFFFF) | ((static_cast<uint64_t>(y + kBias) & 0x1FFFFF) << 21) |
           ((static_cast<uint64_t>(z + kBias) & 0x1FFFFF) << 42);
  }
  int64_t coord(double v) const { return static_cast<int64_t>(std::floor(v / cell)); }
  void add(uint32_t index, const Vec3& p) { cells[key(coord(p.x), coord(p.y), coord(p.z))].push_back(index); }
  template <class Fn>
  void query(const Vec3& p, double radius, Fn&& fn) const {
    if (cells.empty()) return;
    const int64_t x0 = coord(p.x - radius), x1 = coord(p.x + radius);
    const int64_t y0 = coord(p.y - radius), y1 = coord(p.y + radius);
    const int64_t z0 = coord(p.z - radius), z1 = coord(p.z + radius);
    for (int64_t z = z0; z <= z1; ++z)
      for (int64_t y = y0; y <= y1; ++y)
        for (int64_t x = x0; x <= x1; ++x) {
          const auto it = cells.find(key(x, y, z));
          if (it == cells.end()) continue;
          for (const uint32_t j : it->second) fn(j);
        }
  }
};


// Normale de la couche portante au point `tip` : plan moyen des supports (le plus petit vecteur
// propre de leur covariance), tournee vers le point. Supports alignes (un seul cordon) : la direction
// centre des supports -> point privee de sa composante le long du cordon. Un seul support : leur
// direction. Faux si rien d'exploitable.
bool layer_normal(const Vec3* pts, int count, const Vec3& tip, Vec3& normal) {
  if (count <= 0) return false;
  Vec3 c{};
  for (int i = 0; i < count; ++i) c = vadd(c, pts[i]);
  c = vscale(1.0 / count, c);
  const Vec3 up = vsub(tip, c);
  if (count == 1) {
    const double len = vnorm(up);
    if (len < 1e-9) return false;
    normal = vscale(1.0 / len, up);
    return true;
  }
  // Covariance symetrique.
  double a[3][3] = {};
  for (int i = 0; i < count; ++i) {
    const Vec3 d = vsub(pts[i], c);
    const double v[3] = {d.x, d.y, d.z};
    for (int r = 0; r < 3; ++r)
      for (int q = 0; q < 3; ++q) a[r][q] += v[r] * v[q];
  }
  // Jacobi : vecteurs propres de a (3x3 symetrique).
  double vecs[3][3] = {{1, 0, 0}, {0, 1, 0}, {0, 0, 1}};
  for (int sweep = 0; sweep < 12; ++sweep) {
    const double off = std::abs(a[0][1]) + std::abs(a[0][2]) + std::abs(a[1][2]);
    if (off < 1e-18) break;
    for (int p = 0; p < 2; ++p) {
      for (int q = p + 1; q < 3; ++q) {
        if (std::abs(a[p][q]) < 1e-30) continue;
        const double theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
        const double t = (theta >= 0 ? 1.0 : -1.0) / (std::abs(theta) + std::sqrt(theta * theta + 1.0));
        const double cs = 1.0 / std::sqrt(t * t + 1.0), sn = t * cs;
        for (int k = 0; k < 3; ++k) {
          const double akp = a[k][p], akq = a[k][q];
          a[k][p] = cs * akp - sn * akq;
          a[k][q] = sn * akp + cs * akq;
        }
        for (int k = 0; k < 3; ++k) {
          const double apk = a[p][k], aqk = a[q][k];
          a[p][k] = cs * apk - sn * aqk;
          a[q][k] = sn * apk + cs * aqk;
        }
        for (int k = 0; k < 3; ++k) {
          const double vkp = vecs[k][p], vkq = vecs[k][q];
          vecs[k][p] = cs * vkp - sn * vkq;
          vecs[k][q] = sn * vkp + cs * vkq;
        }
      }
    }
  }
  int lo = 0, hi = 0;
  for (int k = 1; k < 3; ++k) {
    if (a[k][k] < a[lo][lo]) lo = k;
    if (a[k][k] > a[hi][hi]) hi = k;
  }
  const int mid = 3 - lo - hi;
  const Vec3 smallest{vecs[0][lo], vecs[1][lo], vecs[2][lo]};
  const Vec3 largest{vecs[0][hi], vecs[1][hi], vecs[2][hi]};
  Vec3 n;
  if (a[mid][mid] > 1e-6 * a[hi][hi] && a[hi][hi] > 1e-12) {
    n = smallest;  // plan bien defini
  } else {
    // Alignes : normale = (tip - centre) sans sa part le long de la droite.
    n = vsub(up, vscale(vdot(up, largest), largest));
  }
  const double len = vnorm(n);
  if (len < 1e-9) return false;
  n = vscale(1.0 / len, n);
  if (vdot(n, up) < 0.0) n = vscale(-1.0, n);
  normal = n;
  return true;
}

}  // namespace

void EditKernel::set_times(const double* times, size_t count) {
  if (times && count == r_.size()) times_.assign(times, times + count);
  else times_.clear();
}

void EditKernel::set_types(const uint8_t* types, size_t count) {
  if (types && count == r_.size()) type_.assign(types, types + count);
  else type_.clear();
}

uint32_t EditKernel::nearest_point(const Vec3& p, double max_distance_mm) const {
  uint32_t best = kNoIndex;
  double best_d = max_distance_mm;
  if (!(max_distance_mm > 0.0) || pass_points_.empty()) return best;
  const double rr = max_distance_mm;
  for_each_in_box(vsub(p, {rr, rr, rr}), vadd(p, {rr, rr, rr}), [&](uint32_t q) {
    const double d = vnorm(vsub(tip_[q], p));
    if (d < best_d || (d == best_d && best != kNoIndex && q < best)) {
      best_d = d;
      best = q;
    }
  });
  return best;
}

void EditKernel::set_head_samples(const float* xyz, size_t count) {
  if (xyz && count) head_.assign(xyz, xyz + 3 * count);
  else head_.clear();
}

const Validation& EditKernel::validate(const MachineLimits& limits, bool collisions, uint32_t lo, uint32_t hi) {
  Validation& out = validation_;
  out = Validation{};
  const size_t n = r_.size();
  if (n == 0) return out;
  const bool live = has_handle() && dragged_ && deformed_.size() == kValuesPerPoint * affected_.size();

  // Points juges.
  std::vector<uint32_t>& idx = out.indices;
  if (live) {
    idx = affected_;
    for (const uint32_t q : affected_) {
      if (q + 1 < n && slot_[q + 1] < 0) idx.push_back(q + 1);
    }
    std::sort(idx.begin(), idx.end());
    idx.erase(std::unique(idx.begin(), idx.end()), idx.end());
  } else {
    if (hi <= lo) {
      lo = 0;
      hi = static_cast<uint32_t>(n);
    }
    hi = std::min<uint32_t>(hi, static_cast<uint32_t>(n));
    for (uint32_t k = lo; k < hi; ++k) idx.push_back(k);
  }
  const size_t count = idx.size();
  out.flags.assign(count, 0);
  out.normal_deviation.assign(count, kNaN);

  // Etat courant (deforme pour les points touches pendant un glissement).
  auto slot_of = [&](uint32_t j) -> int32_t { return live ? slot_[j] : -1; };
  auto tip_of = [&](uint32_t j) -> Vec3 {
    const int32_t s = slot_of(j);
    return s >= 0 ? dtip_[static_cast<size_t>(s)] : tip_[j];
  };
  auto axis_of = [&](uint32_t j) -> Vec3 {
    const int32_t s = slot_of(j);
    return s >= 0 ? daxis_[static_cast<size_t>(s)] : axis_[j];
  };
  auto b_of = [&](uint32_t j) -> double {
    const int32_t s = slot_of(j);
    return s >= 0 ? deformed_[kValuesPerPoint * static_cast<size_t>(s) + 3] : b_[j];
  };
  auto c_of = [&](uint32_t j) -> double {
    const int32_t s = slot_of(j);
    return s >= 0 ? deformed_[kValuesPerPoint * static_cast<size_t>(s) + 1] : c_[j];
  };

  // --- Limites de B ---------------------------------------------------------------------------
  out.timing_known = times_.size() == n;
  const double tol = 1e-9;
  for (size_t k = 0; k < count; ++k) {
    const uint32_t j = idx[k];
    const double b = b_of(j);
    uint8_t f = 0;
    if (b < limits.b_min_deg - 1e-6 || b > limits.b_max_deg + 1e-6) f |= kViolationBRange;
    if (out.timing_known && j > 0) {
      const double dt = times_[j] - times_[j - 1];
      if (dt > 1e-6) {
        const double vel = (b - b_of(j - 1)) / dt;
        if (std::abs(vel) > limits.b_speed_deg_s * (1.0 + tol)) f |= kViolationBSpeed;
        if (j > 1) {
          const double dt0 = times_[j - 1] - times_[j - 2];
          if (dt0 > 1e-6) {
            const double vel0 = (b_of(j - 1) - b_of(j - 2)) / dt0;
            const double acc = (vel - vel0) / (0.5 * (dt + dt0));
            if (std::abs(acc) > limits.b_accel_deg_s2 * (1.0 + tol)) f |= kViolationBAccel;
          }
        }
      }
    }
    out.flags[k] = f;
  }

  // --- Ecart tete / normale de couche ----------------------------------------------------------
  // Normale = plan moyen des supports (couche portante) ; premiere couche : +z.
  parallel_for(count, threads_, 2048, [&](size_t a, size_t e) {
    for (size_t k = a; k < e; ++k) {
      const uint32_t j = idx[k];
      if (pass_[j] < 0) continue;
      const Vec3 tip = tip_of(j);
      Vec3 pts[kSupportSlots];
      int have = 0;
      const uint32_t* sup = supports(j);
      for (int t = 0; t < kSupportSlots && sup[t] != kNoIndex; ++t) pts[have++] = tip_of(sup[t]);
      Vec3 normal;
      if (have == 0) {
        if (tip.z > 2.0 * params_.support_radius_mm) continue;
        normal = {0.0, 0.0, 1.0};
      } else if (!layer_normal(pts, have, tip, normal)) {
        continue;
      }
      const double c = std::clamp(vdot(normal, axis_of(j)), -1.0, 1.0);
      out.normal_deviation[k] = static_cast<float>(std::acos(c) / kDeg);
    }
  });

  // --- Collisions -------------------------------------------------------------------------------
  const size_t samples = head_.size() / 3;
  if (collisions && samples > 0) {
    out.collision_checked = true;
    std::vector<size_t> tested;  // rangs dans idx des poses testees
    for (size_t k = 0; k < count; ++k) {
      if (pass_[idx[k]] >= 0) tested.push_back(k);
    }
    const size_t cap = std::max<size_t>(1, limits.max_poses);
    if (tested.size() > cap) {
      std::vector<size_t> thinned;
      thinned.reserve(cap);
      for (size_t t = 0; t < cap; ++t) thinned.push_back(tested[t * tested.size() / cap]);
      tested.swap(thinned);
    }
    out.poses_tested = tested.size();

    const double reach = limits.part_margin_mm + limits.bead_radius_mm;   // matiere ; le plateau garde collision_margin_mm
    // Echantillons au-dela de la zone de garde autour de la pointe.
    std::vector<uint32_t> usable;
    for (size_t s = 0; s < samples; ++s) {
      const double x = head_[3 * s], y = head_[3 * s + 1], z = head_[3 * s + 2];
      if (std::sqrt(x * x + y * y + z * z) >= limits.contact_clearance_mm) usable.push_back(static_cast<uint32_t>(s));
    }
    if (usable.empty()) {
      for (size_t s = 0; s < samples; ++s) usable.push_back(static_cast<uint32_t>(s));
    }

    // Matiere deplacee : hachage des points touches (la grille du noyau les place a leur ancien lieu).
    HashGrid moved;
    moved.cell = std::max(2.0, reach);
    if (live) {
      for (size_t s = 0; s < affected_.size(); ++s) {
        if (pass_[affected_[s]] >= 0) moved.add(affected_[s], dtip_[s]);
      }
    }

    parallel_for(tested.size(), threads_, 16, [&](size_t a, size_t e) {
      for (size_t t = a; t < e; ++t) {
        const size_t k = tested[t];
        const uint32_t i = idx[k];
        const Vec3 tip = tip_of(i);
        const Vec3 ax = axis_of(i);
        const double cr = c_of(i) * kDeg;
        const Vec3 tang{-std::sin(cr), std::cos(cr), 0.0};
        Vec3 ex = vcross(tang, ax);
        const double exl = vnorm(ex);
        if (exl < 1e-9) continue;
        ex = vscale(1.0 / exl, ex);
        uint8_t f = 0;
        for (const uint32_t s : usable) {
          const Vec3 p = vadd(tip, vadd(vadd(vscale(head_[3 * s], ex), vscale(head_[3 * s + 1], ax)), vscale(head_[3 * s + 2], tang)));
          if (p.z < limits.collision_margin_mm && std::hypot(p.x, p.y) <= limits.plate_radius_mm + limits.collision_margin_mm) {
            f |= kViolationHeadPlate;
          }
          if (!(f & kViolationHeadPart)) {
            auto test = [&](uint32_t j) {
              if (f & kViolationHeadPart) return;
              if (j >= i || pass_[j] < 0) return;
              if (live && slot_[j] >= 0) return;  // remplace par sa position deformee (hachage)
              const Vec3 q = tip_[j];
              if (std::abs(q.x - p.x) > reach || std::abs(q.y - p.y) > reach || std::abs(q.z - p.z) > reach) return;
              double d = vnorm(vsub(p, q));
              if (extruding_[j] && j > 0) {
                const Vec3 prev = (live && slot_[j - 1] >= 0) ? dtip_[static_cast<size_t>(slot_[j - 1])] : tip_[j - 1];
                d = std::min(d, point_segment_distance(p, prev, q));
              }
              if (d < reach) f |= kViolationHeadPart;
            };
            for_each_in_box(vsub(p, {reach, reach, reach}), vadd(p, {reach, reach, reach}), test);
            if (live && !(f & kViolationHeadPart)) {
              moved.query(p, reach, [&](uint32_t j) {
                if (f & kViolationHeadPart) return;
                if (j >= i) return;
                const size_t sj = static_cast<size_t>(slot_[j]);
                const Vec3 q = dtip_[sj];
                double d = vnorm(vsub(p, q));
                if (extruding_[j] && j > 0) {
                  const Vec3 prev = slot_[j - 1] >= 0 ? dtip_[static_cast<size_t>(slot_[j - 1])] : tip_[j - 1];
                  d = std::min(d, point_segment_distance(p, prev, q));
                }
                if (d < reach) f |= kViolationHeadPart;
              });
            }
          }
          if ((f & kViolationHeadPlate) && (f & kViolationHeadPart)) break;
        }
        out.flags[k] |= f;
      }
    });

    // Les points non testes entre deux poses testees en collision heritent de leur drapeau commun.
    if (tested.size() < count) {
      constexpr uint8_t kCollide = kViolationHeadPart | kViolationHeadPlate;
      size_t next = 0;  // premier rang teste >= k
      for (size_t k = 0; k < count; ++k) {
        while (next < tested.size() && tested[next] < k) ++next;
        if (next < tested.size() && tested[next] == k) continue;
        if (pass_[idx[k]] < 0) continue;
        const uint8_t before = next > 0 ? out.flags[tested[next - 1]] : 0;
        const uint8_t after = next < tested.size() ? out.flags[tested[next]] : 0;
        out.flags[k] |= static_cast<uint8_t>(before & after & kCollide);
      }
    }
  }

  for (const uint8_t f : out.flags) {
    if (f & kViolationBRange) ++out.b_range;
    if (f & kViolationBSpeed) ++out.b_speed;
    if (f & kViolationBAccel) ++out.b_accel;
    if (f & kViolationHeadPart) ++out.head_part;
    if (f & kViolationHeadPlate) ++out.head_plate;
  }
  return out;
}

}  // namespace apex::edit
