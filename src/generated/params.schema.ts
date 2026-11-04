// Généré par scripts/sync-engine-schema.cjs depuis apex-engine/config/params.schema.json. NE PAS ÉDITER.
// Contrat C1, version 3.

export const SCHEMA_CONTRACT_VERSION = 3;

/** Boîte englobante alignée sur les axes. */
export interface AABB {
  max_corner?: number[];
  min_corner?: number[];
}

/** SliceParams(min_layer_height: 'float' = 0.1, max_layer_height: 'float' = 0.25, layer_height: 'float | None' = None, first_layer_height: 'float | None' = None, nozzle_reach: 'float' = 2.0, nozzle_angle_deg: 'float' = 10.0, enforce_nozzle_limits: 'bool' = True, mode: 'str' = 'auto', check_head: 'bool' = True, head_model: 'str | None' = None, head_contact_clearance: 'float' = 3.0, head_safety_margin: 'float' = 0.0, intermediate_layers: 'bool' = True, grid_cell: 'float' = 0.25, toolpath: 'tp.Toolpat */
export interface AeolisSliceParams {
  bed_temp?: number;
  center_xy?: [number, number] | null;
  check_head?: boolean;
  enforce_nozzle_limits?: boolean;
  filament_diameter?: number;
  first_layer_height?: number | null;
  first_layer_speed?: number;
  flow?: number;
  grid_cell?: number;
  head_contact_clearance?: number;
  head_model?: string | null;
  head_safety_margin?: number;
  intermediate_layers?: boolean;
  layer_height?: number | null;
  max_layer_height?: number;
  min_layer_height?: number;
  mode?: string;
  nozzle_angle_deg?: number;
  nozzle_reach?: number;
  nozzle_temp?: number;
  place_on_bed?: boolean;
  print_speed?: number;
  retract_length?: number;
  retract_speed?: number;
  toolpath?: ToolpathParams;
  travel_speed?: number;
  z_hop?: number;
}

/** CollisionOrderParams(pose_spacing: 'float' = 3.0, material_spacing: 'float' = 1.5, head_sample_spacing: 'float' = 6.0, margin: 'float' = 1.0, nozzle_contact_clearance: 'float' = 3.0, neighbours: 'int' = 4, support_depth: 'Optional[float]' = 0.3, support_radius: 'float' = 0.6) */
export interface CollisionOrderParams {
  head_sample_spacing?: number;
  margin?: number;
  material_spacing?: number;
  neighbours?: number;
  nozzle_contact_clearance?: number;
  pose_spacing?: number;
  support_depth?: number | null;
  support_radius?: number;
}

/** CollisionSimParams(path_sampling_step: 'float', safety_margin: 'float', printed_part_margin: 'Optional[float]' = None, max_adjustment_iterations: 'int' = 3, grid_cell_size_multiplier: 'float' = 4.0, toolhead_sample_spacing: 'float' = 5.0, nozzle_contact_clearance: 'float' = 3.0, fast_kdtree: 'bool' = False, fast_densify_step: 'float' = 0.25) */
export interface CollisionSimParams {
  fast_densify_step?: number;
  fast_kdtree?: boolean;
  grid_cell_size_multiplier?: number;
  max_adjustment_iterations?: number;
  nozzle_contact_clearance?: number;
  path_sampling_step?: number;
  printed_part_margin?: number | null;
  safety_margin?: number;
  toolhead_sample_spacing?: number;
}

/** Carte de couleur peinte par l'utilisateur sur le mesh source. */
export interface ColorMap {
  merge_tolerance?: number;
  per_face_color?: Record<string, unknown>;
}

/** FieldSolverParams(resolution: 'float' = 1.5, max_solver_iterations: 'int' = 2000, convergence_tolerance: 'float' = 1e-08, direct_solve_node_threshold: 'int' = 30000, use_ilu_preconditioner: 'bool' = False, platform_anchor_weight: 'float' = 1000000.0, up_vector: 'Optional[np.ndarray]' = None, heat_method_time_factor: 'float' = 100.0, radial_tilt_origin: 'Optional[np.ndarray]' = None, heat_project_reachable: 'bool' = True) */
export interface FieldSolverParams {
  convergence_tolerance?: number;
  direct_solve_node_threshold?: number;
  heat_method_time_factor?: number;
  heat_project_reachable?: boolean;
  max_solver_iterations?: number;
  platform_anchor_weight?: number;
  radial_tilt_origin?: number[] | null;
  resolution?: number;
  up_vector?: number[] | null;
  use_ilu_preconditioner?: boolean;
}

