// Executable autonome : meme ligne de commande que python/gcode_to_polar.py, plus l'evitement des
// collisions de la tete (--head-samples). Progression « PROGRESS n » sur stderr, resume JSON sur stdout.
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <iterator>
#include <sstream>
#include <string>

#include "polar_convert.hpp"

namespace {

[[noreturn]] void usage(const char* why) {
  std::fprintf(stderr, "apex_gcode_to_polar: %s\n", why);
  std::exit(2);
}

std::string json_number(double v) {
  char buf[64];
  std::snprintf(buf, sizeof buf, "%.17g", v);
  return buf;
}

}  // namespace

int main(int argc, char** argv) {
  apex::polar::Params p;
  std::string input, output, head_file;
  bool have_cx = false, have_cy = false, avoid = true;
  for (int i = 1; i < argc; ++i) {
    const std::string a = argv[i];
    auto next = [&]() -> const char* {
      if (i + 1 >= argc) usage(("valeur manquante apres " + a).c_str());
      return argv[++i];
    };
    if (a == "--mode") {
      const std::string v = next();
      if (v != "polar" && v != "dynamic") usage("--mode : polar ou dynamic");
      p.dynamic = v == "dynamic";
    } else if (a == "--center-x") { p.center_x = std::atof(next()); have_cx = true; }
    else if (a == "--center-y") { p.center_y = std::atof(next()); have_cy = true; }
    else if (a == "--pivot") p.pivot = std::atof(next());
    else if (a == "--b-limit") p.b_limit = std::atof(next());
    else if (a == "--b-min") p.b_min = std::atof(next());
    else if (a == "--b-rate") p.b_rate_deg_per_mm = std::atof(next());
    else if (a == "--tol") p.tol = std::atof(next());
    else if (a == "--source") p.source = next();
    else if (a == "--drop-outside-radius") p.drop_radius = std::atof(next());
    else if (a == "--plate-radius") p.plate_radius = std::atof(next());
    else if (a == "--threads") p.threads = std::atoi(next());
    else if (a == "--head-samples") head_file = next();
    else if (a == "--no-collision-avoidance") avoid = false;
    else if (a == "--nozzle-tolerance") p.nozzle_tolerance = std::atof(next());
    else if (a == "--body-tolerance") p.body_tolerance = std::atof(next());
    else if (a == "--pose-spacing") p.pose_spacing = std::atof(next());
    else if (a == "--b-reorient-max") p.b_reorient_max = std::atof(next());
    else if (a == "--collision-rounds") p.collision_rounds = std::atoi(next());
    else if (!a.empty() && a[0] == '-') usage(("option inconnue : " + a).c_str());
    else if (input.empty()) input = a;
    else if (output.empty()) output = a;
    else usage("trop d'arguments");
  }
  if (input.empty() || output.empty() || !have_cx || !have_cy) usage("usage : input output --center-x X --center-y Y [options]");

  std::ifstream in(input, std::ios::binary);
  if (!in) usage("lecture impossible");
  const std::string text((std::istreambuf_iterator<char>(in)), std::istreambuf_iterator<char>());

  if (avoid && !head_file.empty()) {
    std::ifstream hs(head_file, std::ios::binary);
    if (!hs) usage("modele de tete illisible");
    std::string raw((std::istreambuf_iterator<char>(hs)), std::istreambuf_iterator<char>());
    p.head_samples.resize(raw.size() / sizeof(float));
    std::memcpy(p.head_samples.data(), raw.data(), p.head_samples.size() * sizeof(float));
  }

  apex::polar::Summary s;
  int last = -1;
  const std::string out = apex::polar::convert(text, p, s, [&](int pct) {
    if (pct != last) {
      last = pct;
      std::fprintf(stderr, "PROGRESS %d\n", pct);
      std::fflush(stderr);
    }
  });
  std::ofstream of(output, std::ios::binary);
  if (!of) usage("ecriture impossible");
  of.write(out.data(), static_cast<std::streamsize>(out.size()));

  std::printf("{\"movesIn\": %lld, \"droppedMoves\": %lld, \"linesOut\": %lld, \"maxErrorMm\": %s, \"bMin\": %s, \"bMax\": %s, "
              "\"maxTipRadiusMm\": %s, \"maxPivotRadiusMm\": %s, \"beyondPlateMoves\": %lld, "
              "\"collisionChecked\": %s, \"posesTested\": %lld, \"collisionsBefore\": %lld, \"collisionsAfter\": %lld, \"reorientedMoves\": %lld}\n",
              static_cast<long long>(s.moves_in), static_cast<long long>(s.dropped), static_cast<long long>(s.lines_out),
              json_number(s.max_error).c_str(), json_number(s.b_min).c_str(), json_number(s.b_max).c_str(),
              json_number(s.max_tip_radius).c_str(), json_number(s.max_pivot_radius).c_str(),
              static_cast<long long>(s.beyond_plate_moves), s.collision_checked ? "true" : "false",
              static_cast<long long>(s.poses_tested), static_cast<long long>(s.collisions_before),
              static_cast<long long>(s.collisions_after), static_cast<long long>(s.reoriented));
  return 0;
}
