import React, { useEffect, useState } from 'react';
import styles from './PrinterDetailModal.module.scss';
import { Info, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { readProfile, type PrinterProfile } from '@/utils/printerProfiles';

interface PrinterDetailModalProps {
  /** Imprimante affichée (chemin relatif de son .json dans `profiles/`), null : fiche fermée. */
  printer: { name: string; path: string } | null;
  /** Position horizontale (px) : la fiche s'ouvre à droite de la dernière colonne du menu. */
  left: number;
  onClose: () => void;
  onSelect: (printerName: string) => void;
}

interface InfoRow {
  label: string;
  value: string;
  tone?: 'yes' | 'no' | undefined;
}

/** Aplatit un JSON quelconque en lignes « clé : valeur » (profil sans bloc `apex`, ex. ancien format). */
function toRows(data: unknown, prefix = ''): InfoRow[] {
  if (data === null || data === undefined) return [];
  if (Array.isArray(data) && data.every((v) => typeof v !== 'object' || v === null)) {
    return [{ label: prefix, value: data.join(', ') }];
  }
  if (typeof data === 'object') {
    return Object.entries(data as Record<string, unknown>).flatMap(([key, value]) =>
      toRows(value, prefix ? `${prefix} › ${key}` : key));
  }
  if (typeof data === 'boolean') {
    return [{ label: prefix, value: data ? 'OUI' : 'NON', tone: data ? 'yes' : 'no' }];
  }
  return [{ label: prefix, value: String(data) }];
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {});
const text = (v: unknown): string | null => {
  if (v === null || v === undefined || v === '') return null;
  if (Array.isArray(v)) return v.length ? v.join(' / ') : null;
  return String(v);
};
const yesNo = (v: unknown): Pick<InfoRow, 'value' | 'tone'> =>
  v === true ? { value: 'OUI', tone: 'yes' } : v === false ? { value: 'NON', tone: 'no' } : { value: '—' };

/** Valeurs distinctes d'un objet axe -> valeur (ex. drivers) : « TMC2209 » ou « X : A, Y : B ». */
function uniqueValues(group: unknown): string | null {
  const entries = Object.entries(obj(group)).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!entries.length) return null;
  const distinct = new Set(entries.map(([, v]) => String(v)));
  return distinct.size === 1 ? [...distinct][0] : entries.map(([k, v]) => `${k} : ${v}`).join(', ');
}

/** Emprise d'un `printable_area` Orca (« 0x0 », « 220x0 »…) : « 220 × 220 mm ». */
function areaLabel(area: unknown): string | null {
  if (!Array.isArray(area) || area.length < 3) return null;
  const pts = area.map((p) => String(p).split('x').map(Number)).filter((p) => p.length === 2 && p.every(Number.isFinite));
  if (pts.length < 3) return null;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return `${+w.toFixed(1)} × ${+h.toFixed(1)} mm`;
}

/** Géométrie de la buse propre à l'imprimante (`apex.default_nozzle_profile`) ; « — » quand le profil ne la donne pas. */
function nozzleGeometryRows(nozzle: Json): [string, string | null][] {
  const withUnit = (v: unknown, unit: string) => (text(v) ? `${text(v)} ${unit}` : null);
  return [
    ['Longueur de buse', withUnit(nozzle.length_mm, 'mm')],
    ['Angle maximum buse-paroi', withUnit(nozzle.angle_deg, '°')],
    ['Largeur extérieure de buse', withUnit(nozzle.outer_width_mm, 'mm')],
  ];
}

/** Résumé lisible d'un profil : les champs propres à Apex (bloc `apex`) et les principaux champs Orca. */
function summaryRows(data: Json): InfoRow[] {
  const apex = obj(data.apex);
  const nozzle = obj(apex.default_nozzle_profile);
  const rows: [string, string | null, InfoRow['tone']?][] = [
    ['Fabricant', text(apex.manufacturer)],
    ["Nombre d'axes", text(apex.axes_count)],
    ['Cinématique', text(apex.kinematics_label) ?? text(apex.kinematics)],
    ['Structure', text(data.printer_structure) ?? text(obj(apex.kinematics_preview).type)],
    ["Volume d'impression", text(apex.build_volume_label) ?? ([areaLabel(data.printable_area), text(data.printable_height) && `${text(data.printable_height)} (H) mm`].filter(Boolean).join(' × ') || null)],
    ['Buse par défaut', nozzle.diameter_mm != null ? `${nozzle.diameter_mm} mm` : null],
    ...nozzleGeometryRows(nozzle),
    ['Carte mère', text(apex.motherboard)],
    ['Drivers', uniqueValues(apex.drivers)],
    ['Moteurs', uniqueValues(apex.motors)],
    ['Auto-niveau', text(obj(apex.auto_leveling).tool)],
    ['Saveur G-code', text(data.gcode_flavor)],
    ['Température max. buse', apex.max_nozzle_temp_c != null ? `${apex.max_nozzle_temp_c} °C` : null],
    ['Température max. plateau', apex.max_bed_temp_c != null ? `${apex.max_bed_temp_c} °C` : null],
    ["Vitesse d'impression max.", apex.max_print_speed_mm_s != null ? `${apex.max_print_speed_mm_s} mm/s` : null],
    ['Connectivité', text(apex.connectivity)],
    ['Distance point-pivot', apex.pivot_distance_mm ? Object.entries(obj(apex.pivot_distance_mm)).map(([k, v]) => `${k} ${v} mm`).join(', ') : null],
    ['Angle non-planaire max.', apex.nonplanar ? text(obj(apex.nonplanar).max_angle_deg) : null],
    ['Distance non-planaire max.', apex.nonplanar ? text(obj(apex.nonplanar).max_distance_mm) : null],
  ];
  const out: InfoRow[] = rows.map(([label, value, tone]) => ({ label, value: value ?? '—', tone }));
  const flags: [string, unknown][] = [
    ['Support 4 axes', apex.support_4_axes],
    ['Support multicouleur', apex.multicolor],
    ['Chambre fermée', apex.enclosed_chamber],
    ['Nivellement automatique', obj(apex.auto_leveling).available],
  ];
  for (const [label, v] of flags) if (typeof v === 'boolean') out.push({ label, ...yesNo(v) });
  return out;
}

