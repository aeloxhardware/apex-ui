// Banc du noyau d'edition sur un vrai G-code polaire du moteur :
//   apex_edit_bench <fichier.gcode> [rayon_de_contact_mm]
// Mesure le chargement (grille, graphe de contacts), puis pour plusieurs reglages d'influence et
// plusieurs poignees : le calcul de l'influence, une image de glissement (tous les coeurs, puis un
// seul), la validation et l'annulation.
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <string>
#include <vector>

#include "edit_kernel.hpp"

using namespace apex::edit;
using Clock = std::chrono::steady_clock;

namespace {

struct Moves {
  std::vector<double> r, c, z, b;
  std::vector<uint8_t> ext;
};

double ms_since(Clock::time_point t0) { return std::chrono::duration<double, std::milli>(Clock::now() - t0).count(); }

// Lecteur minimal G0/G1 (X = R, Y = C, Z, B, E absolu), G92 E. Suffisant pour les fichiers du
// moteur (file_io/gcode_export.py) ; le vrai parseur reste gcodeParse.ts.
bool read_gcode(const char* path, Moves& out) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return false;
  std::string line;
  double r = 0, c = 0, z = 0, b = 0, e = 0;
  while (std::getline(in, line)) {
    const char* s = line.c_str();
    while (*s == ' ' || *s == '\t') ++s;
    if (*s != 'G') continue;
    char* end = nullptr;
    const long code = std::strtol(s + 1, &end, 10);
    if (end == s + 1 || (code != 0 && code != 1 && code != 92)) continue;
    bool has_pos = false, has_e = false;
    double ev = 0.0;
    const char* p = end;
    while (*p && *p != ';') {
      const char letter = *p;
      if (letter >= 'A' && letter <= 'Z') {
        char* stop = nullptr;
        const double v = std::strtod(p + 1, &stop);
        if (stop != p + 1) {
          switch (letter) {
            case 'X': r = v; has_pos = true; break;
            case 'Y': c = v; has_pos = true; break;
            case 'Z': z = v; has_pos = true; break;
            case 'B': b = v; has_pos = true; break;
            case 'E': ev = v; has_e = true; break;
            default: break;
          }
          p = stop;
          continue;
        }
      }
      ++p;
    }
    if (code == 92) {
      if (has_e) e = ev;
      continue;
    }
    if (has_pos) {
      out.r.push_back(r);
      out.c.push_back(c);
      out.z.push_back(z);
      out.b.push_back(b);
      out.ext.push_back(has_e && ev > e + 1e-12 ? 1 : 0);
    }
    if (has_e) e = ev;
  }
  return !out.r.empty();
}

struct Config {
  const char* name;
  InfluenceParams params;
};

InfluenceParams make(bool spatial, double r3, bool along, double rs, bool adjacency, uint32_t hops) {
  InfluenceParams p;
  p.spatial = {spatial, r3, Falloff::Cubic};
  p.along = {along, rs, Falloff::Cubic};
  p.adjacency = {adjacency, true, true, hops, hops, Falloff::Linear};
  p.combine = Combine::Product;
  return p;
}

Transform frame_transform(int f) {
  Transform t;
  t.translation = {0.6 * std::sin(f * 0.2), 0.6 * std::cos(f * 0.2), 0.3 * std::sin(f * 0.1)};
  t.axis = {0.2, 1.0, 0.1};
  t.angle_rad = 0.08 * std::sin(f * 0.15);
  return t;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::printf("usage : apex_edit_bench <fichier.gcode> [rayon_de_contact_mm]\n");
    return 2;
  }
  Moves moves;
  auto t0 = Clock::now();
  if (!read_gcode(argv[1], moves)) {
    std::printf("lecture impossible : %s\n", argv[1]);
    return 1;
  }
  std::printf("%s\n  lecture : %zu points en %.0f ms\n", argv[1], moves.r.size(), ms_since(t0));

  KernelParams kp;
  kp.pivot_mm = 46.0;
  kp.support_radius_mm = argc > 2 ? std::atof(argv[2]) : 0.5;
  EditKernel kernel;
  const LoadStats ls = kernel.load(moves.r.size(), moves.r.data(), moves.c.data(), moves.z.data(), moves.b.data(),
                                   moves.ext.data(), kp);
  size_t without = 0;
  for (uint32_t i = 0; i < kernel.size(); ++i) {
    if (kernel.pass_of(i) >= 0 && kernel.supports(i)[0] == kNoIndex) ++without;
  }
  std::printf("  chargement : %.0f ms (geometrie %.0f, grille %.0f, contacts %.0f)\n", ls.total_ms, ls.geometry_ms,
              ls.grid_ms, ls.supports_ms);
  std::printf("  %zu points de trajectoire, %zu passes, %zu cellules de %.2f mm, %zu contacts, %zu points sans support\n",
              ls.pass_points, ls.passes, ls.cells, ls.cell_mm, ls.support_edges, without);

  const Config configs[] = {
      {"sphere 2 mm", make(true, 2.0, false, 0, false, 0)},
      {"sphere 5 mm", make(true, 5.0, false, 0, false, 0)},
      {"sphere 10 mm", make(true, 10.0, false, 0, false, 0)},
      {"sphere 5 x cordon 5 x 3/3 traj.", make(true, 5.0, true, 5.0, true, 3)},
      {"cordon 3 x 2/2 traj. (sans sphere)", make(false, 0, true, 3.0, true, 2)},
  };
  const double fractions[] = {0.3, 0.5, 0.7};
  constexpr int kFrames = 30;

  std::printf("\n  %-36s %5s %9s %9s %8s %16s %10s\n", "reglage", "pos.", "deplaces", "dependants", "pose ms",
              "image ms (moy/max)", "1 fil ms");
  for (const Config& cfg : configs) {
    for (const double frac : fractions) {
      const auto index = static_cast<uint32_t>(frac * static_cast<double>(kernel.size()));
      t0 = Clock::now();
      if (!kernel.set_handle(index, cfg.params)) continue;
      const double set_ms = ms_since(t0);
      std::vector<double> frames;
      for (int f = 0; f < kFrames; ++f) {
        t0 = Clock::now();
        kernel.drag(frame_transform(f));
        frames.push_back(ms_since(t0));
      }
      double sum = 0, worst = 0;
      for (const double v : frames) {
        sum += v;
        worst = std::max(worst, v);
      }
      kernel.set_threads(1);
      t0 = Clock::now();
      for (int f = 0; f < 5; ++f) kernel.drag(frame_transform(f));
      const double single = ms_since(t0) / 5.0;
      kernel.set_threads(0);
      std::printf("  %-36s %4.0f%% %9zu %9zu %8.1f %8.2f / %6.2f %10.2f\n", cfg.name, frac * 100.0,
                  kernel.affected().size(), kernel.dependents().size(), set_ms, sum / kFrames, worst, single);
    }
  }

  // Validation puis annulation et retablissement, sphere de 5 mm au milieu du fichier.
  kernel.set_handle(static_cast<uint32_t>(kernel.size() / 2), configs[1].params);
  kernel.drag(frame_transform(3));
  const size_t moved = kernel.affected().size();
  t0 = Clock::now();
  kernel.commit();
  const double commit_ms = ms_since(t0);
  t0 = Clock::now();
  kernel.undo();
  const double undo_ms = ms_since(t0);
  t0 = Clock::now();
  kernel.redo();
  const double redo_ms = ms_since(t0);
  std::printf("\n  validation de %zu points : %.0f ms, annulation %.0f ms, retablissement %.0f ms\n", moved, commit_ms,
              undo_ms, redo_ms);
  return 0;
}
