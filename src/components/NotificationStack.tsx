import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleX, Loader2, TriangleAlert, X } from 'lucide-react';
import { emitApex, onApex } from '@/events/apexEvents';
import { removeNotification, subscribeToNotifications, type NotificationItem, type NotificationVariant } from '@/utils/notificationStore';
import { FALLBACK_HEIGHT, PEEK, cardPose, layoutStack, type CardPose } from './notificationLayout';
import { useCardMotion, type CardMotion } from './useCardMotion';
import { useSwipeGesture, type SwipeGesture } from './useSwipeGesture';
import styles from './NotificationStack.module.scss';

const VARIANT_ICONS: Record<NotificationVariant, React.ReactNode> = {
  success: <CircleCheck size={18} />,
  error: <CircleX size={18} />,
  warning: <TriangleAlert size={18} />,
  loading: <Loader2 size={18} className="animate-spin" />,
};

const VARIANT_LABELS: Record<NotificationVariant, string> = {
  success: 'Succès',
  error: 'Erreur',
  warning: 'Avertissement',
  loading: 'En cours',
};

const setTooltip = (title: string, desc: string) => emitApex('apex-set-tooltip', { title, desc });
const resetTooltip = () => emitApex('apex-reset-tooltip');

/** Notifications du magasin, la plus récente d'abord (c'est la carte de face). */
function useNotifications(): NotificationItem[] {
  const [items, setItems] = useState<NotificationItem[]>([]);
  useEffect(() => subscribeToNotifications((its) => setItems(its.slice().reverse())), []);
  return items;
}

/**
 * Hauteur mesurée de chaque carte, remise à jour quand elle change (texte qui se recoupe). Les
 * notifications arrivent à tout moment : chaque carte s'enregistre à son montage.
 */
function useCardHeights() {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const observer = useRef<ResizeObserver | null>(null);
  const nodes = useRef(new Map<string, HTMLElement>());

  const report = useCallback((id: string, height: number) => {
    if (!height) return;
    setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height }));
  }, []);

  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.id;
        if (id) report(id, Math.round(entry.borderBoxSize[0]?.blockSize ?? 0));
      }
    });
    observer.current = ro;
    nodes.current.forEach((node) => ro.observe(node));
    return () => {
      ro.disconnect();
      observer.current = null;
    };
  }, [report]);

  const observe = (id: string) => (node: HTMLLIElement | null) => {
    if (node) {
      nodes.current.set(id, node);
      observer.current?.observe(node);
      report(id, node.offsetHeight);
      return;
    }
    const old = nodes.current.get(id);
    if (old) observer.current?.unobserve(old);
    nodes.current.delete(id);
  };

  const heightOf = (id: string) => heights[id] ?? FALLBACK_HEIGHT;
  return { heightOf, observe };
}

/** Survol (souris seulement) et focus clavier : ils déplient la pile, le focus de la souris non. */
function useExpansion(count: number) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pinned, setPinned] = useState(false);
  const expanded = (hovered || focused || pinned) && count > 1;
  const handlers = {
    onFocus: (event: React.FocusEvent<HTMLDivElement>) => {
      // Cliquer un bouton le focalise : seul le focus au clavier compte, sinon « Réduire » ne réduirait jamais.
      if (event.target.matches(':focus-visible')) setFocused(true);
    },
    onBlur: (event: React.FocusEvent<HTMLDivElement>) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false);
    },
    // Un écran tactile déclenche pointerenter au toucher : seul un vrai survol déplie.
    onPointerEnter: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse') setHovered(true);
    },
    onPointerLeave: (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'mouse') setHovered(false);
    },
  };
  return { expanded, handlers, togglePinned: () => setPinned((p) => !p), pin: () => setPinned(true) };
}

/** Déplace le focus clavier sur la carte voisine quand celle qui l'a part, au lieu de le perdre. */
function refocusAround(list: HTMLOListElement | null, id: string, leaving: ReadonlySet<string>) {
  if (!list) return;
  const cards = (Array.from(list.children) as HTMLElement[]).filter((el) => !leaving.has(el.dataset.id ?? ''));
  const at = cards.findIndex((el) => el.dataset.id === id);
  if (at < 0 || !cards[at].contains(document.activeElement)) return;
  const next = cards[at + 1] ?? cards[at - 1];
  (next?.querySelector('article') ?? list).focus();
}

interface HeaderProps {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  onClear: () => void;
}

const StackHeader: React.FC<HeaderProps> = ({ count, expanded, onToggle, onClear }) => (
  <div className={styles.header}>
    <p className={styles.title}>
      Notifications<span className={styles.count}>{count}</span>
    </p>
    <div className={styles.actions}>
      {count > 1 && (
        <button type="button" className={styles.headerButton} aria-expanded={expanded} onClick={onToggle}>
          {expanded ? 'Réduire' : 'Tout afficher'}
        </button>
      )}
      <button
        type="button"
        className={styles.headerButton}
        onMouseEnter={() => setTooltip('Tout fermer', 'Ferme toutes les notifications.')}
        onMouseLeave={resetTooltip}
        onClick={() => {
          resetTooltip();
          onClear();
        }}
      >
        Tout fermer
      </button>
    </div>
  </div>
);

interface CardProps {
  item: NotificationItem;
  depth: number;
  /** Ordre d'empilement : la face au-dessus des cartes du fond. */
  layer: number;
  pose: CardPose;
  clickable: boolean;
  observe: (node: HTMLLIElement | null) => void;
  motion: CardMotion;
  gesture: SwipeGesture;
  onExpand: () => void;
}

