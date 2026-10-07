// Interface N-API du noyau d'edition, chargee par electron/edit-process.cjs (utilityProcess).
// Un seul noyau par processus : une seule session d'edition a la fois. Toutes les donnees
// echangees sont des tableaux types (copies par le MessagePort cote Electron) ; le repere des
// transformations est celui du noyau (droit, z vers le haut), voir edit_kernel.hpp.
#include <node_api.h>

#include <algorithm>
#include <cmath>
#include <cstring>
#include <string>
#include <vector>

#include "edit_kernel.hpp"

namespace {

using namespace apex::edit;

EditKernel g_kernel;
bool g_loaded = false;

// --- utilitaires N-API ------------------------------------------------------------------------

napi_value throw_error(napi_env env, const char* message) {
  napi_throw_error(env, nullptr, message);
  return nullptr;
}

napi_value undefined(napi_env env) {
  napi_value v;
  napi_get_undefined(env, &v);
  return v;
}

bool get_property(napi_env env, napi_value object, const char* name, napi_value* out) {
  napi_valuetype object_type;
  if (napi_typeof(env, object, &object_type) != napi_ok || (object_type != napi_object && object_type != napi_function)) return false;
  bool has = false;
  if (napi_has_named_property(env, object, name, &has) != napi_ok || !has) return false;
  if (napi_get_named_property(env, object, name, out) != napi_ok) return false;
  // Propriete presente mais undefined / null (clone structure d'un objet JS) : comme absente.
  napi_valuetype type;
  return napi_typeof(env, *out, &type) == napi_ok && type != napi_undefined && type != napi_null;
}

double get_number(napi_env env, napi_value object, const char* name, double fallback) {
  napi_value v;
  napi_valuetype type;
  double d = fallback;
  if (!get_property(env, object, name, &v) || napi_typeof(env, v, &type) != napi_ok || type != napi_number) return fallback;
  napi_get_value_double(env, v, &d);
  return d;
}

bool get_bool(napi_env env, napi_value object, const char* name, bool fallback) {
  napi_value v;
  napi_valuetype type;
  bool b = fallback;
  if (!get_property(env, object, name, &v) || napi_typeof(env, v, &type) != napi_ok || type != napi_boolean) return fallback;
  napi_get_value_bool(env, v, &b);
  return b;
}

std::string get_string(napi_env env, napi_value object, const char* name) {
  napi_value v;
  napi_valuetype type;
  if (!get_property(env, object, name, &v) || napi_typeof(env, v, &type) != napi_ok || type != napi_string) return {};
  char buffer[32] = {};
  size_t length = 0;
  napi_get_value_string_utf8(env, v, buffer, sizeof(buffer), &length);
  return std::string(buffer, length);
}

template <class T>
bool get_typed(napi_env env, napi_value value, napi_typedarray_type want, const T** data, size_t* length) {
  bool is_typed = false;
  if (napi_is_typedarray(env, value, &is_typed) != napi_ok || !is_typed) return false;
  napi_typedarray_type type;
  void* raw = nullptr;
  napi_value buffer;
  size_t offset = 0;
  if (napi_get_typedarray_info(env, value, &type, length, &raw, &buffer, &offset) != napi_ok || type != want) return false;
  *data = static_cast<const T*>(raw);
  return true;
}

template <class T>
napi_value make_typed(napi_env env, napi_typedarray_type type, const T* data, size_t count) {
  void* raw = nullptr;
  napi_value buffer, array;
  if (napi_create_arraybuffer(env, sizeof(T) * count, &raw, &buffer) != napi_ok) return nullptr;
  if (count) std::memcpy(raw, data, sizeof(T) * count);
  if (napi_create_typedarray(env, type, count, buffer, 0, &array) != napi_ok) return nullptr;
  return array;
}

napi_value make_number(napi_env env, double value) {
  napi_value v;
  napi_create_double(env, value, &v);
  return v;
}

napi_value make_bool(napi_env env, bool value) {
  napi_value v;
  napi_get_boolean(env, value, &v);
  return v;
}

void set(napi_env env, napi_value object, const char* name, napi_value value) {
  if (value) napi_set_named_property(env, object, name, value);
}

napi_value new_object(napi_env env) {
  napi_value o;
  napi_create_object(env, &o);
  return o;
}

Falloff parse_falloff(const std::string& name, Falloff fallback) {
  if (name == "linear") return Falloff::Linear;
  if (name == "gaussian") return Falloff::Gaussian;
  if (name == "cubic") return Falloff::Cubic;
  if (name == "plateau") return Falloff::Plateau;
  return fallback;
}

DistanceMetric parse_distance(napi_env env, napi_value parent, const char* name, DistanceMetric metric) {
  napi_value o;
  if (!get_property(env, parent, name, &o)) return metric;
  metric.enabled = get_bool(env, o, "enabled", metric.enabled);
  metric.radius_mm = get_number(env, o, "radiusMm", metric.radius_mm);
  metric.falloff = parse_falloff(get_string(env, o, "falloff"), metric.falloff);
  return metric;
}

Vec3 parse_vec3(napi_env env, napi_value parent, const char* name, Vec3 fallback);

InfluenceParams parse_influence(napi_env env, napi_value value) {
  InfluenceParams p;
  p.spatial = parse_distance(env, value, "spatial", p.spatial);
  p.along = parse_distance(env, value, "along", p.along);
  napi_value adj;
  if (get_property(env, value, "adjacency", &adj)) {
    p.adjacency.enabled = get_bool(env, adj, "enabled", p.adjacency.enabled);
    p.adjacency.before = get_bool(env, adj, "before", p.adjacency.before);
    p.adjacency.after = get_bool(env, adj, "after", p.adjacency.after);
    p.adjacency.hops_before = static_cast<uint32_t>(get_number(env, adj, "hopsBefore", p.adjacency.hops_before));
    p.adjacency.hops_after = static_cast<uint32_t>(get_number(env, adj, "hopsAfter", p.adjacency.hops_after));
    p.adjacency.falloff = parse_falloff(get_string(env, adj, "falloff"), p.adjacency.falloff);
  }
  p.combine = get_string(env, value, "combine") == "max" ? Combine::Max : Combine::Product;

  // Poignees du noeud : Float64Array de 4 valeurs par entree (repere du noyau).
  //   directions : dx, dy, dz, portee (mm) ; anchors : x, y, z, rayon (mm).
  auto quads = [&](const char* name) {
    napi_value v;
    const double* data = nullptr;
    size_t length = 0;
    std::vector<double> out;
    if (get_property(env, value, name, &v) && get_typed(env, v, napi_float64_array, &data, &length)) {
      out.assign(data, data + (length / 4) * 4);
    }
    return out;
  };
  const std::vector<double> dirs = quads("directions");
  for (size_t i = 0; i < dirs.size(); i += 4) {
    p.directions.push_back({{dirs[i], dirs[i + 1], dirs[i + 2]}, dirs[i + 3]});
  }
  const std::vector<double> anchors = quads("anchors");
  for (size_t i = 0; i < anchors.size(); i += 4) {
    p.anchors.push_back({{anchors[i], anchors[i + 1], anchors[i + 2]}, anchors[i + 3]});
  }
  p.direction_sharpness = get_number(env, value, "directionSharpness", p.direction_sharpness);
  // Recalcul de E : { mode: 'off' | 'auto', factor }.
  napi_value ex;
  if (get_property(env, value, "extrusion", &ex)) {
    p.extrusion = get_string(env, ex, "mode") == "off" ? ExtrusionMode::Off : ExtrusionMode::Auto;
    p.extrusion_factor = get_number(env, ex, "factor", p.extrusion_factor);
  }
  p.keep_shape = get_bool(env, value, "keepShape", p.keep_shape);
  p.type_barrier = get_bool(env, value, "typeBarrier", p.type_barrier);
  p.reslice = get_bool(env, value, "reslice", p.reslice);
  p.reslice_max_layers = static_cast<uint32_t>(get_number(env, value, "resliceMaxLayers", p.reslice_max_layers));
  p.smooth_b = get_number(env, value, "smoothB", p.smooth_b);
  p.smooth_b_iterations = static_cast<uint32_t>(get_number(env, value, "smoothBIterations", p.smooth_b_iterations));
  napi_value trim;
  if (get_property(env, value, "trim", &trim)) {
    p.trim.enabled = get_bool(env, trim, "enabled", p.trim.enabled);
    p.trim.layers = static_cast<uint32_t>(get_number(env, trim, "layers", p.trim.layers));
    p.trim.clearance_mm = get_number(env, trim, "clearanceMm", p.trim.clearance_mm);
  }
  p.drag_direction = parse_vec3(env, value, "dragDirection", Vec3{});
  return p;
}

Vec3 parse_vec3(napi_env env, napi_value parent, const char* name, Vec3 fallback) {
  napi_value v;
  const double* data = nullptr;
  size_t length = 0;
  if (!get_property(env, parent, name, &v) || !get_typed(env, v, napi_float64_array, &data, &length) || length != 3) {
    return fallback;
  }
  return {data[0], data[1], data[2]};
}

// Resultat d'une modification appliquee (commit / undo / redo).
napi_value change_result(napi_env env, bool ok) {
  napi_value o = new_object(env);
  set(env, o, "ok", make_bool(env, ok));
  if (ok) {
    set(env, o, "indices", make_typed(env, napi_uint32_array, g_kernel.last_indices().data(), g_kernel.last_indices().size()));
    set(env, o, "values", make_typed(env, napi_float64_array, g_kernel.last_values().data(), g_kernel.last_values().size()));
    // Depots rognes (ou retablis par une annulation) : sous-ensemble de `indices`.
    set(env, o, "trimmed", make_typed(env, napi_uint32_array, g_kernel.last_trimmed().data(), g_kernel.last_trimmed().size()));
    set(env, o, "trimState", make_bool(env, g_kernel.last_trim_state()));
  }
  set(env, o, "undoDepth", make_number(env, static_cast<double>(g_kernel.undo_depth())));
  set(env, o, "redoDepth", make_number(env, static_cast<double>(g_kernel.redo_depth())));
  return o;
}

napi_value args(napi_env env, napi_callback_info info, size_t want, napi_value* argv) {
  size_t argc = want;
  if (napi_get_cb_info(env, info, &argc, argv, nullptr, nullptr) != napi_ok) return nullptr;
  for (size_t i = argc; i < want; ++i) argv[i] = undefined(env);
  return argv[0];
}

// --- fonctions exportees ----------------------------------------------------------------------

// load({ r, c, z, b: Float64Array, extruding: Uint8Array, params? }) -> statistiques
napi_value Load(napi_env env, napi_callback_info info) {
  napi_value argv[1];
  args(env, info, 1, argv);
  const double *r = nullptr, *c = nullptr, *z = nullptr, *b = nullptr;
  const uint8_t* ext = nullptr;
  size_t nr = 0, nc = 0, nz = 0, nb = 0, ne = 0;
  napi_value v;
  if (!get_property(env, argv[0], "r", &v) || !get_typed(env, v, napi_float64_array, &r, &nr) ||
      !get_property(env, argv[0], "c", &v) || !get_typed(env, v, napi_float64_array, &c, &nc) ||
      !get_property(env, argv[0], "z", &v) || !get_typed(env, v, napi_float64_array, &z, &nz) ||
      !get_property(env, argv[0], "b", &v) || !get_typed(env, v, napi_float64_array, &b, &nb) ||
      !get_property(env, argv[0], "extruding", &v) || !get_typed(env, v, napi_uint8_array, &ext, &ne)) {
    return throw_error(env, "load : r, c, z, b (Float64Array) et extruding (Uint8Array) sont requis");
  }
  if (nc != nr || nz != nr || nb != nr || ne != nr) return throw_error(env, "load : tableaux de longueurs differentes");
  // Extrusion par segment (delta E du fichier), facultative.
  const double* e = nullptr;
  size_t n_e = 0;
  if (get_property(env, argv[0], "e", &v) && get_typed(env, v, napi_float64_array, &e, &n_e) && n_e != nr) {
    return throw_error(env, "load : e de longueur differente");
  }

  KernelParams kp;
  napi_value params;
  if (get_property(env, argv[0], "params", &params)) {
    kp.pivot_mm = get_number(env, params, "pivotMm", kp.pivot_mm);
    kp.support_radius_mm = get_number(env, params, "supportRadiusMm", kp.support_radius_mm);
    kp.min_layer_mm = get_number(env, params, "minLayerMm", kp.min_layer_mm);
    kp.max_layer_mm = get_number(env, params, "maxLayerMm", kp.max_layer_mm);
    kp.width_factor = get_number(env, params, "widthFactor", kp.width_factor);
    kp.support_cone_deg = get_number(env, params, "supportConeDeg", kp.support_cone_deg);
    kp.closed_loop_tolerance_mm = get_number(env, params, "closedLoopToleranceMm", kp.closed_loop_tolerance_mm);
    kp.grid_margin_mm = get_number(env, params, "gridMarginMm", kp.grid_margin_mm);
    kp.threads = static_cast<unsigned>(get_number(env, params, "threads", 0.0));
  }
  const LoadStats s = g_kernel.load(nr, r, c, z, b, e, ext, kp);
  g_loaded = true;
  // Temps cumule par mouvement (vitesse / acceleration de B) et modele de tete (collisions), facultatifs.
  const double* times = nullptr;
  size_t n_times = 0;
  if (get_property(env, argv[0], "times", &v) && get_typed(env, v, napi_float64_array, &times, &n_times) && n_times == nr) {
    g_kernel.set_times(times, n_times);
  } else {
    g_kernel.set_times(nullptr, 0);
  }
  const uint8_t* types = nullptr;
  size_t n_types = 0;
  if (get_property(env, argv[0], "types", &v) && get_typed(env, v, napi_uint8_array, &types, &n_types) && n_types == nr) {
    g_kernel.set_types(types, n_types);
  } else {
    g_kernel.set_types(nullptr, 0);
  }
  const float* head = nullptr;
  size_t n_head = 0;
  if (get_property(env, argv[0], "headSamples", &v) && get_typed(env, v, napi_float32_array, &head, &n_head)) {
    g_kernel.set_head_samples(head, n_head / 3);
  } else {
    g_kernel.set_head_samples(nullptr, 0);
  }
  napi_value o = new_object(env);
  set(env, o, "points", make_number(env, static_cast<double>(s.points)));
  set(env, o, "passPoints", make_number(env, static_cast<double>(s.pass_points)));
  set(env, o, "passes", make_number(env, static_cast<double>(s.passes)));
  set(env, o, "supportEdges", make_number(env, static_cast<double>(s.support_edges)));
  set(env, o, "cellMm", make_number(env, s.cell_mm));
  set(env, o, "totalMs", make_number(env, s.total_ms));
  return o;
}

// setHandle(index, influence) -> { handle, affected, weights, slideNormals, dependents, baseHeights }
//   | { refused: 'invalid' | 'locked' | 'plate' | 'surface' }
napi_value SetHandle(napi_env env, napi_callback_info info) {
  if (!g_loaded) return throw_error(env, "setHandle avant load");
  napi_value argv[2];
  args(env, info, 2, argv);
  double index = -1.0;
  if (napi_get_value_double(env, argv[0], &index) != napi_ok || index < 0.0) return throw_error(env, "setHandle : indice invalide");
  if (!g_kernel.set_handle(static_cast<uint32_t>(index), parse_influence(env, argv[1]))) {
    napi_value refused = new_object(env);
    const char* reason = "invalid";
    switch (g_kernel.refusal()) {
      case HandleRefusal::Locked: reason = "locked"; break;
      case HandleRefusal::Plate: reason = "plate"; break;
      case HandleRefusal::Surface: reason = "surface"; break;
      default: break;
    }
    napi_value str;
    napi_create_string_utf8(env, reason, NAPI_AUTO_LENGTH, &str);
    set(env, refused, "refused", str);
    return refused;
  }
  napi_value o = new_object(env);
  set(env, o, "handle", make_number(env, g_kernel.handle()));
  set(env, o, "affected", make_typed(env, napi_uint32_array, g_kernel.affected().data(), g_kernel.affected().size()));
  set(env, o, "weights", make_typed(env, napi_float32_array, g_kernel.weights().data(), g_kernel.weights().size()));
  set(env, o, "slideNormals", make_typed(env, napi_float32_array, g_kernel.slide_normals().data(), g_kernel.slide_normals().size()));
  // Le long de l'empilement : sens, axe de tete du noeud et axe de chaque point touche (shader).
  set(env, o, "stackSign", make_number(env, g_kernel.stack_sign()));
  const Vec3 ha = g_kernel.handle_axis();
  const double ha3[3] = {ha.x, ha.y, ha.z};
  set(env, o, "handleAxis", make_typed(env, napi_float64_array, ha3, 3));
  std::vector<float> axes(3 * g_kernel.affected().size());
  for (size_t k = 0; k < g_kernel.affected().size(); ++k) {
    const Vec3 a = g_kernel.axis(g_kernel.affected()[k]);
    axes[3 * k] = static_cast<float>(a.x);
    axes[3 * k + 1] = static_cast<float>(a.y);
    axes[3 * k + 2] = static_cast<float>(a.z);
  }
  set(env, o, "axes", make_typed(env, napi_float32_array, axes.data(), axes.size()));
  set(env, o, "dependents", make_typed(env, napi_uint32_array, g_kernel.dependents().data(), g_kernel.dependents().size()));
  set(env, o, "baseHeights", make_typed(env, napi_float32_array, g_kernel.base_heights().data(), g_kernel.base_heights().size()));
  // Capacite d'epaisseur le long de l'empilement (mm) ; null : illimitee ou inconnue.
  const double capacity = g_kernel.capacity_mm();
  napi_value capacity_value;
  if (std::isfinite(capacity)) {
    capacity_value = make_number(env, capacity);
  } else {
    napi_get_null(env, &capacity_value);
  }
  set(env, o, "capacityMm", capacity_value);
  return o;
}

// setLayerLimits(minMm, maxMm, widthFactor) : bornes d'epaisseur (profil d'imprimante) sans recharger.
napi_value SetLayerLimits(napi_env env, napi_callback_info info) {
  if (!g_loaded) return undefined(env);
  napi_value argv[3];
  args(env, info, 3, argv);
  double mn = 0.0, mx = 0.0, wf = 1.0;
  napi_get_value_double(env, argv[0], &mn);
  napi_get_value_double(env, argv[1], &mx);
  napi_get_value_double(env, argv[2], &wf);
  g_kernel.set_layer_limits(mn, mx, wf);
  return undefined(env);
}

// drag({ translation, axis: Float64Array(3), angleRad }, { heights?, deformed? })
//   -> { handle: Float64Array(5) R C Z B E, handleResidualDeg, maxResidualDeg, appliedTranslation,
//        limitScale (null : aucune limite), heights?, deformed? }
napi_value Drag(napi_env env, napi_callback_info info) {
  if (!g_kernel.has_handle()) return throw_error(env, "drag sans poignee");
  napi_value argv[2];
  args(env, info, 2, argv);
  Transform t;
  t.translation = parse_vec3(env, argv[0], "translation", Vec3{});
  t.axis = parse_vec3(env, argv[0], "axis", Vec3{0.0, 0.0, 1.0});
  t.angle_rad = get_number(env, argv[0], "angleRad", 0.0);
  const bool want_heights = get_bool(env, argv[1], "heights", false);
  const bool want_deformed = get_bool(env, argv[1], "deformed", false);
  const bool want_travel = get_bool(env, argv[1], "travel", false);
  g_kernel.drag(t, want_heights);

  const auto& affected = g_kernel.affected();
  const size_t slot = static_cast<size_t>(
      std::lower_bound(affected.begin(), affected.end(), g_kernel.handle()) - affected.begin());
  float worst = 0.0f;
  for (const float r : g_kernel.residual_deg()) worst = r > worst ? r : worst;
  napi_value o = new_object(env);
  set(env, o, "handle", make_typed(env, napi_float64_array, &g_kernel.deformed()[kValuesPerPoint * slot], kValuesPerPoint));
  set(env, o, "handleResidualDeg", make_number(env, g_kernel.residual_deg()[slot]));
  set(env, o, "maxResidualDeg", make_number(env, worst));
  const Vec3& applied = g_kernel.applied_translation();
  const double applied3[3] = {applied.x, applied.y, applied.z};
  set(env, o, "appliedTranslation", make_typed(env, napi_float64_array, applied3, 3));
  set(env, o, "appliedAngleRad", make_number(env, g_kernel.applied_angle()));
  napi_value stale;
  napi_get_boolean(env, g_kernel.weights_direction_stale(), &stale);
  set(env, o, "rebuild", stale);
  if (g_kernel.limit_point() != kNoIndex) {
    set(env, o, "limitPoint", make_number(env, g_kernel.limit_point()));
    set(env, o, "limitSupport", make_number(env, g_kernel.limit_support()));
  }
  if (std::isfinite(g_kernel.limit_scale())) set(env, o, "limitScale", make_number(env, g_kernel.limit_scale()));
  else {
    napi_value nul;
    napi_get_null(env, &nul);
    set(env, o, "limitScale", nul);
  }
  // Depots rognes par la deformation en cours (rognage actif) : apercu.
  set(env, o, "trimmed", make_typed(env, napi_uint32_array, g_kernel.trimmed().data(), g_kernel.trimmed().size()));
  // Deplacements a vide touches : indices et positions deformees (repere du noyau, 3 flottants chacun).
  if (want_travel) {
    std::vector<uint32_t> tidx;
    std::vector<float> ttip;
    for (size_t k = 0; k < affected.size(); ++k) {
      if (g_kernel.pass_of(affected[k]) >= 0) continue;
      tidx.push_back(affected[k]);
      const Vec3& p = g_kernel.deformed_tips()[k];
      ttip.push_back(static_cast<float>(p.x));
      ttip.push_back(static_cast<float>(p.y));
      ttip.push_back(static_cast<float>(p.z));
    }
    set(env, o, "travelIndices", make_typed(env, napi_uint32_array, tidx.data(), tidx.size()));
    set(env, o, "travelTips", make_typed(env, napi_float32_array, ttip.data(), ttip.size()));
  }
  if (g_kernel.reslice_active() && !g_kernel.layer_counts().empty()) {
    set(env, o, "layerCounts", make_typed(env, napi_uint8_array, g_kernel.layer_counts().data(), g_kernel.layer_counts().size()));
  }
  if (want_heights) set(env, o, "heights", make_typed(env, napi_float32_array, g_kernel.heights().data(), g_kernel.heights().size()));
  if (want_deformed) set(env, o, "deformed", make_typed(env, napi_float64_array, g_kernel.deformed().data(), g_kernel.deformed().size()));
  return o;
}

// restoreHistory({ undo: [{ indices: Uint32Array, before, after: Float64Array }], redo: [...] })
//   -> { undoDepth, redoDepth } ; erreur si une entree ne correspond pas au fichier charge.
napi_value RestoreHistory(napi_env env, napi_callback_info info) {
  if (!g_loaded) return throw_error(env, "restoreHistory avant load");
  napi_value argv[1];
  args(env, info, 1, argv);
  auto read_list = [&](const char* name, std::vector<EditKernel::HistoryEntry>& out) -> bool {
    napi_value list;
    if (!get_property(env, argv[0], name, &list)) return true;
    uint32_t count = 0;
    if (napi_get_array_length(env, list, &count) != napi_ok) return false;
    for (uint32_t i = 0; i < count; ++i) {
      napi_value item, v;
      if (napi_get_element(env, list, i, &item) != napi_ok) return false;
      const uint32_t* idx = nullptr;
      const double *before = nullptr, *after = nullptr;
      size_t ni = 0, nb = 0, na = 0;
      if (!get_property(env, item, "indices", &v) || !get_typed(env, v, napi_uint32_array, &idx, &ni) ||
          !get_property(env, item, "before", &v) || !get_typed(env, v, napi_float64_array, &before, &nb) ||
          !get_property(env, item, "after", &v) || !get_typed(env, v, napi_float64_array, &after, &na)) {
        return false;
      }
      std::vector<uint32_t> trimmed;
      const uint32_t* tr = nullptr;
      size_t nt = 0;
      if (get_property(env, item, "trimmed", &v) && get_typed(env, v, napi_uint32_array, &tr, &nt)) trimmed.assign(tr, tr + nt);
      out.push_back({std::vector<uint32_t>(idx, idx + ni), std::vector<double>(before, before + nb),
                     std::vector<double>(after, after + na), std::move(trimmed)});
    }
    return true;
  };
  std::vector<EditKernel::HistoryEntry> undo, redo;
  if (!read_list("undo", undo) || !read_list("redo", redo)) return throw_error(env, "restoreHistory : entrees mal formees");
  if (!g_kernel.restore_history(std::move(undo), std::move(redo))) {
    return throw_error(env, "restoreHistory : historique incompatible avec le fichier charge");
  }
  napi_value o = new_object(env);
  set(env, o, "undoDepth", make_number(env, static_cast<double>(g_kernel.undo_depth())));
  set(env, o, "redoDepth", make_number(env, static_cast<double>(g_kernel.redo_depth())));
  return o;
}

// Commit : modification validee, et couches inserees (re-tranchage) : [{ before, values, extruding }].
napi_value Commit(napi_env env, napi_callback_info) {
  napi_value o = change_result(env, g_kernel.commit());
  const auto& plan = g_kernel.last_reslice();
  if (!plan.empty()) {
    napi_value list;
    napi_create_array_with_length(env, plan.size(), &list);
    for (size_t i = 0; i < plan.size(); ++i) {
      napi_value item = new_object(env);
      set(env, item, "before", make_number(env, plan[i].before));
      set(env, item, "values", make_typed(env, napi_float64_array, plan[i].values.data(), plan[i].values.size()));
      set(env, item, "extruding", make_typed(env, napi_uint8_array, plan[i].extruding.data(), plan[i].extruding.size()));
      napi_set_element(env, list, static_cast<uint32_t>(i), item);
    }
    set(env, o, "reslice", list);
  }
  return o;
}
napi_value Undo(napi_env env, napi_callback_info) { return change_result(env, g_kernel.undo()); }
napi_value Redo(napi_env env, napi_callback_info) { return change_result(env, g_kernel.redo()); }

napi_value Cancel(napi_env env, napi_callback_info) {
  g_kernel.cancel();
  return undefined(env);
}

// setLocked(indices: Uint32Array, locked: boolean)
napi_value SetLocked(napi_env env, napi_callback_info info) {
  if (!g_loaded) return throw_error(env, "setLocked avant load");
  napi_value argv[2];
  args(env, info, 2, argv);
  const uint32_t* data = nullptr;
  size_t length = 0;
  if (!get_typed(env, argv[0], napi_uint32_array, &data, &length)) return throw_error(env, "setLocked : Uint32Array attendu");
  bool locked = true;
  napi_get_value_bool(env, argv[1], &locked);
  g_kernel.set_locked(data, length, locked);
  return undefined(env);
}


MachineLimits parse_limits(napi_env env, napi_value value) {
  MachineLimits l;
  l.b_min_deg = get_number(env, value, "bMinDeg", l.b_min_deg);
  l.b_max_deg = get_number(env, value, "bMaxDeg", l.b_max_deg);
  l.b_speed_deg_s = get_number(env, value, "bSpeedDegS", l.b_speed_deg_s);
  l.b_accel_deg_s2 = get_number(env, value, "bAccelDegS2", l.b_accel_deg_s2);
  l.plate_radius_mm = get_number(env, value, "plateRadiusMm", l.plate_radius_mm);
  l.collision_margin_mm = get_number(env, value, "collisionMarginMm", l.collision_margin_mm);
  l.bead_radius_mm = get_number(env, value, "beadRadiusMm", l.bead_radius_mm);
  l.contact_clearance_mm = get_number(env, value, "contactClearanceMm", l.contact_clearance_mm);
  l.max_poses = static_cast<size_t>(get_number(env, value, "maxPoses", static_cast<double>(l.max_poses)));
  return l;
}

// setHeadSamples(Float32Array xyz) : modele de tete (repere tete, pointe a l'origine).
napi_value SetHeadSamples(napi_env env, napi_callback_info info) {
  if (!g_loaded) return throw_error(env, "setHeadSamples avant load");
  napi_value argv[1];
  args(env, info, 1, argv);
  const float* data = nullptr;
  size_t length = 0;
  if (!get_typed(env, argv[0], napi_float32_array, &data, &length)) return throw_error(env, "setHeadSamples : Float32Array attendu");
  g_kernel.set_head_samples(data, length / 3);
  return undefined(env);
}

// validate({ limits?, collisions?, lo?, hi? }) -> { indices, flags, normalDeviation, counts... }
//   Sur la deformation en cours si une poignee est glissee, sinon sur l'etat valide de [lo, hi).
napi_value Validate(napi_env env, napi_callback_info info) {
  if (!g_loaded) return throw_error(env, "validate avant load");
  napi_value argv[1];
  args(env, info, 1, argv);
  napi_value limits_v;
  const MachineLimits limits = get_property(env, argv[0], "limits", &limits_v) ? parse_limits(env, limits_v) : MachineLimits{};
  const bool collisions = get_bool(env, argv[0], "collisions", false);
  const auto lo = static_cast<uint32_t>(get_number(env, argv[0], "lo", 0.0));
  const auto hi = static_cast<uint32_t>(get_number(env, argv[0], "hi", 0.0));
  const Validation& v = g_kernel.validate(limits, collisions, lo, hi);
  napi_value o = new_object(env);
  // On ne renvoie que les points en defaut (le reste est la regle) : un fichier entier fait 1 M de points.
  std::vector<uint32_t> bad;
  std::vector<uint8_t> bad_flags;
  for (size_t k = 0; k < v.indices.size(); ++k) {
    if (v.flags[k]) {
      bad.push_back(v.indices[k]);
      bad_flags.push_back(v.flags[k]);
    }
  }
  set(env, o, "violations", make_typed(env, napi_uint32_array, bad.data(), bad.size()));
  set(env, o, "violationFlags", make_typed(env, napi_uint8_array, bad_flags.data(), bad_flags.size()));
  set(env, o, "judged", make_number(env, static_cast<double>(v.indices.size())));
  set(env, o, "bRange", make_number(env, static_cast<double>(v.b_range)));
  set(env, o, "bSpeed", make_number(env, static_cast<double>(v.b_speed)));
  set(env, o, "bAccel", make_number(env, static_cast<double>(v.b_accel)));
  set(env, o, "headPart", make_number(env, static_cast<double>(v.head_part)));
  set(env, o, "headPlate", make_number(env, static_cast<double>(v.head_plate)));
  set(env, o, "posesTested", make_number(env, static_cast<double>(v.poses_tested)));
  set(env, o, "collisionChecked", make_bool(env, v.collision_checked));
  set(env, o, "timingKnown", make_bool(env, v.timing_known));
  // Ecart tete / normale : indices et valeurs des seuls points qui en ont une (graphe du panneau),
  // limites a 4000 points regulierement echantillonnes.
  std::vector<uint32_t> nidx;
  std::vector<float> nval;
  for (size_t k = 0; k < v.indices.size(); ++k) {
    if (std::isfinite(v.normal_deviation[k])) {
      nidx.push_back(v.indices[k]);
      nval.push_back(v.normal_deviation[k]);
    }
  }
  constexpr size_t kMaxGraph = 4000;
  if (nidx.size() > kMaxGraph) {
    std::vector<uint32_t> i2;
    std::vector<float> v2;
    for (size_t t = 0; t < kMaxGraph; ++t) {
      const size_t k = t * nidx.size() / kMaxGraph;
      i2.push_back(nidx[k]);
      v2.push_back(nval[k]);
    }
    nidx.swap(i2);
    nval.swap(v2);
  }
  set(env, o, "normalIndices", make_typed(env, napi_uint32_array, nidx.data(), nidx.size()));
  set(env, o, "normalDeviation", make_typed(env, napi_float32_array, nval.data(), nval.size()));
  float worst = 0.0f;
  for (const float d : nval) worst = d > worst ? d : worst;
  set(env, o, "normalWorst", make_number(env, worst));
  return o;
}

// lockRegion(index, radiusMm, locked) -> Uint32Array des points touches (matiere a moins de radiusMm).
napi_value LockRegion(napi_env env, napi_callback_info info) {
  if (!g_loaded) return throw_error(env, "lockRegion avant load");
  napi_value argv[3];
  args(env, info, 3, argv);
  double index = -1.0, radius = 0.0;
  bool locked = true;
  napi_get_value_double(env, argv[0], &index);
  napi_get_value_double(env, argv[1], &radius);
  napi_get_value_bool(env, argv[2], &locked);
  if (index < 0.0) return throw_error(env, "lockRegion : indice invalide");
  const std::vector<uint32_t> out = g_kernel.lock_region(static_cast<uint32_t>(index), radius, locked);
  return make_typed(env, napi_uint32_array, out.data(), out.size());
}

napi_value LockedIndices(napi_env env, napi_callback_info) {
  if (!g_loaded) return throw_error(env, "lockedIndices avant load");
  const std::vector<uint32_t> out = g_kernel.locked_indices();
  return make_typed(env, napi_uint32_array, out.data(), out.size());
}

// nearest(x, y, z, maxDistanceMm) -> indice du point de matiere le plus proche (repere du noyau), -1 : aucun.
napi_value Nearest(napi_env env, napi_callback_info info) {
  if (!g_loaded) return throw_error(env, "nearest avant load");
  napi_value argv[4];
  args(env, info, 4, argv);
  double x = 0, y = 0, z = 0, d = 0;
  napi_get_value_double(env, argv[0], &x);
  napi_get_value_double(env, argv[1], &y);
  napi_get_value_double(env, argv[2], &z);
  napi_get_value_double(env, argv[3], &d);
  const uint32_t q = g_kernel.nearest_point({x, y, z}, d);
  return make_number(env, q == kNoIndex ? -1.0 : static_cast<double>(q));
}

napi_value ClearLocks(napi_env env, napi_callback_info) {
  if (g_loaded) g_kernel.clear_locks();
  return undefined(env);
}

}  // namespace

NAPI_MODULE_INIT() {
  const napi_property_descriptor props[] = {
      {"load", nullptr, Load, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setHandle", nullptr, SetHandle, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setLayerLimits", nullptr, SetLayerLimits, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"drag", nullptr, Drag, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"commit", nullptr, Commit, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"cancel", nullptr, Cancel, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"undo", nullptr, Undo, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"redo", nullptr, Redo, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setLocked", nullptr, SetLocked, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"clearLocks", nullptr, ClearLocks, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"restoreHistory", nullptr, RestoreHistory, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"nearest", nullptr, Nearest, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"lockRegion", nullptr, LockRegion, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"lockedIndices", nullptr, LockedIndices, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setHeadSamples", nullptr, SetHeadSamples, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"validate", nullptr, Validate, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  if (napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props) != napi_ok) return nullptr;
  return exports;
}
