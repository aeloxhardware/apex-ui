// Rejeu des vecteurs de la cinematique pivot/pointe publies par le moteur (R-008, RULES §6) contre le noyau
// d'edition : pour chaque vecteur de la configuration que le noyau represente (B non inverse, pivot decale
// vers +R, Z de la pointe), les valeurs firmware (X, Y, Z, B) donnent la pointe attendue.
//   apex_kinematics_vectors_tests <kinematics_vectors.json>
// Le fichier est celui du moteur, copie par scripts/sync-engine-vectors.cjs (src/generated/).
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <sstream>
#include <string>
#include <vector>

#include "edit_kernel.hpp"

using namespace apex::edit;

namespace {

// Lecteur JSON minimal (objets, tableaux, nombres, chaines, null, booleens) : le fichier est genere, sans echappements.
struct Json {
  enum Kind { Null, Bool, Number, String, Array, Object } kind = Null;
  double number = 0.0;
  bool boolean = false;
  std::string text;
  std::vector<Json> items;
  std::map<std::string, Json> fields;
  const Json& at(const std::string& key) const { return fields.at(key); }
};

struct Parser {
  const std::string& s;
  size_t i = 0;
  explicit Parser(const std::string& src) : s(src) {}
  void ws() { while (i < s.size() && std::isspace(static_cast<unsigned char>(s[i]))) ++i; }
  std::string str() {
    std::string out;
    ++i;  // guillemet ouvrant
    while (i < s.size() && s[i] != '"') out += s[i++];
    ++i;
    return out;
  }
  Json value() {
    ws();
    Json j;
    if (s[i] == '{') {
      j.kind = Json::Object;
      ++i;
      ws();
      while (s[i] != '}') {
        ws();
        const std::string key = str();
        ws();
        ++i;  // :
        j.fields[key] = value();
        ws();
        if (s[i] == ',') ++i;
        ws();
      }
      ++i;
    } else if (s[i] == '[') {
      j.kind = Json::Array;
      ++i;
      ws();
      while (s[i] != ']') {
        j.items.push_back(value());
        ws();
        if (s[i] == ',') ++i;
        ws();
      }
      ++i;
    } else if (s[i] == '"') {
      j.kind = Json::String;
      j.text = str();
    } else if (s.compare(i, 4, "null") == 0) {
      i += 4;
    } else if (s.compare(i, 4, "true") == 0) {
      j.kind = Json::Bool;
      j.boolean = true;
      i += 4;
    } else if (s.compare(i, 5, "false") == 0) {
      j.kind = Json::Bool;
      i += 5;
    } else {
      j.kind = Json::Number;
      char* end = nullptr;
      j.number = std::strtod(s.c_str() + i, &end);
      i = static_cast<size_t>(end - s.c_str());
    }
    return j;
  }
};

}  // namespace

int main(int argc, char** argv) {
  if (argc < 2) {
    std::printf("usage : %s <kinematics_vectors.json>\n", argv[0]);
    return 2;
  }
  std::ifstream in(argv[1], std::ios::binary);
  if (!in) {
    std::printf("fichier de vecteurs illisible : %s\n", argv[1]);
    return 2;
  }
  std::stringstream buffer;
  buffer << in.rdbuf();
  const std::string src = buffer.str();
  Parser parser(src);
  const Json doc = parser.value();
  if (doc.at("format").text != "apex-kinematics-vectors-1") {
    std::printf("format de vecteurs inconnu : %s\n", doc.at("format").text.c_str());
    return 2;
  }
  const double tol = doc.at("tolerance_mm").number;

  int checked = 0, skipped = 0, failures = 0;
  for (const Json& v : doc.at("vectors").items) {
    // Configurations hors du noyau (B inverse, pivot de l'autre cote, Z du pivot) : refusees au chargement du fichier.
    if (v.at("b_sign").number != 1.0 || v.at("tilt_sign").number != 1.0 || v.at("z_reference").text != "tip") {
      ++skipped;
      continue;
    }
    const Json& fw = v.at("firmware");
    const double r = fw.at("X").number, c = fw.at("Y").number, z = fw.at("Z").number, b = fw.at("B").number;
    const uint8_t extruding = 0;
    KernelParams params;
    params.pivot_mm = v.at("pivot_to_tip").number;
    EditKernel kernel;
    kernel.load(1, &r, &c, &z, &b, nullptr, &extruding, params);
    const Vec3 tip = kernel.tip(0);
    const double ex = v.at("tip").items[0].number, ey = v.at("tip").items[1].number, ez = v.at("tip").items[2].number;
    ++checked;
    // Au centre (inverse non exact) Y est herite : seule la hauteur et le rayon comptent.
    const bool exact = v.at("inverse_exact").boolean;
    const bool ok = std::abs(tip.z - ez) <= tol &&
                    (exact ? (std::abs(tip.x - ex) <= tol && std::abs(tip.y - ey) <= tol)
                           : std::abs(std::hypot(tip.x, tip.y) - std::hypot(ex, ey)) <= tol);
    if (!ok) {
      ++failures;
      std::printf("  ECHEC : pointe (%.9f, %.9f, %.9f), attendue (%.9f, %.9f, %.9f)\n", tip.x, tip.y, tip.z, ex, ey, ez);
    }
  }
  std::printf("%d vecteur(s) rejoue(s) contre le noyau, %d hors configuration par defaut, %d echec(s)\n", checked, skipped, failures);
  return (failures == 0 && checked > 0) ? 0 : 1;
}
