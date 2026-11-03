
/**
 * Icônes des outils à gizmo (translation, rotation, redimensionnement). Les tracés sont ceux des icônes Lucide
 * `Move3d`, `Rotate3d` et `Scale3d`, découpés par axe : actif, chaque axe prend la couleur de son gizmo (X rouge,
 * vertical bleu, profondeur vert) ; au repos, tout suit la couleur du texte.
 */
const AXIS_ICON_COLORS = { x: '#ff5a5a', y: '#5a9bff', z: '#4fe08a' } as const;

type AxisTool = 'move' | 'rotate' | 'scale';

interface ToolAxisIconProps {
  tool: AxisTool;
  active: boolean;
  size?: number;
}

export default function ToolAxisIcon({ tool, active, size = 16 }: ToolAxisIconProps) {
  const x = active ? AXIS_ICON_COLORS.x : 'currentColor';
  const y = active ? AXIS_ICON_COLORS.y : 'currentColor';
  const z = active ? AXIS_ICON_COLORS.z : 'currentColor';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {tool === 'move' && (
        <>
          <path d="M5 3v16" stroke={y} />
          <path d="m2 6 3-3 3 3" stroke={y} />
          <path d="M5 19h16" stroke={x} />
          <path d="m18 16 3 3-3 3" stroke={x} />
          <path d="m5 19 6-6" stroke={z} />
        </>
      )}
      {tool === 'rotate' && (
        <>
          <path d="M16.466 7.5C15.643 4.237 13.952 2 12 2 9.239 2 7 6.477 7 12s2.239 10 5 10c.342 0 .677-.069 1-.2" stroke={y} />
          <path d="M19 15.57c-1.804.885-4.274 1.43-7 1.43-5.523 0-10-2.239-10-5s4.477-5 10-5c4.838 0 8.873 1.718 9.8 4" stroke={x} />
          <path d="m15.194 13.707 3.814 1.86-1.86 3.814" stroke={x} />
        </>
      )}
      {tool === 'scale' && (
        <>
          <path d="M5 7v11a1 1 0 0 0 1 1" stroke={y} />
          <circle cx="5" cy="5" r="2" stroke={y} />
          <path d="M6 19h11" stroke={x} />
          <circle cx="19" cy="19" r="2" stroke={x} />
          <path d="M5.293 18.707 11 13" stroke={z} />
        </>
      )}
    </svg>
  );
}
