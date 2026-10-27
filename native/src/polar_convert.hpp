#pragma once
// Conversion d'un G-code cartesien 3 axes en G-code polaire Apex (portage de python/gcode_to_polar.py,
// dont la sortie sert d'oracle) + evitement des collisions de la tete en mode dynamique.
//
// Le calcul est parallele partout ou les elements sont independants (carte de hauteur par couche, normale
// par mouvement, nombre de subdivisions par segment, test de collision par pose, mise en forme du texte) ;
// aucune reduction flottante n'est repartie entre fils, la sortie ne depend donc pas du nombre de fils.
#include <cstdint>
#include <functional>
#include <string>
#include <vector>

namespace apex::polar {

struct Params {
  bool dynamic = false;
  double center_x = 0.0, center_y = 0.0;
  double pivot = 46.0;
  double b_limit = 45.0;         // borne haute de B visee d'apres la normale
  double b_min = 0.0;            // B ne peut pas etre negatif sur la machine (plage reelle [0, 185])
  double tol = 0.01;             // ecart max de la buse a la droite cartesienne (mm)
  double drop_radius = 0.0;      // 0 : aucun mouvement supprime
  double plate_radius = 150.0;   // seulement pour les avertissements
  std::string source;
  int threads = 0;               // <= 0 : nombre de coeurs

  // --- Evitement des collisions (mode dynamique, necessite le modele de tete) -----------------------
  // Echantillons de la tete, en mm, repere de la tete : x = (tangente x axe), y = axe de la tete (de la
  // pointe vers le pivot), z = tangente a la rotation du plateau ; origine = pointe de buse. Meme repere
  // que `getHeadSamples` de l'interface.
  std::vector<float> head_samples;
  double b_reorient_max = 185.0;   // B maximal qu'une reorientation peut prendre
  double b_search_step = 2.5;      // pas de la recherche d'un B libre (degres)
  double b_search_span = 180.0;    // ecart maximal a la cible
  double nozzle_tolerance = 0.18;  // regle de l'utilisateur : buse
  double body_tolerance = 0.7;     //                          reste de la tete
  double collision_margin = 1.0;   // marge nominale
  double bead_radius = 0.2;
  double nozzle_zone = 10.0;       // echantillons a moins de ce rayon de la pointe : zone de la buse
  double contact_clearance = 3.0;  // echantillons plus proches de la pointe : ignores (cordon en cours)
  double pose_spacing = 1.0;       // une pose testee tous les ... mm de trajet extrude
  double densify_step = 0.25;
  double b_rate_deg_per_mm = 2.0;
  int collision_rounds = 4;
};

struct Summary {
  std::int64_t moves_in = 0, dropped = 0, lines_out = 0;
  double max_error = 0.0, b_min = 0.0, b_max = 0.0;
  // Rayons atteints (avertissements) : pointe de buse et pivot de l'axe B.
  double max_tip_radius = 0.0, max_pivot_radius = 0.0;
  std::int64_t beyond_plate_moves = 0;
  // Evitement des collisions.
  bool collision_checked = false;
  std::int64_t poses_tested = 0, collisions_before = 0, collisions_after = 0, reoriented = 0;
};

// `progress(percent)` est appele depuis le fil appelant seulement.
std::string convert(const std::string& text, const Params& params, Summary& summary,
                    const std::function<void(int)>& progress);

}  // namespace apex::polar
