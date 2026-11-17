/**
 * Icônes des outils à gizmo (translation, rotation, redimensionnement), dessinées à la charte du jeu `@/lib/icons`
 * (grille 24, trait de 2, extrémités coupées net, angles adoucis) et découpées par axe : actif, chaque axe prend la
 * couleur de son gizmo (X rouge, vertical bleu, profondeur vert) ; au repos, tout suit la couleur du texte.
 */
const AXIS_ICON_COLORS = { x: '#ff5a5a', y: '#5a9bff', z: '#4fe08a' } as const;

type AxisTool = 'move' | 'rotate' | 'scale';
type Axis = keyof typeof AXIS_ICON_COLORS;

interface ToolAxisIconProps {
  tool: AxisTool;
  active: boolean;
  size?: number;
}

/** Un tracé par axe : les tracés d'un même outil ne se recouvrent pas (aucune surépaisseur en transparence). */
const AXIS_PATHS: Record<AxisTool, Partial<Record<Axis, string>>> = {
  move: {
    y: 'M6 17V4M2.5 7.5 6 4l3.5 3.5',
    x: 'M7 18h13M16.5 14.5 20 18l-3.5 3.5',
    z: 'M7.5 16.5 12 12',
  },
  rotate: {
    y: 'M14 21c-.6.3-1.3.5-2 .5-2.8 0-5-4.25-5-9.5S9.2 2.5 12 2.5c2 0 3.7 2.2 4.5 5.4',
    x: 'M21.3 10.5C20 8.4 16.3 7 12 7 6.75 7 2.5 9.2 2.5 12s4.25 5 9.5 5c2.4 0 4.6-.5 6.3-1.2M15 13.5l3.6 2.2-2 3.6',
  },
  scale: {
    y: 'M6 17V8.5M4 3.5h4v4H4z',
    x: 'M7 18h8.5M16.5 16h4v4h-4z',
    z: 'M7.5 16.5 12 12',
  },
};

export default function ToolAxisIcon({ tool, active, size = 16 }: ToolAxisIconProps) {
  const paths = AXIS_PATHS[tool];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="butt"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`apex-icon apex-icon-axis-${tool}`}
    >
      {(Object.keys(paths) as Axis[]).map((axis) => (
        <path key={axis} d={paths[axis]} stroke={active ? AXIS_ICON_COLORS[axis] : 'currentColor'} />
      ))}
    </svg>
  );
}
