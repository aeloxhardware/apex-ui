export type NotificationVariant = 'success' | 'error' | 'warning' | 'loading';

export interface NotificationItem {
  id: string;
  variant: NotificationVariant;
  message: string;
  createdAt: number;
}

type Listener = (items: NotificationItem[]) => void;

let items: NotificationItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  const snapshot = items.slice();
  listeners.forEach((l) => l(snapshot));
}

let uid = 0;
function genId() {
  uid += 1;
  return `ntf-${Date.now()}-${uid}`;
}

export function pushNotification(variant: NotificationVariant, message: string): string {
  const id = genId();
  items = [...items, { id, variant, message, createdAt: Date.now() }];
  emit();
  return id;
}

/** Utilisé par la valeur retournée de showLoading + dismissToast, et par la croix de fermeture. */
export function removeNotification(id: string): void {
  if (!items.some((n) => n.id === id)) return;
  items = items.filter((n) => n.id !== id);
  emit();
}

export function subscribeToNotifications(listener: Listener): () => void {
  listeners.add(listener);
  listener(items.slice());
  return () => listeners.delete(listener);
}
