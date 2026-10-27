// Tests du convertisseur polaire natif. La parite octet a octet avec python/gcode_to_polar.py est verifiee
// sur de vrais G-codes par scripts/check-polar-parity.py ; ici : le comportement propre au portage.
#include <cmath>
#include <cstdio>
#include <string>

#include "polar_convert.hpp"

namespace {

int failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::fprintf(stderr, "ECHEC %s:%d  %s\n", __FILE__, __LINE__, #cond); ++failures; } } while (0)

apex::polar::Params base() {
  apex::polar::Params p;
  p.tol = 0.01;
  return p;
}

std::string run(const std::string& gcode, const apex::polar::Params& p, apex::polar::Summary& s) {
  return apex::polar::convert(gcode, p, s, [](int) {});
}

bool contains(const std::string& hay, const std::string& needle) { return hay.find(needle) != std::string::npos; }

// Une ligne droite le long de x : en polaire, la buse reste sur la droite (subdivision), E conserve.
void test_polar_basic() {
  apex::polar::Summary s;
  const std::string out = run("G90\nM82\nG92 E0\nG1 X10 Y0 Z0.2 F1200\nG1 X20 Y0 Z0.2 E1.0\n", base(), s);
  CHECK(contains(out, "; apex_conversion_mode = polar"));
  CHECK(contains(out, "G00 Y0 X10 Z0.2 B0 F1200"));
  CHECK(contains(out, "G00 Y0 X20 Z0.2 B0 E1"));
  CHECK(s.moves_in == 2);
  CHECK(s.max_error < 1e-9);
}

// Un arc G2/G3 est linearise, le nombre de segments extrudes est borne.
void test_arc_and_relative_e() {
  apex::polar::Summary s;
  const std::string out = run("G90\nM83\nG1 X10 Y0 Z0.2 F600\nG3 X-10 Y0 I-10 J0 E2\n", base(), s);
  CHECK(s.moves_in > 20 && s.moves_in <= 721);
  CHECK(contains(out, " E2"));
}

// Mouvements au-dela du rayon : supprimes, le premier retour sur le plateau ne depose pas.
void test_drop_outside_radius() {
  auto p = base();
  p.drop_radius = 50.0;
  apex::polar::Summary s;
  const std::string out = run("G1 X10 Y0 Z0.2 F600\nG1 X60 Y0 Z0.2 E1\nG1 X20 Y0 Z0.2 E2\n", p, s);
  CHECK(s.dropped == 1);
  CHECK(!contains(out, "X60"));
}

// En mode dynamique, B n'est jamais negatif (la machine ne penche que vers +R) et le sens de la normale
// pointant vers le centre est ramene a 0.
void test_dynamic_b_never_negative() {
  auto p = base();
  p.dynamic = true;
  p.b_limit = 45;
  // Pente descendante vers l'exterieur : la normale pointe vers le centre.
  std::string g = "G90\nM82\nG1 X30 Y0 Z10 F600\n";
  double e = 0;
  for (int i = 1; i <= 30; ++i) {
    e += 0.05;
    g += "G1 X" + std::to_string(30 + i) + " Y0 Z" + std::to_string(10 - 0.5 * i) + " E" + std::to_string(e) + "\n";
  }
  apex::polar::Summary s;
  run(g, p, s);
  CHECK(s.b_min >= 0.0);
}

// Evitement : un pilier deja imprime touche la tete droite ; la reorientation trouve un B libre.
void test_collision_avoidance() {
  auto p = base();
  p.dynamic = true;
  p.head_samples = {0, 5, 0, 0, 10, 0, 0, 20, 0, 6, 20, 0, 0, 30, 0};  // axe + un echantillon decale de 6 mm
  p.contact_clearance = 3.0;
  p.nozzle_zone = 10.0;
  p.pose_spacing = 0.5;
  std::string g = "G90\nM82\nG92 E0\nG1 X66 Y0 Z0 F600\n";
  double e = 0;
  for (int z = 1; z <= 30; ++z) { e += 0.1; g += "G1 X66 Y0 Z" + std::to_string(z) + " E" + std::to_string(e) + "\n"; }
  g += "G1 X60.5 Y0 Z10 F3000\nG1 X60 Y0 Z10 E" + std::to_string(e + 0.1) + " F600\n";
  apex::polar::Summary s;
  run(g, p, s);
  CHECK(s.collision_checked);
  CHECK(s.collisions_before > 0);
  CHECK(s.collisions_after == 0);
  CHECK(s.reoriented > 0);
  CHECK(s.b_min >= 0.0);

  // Resultat independant du nombre de fils.
  auto p1 = p;
  p1.threads = 1;
  auto p8 = p;
  p8.threads = 8;
  apex::polar::Summary s1, s8;
  CHECK(run(g, p1, s1) == run(g, p8, s8));
}

}  // namespace

int main() {
  test_polar_basic();
  test_arc_and_relative_e();
  test_drop_outside_radius();
  test_dynamic_b_never_negative();
  test_collision_avoidance();
  if (failures) {
    std::fprintf(stderr, "%d echec(s)\n", failures);
    return 1;
  }
  std::puts("test_polar_convert : OK");
  return 0;
}
