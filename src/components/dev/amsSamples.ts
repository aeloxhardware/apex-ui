import { useEffect, useState } from 'react';
import { loadFilaments, filamentKey, type FilamentProfile } from '@/utils/filamentCatalog';

/** Bobines d'exemple de l'AMS : chacune pointe un VRAI profil du catalogue (matériau et aspect viennent du profil). */
export const AMS_SAMPLE_SPOOLS: ReadonlyArray<{ key: string; color: string }> = [
  { key: 'BBL|Bambu PLA Silk', color: '#e8e8ea' },
  { key: 'BBL|Bambu PLA Matte', color: '#1f2125' },
  { key: 'BBL|Bambu PETG Translucent', color: '#e5483d' },
  { key: 'BBL|Bambu PLA Metal', color: '#f2a33a' },
  { key: 'BBL|Bambu PLA Basic', color: '#f4d84a' },
  { key: 'BBL|Bambu ASA', color: '#5fc46a' },
  { key: 'BBL|Bambu PLA Sparkle', color: '#2fb3b8' },
  { key: 'BBL|Bambu PLA-CF', color: '#3d7be0' },
  { key: 'BBL|Bambu TPU 95A', color: '#7a5ce0' },
  { key: 'BBL|Bambu PC', color: '#d768b8' },
  { key: 'BBL|Bambu PLA Marble', color: '#9a6a45' },
  { key: 'BBL|Bambu ABS', color: '#8e949c' },
];

/** Profils du catalogue indexés par clé `vendor|name` (vide tant que le catalogue charge). */
export function useFilamentIndex(): ReadonlyMap<string, FilamentProfile> {
  const [index, setIndex] = useState<ReadonlyMap<string, FilamentProfile>>(new Map());
  useEffect(() => {
    let alive = true;
    loadFilaments()
      .then((list) => { if (alive) setIndex(new Map(list.map((p) => [filamentKey(p), p]))); })
      .catch(() => { /* catalogue indisponible : bobines sans matériau ni aspect */ });
    return () => { alive = false; };
  }, []);
  return index;
}