export const PrinterDetailModal: React.FC<PrinterDetailModalProps> = ({ printer, left, onClose, onSelect }) => {
  const [profile, setProfile] = useState<PrinterProfile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const printerPath = printer?.path ?? null;
  useEffect(() => {
    setProfile(null);
    setLoadError(null);
    if (!printerPath) return;
    let cancelled = false;
    readProfile(printerPath)
      .then((p) => { if (!cancelled) setProfile(p); })
      .catch((err) => { if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err)); });
    return () => { cancelled = true; };
  }, [printerPath]);

  const boxVariants = {
    initial: { opacity: 0, scale: 0.95, x: -10 },
    animate: { opacity: 1, scale: 1, x: 0 },
    exit: { opacity: 0, x: -20 },
  };
  const transition = { duration: 0.2, ease: [0.16, 1, 0.3, 1] as const };
  const exitTransition = { opacity: { duration: 0.2, ease: 'linear' as const }, x: { duration: 0.2, ease: 'easeInOut' as const } };

  const rows = profile?.status === 'ok'
    ? (obj(profile.data).apex ? summaryRows(obj(profile.data)) : toRows(profile.data))
    : [];
  const emptyMessage = loadError
    ?? (profile?.status === 'invalid' ? `Profil illisible : ${profile.error}` : null)
    ?? (profile?.status === 'empty' || (profile?.status === 'ok' && rows.length === 0) ? 'Profil vide : aucune donnée renseignée.' : null);

  return (
    <AnimatePresence>
      {printer && (
    <div className={styles.container} style={{ left }}>
      <motion.div className={styles.headerBox} {...boxVariants} transition={transition} exit={{ ...boxVariants.exit, transition: exitTransition }}>
        <div className={styles.headerTitle}>
          <Info size={16} className="text-[#00f0ff]" />
          <span>Fiche Technique : {printer.name}</span>
        </div>
        <button className={styles.closeBtn} onClick={onClose}>
          <X size={14} />
        </button>
      </motion.div>

      <motion.div className={styles.imageBox} {...boxVariants} transition={{ ...transition, delay: 0.03 }} exit={{ ...boxVariants.exit, transition: exitTransition }}>
        <div className={styles.imageContainer}>
          {profile?.image ? (
            <img src={profile.image} alt={printer.name} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-xs text-zinc-400 font-orbitron bg-neutral-900/80">
              {printer.name}
            </div>
          )}
        </div>
      </motion.div>

      <motion.div className={styles.infoBox} {...boxVariants} transition={{ ...transition, delay: 0.06 }} exit={{ ...boxVariants.exit, transition: exitTransition }}>
        <div className={styles.infoList}>
          {!profile && !loadError && (
            <div className={styles.infoRow}><span className={styles.label}>Chargement…</span></div>
          )}
          {emptyMessage && (
            <div className={styles.infoRow}><span className={styles.label}>{emptyMessage}</span></div>
          )}
          {rows.map((row, i) => (
            <div className={styles.infoRow} key={`${row.label}-${i}`}>
              <span className={styles.label}>{row.label} :</span>
              <span className={`${styles.value} ${row.tone ? styles[row.tone] : ''}`}>{row.value}</span>
            </div>
          ))}
        </div>
      </motion.div>

      <motion.button
        className={styles.selectBtn}
        onClick={() => onSelect(printer.name)}
        {...boxVariants}
        transition={{ ...transition, delay: 0.09 }}
        exit={{ ...boxVariants.exit, transition: exitTransition }}
      >
        Sélectionner cette imprimante
      </motion.button>
    </div>
      )}
    </AnimatePresence>
  );
};
