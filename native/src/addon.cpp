// Interface N-API du noyau d'edition, chargee par electron/edit-process.cjs (utilityProcess).
// Un seul noyau par processus : une seule session d'edition a la fois. Toutes les donnees
// echangees sont des tableaux types (copies par le MessagePort cote Electron) ; le repere des
// transformations est celui du noyau (droit, z vers le haut), voir edit_kernel.hpp.
#include <node_api.h>

#include <algorithm>
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
  bool has = false;
  if (napi_has_named_property(env, object, name, &has) != napi_ok || !has) return false;
  return napi_get_named_property(env, object, name, out) == napi_ok;
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

  KernelParams kp;
  napi_value params;
  if (get_property(env, argv[0], "params", &params)) {
    kp.pivot_mm = get_number(env, params, "pivotMm", kp.pivot_mm);
    kp.support_radius_mm = get_number(env, params, "supportRadiusMm", kp.support_radius_mm);
    kp.support_cone_deg = get_number(env, params, "supportConeDeg", kp.support_cone_deg);
    kp.closed_loop_tolerance_mm = get_number(env, params, "closedLoopToleranceMm", kp.closed_loop_tolerance_mm);
    kp.grid_margin_mm = get_number(env, params, "gridMarginMm", kp.grid_margin_mm);
    kp.threads = static_cast<unsigned>(get_number(env, params, "threads", 0.0));
  }
  const LoadStats s = g_kernel.load(nr, r, c, z, b, ext, kp);
  g_loaded = true;
  napi_value o = new_object(env);
  set(env, o, "points", make_number(env, static_cast<double>(s.points)));
  set(env, o, "passPoints", make_number(env, static_cast<double>(s.pass_points)));
  set(env, o, "passes", make_number(env, static_cast<double>(s.passes)));
  set(env, o, "supportEdges", make_number(env, static_cast<double>(s.support_edges)));
  set(env, o, "cellMm", make_number(env, s.cell_mm));
  set(env, o, "totalMs", make_number(env, s.total_ms));
  return o;
}

// setHandle(index, influence) -> { handle, affected, weights, dependents, baseHeights } | null
napi_value SetHandle(napi_env env, napi_callback_info info) {
  if (!g_loaded) return throw_error(env, "setHandle avant load");
  napi_value argv[2];
  args(env, info, 2, argv);
  double index = -1.0;
  if (napi_get_value_double(env, argv[0], &index) != napi_ok || index < 0.0) return throw_error(env, "setHandle : indice invalide");
  napi_value nul;
  napi_get_null(env, &nul);
  if (!g_kernel.set_handle(static_cast<uint32_t>(index), parse_influence(env, argv[1]))) return nul;
  napi_value o = new_object(env);
  set(env, o, "handle", make_number(env, g_kernel.handle()));
  set(env, o, "affected", make_typed(env, napi_uint32_array, g_kernel.affected().data(), g_kernel.affected().size()));
  set(env, o, "weights", make_typed(env, napi_float32_array, g_kernel.weights().data(), g_kernel.weights().size()));
  set(env, o, "dependents", make_typed(env, napi_uint32_array, g_kernel.dependents().data(), g_kernel.dependents().size()));
  set(env, o, "baseHeights", make_typed(env, napi_float32_array, g_kernel.base_heights().data(), g_kernel.base_heights().size()));
  return o;
}

// drag({ translation, axis: Float64Array(3), angleRad }, { heights?, deformed? })
//   -> { handle: Float64Array(4) R C Z B, handleResidualDeg, maxResidualDeg, heights?, deformed? }
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
  g_kernel.drag(t, want_heights);

  const auto& affected = g_kernel.affected();
  const size_t slot = static_cast<size_t>(
      std::lower_bound(affected.begin(), affected.end(), g_kernel.handle()) - affected.begin());
  float worst = 0.0f;
  for (const float r : g_kernel.residual_deg()) worst = r > worst ? r : worst;
  napi_value o = new_object(env);
  set(env, o, "handle", make_typed(env, napi_float64_array, &g_kernel.deformed()[4 * slot], 4));
  set(env, o, "handleResidualDeg", make_number(env, g_kernel.residual_deg()[slot]));
  set(env, o, "maxResidualDeg", make_number(env, worst));
  if (want_heights) set(env, o, "heights", make_typed(env, napi_float32_array, g_kernel.heights().data(), g_kernel.heights().size()));
  if (want_deformed) set(env, o, "deformed", make_typed(env, napi_float64_array, g_kernel.deformed().data(), g_kernel.deformed().size()));
  return o;
}

napi_value Commit(napi_env env, napi_callback_info) { return change_result(env, g_kernel.commit()); }
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

napi_value ClearLocks(napi_env env, napi_callback_info) {
  if (g_loaded) g_kernel.clear_locks();
  return undefined(env);
}

}  // namespace

NAPI_MODULE_INIT() {
  const napi_property_descriptor props[] = {
      {"load", nullptr, Load, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setHandle", nullptr, SetHandle, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"drag", nullptr, Drag, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"commit", nullptr, Commit, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"cancel", nullptr, Cancel, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"undo", nullptr, Undo, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"redo", nullptr, Redo, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"setLocked", nullptr, SetLocked, nullptr, nullptr, nullptr, napi_default, nullptr},
      {"clearLocks", nullptr, ClearLocks, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  if (napi_define_properties(env, exports, sizeof(props) / sizeof(props[0]), props) != napi_ok) return nullptr;
  return exports;
}
