export type NotificationVariant = 'success' | 'error' | 'warning' | 'loading';

export interface NotificationItem {
  id: string;
  variant: NotificationVariant;
  message: string;
  createdAt: number;
}

type Listener = (items: NotificationItem[], frontId: string | null) => void;

let items: NotificationItem[] = [];
// Id de la notif épinglée au premier plan par la molette (ou par un push récent). null = aucun
// forçage, la pile retombe sur la plus récente (cf. orderedIds dans NotificationStack.tsx).
let frontId: string | null = null;
const listeners = new Set<Listener>();

function emit() {
  const snapshot = items.slice();
  listeners.forEach((l) => l(snapshot, frontId));
}

let uid = 0;
function genId() {
  uid += 1;
  return `ntf-${Date.now()}-${uid}`;
}

export function pushNotification(variant: NotificationVariant, message: string): string {
  const id = genId();
  items = [...items, { id, variant, message, createdAt: Date.now() }];
  frontId = id;
  emit();
  return id;
}

/** Utilisé par la valeur retournée de showLoading + dismissToast, et par la croix de fermeture. */
export function removeNotification(id: string): void {
  if (!items.some((n) => n.id === id)) return;
  items = items.filter((n) => n.id !== id);
  if (frontId === id) frontId = null;
  emit();
}

/** Bouton « tout fermer » de la pile. */
export function clearNotifications(): void {
  if (items.length === 0) return;
  items = [];
  frontId = null;
  emit();
}

/** Appelé par le gestionnaire de molette de NotificationStack. */
export function setFrontNotification(id: string): void {
  if (!items.some((n) => n.id === id)) return;
  frontId = id;
  emit();
}

export function subscribeToNotifications(listener: Listener): () => void {
  listeners.add(listener);
  listener(items.slice(), frontId);
  return () => listeners.delete(listener);
}
