#include "polar_convert.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <memory>
#include <string_view>
#include <thread>
#include <unordered_map>

#include "apex/past_material.hpp"
#include "parallel.hpp"

namespace apex::polar {
namespace {

using apex::edit::parallel_for;

constexpr double kPi = 3.14159265358979323846;
constexpr double kRadToDeg = 180.0 / kPi;
constexpr double kDegToRad = kPi / 180.0;
constexpr double kArcMaxChord = 0.5;
constexpr double kArcMaxStep = 10.0 * kDegToRad;
constexpr int kArcMaxSegments = 720;
constexpr int kMaxSubdivisions = 2048;
constexpr double kEEps = 1e-9;
constexpr double kCell = 1.0;
constexpr int kCellRadius = 2;
constexpr double kSampleMm = 1.0;
constexpr double kMinRadiusForTilt = 1.0;

double degrees(double r) { return r * kRadToDeg; }
double radians(double d) { return d * kDegToRad; }

// Modulo de Python : le signe est celui du diviseur.
double pymod(double a, double b) {
  double m = std::fmod(a, b);
  if (m != 0.0 && ((m < 0.0) != (b < 0.0))) m += b;
  return m;
}

unsigned thread_count(const Params& p) {
  if (p.threads > 0) return static_cast<unsigned>(p.threads);
  return std::max(1u, std::thread::hardware_concurrency());
}

// Nombre compact comme `fmt` de Python : « 12.5 », « -0.25 », jamais « -0 ».
void append_fmt(std::string& out, double value, int digits) {
  char buf[96];
  auto res = std::to_chars(buf, buf + sizeof buf, value, std::chars_format::fixed, digits);
  char* end = res.ptr;
  while (end > buf && end[-1] == '0') --end;
  if (end > buf && end[-1] == '.') --end;
  const size_t len = static_cast<size_t>(end - buf);
  if (len == 0 || (len == 2 && buf[0] == '-' && buf[1] == '0')) {
    out += '0';
    return;
  }
  out.append(buf, len);
}

// --------------------------------------------------------------------------------------------
// Passe 1 : lecture du G-code cartesien
// --------------------------------------------------------------------------------------------

struct Moves {
  std::vector<double> x, y, z, de, feed;
  std::vector<std::uint8_t> ext;
  std::vector<int> layer;
  size_t size() const { return x.size(); }
};

struct Item {
  std::int32_t text = -1;  // indice dans `texts`, sinon plage de mouvements [a, b)
  size_t a = 0, b = 0;
};

struct Words {
  double v[26];
  std::uint32_t mask = 0;
  bool has(char c) const { return (mask >> (c - 'A')) & 1u; }
  double get(char c, double dflt) const { return has(c) ? v[c - 'A'] : dflt; }
};

bool is_space(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }
bool is_digit(char c) { return c >= '0' && c <= '9'; }

// Equivalent de WORD_RE.finditer : ([A-Z])\s*([-+]?(?:\d+\.?\d*|\.\d+)).
Words parse_words(std::string_view s) {
  Words w;
  size_t i = 0;
  const size_t n = s.size();
  while (i < n) {
    const char c = s[i];
    if (c < 'A' || c > 'Z') {
      ++i;
      continue;
    }
    size_t p = i + 1;
    while (p < n && is_space(s[p])) ++p;
    const size_t num_start = p;
    if (p < n && (s[p] == '+' || s[p] == '-')) ++p;
    size_t q = p;
    bool ok = false;
    if (q < n && is_digit(s[q])) {
      while (q < n && is_digit(s[q])) ++q;
      if (q < n && s[q] == '.') ++q;
      while (q < n && is_digit(s[q])) ++q;
      ok = true;
    } else if (q + 1 < n && s[q] == '.' && is_digit(s[q + 1])) {
      ++q;
      while (q < n && is_digit(s[q])) ++q;
      ok = true;
    }
    if (!ok) {
      ++i;
      continue;
    }
    const std::string tmp(s.substr(num_start, q - num_start));
    w.v[c - 'A'] = std::strtod(tmp.c_str(), nullptr);
    w.mask |= 1u << (c - 'A');
    i = q;
  }
  return w;
}

bool layer_marker(std::string_view comment) {
  size_t i = 0;
  while (i < comment.size() && is_space(comment[i])) ++i;
  auto starts = [&](const char* lit, bool word_boundary) {
    const size_t len = std::strlen(lit);
    if (comment.size() - i < len) return false;
    for (size_t k = 0; k < len; ++k) {
      char c = comment[i + k];
      if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 32);
      if (c != lit[k]) return false;
    }
    if (word_boundary && comment.size() - i > len) {
      const char nx = comment[i + len];
      if (std::isalnum(static_cast<unsigned char>(nx)) || nx == '_') return false;
    }
    return true;
  };
  return starts("LAYER_CHANGE", true) || starts("<LAYER>", false) || starts("LAYER:", false);
}

struct ArcPoint { double x, y, z, de; };

std::vector<ArcPoint> linearize_arc(double x, double y, double z, double ex, double ey, double ez, double de,
                                    const Words& w, double unit, bool ccw) {
  double cx, cy;
  if (w.has('I') || w.has('J')) {
    cx = x + w.get('I', 0.0) * unit;
    cy = y + w.get('J', 0.0) * unit;
  } else if (w.has('R')) {
    const double r = w.get('R', 0.0) * unit;
    const double dx = ex - x, dy = ey - y;
    const double d = std::hypot(dx, dy);
    if (d < 1e-9 || std::abs(r) < d / 2) return {{ex, ey, ez, de}};
    const double h = std::sqrt(r * r - d * d / 4) * (ccw ? 1 : -1) * (r > 0 ? 1 : -1);
    cx = (x + ex) / 2 - dy / d * h;
    cy = (y + ey) / 2 + dx / d * h;
  } else {
    return {{ex, ey, ez, de}};
  }
  const double radius = std::hypot(x - cx, y - cy);
  const double a0 = std::atan2(y - cy, x - cx);
  double sweep = std::atan2(ey - cy, ex - cx) - a0;
  if (ccw) {
    while (sweep <= 1e-9) sweep += 2 * kPi;
  } else {
    while (sweep >= -1e-9) sweep -= 2 * kPi;
  }
  const double by_chord = std::ceil(std::abs(sweep) * radius / kArcMaxChord);
  const double by_step = std::ceil(std::abs(sweep) / kArcMaxStep);
  const int n = static_cast<int>(std::min<double>(kArcMaxSegments, std::max({1.0, by_chord, by_step})));
  std::vector<ArcPoint> pts;
  for (int i = 1; i <= n; ++i) {
    if (i == n) {
      pts.push_back({ex, ey, ez, de / n});
    } else {
      const double a = a0 + sweep * i / n;
      pts.push_back({cx + radius * std::cos(a), cy + radius * std::sin(a), z + (ez - z) * i / n, de / n});
    }
  }
  return pts;
}

void assign_layers_by_z(Moves& m) {
  int layer = 0;
  bool have = false;
  double last = 0.0;
  for (size_t k = 0; k < m.size(); ++k) {
    if (m.ext[k]) {
      last = m.z[k];
      have = true;
    } else if (have && m.z[k] > last + 1e-3) {
      ++layer;
      have = false;
    }
    m.layer[k] = layer;
  }
}

struct Reader {
  Moves moves;
  std::vector<Item> items;
  std::vector<std::string> texts;
};

std::string_view rstrip_cr(std::string_view s) {
  while (!s.empty() && s.back() == '\r') s.remove_suffix(1);
  return s;
}

Reader read_gcode(const std::string& text, double center_x, double center_y, const std::function<void(double)>& report) {
  Reader rd;
  Moves& moves = rd.moves;
  double x = 0, y = 0, z = 0, feed = 1500.0, unit = 1.0;
  bool rel_xyz = false, rel_e = false, have_e_abs = false;
  double e_abs = 0.0;
  int layer = 0, layer_markers = 0;

  auto push_text = [&](std::string_view s) {
    rd.texts.emplace_back(s);
    Item it;
    it.text = static_cast<std::int32_t>(rd.texts.size() - 1);
    rd.items.push_back(it);
  };
  auto push = [&](double nx, double ny, double nz, double de) {
    moves.x.push_back(nx - center_x);
    moves.y.push_back(ny - center_y);
    moves.z.push_back(nz);
    moves.de.push_back(de);
    moves.feed.push_back(feed);
    const bool moved = nx != x || ny != y || nz != z;
    moves.ext.push_back(moved && de > kEEps);
    moves.layer.push_back(layer);
  };

  size_t pos = 0;
  size_t index = 0;
  const size_t total = std::max<size_t>(1, text.size());
  std::string code;
  for (;;) {
    const size_t nl = text.find('\n', pos);
    const size_t end = nl == std::string::npos ? text.size() : nl;
    std::string_view line = rstrip_cr(std::string_view(text).substr(pos, end - pos));
    if (index % 5000 == 0) report(30.0 * static_cast<double>(pos) / static_cast<double>(total));
    ++index;

    const size_t semi = line.find(';');
    const std::string_view comment = semi == std::string_view::npos ? std::string_view() : line.substr(semi + 1);
    std::string_view code_view = semi == std::string_view::npos ? line : line.substr(0, semi);
    code.clear();
    if (code_view.find('(') != std::string_view::npos) {
      // PAREN_RE : \([^)]*\) -> " "
      for (size_t i = 0; i < code_view.size();) {
        if (code_view[i] == '(') {
          const size_t close = code_view.find(')', i + 1);
          if (close != std::string_view::npos) {
            code += ' ';
            i = close + 1;
            continue;
          }
        }
        code += code_view[i++];
      }
    } else {
      code.assign(code_view);
    }
    {
      size_t a = 0, b = code.size();
      while (a < b && is_space(code[a])) ++a;
      while (b > a && is_space(code[b - 1])) --b;
      code = code.substr(a, b - a);
      for (char& c : code) if (c >= 'a' && c <= 'z') c = static_cast<char>(c - 32);
    }
    if (!comment.empty() && layer_marker(comment)) {
      ++layer;
      ++layer_markers;
    }

    auto finish_line = [&]() {
      if (nl == std::string::npos) return false;
      pos = nl + 1;
      return true;
    };

    bool handled = false;
    if (code.empty()) {
      push_text(line);
      handled = true;
    } else if ((code[0] == 'G' || code[0] == 'M') && code.size() > 1 && is_digit(code[1])) {
      const char letter = code[0];
      size_t p = 1;
      int num = 0;
      while (p < code.size() && is_digit(code[p])) num = num * 10 + (code[p++] - '0');
      if (p + 1 < code.size() && code[p] == '.' && is_digit(code[p + 1])) {
        ++p;
        while (p < code.size() && is_digit(code[p])) ++p;
      }
      const Words w = parse_words(std::string_view(code).substr(p));

      auto axis = [&](double current, char key) {
        if (!w.has(key)) return current;
        return rel_xyz ? current + w.get(key, 0) * unit : w.get(key, 0) * unit;
      };
      auto extrusion_delta = [&]() {
        if (!w.has('E')) return 0.0;
        const double e = w.get('E', 0) * unit;
        if (rel_xyz || rel_e) return e;
        const double de = have_e_abs ? e - e_abs : 0.0;
        e_abs = e;
        have_e_abs = true;
        return de;
      };

      if (letter == 'M') {
        if (num == 82) rel_e = false;
        else if (num == 83) rel_e = true;
        else push_text(line);
      } else if (num == 0 || num == 1) {
        if (w.get('F', 0) > 0) feed = w.get('F', 0) * unit;
        if (w.has('X') || w.has('Y') || w.has('Z') || w.has('E')) {
          const size_t start = moves.size();
          const double nx = axis(x, 'X'), ny = axis(y, 'Y'), nz = axis(z, 'Z');
          push(nx, ny, nz, extrusion_delta());
          x = nx; y = ny; z = nz;
          Item it;
          it.a = start;
          it.b = moves.size();
          rd.items.push_back(it);
        }
      } else if (num == 2 || num == 3) {
        if (w.get('F', 0) > 0) feed = w.get('F', 0) * unit;
        const double ex = axis(x, 'X'), ey = axis(y, 'Y'), ez = axis(z, 'Z');
        const double de = extrusion_delta();
        const size_t start = moves.size();
        for (const ArcPoint& ap : linearize_arc(x, y, z, ex, ey, ez, de, w, unit, num == 3)) {
          push(ap.x, ap.y, ap.z, ap.de);
          x = ap.x; y = ap.y; z = ap.z;
        }
        Item it;
        it.a = start;
        it.b = moves.size();
        rd.items.push_back(it);
      } else if (num == 20) {
        unit = 25.4;
      } else if (num == 21) {
        unit = 1.0;
      } else if (num == 90) {
        rel_xyz = false;
      } else if (num == 91) {
        rel_xyz = true;
      } else if (num == 92) {
        if (w.has('X')) x = w.get('X', 0) * unit;
        if (w.has('Y')) y = w.get('Y', 0) * unit;
        if (w.has('Z')) z = w.get('Z', 0) * unit;
        if (w.has('E')) {
          e_abs = w.get('E', 0) * unit;
          have_e_abs = true;
        }
      } else if (num == 28) {
        const bool any = w.has('X') || w.has('Y') || w.has('Z');
        if (!any || w.has('X')) x = 0.0;
        if (!any || w.has('Y')) y = 0.0;
        if (!any || w.has('Z')) z = 0.0;
        push_text("G28");
      } else {
        push_text(line);
      }
      handled = true;
    }
    if (!handled) push_text(line);
    if (!finish_line()) break;
  }
  if (layer_markers == 0) assign_layers_by_z(moves);
  return rd;
}

// --------------------------------------------------------------------------------------------
// Passe 2 : inclinaison de la tete
// --------------------------------------------------------------------------------------------

struct Cell { double sum; int count; };
using LayerCells = std::unordered_map<std::uint64_t, Cell>;

std::uint64_t cell_key(long long ix, long long iy) {
  return (static_cast<std::uint64_t>(ix + (1LL << 30)) << 32) | static_cast<std::uint64_t>(iy + (1LL << 30));
}

struct Normal { double x, y, z; };

class NormalField {
 public:
  explicit NormalField(std::vector<LayerCells>&& cells) : cells_(std::move(cells)) {}

