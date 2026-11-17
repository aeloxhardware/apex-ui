import { useEffect, useState } from 'react';
import { projectThumbnail } from '@/utils/threeMfThumbnail';

export interface RecentProject {
  name: string;
  path: string;
  modified: number;
  /** URL de la miniature ; null tant qu'elle se prépare (ou si le fichier n'en donne pas). */
  thumbnail: string | null;
}

const RECENT_COUNT = 12;

/** « Pièce_2026-11-16-21-24-32.3mf » → « Pièce » : le suffixe horodaté ajouté à l'enregistrement. */
export const projectLabel = (fileName: string) => fileName.replace(/\.3mf$/i, '').replace(/_\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}$/, '');

type Desktop = NonNullable<typeof window.apexDesktop>;

/** Miniature d'un projet, ou null (fichier illisible, sans modèle) : une vignette manquante n'arrête pas la suite. */
async function thumbnailOf(desktop: Desktop | undefined, path: string): Promise<string | null> {
  const bytes = await desktop?.readProject?.(path).catch(() => null);
  return bytes ? projectThumbnail(bytes) : null;
}

/**
 * Miniatures déjà dessinées, par fichier et date de modification : revenir à l'Accueil ne relit ni ne redessine
 * plus les projets (l'archive et le rendu bloquaient le fil principal en pleine transition). Les URL ne sont
 * jamais révoquées : une douzaine d'images de 240 x 160, pour la durée de la session.
 */
const thumbnailCache = new Map<string, string | null>();

/**
 * Projets du répertoire dédié d'Apex, du plus récent au plus ancien. La liste s'affiche aussitôt ; les miniatures
 * se dessinent une à une ensuite (une seule archive en mémoire à la fois). Hors application de bureau : liste vide.
 */
export function useRecentProjects(): RecentProject[] {
  const [projects, setProjects] = useState<RecentProject[]>([]);
  useEffect(() => {
    let cancelled = false;
    const desktop = window.apexDesktop;
    void (async () => {
      const listed = await desktop?.listProjects?.(RECENT_COUNT).catch(() => []);
      if (cancelled || !listed) return;
      const keyOf = (p: { path: string; modified: number }) => `${p.path}:${p.modified}`;
      setProjects(listed.map((p) => ({ ...p, thumbnail: thumbnailCache.get(keyOf(p)) ?? null })));
      for (const project of listed) {
        if (thumbnailCache.has(keyOf(project))) continue;
        const url = await thumbnailOf(desktop, project.path);
        thumbnailCache.set(keyOf(project), url);
        if (cancelled) return;
        if (!url) continue;
        setProjects((all) => all.map((p) => (p.path === project.path ? { ...p, thumbnail: url } : p)));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return projects;
}
