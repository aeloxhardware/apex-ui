// Catalogue des profils d'imprimantes (dossier `profiles/`) : application de bureau par IPC,
// navigateur par le serveur de développement Vite (cf. electron/profiles.cjs).
export type ProfileFolder = ApexProfileFolder;
export type PrinterProfile = ApexProfile;

async function devFetch<T>(url: string): Promise<T> {
  const response = await fetch(url);
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error ?? `Profils indisponibles (${response.status})`);
  return body as T;
}

export function scanProfiles(): Promise<ProfileFolder> {
  const bridge = window.apexDesktop;
  if (bridge?.scanProfiles) return bridge.scanProfiles();
  return devFetch<ProfileFolder>('/__apex/profiles/scan');
}

export function readProfile(path: string): Promise<PrinterProfile> {
  const bridge = window.apexDesktop;
  if (bridge?.readProfile) return bridge.readProfile(path);
  return devFetch<PrinterProfile>(`/__apex/profiles/read?path=${encodeURIComponent(path)}`);
}