  // Cache local a un fil : la fonction est pure, seul le cache differe.
  struct Cache { std::unordered_map<std::uint64_t, Normal> map; };

  Normal at(Cache& cache, int layer, double x, double y) const {
    const long long cx = static_cast<long long>(std::floor(x / kCell));
    const long long cy = static_cast<long long>(std::floor(y / kCell));
    const std::uint64_t ck = (static_cast<std::uint64_t>(layer) << 40) ^ cell_key(cx, cy);
    auto it = cache.map.find(ck);
    if (it != cache.map.end()) return it->second;
    Normal result{0.0, 0.0, 1.0};
    if (static_cast<size_t>(layer) < cells_.size()) {
      const LayerCells& lc = cells_[static_cast<size_t>(layer)];
      double px[(2 * kCellRadius + 1) * (2 * kCellRadius + 1)], py[sizeof px / sizeof(double)], pz[sizeof px / sizeof(double)];
      int np = 0;
      for (int dx = -kCellRadius; dx <= kCellRadius; ++dx) {
        for (int dy = -kCellRadius; dy <= kCellRadius; ++dy) {
          auto f = lc.find(cell_key(cx + dx, cy + dy));
          if (f != lc.end()) {
            px[np] = (static_cast<double>(cx + dx) + 0.5) * kCell;
            py[np] = (static_cast<double>(cy + dy) + 0.5) * kCell;
            pz[np] = f->second.sum / f->second.count;
            ++np;
          }
        }
      }
      if (np >= 2) {
        double mx = 0, my = 0, mz = 0;
        for (int i = 0; i < np; ++i) { mx += px[i]; my += py[i]; mz += pz[i]; }
        mx /= np; my /= np; mz /= np;
        double cxx = 0, cxy = 0, cyy = 0, cxz = 0, cyz = 0;
        for (int i = 0; i < np; ++i) {
          const double ux = px[i] - mx, uy = py[i] - my, uz = pz[i] - mz;
          cxx += ux * ux; cxy += ux * uy; cyy += uy * uy; cxz += ux * uz; cyz += uy * uz;
        }
        const double det = cxx * cyy - cxy * cxy;
        double gx, gy;
        const double tr = cxx + cyy;
        if (det > 1e-6 * std::max(1e-9, tr * tr)) {
          gx = (cxz * cyy - cyz * cxy) / det;
          gy = (cyz * cxx - cxz * cxy) / det;
        } else if (tr > 1e-9) {
          gx = cxz / tr;
          gy = cyz / tr;
        } else {
          gx = gy = 0.0;
        }
        const double norm = std::sqrt(gx * gx + gy * gy + 1.0);
        result = {-gx / norm, -gy / norm, 1.0 / norm};
      }
    }
    cache.map.emplace(ck, result);
    return result;
  }