/** GcodeParams(nozzle_temp: 'float' = 195.0, filament_diameter: 'float' = 1.75, layer_height: 'float' = 0.2, skin_thickness: 'float' = 0.2, line_width: 'float' = 0.4, flow: 'float' = 1.0, print_speed: 'float' = 25.0, travel_speed: 'float' = 80.0, rotation_feed: 'float' = 3000.0, max_feed: 'float' = 12000.0, retract_length: 'float' = 0.8, retract_speed: 'float' = 35.0, retract_min_travel: 'float' = 2.0, travel_clearance: 'float' = 1.0, travel_clearance_max_factor: 'float' = 4.0, pivot_to_tip: 'float */
export interface GcodeParams {
  b_sign?: number;
  decimals?: number;
  filament_diameter?: number;
  flow?: number;
  fw_axis_speeds?: unknown[] | null;
  layer_height?: number;
  line_width?: number;
  max_feed?: number;
  max_tip_deviation?: number | null;
  max_y_turns?: number | null;
  nozzle_temp?: number;
  pivot_to_tip?: number;
  platform_margin?: number;
  print_speed?: number;
  retract_length?: number;
  retract_min_travel?: number;
  retract_speed?: number;
  rotation_feed?: number;
  singularity_radius?: number;
  skin_thickness?: number;
  strict?: boolean;
  tilt_sign?: number;
  tip_at_bead_top?: boolean;
  travel_clearance?: number;
  travel_clearance_max_factor?: number;
  travel_speed?: number;
  z_reference?: string;
}

/** Cout d'un trou temporaire (contrat UI : SchedulingParams.hole_cost_model). */
export interface HoleCostModel {
  adhesion_risk_weight?: number;
  reheat_penalty?: number;
}

/** LayerParams(layer_height_base: 'float' = 0.2, weld_tolerance_factor: 'float' = 1e-06, split_disjoint_clusters: 'Optional[float]' = None, isovalue_order: 'bool' = True) */
export interface LayerParams {
  isovalue_order?: boolean;
  layer_height_base?: number;
  split_disjoint_clusters?: number | null;
  weld_tolerance_factor?: number;
}

/** Cinématique de la machine, décrite comme une liste ORDONNÉE et PARAMÉTRABLE d'axes de rotation — PAS un modèle figé sur une seule machine. La machine actuelle (plateau C + tête B∈[0°,180°]) n'est qu'UN cas d'usage à valider parmi d'autres cinématiques futures (un seul DOF, deux DOF différemment agencés, plus de deux DOF) ; voir CLAUDE.md limite de conception #18. - liste vide : orientation libre (5 axes), aucune contrainte de rotation. - 1 élément, plage `(0,360)` : machine 4 axes classique à 1  */
export interface MachineProfile {
  build_volume?: AABB | null;
  max_angular_acceleration?: number;
  max_angular_velocity?: number;
  nozzle_diameter?: number;
  nozzle_model?: unknown;
  platform_origin?: number[];
  platform_radius?: number | null;
  position_coupled_axes?: number[];
  radial_direction?: number[] | null;
  rotation_axes?: RotationAxisSpec[];
  toolhead_id?: string;
  z_clearance_min?: number;
}

/** OverhangParams(overhang_angle_threshold_deg: 'float' = 45.0, bridge_detection_ray_density: 'int' = 4, bridge_support_ratio_threshold: 'float' = 0.7, bridge_max_gap_distance: 'float' = 2.0, bridge_horizontal_angle_tolerance_deg: 'float' = 10.0, up_vector: 'np.ndarray' = None) */
export interface OverhangParams {
  bridge_detection_ray_density?: number;
  bridge_horizontal_angle_tolerance_deg?: number;
  bridge_max_gap_distance?: number;
  bridge_support_ratio_threshold?: number;
  overhang_angle_threshold_deg?: number;
  up_vector?: number[];
}

