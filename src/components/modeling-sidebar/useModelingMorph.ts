import { useRef, useState, useEffect, useLayoutEffect } from 'react';
import { LiquidGlassShadowHandle, applyGlassBlur, PREVIEW_GLASS_BLUR_PX, GLASS_BLUR_PX, applyLiquidGlassShadow } from '../LiquidGlassMorph';
import { modelingMorphStage, modelingPathAt, modelingMorphDuration } from '@/utils/spaceMorphGeometry';
import { CONTENT_REVEAL_THRESHOLD } from './constants';

/** Morph d'espace : le panneau réel change de silhouette (clip-path), le contenu n'apparaît qu'à la forme normale. */
export function useModelingMorph({ morph }: {
  morph: { direction: "enter" | "exit"; fromPreview: boolean; onDone: () => void; };
}) {


  // Morph d'espace (cf. la prop `morph`) : anime directement le `clip-path` de .panel entre la
  // forme de la pilule/des panneaux Preview et sa forme normale — jamais de calque séparé à
  // raccorder, c'est ce panneau réel, déjà affiché avec son contenu, qui change de silhouette.
  //
  // `stage` est DÉRIVÉ de `morph` pendant le rendu, jamais stocké dans un état mis à jour depuis la
  // boucle RAF : l'app tourne sous `createRoot` (React 18 concurrent), où un `setState` hors
  // gestionnaire d'événement n'est commité que dans une tâche ULTÉRIEURE — donc après la peinture de
  // la frame courante. Mélanger une mutation DOM synchrone (retrait du clip-path) et un tel
  // `setState` (retrait du stage et de `.morphing`) laissait passer une frame incohérente : panneau
  // non découpé à la taille du stage (un rectangle plus large), ou masqué par le filet CSS de
  // `.morphing` (un trou « transparent » entouré de l'ombre). Ici, tout ce qui décrit « un morph est
  // en cours » disparaît dans le MÊME commit que `morph`, et le clip-path est retiré par le cleanup
  // du layout effect ci-dessous, qui s'exécute pendant ce commit, avant la peinture.
  const panelRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<LiquidGlassShadowHandle>(null);
  const stage = morph ? modelingMorphStage(window.innerHeight) : null;
  const morphRef = useRef(morph);
  morphRef.current = morph;
  // Le contenu (header, Sélection, Corps — cf. CONTENT_REVEAL_THRESHOLD) n'a de sens que quand la
  // silhouette a sa forme normale. Calculé dès l'état initial (pas seulement dans le layout effect,
  // qui ne corrigerait qu'APRÈS un premier rendu à `true`) : faux dès qu'un morph est en cours au
  // montage.
  const [contentRevealed, setContentRevealed] = useState(() => !morph);
  // Vrai dès le CLIC qui quitte Modélisation (cf. apex-leaving-modeling, dispatché par Sidebar.tsx
  // avant même que le rideau ne monte) : le contenu disparaît en cascade AVANT que la déformation ne
  // commence (à `onCovered`, ~900ms plus tard). Ce composant est démonté à la fin du morph de
  // sortie, jamais besoin de repasser à `false`.
  const [contentLeaving, setContentLeaving] = useState(false);

  useEffect(() => {
    const handleLeaving = () => setContentLeaving(true);
    window.addEventListener('apex-leaving-modeling', handleLeaving);
    return () => window.removeEventListener('apex-leaving-modeling', handleLeaving);
  }, []);

  // Layout effect : la première silhouette est posée avant le premier affichage (sinon une image
  // du panneau non clippé clignoterait — cf. aussi le filet CSS de `.panel.morphing`).
  useLayoutEffect(() => {
    if (!morph || !panelRef.current) return;
    const stage = modelingMorphStage(window.innerHeight);
    const el = panelRef.current;
    // Le contenu n'est jamais visible pendant une déformation : en entrée il n'apparaît qu'à t = 1,
    // en sortie il est déjà parti au clic (contentLeaving).
    let revealed = false;
    setContentRevealed(false);

    const pathAt = (t: number, dx: number, dy: number) =>
      modelingPathAt(morph.fromPreview, window.innerHeight, t, dx, dy - stage.dyOffset);

    const apply = (progress: number) => {
      const t = morph.direction === 'exit' ? 1 - progress : progress;
      el.style.clipPath = `path('${pathAt(t, 0, 0)}')`;
      // Depuis la Prévisualisation, le verre part du flou (plus fort) de ses panneaux.
      if (morph.fromPreview) applyGlassBlur(el, PREVIEW_GLASS_BLUR_PX, GLASS_BLUR_PX, t);
      // MÊME frame, MÊME `progress` que le panneau réel ci-dessus (cf. le commentaire de
      // LiquidGlassShadow : deux boucles RAF séparées dériveraient l'une de l'autre).
      applyLiquidGlassShadow(shadowRef, pathAt, stage.width, stage.height, morph.direction === 'exit', progress);
      const shouldReveal = morph.direction === 'enter' && t >= CONTENT_REVEAL_THRESHOLD;
      if (shouldReveal !== revealed) {
        revealed = shouldReveal;
        setContentRevealed(revealed);
      }
    };

    const duration = modelingMorphDuration(morph.fromPreview);
    apply(0);
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const progress = Math.min(1, (now - start) / duration);
      apply(progress);
      if (progress < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        // Rien d'autre ici : ni mutation DOM, ni état de géométrie. `onDone` fait passer `morph` à
        // undefined (ou démonte ce composant en sortie) ; le commit qui en résulte retire le stage
        // et `.morphing`, et le cleanup ci-dessous efface le clip-path dans ce même commit.
        morphRef.current?.onDone();
      }
    });
    return () => {
      cancelAnimationFrame(raf);
      el.style.clipPath = '';
      el.style.backdropFilter = '';
      el.style.removeProperty('-webkit-backdrop-filter');
    };
    // Dépendre de `morph` lui-même (plutôt que ses champs primitifs) relancerait cet effet — donc
    // l'animation, depuis `t = 0` — à chaque re-render du parent pendant le morph : Index.tsx
    // construit `{ ...modelingMorph, onDone }` à chaque rendu, un nouvel objet à chaque fois, alors
    // que `onDone` (lu via morphRef, jamais capturé ici) fait toujours la même chose. `direction`/
    // `fromPreview`, eux, restent figés pour la durée de CE morph (Index.tsx ne les change jamais
    // sans démonter/remonter un nouveau cycle) : ce sont eux qui doivent déclencher l'effet, à
    // l'exclusion de toute autre cause de re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morph?.direction, morph?.fromPreview]);
  return { contentLeaving, stage, shadowRef, panelRef, contentRevealed };
}