 private:
  std::vector<LayerCells> cells_;
};

NormalField build_normal_field(const Moves& m, unsigned threads) {
  const size_t n = m.size();
  int max_layer = 0;
  for (size_t k = 0; k < n; ++k) max_layer = std::max(max_layer, m.layer[k]);
  std::vector<LayerCells> cells(static_cast<size_t>(max_layer) + 1);
  // Les couches sont des plages contigues de mouvements : une tranche par couche, l'ordre
  // d'accumulation dans une cellule (donc la somme flottante) est celui du Python.
  std::vector<size_t> starts;
  for (size_t k = 0; k < n; ++k) if (k == 0 || m.layer[k] != m.layer[k - 1]) starts.push_back(k);
  starts.push_back(n);
  const size_t runs = starts.size() - 1;
  parallel_for(runs, threads, 1, [&](size_t a, size_t e) {
    for (size_t r = a; r < e; ++r) {
      for (size_t k = starts[r]; k < starts[r + 1]; ++k) {
        if (!m.ext[k] || k == 0) continue;
        const double x = m.x[k], y = m.y[k], z = m.z[k];
        const double px = m.x[k - 1], py = m.y[k - 1], pz = m.z[k - 1];
        const double length = std::hypot(x - px, y - py);
        const int steps = std::max(1, static_cast<int>(length / kSampleMm));
        LayerCells& lc = cells[static_cast<size_t>(m.layer[k])];
        for (int s = 0; s <= steps; ++s) {
          const double f = static_cast<double>(s) / steps;
          const double sx = px + (x - px) * f, sy = py + (y - py) * f, sz = pz + (z - pz) * f;
          const std::uint64_t key = cell_key(static_cast<long long>(std::floor(sx / kCell)),
                                             static_cast<long long>(std::floor(sy / kCell)));
          auto it = lc.find(key);
          if (it == lc.end()) lc.emplace(key, Cell{sz, 1});
          else { it->second.sum += sz; it->second.count += 1; }
        }
      }
    }
  });
  return NormalField(std::move(cells));
}

constexpr double kNaN = std::numeric_limits<double>::quiet_NaN();

// B vise aux points extrudes (NaN ailleurs).
std::vector<double> extrusion_targets(const Moves& m, const Params& p, const NormalField& field, unsigned threads) {
  const size_t n = m.size();
  std::vector<double> targets(n, kNaN);
  parallel_for(n, threads, 4096, [&](size_t a, size_t e) {
    NormalField::Cache cache;
    for (size_t k = a; k < e; ++k) {
      if (!m.ext[k]) continue;
      const double x = m.x[k], y = m.y[k];
      const double r = std::hypot(x, y);
      if (r < kMinRadiusForTilt) {
        targets[k] = 0.0;
        continue;
      }
      const Normal nrm = field.at(cache, m.layer[k], x, y);
      const double n_r = (nrm.x * x + nrm.y * y) / r;
      const double b = degrees(std::atan2(n_r, nrm.z));
      targets[k] = std::max(p.b_min, std::min(p.b_limit, b));
    }
  });
  return targets;
}

// Trajets a vide : cible du prochain depot ; vitesse d'inclinaison bornee dans les deux sens.
std::vector<double> fill_and_smooth(const Moves& m, const Params& p, std::vector<double> targets) {
  const size_t n = m.size();
  double upcoming = 0.0;
  for (size_t k = n; k-- > 0;) {
    if (std::isnan(targets[k])) targets[k] = upcoming;
    else upcoming = targets[k];
  }
  std::vector<double> dist(n, 0.0);
  for (size_t k = 1; k < n; ++k) {
    const double dx = m.x[k] - m.x[k - 1], dy = m.y[k] - m.y[k - 1], dz = m.z[k] - m.z[k - 1];
    dist[k] = std::sqrt(dx * dx + dy * dy + dz * dz);
  }
  std::vector<double>& t = targets;
  for (size_t k = 1; k < n; ++k) {
    const double step = p.b_rate_deg_per_mm * dist[k];
    t[k] = std::max(t[k - 1] - step, std::min(t[k - 1] + step, t[k]));
  }
  for (size_t k = n; k-- > 1;) {
    const size_t j = k - 1;
    const double step = p.b_rate_deg_per_mm * dist[k];
    t[j] = std::max(t[k] - step, std::min(t[k] + step, t[j]));
  }
  // Pivot jamais au-dela de l'axe du plateau : R = r + pivot*sin(B) >= 0.
  for (size_t k = 0; k < n; ++k) {
    const double r = std::hypot(m.x[k], m.y[k]);
    const double min_b = -degrees(std::asin(std::min(1.0, r / p.pivot)));
    if (t[k] < min_b) t[k] = min_b;
  }
  return targets;
}

// --------------------------------------------------------------------------------------------
// Evitement des collisions de la tete
// --------------------------------------------------------------------------------------------

struct V3 { double x, y, z; };

class CollisionAvoider {
 public:
  CollisionAvoider(const Moves& m, const Params& p, unsigned threads) : m_(m), p_(p), threads_(threads) {
    reach_nozzle_ = -p.nozzle_tolerance + p.bead_radius;
    reach_body_ = p.collision_margin - p.body_tolerance + p.bead_radius;
    const size_t samples = p.head_samples.size() / 3;
    std::vector<size_t> keep;
    for (size_t s = 0; s < samples; ++s) {
      const double x = p.head_samples[3 * s], y = p.head_samples[3 * s + 1], z = p.head_samples[3 * s + 2];
      if (std::sqrt(x * x + y * y + z * z) >= p.contact_clearance) keep.push_back(s);
    }
    if (keep.empty()) for (size_t s = 0; s < samples; ++s) keep.push_back(s);
    for (size_t s : keep) {
      const double x = p.head_samples[3 * s], y = p.head_samples[3 * s + 1], z = p.head_samples[3 * s + 2];
      const bool nozzle = std::sqrt(x * x + y * y + z * z) <= p.nozzle_zone;
      auto& dst = nozzle ? nozzle_ : body_;
      dst.push_back(x); dst.push_back(y); dst.push_back(z);
    }
    build_matter();
    build_poses();
  }