/** Un champ par etape. Chaque valeur par defaut est celle DEJA ACTEE dans le `Params` de l'etape correspondante - ce fichier ne reinvente aucun defaut, il les expose juste au niveau orchestrateur/CLI. */
export interface PipelineParams {
  adjustment?: Step10Params;
  allow_multi_mesh?: boolean;
  collision?: CollisionSimParams;
  collision_order?: CollisionOrderParams | null;
  color_map?: ColorMap | null;
  coupled_reorientation_rounds?: number;
  coupled_reorientation_tiers?: unknown[] | null;
  field_solver?: FieldSolverParams;
  height_clamp?: boolean;
  junction_refinement_angle_deg?: number;
  junction_refinement_margin?: number;
  junction_refinement_resolution?: number | null;
  layers?: LayerParams;
  machine_profile?: MachineProfile;
  machine_toolpath?: Step8Params;
  mesher?: string;
  near_platform_margin?: number;
  near_platform_resolution?: number | null;
  overhang?: OverhangParams;
  place_on_platform?: boolean;
  reachable_tilt_from_machine?: boolean;
  resolution?: number;
  scheduling?: Step7Params;
  segmentation?: SegmentationParams;
  skin?: SkinParams | null;
  support_check?: SupportCheckParams | null;
  tetranet_refuse_ratio?: number;
  toolpath2d?: Step6Params;
  travel_routing?: TravelRoutingParams | null;
}

/** Cout d'une purge classique (contrat UI : SchedulingParams.purge_cost_model). */
export interface PurgeCostModel {
  time_per_purge?: number;
  volume_per_purge?: number;
}

/** Un DOF de rotation : axe + plage angulaire, exprimé dans le repère du DOF parent (le repère déjà tourné par tous les axes précédents de la liste — même convention que l'ordre d'application matricielle). `angle_range_deg` peut être `(0, 360)` pour un tour complet, une plage restreinte (ex: `(0, 180)` pour la tête de la machine actuelle), ou `(v, v)` pour un DOF figé à une seule valeur — dégénérescence utile qui permet de décrire un axe verrouillé sans le retirer de la liste. */
export interface RotationAxisSpec {
  angle_range_deg?: [number, number];
  axis?: number[];
}

/** SegmentationParams(direction_candidate_count: 'int' = 26, max_angle_from_direction_deg: 'float' = 45.0, max_region_merge_angle_deg: 'Optional[float]' = None, platform_z: 'Optional[float]' = None, platform_contact_tolerance: 'float' = 0.5, rotation_axes: 'Optional[list[RotationAxisSpec]]' = None, up_vector: 'np.ndarray' = None) */
export interface SegmentationParams {
  direction_candidate_count?: number;
  max_angle_from_direction_deg?: number;
  max_region_merge_angle_deg?: number | null;
  platform_contact_tolerance?: number;
  platform_z?: number | null;
  rotation_axes?: RotationAxisSpec[] | null;
  up_vector?: number[];
}

/** SkinParams(thickness: 'float' = 0.2, pattern: 'str' = 'rectilinear', head_tolerance_deg: 'float' = 45.0, trim_radius: 'float' = 2.0, max_iter: 'int' = 8, loop_sampling: 'float' = 2.0, exclusion_rounds: 'int' = 3, plate_radius: 'Optional[float]' = None, face_sample: 'Optional[int]' = None, head_sample_spacing: 'float' = 5.0, workers: 'Optional[int]' = None) */
export interface SkinParams {
  exclusion_rounds?: number;
  face_sample?: number | null;
  head_sample_spacing?: number;
  head_tolerance_deg?: number;
  loop_sampling?: number;
  max_iter?: number;
  pattern?: string;
  plate_radius?: number | null;
  thickness?: number;
  trim_radius?: number;
  workers?: number | null;
}

/** Step10Params(max_adjustment_iterations: 'int' = 3, reorientation_samples_per_axis: 'int' = 12, max_direction_deviation_deg: 'float' = 45.0, excluded_range_half_width_deg: 'float' = 15.0, rate_limit_neighbor_margin: 'int' = 1, orientation_support_min_residual_deg: 'Optional[float]' = None) */
export interface Step10Params {
  excluded_range_half_width_deg?: number;
  max_adjustment_iterations?: number;
  max_direction_deviation_deg?: number;
  orientation_support_min_residual_deg?: number | null;
  rate_limit_neighbor_margin?: number;
  reorientation_samples_per_axis?: number;
}