/** Une carte : conteneur de position (li), zone de balayage, carte de verre et croix de fermeture. */
const StackCard: React.FC<CardProps> = ({ item, depth, layer, pose, clickable, observe, motion, gesture, onExpand }) => {
  const { id } = item;
  const handleClick = () => {
    if (!gesture.takeSuppressedClick()) onExpand();
  };
  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    event.preventDefault();
    // Une touche maintenue fermerait aussi la carte suivante, puisque le focus s'y déplace.
    if (!event.repeat) motion.dismiss(id, 1);
  };

  return (
    <li
      className={styles.item}
      data-id={id}
      ref={observe}
      style={{
        transform: `translateY(${pose.y}px) scale(${pose.scale})`,
        opacity: pose.hidden ? 0 : 1,
        zIndex: layer,
        pointerEvents: pose.hidden ? 'none' : undefined,
      }}
    >
      <div
        className={styles.swipe}
        ref={(node) => motion.register(id, node)}
        onPointerDown={(event) => gesture.onPointerDown(event, depth, id)}
        onPointerMove={(event) => gesture.onPointerMove(event, id)}
        onPointerUp={(event) => gesture.onPointerUp(event, id)}
        onPointerCancel={(event) => gesture.onPointerUp(event, id)}
        // Le toucher démarre par une capture implicite sur l'élément sous le doigt ; la déplacer vers
        // cette zone déclenche un lostpointercapture qui ne marque pas la fin du balayage.
        onLostPointerCapture={(event) => {
          if (event.target === event.currentTarget) gesture.onPointerUp(event, id);
        }}
      >
        <article
          data-card
          data-variant={item.variant}
          data-peek={pose.peek || undefined}
          data-clickable={clickable || undefined}
          className={styles.card}
          style={pose.peek ? ({ '--peek': `${PEEK / pose.scale}px` } as React.CSSProperties) : undefined}
          aria-label={`${VARIANT_LABELS[item.variant]} : ${item.message}`}
          tabIndex={pose.hidden ? -1 : 0}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
        >
          <span className={styles.icon}>{VARIANT_ICONS[item.variant]}</span>
          <span className={styles.message}>{item.message}</span>
        </article>
        {!pose.peek && (
          <button
            type="button"
            className={styles.close}
            aria-label="Fermer la notification"
            onClick={(event) => {
              event.stopPropagation();
              motion.dismiss(id, 1);
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
    </li>
  );
};

const NotificationCards: React.FC = () => {
  const items = useNotifications();
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLOListElement>(null);
  // Où chaque carte se trouvait en dernier : celle qui part glisse depuis ce point.
  const lastY = useRef(new Map<string, number>());
  const { heightOf, observe } = useCardHeights();

  // Les cartes qui partent ne prennent plus de place : les autres comblent le vide pendant leur sortie.
  const laidOut = items.filter((item) => !leaving.has(item.id));
  const { expanded, handlers, togglePinned, pin } = useExpansion(laidOut.length);

  const motion = useCardMotion({
    onStart: (id) => {
      refocusAround(listRef.current, id, leaving);
      setLeaving((prev) => new Set(prev).add(id));
    },
    onEnd: (id) => {
      lastY.current.delete(id);
      setLeaving((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      removeNotification(id);
    },
  });
  const gesture = useSwipeGesture({
    motion,
    canStart: (id, depth) => !leaving.has(id) && (expanded || depth === 0),
  });

  if (items.length === 0) return null;

  const layout = layoutStack(
    laidOut.map((item) => item.id),
    heightOf,
    expanded,
  );

  return (
    <div className={styles.stack} {...handlers}>
      {laidOut.length > 0 && (
        <StackHeader
          count={laidOut.length}
          expanded={expanded}
          onToggle={togglePinned}
          onClear={() => laidOut.forEach((item) => motion.dismiss(item.id, 1))}
        />
      )}
      {/* Reçoit le focus quand la dernière carte est fermée au clavier. */}
      <ol className={styles.list} aria-label="Notifications" ref={listRef} style={{ height: layout.height }} tabIndex={-1}>
        {items.map((item) => {
          const index = laidOut.findIndex((card) => card.id === item.id);
          const isLeaving = index === -1;
          const depth = Math.max(index, 0);
          const pose = cardPose(depth, expanded, layout, heightOf(item.id));
          if (isLeaving) pose.y = lastY.current.get(item.id) ?? pose.y;
          else lastY.current.set(item.id, pose.y);
          return (
            <StackCard
              key={item.id}
              item={item}
              depth={depth}
              layer={items.length - depth}
              pose={isLeaving ? { ...pose, scale: 1, peek: false } : pose}
              clickable={!expanded && depth === 0 && laidOut.length > 1}
              observe={observe(item.id)}
              motion={motion}
              gesture={gesture}
              onExpand={() => {
                if (!expanded) pin();
              }}
            />
          );
        })}
      </ol>
    </div>
  );
};

/** Espace Dev : volontairement vide de tout chrome hors viewport, la pile de notifications y est masquée. */
export const NotificationStack: React.FC = () => {
  const [inDev, setInDev] = useState(false);
  useEffect(() => onApex('apex-space-changed', ({ space }) => setInDev(space === 'dev')), []);
  return inDev ? null : <NotificationCards />;
};