  bool ready() const { return !poses_.empty() && (!nozzle_.empty() || !body_.empty()); }
  const std::vector<size_t>& poses() const { return poses_; }

  // Vrai si la tete, posee en k avec l'inclinaison b (degres), touche la matiere deja deposee ou le plateau.
  bool collides(size_t k, double b_deg) const {
    const double cr = std::atan2(m_.y[k], m_.x[k]);
    const double br = radians(b_deg);
    const V3 tang{-std::sin(cr), std::cos(cr), 0.0};
    const V3 rad{std::cos(cr), std::sin(cr), 0.0};
    const V3 ax{std::sin(br) * rad.x, std::sin(br) * rad.y, std::cos(br)};
    V3 ex{tang.y * ax.z - tang.z * ax.y, tang.z * ax.x - tang.x * ax.z, tang.x * ax.y - tang.y * ax.x};
    const double exl = std::sqrt(ex.x * ex.x + ex.y * ex.y + ex.z * ex.z);
    if (exl < 1e-9) return false;
    ex = {ex.x / exl, ex.y / exl, ex.z / exl};
    const double tx = m_.x[k], ty = m_.y[k], tz = m_.z[k];
    thread_local std::vector<double> npts, bpts;
    npts.resize(nozzle_.size());
    bpts.resize(body_.size());
    auto place = [&](const std::vector<double>& src, std::vector<double>& dst, bool& plate) {
      for (size_t s = 0; s + 2 < src.size(); s += 3) {
        const double hx = src[s], hy = src[s + 1], hz = src[s + 2];
        const double px = tx + hx * ex.x + hy * ax.x + hz * tang.x;
        const double py = ty + hx * ex.y + hy * ax.y + hz * tang.y;
        const double pz = tz + hx * ex.z + hy * ax.z + hz * tang.z;
        dst[s] = px; dst[s + 1] = py; dst[s + 2] = pz;
        if (pz < p_.collision_margin && std::hypot(px, py) <= p_.plate_radius + p_.collision_margin) plate = true;
      }
    };
    bool plate = false;
    place(nozzle_, npts, plate);
    place(body_, bpts, plate);
    if (plate) return true;
    if (index_ && index_->size() > 0) {
      if (reach_nozzle_ > 0.0 && !npts.empty() &&
          index_->min_past_distance(npts.data(), static_cast<std::int64_t>(npts.size() / 3), static_cast<std::int64_t>(k), reach_nozzle_) < reach_nozzle_)
        return true;
      if (reach_body_ > 0.0 && !bpts.empty() &&
          index_->min_past_distance(bpts.data(), static_cast<std::int64_t>(bpts.size() / 3), static_cast<std::int64_t>(k), reach_body_) < reach_body_)
        return true;
    }
    return false;
  }