/** Step6Params(nozzle_width: 'float' = 0.4, wall_count: 'int' = 2, infill_density: 'float' = 0.2, infill_pattern: 'InfillPattern' = <InfillPattern.CROSSED_ZIGZAG: 'crossed_zigzag'>, bridge_contour_ratio_threshold: 'float' = 0.05, bridge_anchor_extra_walls: 'int' = 2, degenerate_area_ratio: 'float' = 1e-06, out_of_plane_interpolation_power: 'float | None' = None, split_rings_into_runs: 'bool' = False, split_open_polylines: 'bool' = False, continuous_rings: 'bool' = False, run_split_min_amplitude: 'f */
export interface Step6Params {
  bridge_anchor_extra_walls?: number;
  bridge_contour_ratio_threshold?: number;
  continuous_rings?: boolean;
  degenerate_area_ratio?: number;
  infill_density?: number;
  infill_pattern?: "lines" | "grid" | "crossed_zigzag" | "oscillating_spiral";
  nozzle_width?: number;
  out_of_plane_interpolation_power?: number | null;
  run_split_min_amplitude?: number;
  spiral_alternation_threshold?: number | null;
  spiral_axis_origin?: [number, number, number] | null;
  spiral_peak_spacing?: number | null;
  spiral_randomization_threshold?: number;
  spiral_seed?: number;
  split_open_polylines?: boolean;
  split_rings_into_runs?: boolean;
  wall_count?: number;
}

/** Step7Params(surface_color_distance: 'float' = 0.5, hole_cost_model: 'HoleCostModel' = <factory>, purge_cost_model: 'PurgeCostModel' = <factory>, max_open_holes: 'int' = 4, escape_direction_count: 'int' = 16, rotation_axes: 'Optional[list[RotationAxisSpec]]' = None, deadline_ray_samples: 'int' = 24) */
export interface Step7Params {
  deadline_ray_samples?: number;
  escape_direction_count?: number;
  hole_cost_model?: HoleCostModel;
  max_open_holes?: number;
  purge_cost_model?: PurgeCostModel;
  rotation_axes?: RotationAxisSpec[] | null;
  surface_color_distance?: number;
}

/** Step8Params(ik_samples_per_axis: 'int' = 10, ik_refine_iterations: 'int' = 8, ik_refine_step_multiplier: 'float' = 0.5, singularity_radius_epsilon: 'float' = 0.001, travel_feedrate: 'float' = 0.0, default_feedrate: 'float' = 1000.0, max_unreachable_angular_error_deg: 'float' = 5.0, clamp_angle_rates: 'bool' = False, free_axis_median_window: 'int' = 9, per_point_normal: 'bool' = True, per_point_normal_nodal: 'bool' = False) */
export interface Step8Params {
  clamp_angle_rates?: boolean;
  default_feedrate?: number;
  free_axis_median_window?: number;
  ik_refine_iterations?: number;
  ik_refine_step_multiplier?: number;
  ik_samples_per_axis?: number;
  max_unreachable_angular_error_deg?: number;
  per_point_normal?: boolean;
  per_point_normal_nodal?: boolean;
  singularity_radius_epsilon?: number;
  travel_feedrate?: number;
}

/** Les rayons/hauteurs de recherche sont exprimes en MULTIPLES de grandeurs physiques reelles (diametre de buse, hauteur de couche), jamais en constantes absolues : une constante universelle serait soit aberrante sur un modele de 5 mm, soit aveugle sur un modele de 500 mm. Meme discipline que `bridge_max_gap_distance` (step2), calibre relativement a `layer_height_base`. */
export interface SupportCheckParams {
  direction_candidate_count?: number;
  grid_cell_size_multiplier?: number;
  horizontal_search_radius_factor?: number;
  locate_supporting_point?: boolean;
  path_sampling_step?: number;
  platform_contact_tolerance_factor?: number;
  vertical_search_height_factor?: number;
}

/** ToolpathParams(line_width: 'float' = 0.4, wall_count: 'int' = 2, infill_density: 'float' = 0.2, solid_bottom_mm: 'float' = 0.6, solid_top_mm: 'float' = 0.8, max_segment: 'float' = 0.5) */
export interface ToolpathParams {
  infill_density?: number;
  line_width?: number;
  max_segment?: number;
  solid_bottom_mm?: number;
  solid_top_mm?: number;
  wall_count?: number;
}

/** TravelRoutingParams(length_threshold: 'float' = 5.0, lift_height: 'float' = 3.0, max_lift_multiplier: 'float' = 4.0, traverse_samples: 'int' = 1, routing_toolhead_sample_spacing: 'float' = 15.0, routing_grid_cell_size_multiplier: 'float' = 40.0) */
export interface TravelRoutingParams {
  length_threshold?: number;
  lift_height?: number;
  max_lift_multiplier?: number;
  routing_grid_cell_size_multiplier?: number;
  routing_toolhead_sample_spacing?: number;
  traverse_samples?: number;
}