 private:
  void build_matter() {
    std::vector<double> pts;
    std::vector<std::int64_t> owners;
    const double step = std::max(1e-3, p_.densify_step);
    for (size_t j = 1; j < m_.size(); ++j) {
      if (!m_.ext[j]) continue;
      const double ax = m_.x[j - 1], ay = m_.y[j - 1], az = m_.z[j - 1];
      const double bx = m_.x[j], by = m_.y[j], bz = m_.z[j];
      const double len = std::sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay) + (bz - az) * (bz - az));
      const int parts = std::max(1, static_cast<int>(std::ceil(len / step)));
      for (int u = 0; u <= parts; ++u) {
        const double t = static_cast<double>(u) / parts;
        pts.push_back(ax + t * (bx - ax));
        pts.push_back(ay + t * (by - ay));
        pts.push_back(az + t * (bz - az));
        owners.push_back(static_cast<std::int64_t>(j));
      }
    }
    index_ = std::make_unique<apex::PastMaterialIndex>(pts.data(), owners.data(), static_cast<std::int64_t>(owners.size()));
  }

  void build_poses() {
    double since = std::numeric_limits<double>::infinity();
    for (size_t k = 0; k < m_.size(); ++k) {
      if (!m_.ext[k]) {
        since = std::numeric_limits<double>::infinity();
        continue;
      }
      if (k > 0 && m_.ext[k - 1] && std::isfinite(since)) {
        const double dx = m_.x[k] - m_.x[k - 1], dy = m_.y[k] - m_.y[k - 1], dz = m_.z[k] - m_.z[k - 1];
        since += std::sqrt(dx * dx + dy * dy + dz * dz);
      }
      if (since >= p_.pose_spacing) {
        poses_.push_back(k);
        since = 0.0;
      }
    }
  }

  const Moves& m_;
  const Params& p_;
  unsigned threads_;
  double reach_nozzle_ = 0.0, reach_body_ = 0.0;
  std::vector<double> nozzle_, body_;
  std::unique_ptr<apex::PastMaterialIndex> index_;
  std::vector<size_t> poses_;
};

// --------------------------------------------------------------------------------------------
// Passe 3 : emission polaire, avec subdivision adaptative
// --------------------------------------------------------------------------------------------

struct Pt { double x, y, z; };
struct State { double r, c, z, b; };

struct PolarCalc {
  double pivot;

  State polar(double x, double y, double z, double b_deg, double c_ref) const {
    const double r = std::hypot(x, y);
    double c;
    if (r < 1e-6) c = c_ref;
    else {
      const double theta = degrees(std::atan2(y, x));
      c = c_ref + (pymod(theta - c_ref + 180.0, 360.0) - 180.0);
    }
    const double b = radians(b_deg);
    return {r + pivot * std::sin(b), c, z - pivot * (1.0 - std::cos(b)), b_deg};
  }

  Pt tip(double big_r, double c_deg, double big_z, double b_deg) const {
    const double b = radians(b_deg);
    const double r = big_r - pivot * std::sin(b);
    const double c = radians(c_deg);
    return {r * std::cos(c), r * std::sin(c), big_z + pivot * (1.0 - std::cos(b))};
  }

  // Etats aux n+1 points de subdivision et ecart maximal au milieu des sous-segments.
  double plan(const Pt& p0, const Pt& p1, double b0, double b1, int n, double c_ref, State* states) const {
    double c = c_ref;
    std::vector<State> local;
    if (!states) { local.resize(static_cast<size_t>(n) + 1); states = local.data(); }
    for (int i = 0; i <= n; ++i) {
      const double f = static_cast<double>(i) / n;
      const double x = p0.x + (p1.x - p0.x) * f;
      const double y = p0.y + (p1.y - p0.y) * f;
      const double z = p0.z + (p1.z - p0.z) * f;
      const double b = b0 + (b1 - b0) * f;
      states[i] = polar(x, y, z, b, c);
      c = states[i].c;
    }
    double error = 0.0;
    for (int i = 0; i < n; ++i) {
      const State& s0 = states[i];
      const State& s1 = states[i + 1];
      const Pt mid = tip((s0.r + s1.r) / 2, (s0.c + s1.c) / 2, (s0.z + s1.z) / 2, (s0.b + s1.b) / 2);
      const double f = (static_cast<double>(i) + 0.5) / n;
      const double ex = p0.x + (p1.x - p0.x) * f - mid.x;
      const double ey = p0.y + (p1.y - p0.y) * f - mid.y;
      const double ez = p0.z + (p1.z - p0.z) * f - mid.z;
      error = std::max(error, std::sqrt(ex * ex + ey * ey + ez * ez));
    }
    return error;
  }
};

enum class OpKind : std::uint8_t { Text, Start, Move, EOnly };

struct Op {
  OpKind kind;
  std::int32_t text = -1;
  Pt p0{}, p1{};
  double b0 = 0, b1 = 0, de = 0, feed = 0;
  int n = 1;
};

enum class RecKind : std::uint8_t { Text, Move, EOnly };

struct Rec {
  RecKind kind;
  bool has_e = false, has_feed = false;
  std::int32_t text = -1;
  double r = 0, c = 0, z = 0, b = 0, e = 0, feed = 0;
};

}  // namespace

std::string convert(const std::string& text, const Params& params, Summary& summary,
                    const std::function<void(int)>& progress) {
  const unsigned threads = thread_count(params);
  auto report = [&](double pct) {
    progress(static_cast<int>(std::max(0.0, std::min(100.0, pct))));
  };

  Reader rd = read_gcode(text, params.center_x, params.center_y, report);
  Moves& m = rd.moves;
  const size_t n = m.size();
  summary = Summary{};
  summary.moves_in = static_cast<std::int64_t>(n);

  std::vector<double> tilts(n, 0.0);
  if (params.dynamic) {
    report(30);
    const NormalField field = build_normal_field(m, threads);
    report(35);
    std::vector<double> targets = extrusion_targets(m, params, field, threads);
    report(40);
    tilts = fill_and_smooth(m, params, targets);
    if (!params.head_samples.empty()) {
      CollisionAvoider avoider(m, params, threads);
      if (avoider.ready()) {
        summary.collision_checked = true;
        const std::vector<size_t>& poses = avoider.poses();
        summary.poses_tested = static_cast<std::int64_t>(poses.size());
        std::vector<std::uint8_t> flagged(poses.size());
        auto check = [&]() {
          parallel_for(poses.size(), threads, 8, [&](size_t a, size_t e) {
            for (size_t i = a; i < e; ++i) flagged[i] = avoider.collides(poses[i], tilts[poses[i]]) ? 1 : 0;
          });
          return static_cast<std::int64_t>(std::count(flagged.begin(), flagged.end(), 1));
        };
        const std::vector<double> original = targets;
        summary.collisions_before = check();
        std::int64_t remaining = summary.collisions_before;

        // Longueur cumulee du trajet et coupures (trajets a vide) entre poses consecutives.
        std::vector<double> cum(n, 0.0);
        std::vector<std::int32_t> nonext(n + 1, 0);
        for (size_t k = 0; k < n; ++k) {
          if (k > 0) {
            const double dx = m.x[k] - m.x[k - 1], dy = m.y[k] - m.y[k - 1], dz = m.z[k] - m.z[k - 1];
            cum[k] = cum[k - 1] + std::sqrt(dx * dx + dy * dy + dz * dz);
          }
          nonext[k + 1] = nonext[k] + (m.ext[k] ? 0 : 1);
        }
        const size_t P = poses.size();
        auto connected = [&](size_t i) {  // poses i-1 et i sur un meme cordon continu
          return i > 0 && nonext[poses[i] + 1] - nonext[poses[i - 1] + 1] == 0;
        };
        const double grid = std::max(0.5, params.b_rate_deg_per_mm * params.pose_spacing);
        const int window = static_cast<int>(std::ceil(params.b_search_span / grid));

        for (int round = 0; round < params.collision_rounds && remaining > 0; ++round) {
          report(40 + 5.0 * round / std::max(1, params.collision_rounds));
          // Fenetres autour des poses en collision : la vitesse d'inclinaison bornee impose de
          // commencer a s'ecarter avant l'obstacle, sur un nombre de poses fini.
          std::vector<std::uint8_t> inwin(P, 0);
          for (size_t i = 0; i < P; ++i) {
            if (!flagged[i]) continue;
            const size_t lo = i > static_cast<size_t>(window) ? i - static_cast<size_t>(window) : 0;
            const size_t hi = std::min(P - 1, i + static_cast<size_t>(window));
            for (size_t j = lo; j <= hi; ++j) inwin[j] = 1;
          }
          std::vector<std::pair<size_t, size_t>> segs;
          for (size_t i = 0; i < P;) {
            if (!inwin[i]) { ++i; continue; }
            size_t j = i;
            while (j + 1 < P && inwin[j + 1] && connected(j + 1)) ++j;
            segs.emplace_back(i, j);
            i = j + 1;
          }
          std::vector<double> chosen(P, kNaN);
          const std::vector<double> current = tilts;
          // Chaque fenetre est independante des autres (matiere = positions seulement) : un fil par fenetre.
          parallel_for(segs.size(), threads, 1, [&](size_t sa, size_t se) {
            for (size_t si = sa; si < se; ++si) {
              const size_t lo = segs[si].first, hi = segs[si].second;
              const size_t len = hi - lo + 1;
              const double inf = std::numeric_limits<double>::infinity();
              std::vector<int> smin(len), smax(len);
              std::vector<size_t> off(len + 1, 0);
              for (size_t i = 0; i < len; ++i) {
                const double t = current[poses[lo + i]];
                smin[i] = static_cast<int>(std::ceil(std::max(params.b_min, t - params.b_search_span) / grid));
                smax[i] = static_cast<int>(std::floor(std::min(params.b_reorient_max, t + params.b_search_span) / grid));
                if (smax[i] < smin[i]) smax[i] = smin[i] - 1;
                off[i + 1] = off[i] + static_cast<size_t>(smax[i] - smin[i] + 1);
              }
              std::vector<double> cost(off[len], inf);
              std::vector<std::int32_t> back(off[len], -1);
              std::vector<std::int8_t> freev(off[len], -1);  // -1 inconnu, 0 libre, 1 collision
              auto is_free = [&](size_t i, int s) {
                std::int8_t& f = freev[off[i] + static_cast<size_t>(s - smin[i])];
                if (f < 0) f = avoider.collides(poses[lo + i], s * grid) ? 1 : 0;
                return f == 0;
              };
              auto jump_cells = [&](size_t pose_a, size_t pose_b) {
                const double d = cum[poses[pose_b]] - cum[poses[pose_a]];
                return std::max(1, static_cast<int>(std::floor(params.b_rate_deg_per_mm * d / grid + 1e-9)));
              };
              const bool has_prev = lo > 0 && connected(lo);
              const bool has_next = hi + 1 < P && connected(hi + 1);
              const double prev_b = has_prev ? current[poses[lo - 1]] : 0.0;
              const double next_b = has_next ? current[poses[hi + 1]] : 0.0;
              const double prev_lim = has_prev ? params.b_rate_deg_per_mm * (cum[poses[lo]] - cum[poses[lo - 1]]) + 1e-6 : 0.0;
              const double next_lim = has_next ? params.b_rate_deg_per_mm * (cum[poses[hi + 1]] - cum[poses[hi]]) + 1e-6 : 0.0;
              for (int s = smin[0]; s <= smax[0]; ++s) {
                if (has_prev && std::abs(s * grid - prev_b) > prev_lim) continue;
                if (!is_free(0, s)) continue;
                cost[off[0] + static_cast<size_t>(s - smin[0])] = std::abs(s * grid - current[poses[lo]]);
              }
              for (size_t i = 1; i < len; ++i) {
                const int jc = jump_cells(lo + i - 1, lo + i);
                for (int s = smin[i]; s <= smax[i]; ++s) {
                  double bestc = inf;
                  int bests = 0;
                  const int from = std::max(smin[i - 1], s - jc), to = std::min(smax[i - 1], s + jc);
                  for (int q = from; q <= to; ++q) {
                    const double c = cost[off[i - 1] + static_cast<size_t>(q - smin[i - 1])];
                    if (c < bestc) { bestc = c; bests = q; }
                  }
                  if (bestc == inf || !is_free(i, s)) continue;
                  cost[off[i] + static_cast<size_t>(s - smin[i])] = bestc + std::abs(s * grid - current[poses[lo + i]]);
                  back[off[i] + static_cast<size_t>(s - smin[i])] = bests;
                }
              }
              double bestc = inf;
              int bests = 0;
              for (int s = smin[len - 1]; s <= smax[len - 1]; ++s) {
                if (has_next && std::abs(s * grid - next_b) > next_lim) continue;
                const double c = cost[off[len - 1] + static_cast<size_t>(s - smin[len - 1])];
                if (c < bestc) { bestc = c; bests = s; }
              }
              if (bestc == inf) continue;  // fenetre sans issue : laissee telle quelle
              int s = bests;
              for (size_t i = len; i-- > 0;) {
                chosen[lo + i] = s * grid;
                s = back[off[i] + static_cast<size_t>(s - smin[i])];
              }
            }
          });
          // B choisi aux poses ; entre deux poses d'une fenetre, interpolation sur la longueur de trajet.
          std::vector<std::uint8_t> touched(P, 0);
          for (size_t i = 0; i < P; ++i) {
            if (std::isnan(chosen[i])) continue;
            targets[poses[i]] = chosen[i];
            touched[i] = 1;
          }
          for (size_t i = 0; i < P; ++i) {
            if (!touched[i]) continue;
            // moves apres la pose i jusqu'a la pose suivante (ou la fin du cordon)
            if (i + 1 < P && connected(i + 1)) {
              const size_t k0 = poses[i], k1 = poses[i + 1];
              const double b0 = targets[k0], b1 = touched[i + 1] ? targets[k1] : current[k1];
              const double span = cum[k1] - cum[k0];
              for (size_t k = k0 + 1; k < k1; ++k) {
                if (!m.ext[k]) continue;
                const double f = span > 0 ? (cum[k] - cum[k0]) / span : 0.0;
                targets[k] = b0 + (b1 - b0) * f;
              }
            }
            if (i > 0 && connected(i) && !touched[i - 1]) {
              const size_t k0 = poses[i - 1], k1 = poses[i];
              const double b0 = current[k0], b1 = targets[k1];
              const double span = cum[k1] - cum[k0];
              for (size_t k = k0 + 1; k < k1; ++k) {
                if (!m.ext[k]) continue;
                const double f = span > 0 ? (cum[k] - cum[k0]) / span : 0.0;
                targets[k] = b0 + (b1 - b0) * f;
              }
            }
          }
          tilts = fill_and_smooth(m, params, targets);
          remaining = check();
        }
        summary.collisions_after = remaining;
        for (size_t k = 0; k < n; ++k) {
          if (!std::isnan(original[k]) && targets[k] != original[k]) ++summary.reoriented;
        }
      }
    }
  }
  report(45);

  // --- Operations (decisions sequentielles : suppression hors plateau, point precedent) -------------------
  std::vector<std::string> texts = std::move(rd.texts);
  std::vector<Op> ops;
  ops.reserve(n + rd.items.size() + 16);
  auto add_text = [&](const std::string& s) {
    texts.push_back(s);
    Op o;
    o.kind = OpKind::Text;
    o.text = static_cast<std::int32_t>(texts.size() - 1);
    ops.push_back(o);
  };
  std::string mode = params.dynamic ? "dynamic" : "polar";
  auto fmt_str = [](double v, int d) { std::string s; append_fmt(s, v, d); return s; };
  add_text(params.source.empty() ? "; generated by Apex Slicer 1.0 (conversion polaire)"
                                  : "; generated by Apex Slicer 1.0 (conversion polaire depuis " + params.source + ")");
  add_text("; apex_conversion_mode = " + mode);
  add_text("; apex_bed_center = " + fmt_str(params.center_x, 3) + "," + fmt_str(params.center_y, 3));
  add_text("; apex_nozzle_pivot_mm = " + fmt_str(params.pivot, 3));
  add_text("; apex_dropped_outside_radius_mm = " + fmt_str(params.drop_radius, 3));
  add_text("G21");
  add_text("G90");
  add_text("M82");

  bool have_prev = false, after_drop = false;
  Pt prev{};
  double prev_b = 0.0;
  for (const Item& item : rd.items) {
    if (item.text >= 0) {
      Op o;
      o.kind = OpKind::Text;
      o.text = item.text;
      ops.push_back(o);
      continue;
    }
    for (size_t k = item.a; k < item.b; ++k) {
      const Pt p{m.x[k], m.y[k], m.z[k]};
      double de = m.de[k];
      const double rad = std::hypot(p.x, p.y);
      summary.max_tip_radius = std::max(summary.max_tip_radius, rad);
      if (params.drop_radius != 0.0 && rad > params.drop_radius) {
        ++summary.dropped;
        after_drop = true;
        if (have_prev && std::abs(de) > kEEps && !m.ext[k]) {
          Op o;
          o.kind = OpKind::Move;
          o.p0 = o.p1 = prev;
          o.b0 = o.b1 = prev_b;
          o.de = de;
          o.feed = m.feed[k];
          ops.push_back(o);
        }
        continue;
      }
      if (rad > params.plate_radius) ++summary.beyond_plate_moves;
      if (after_drop && m.ext[k]) de = 0.0;
      after_drop = false;
      Op o;
      o.p1 = p;
      o.b1 = tilts[k];
      o.de = de;
      o.feed = m.feed[k];
      if (!have_prev) {
        o.kind = OpKind::Start;
      } else {
        o.kind = OpKind::Move;
        o.p0 = prev;
        o.b0 = prev_b;
      }
      ops.push_back(o);
      prev = p;
      prev_b = tilts[k];
      have_prev = true;
    }
  }

  const PolarCalc calc{params.pivot};

  // --- Phase A (parallele) : nombre de subdivisions par segment ---------------------------------------
  // Le nombre de subdivisions ne depend pas du decalage de 360 degres de l'angle deroule : seule la
  // partie periodique entre dans la trajectoire de la buse.
  parallel_for(ops.size(), threads, 256, [&](size_t a, size_t e) {
    for (size_t i = a; i < e; ++i) {
      Op& o = ops[i];
      if (o.kind != OpKind::Move) continue;
      if (o.p0.x == o.p1.x && o.p0.y == o.p1.y && o.p0.z == o.p1.z && o.b0 == o.b1) {
        o.n = 0;
        continue;
      }
      // Un segment qui passe par l'axe du plateau : le sens de repliement de l'angle depend de l'angle
      // courant reel, connu seulement a la phase B.
      {
        const double dx = o.p1.x - o.p0.x, dy = o.p1.y - o.p0.y;
        const double len2 = dx * dx + dy * dy;
        double t = len2 > 0 ? -(o.p0.x * dx + o.p0.y * dy) / len2 : 0.0;
        t = std::max(0.0, std::min(1.0, t));
        if (std::hypot(o.p0.x + t * dx, o.p0.y + t * dy) < 0.05) {
          o.n = -1;
          continue;
        }
      }
      const double r0 = std::hypot(o.p0.x, o.p0.y);
      const double c_ref = r0 > 1e-6 ? degrees(std::atan2(o.p0.y, o.p0.x)) : 0.0;
      int nn = 1;
      double err = calc.plan(o.p0, o.p1, o.b0, o.b1, nn, c_ref, nullptr);
      while (err > params.tol && nn < kMaxSubdivisions) {
        nn *= 2;
        err = calc.plan(o.p0, o.p1, o.b0, o.b1, nn, c_ref, nullptr);
      }
      o.n = nn;
    }
  });
  report(60);

  // --- Phase B (sequentielle) : angle deroule, E, avance ------------------------------------------------
  std::vector<Rec> recs;
  recs.reserve(ops.size() + n / 4);
  double cur_c = 0.0, cur_e = 0.0, cur_feed = 0.0;
  bool have_feed = false;
  double max_error = 0.0, b_min = 0.0, b_max = 0.0, max_pivot = 0.0;
  auto feed_flag = [&](Rec& r, double feed) {
    if (have_feed && feed == cur_feed) return;
    have_feed = true;
    cur_feed = feed;
    r.has_feed = true;
    r.feed = feed;
  };
  std::vector<State> states;
  for (const Op& o : ops) {
    Rec r;
    switch (o.kind) {
      case OpKind::Text:
        r.kind = RecKind::Text;
        r.text = o.text;
        recs.push_back(r);
        break;
      case OpKind::Start: {
        const double rad = std::hypot(o.p1.x, o.p1.y);
        cur_c = rad > 1e-6 ? degrees(std::atan2(o.p1.y, o.p1.x)) : 0.0;
        const State s = calc.polar(o.p1.x, o.p1.y, o.p1.z, o.b1, cur_c);
        r.kind = RecKind::Move;
        r.r = s.r; r.c = s.c; r.z = s.z; r.b = o.b1;
        max_pivot = std::max(max_pivot, s.r);
        if (std::abs(o.de) > kEEps) {
          cur_e += o.de;
          r.has_e = true;
          r.e = cur_e;
        }
        feed_flag(r, o.feed);
        recs.push_back(r);
        break;
      }
      case OpKind::Move: {
        if (o.n == 0) {
          if (std::abs(o.de) > kEEps) {
            cur_e += o.de;
            r.kind = RecKind::EOnly;
            r.has_e = true;
            r.e = cur_e;
            feed_flag(r, o.feed);
            recs.push_back(r);
          }
          break;
        }
        int nn = o.n;
        if (nn < 0) {
          nn = 1;
          double e0 = calc.plan(o.p0, o.p1, o.b0, o.b1, nn, cur_c, nullptr);
          while (e0 > params.tol && nn < kMaxSubdivisions) {
            nn *= 2;
            e0 = calc.plan(o.p0, o.p1, o.b0, o.b1, nn, cur_c, nullptr);
          }
        }
        states.resize(static_cast<size_t>(nn) + 1);
        const double err = calc.plan(o.p0, o.p1, o.b0, o.b1, nn, cur_c, states.data());
        max_error = std::max(max_error, err);
        for (int i = 1; i <= nn; ++i) {
          const State& s = states[static_cast<size_t>(i)];
          cur_c = s.c;
          b_min = std::min(b_min, s.b);
          b_max = std::max(b_max, s.b);
          max_pivot = std::max(max_pivot, s.r);
          Rec mr;
          mr.kind = RecKind::Move;
          mr.r = s.r; mr.c = s.c; mr.z = s.z; mr.b = s.b;
          if (std::abs(o.de) > kEEps) {
            cur_e += o.de / nn;
            mr.has_e = true;
            mr.e = cur_e;
          }
          feed_flag(mr, o.feed);
          recs.push_back(mr);
        }
        break;
      }
      default:
        break;
    }
  }
  report(75);

  // --- Phase C (parallele) : mise en forme du texte -------------------------------------------------
  const size_t block = 8192;
  const size_t blocks = (recs.size() + block - 1) / block;
  std::vector<std::string> pieces(blocks);
  parallel_for(blocks, threads, 1, [&](size_t a, size_t e) {
    for (size_t bi = a; bi < e; ++bi) {
      std::string& out = pieces[bi];
      out.reserve(block * 48);
      const size_t lo = bi * block, hi = std::min(recs.size(), lo + block);
      for (size_t i = lo; i < hi; ++i) {
        const Rec& r = recs[i];
        if (r.kind == RecKind::Text) {
          out += texts[static_cast<size_t>(r.text)];
        } else if (r.kind == RecKind::Move) {
          out += "G00 Y";
          append_fmt(out, r.c, 4);
          out += " X";
          append_fmt(out, r.r, 4);
          out += " Z";
          append_fmt(out, r.z, 4);
          out += " B";
          append_fmt(out, r.b, 3);
          if (r.has_e) { out += " E"; append_fmt(out, r.e, 5); }
          if (r.has_feed) { out += " F"; append_fmt(out, r.feed, 1); }
        } else {
          out += "G00 E";
          append_fmt(out, r.e, 5);
          if (r.has_feed) { out += " F"; append_fmt(out, r.feed, 1); }
        }
        out += '\n';
      }
    }
  });
  size_t total = 0;
  for (const auto& s : pieces) total += s.size();
  std::string result;
  result.reserve(total);
  for (const auto& s : pieces) result += s;
  report(100);

  summary.lines_out = static_cast<std::int64_t>(recs.size());
  summary.max_error = max_error;
  summary.b_min = b_min;
  summary.b_max = b_max;
  summary.max_pivot_radius = max_pivot;
  return result;
}

}  // namespace apex::polar
