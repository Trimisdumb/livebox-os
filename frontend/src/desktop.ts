export type DesktopPreferences = {
  icon_size: 'small' | 'medium' | 'large';
  icon_order: string[];
  dock_pinned: string[] | null;
  remember_windows: boolean;
  wallpaper_x: number;
  wallpaper_y: number;
  animations: boolean;
  accent: 'orange' | 'amber';
};

export const desktopDefaults: DesktopPreferences = {
  icon_size: 'medium', icon_order: [], dock_pinned: null, remember_windows: false,
  wallpaper_x: 50, wallpaper_y: 50, animations: true, accent: 'orange',
};

export type DesktopWindowState = {
  id: string; x: number; y: number; width: number; height: number;
  z: number; minimized: boolean; maximized: boolean;
};

export function desktopPreferences(value?: Partial<DesktopPreferences>): DesktopPreferences {
  const result = { ...desktopDefaults, ...value };
  return {
    icon_size: ['small', 'medium', 'large'].includes(result.icon_size) ? result.icon_size : 'medium',
    icon_order: Array.isArray(result.icon_order) ? [...new Set(result.icon_order.filter(v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v)))].slice(0, 64) : [],
    dock_pinned: Array.isArray(result.dock_pinned) ? [...new Set(result.dock_pinned.filter(v => typeof v === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(v)))].slice(0, 64) : null,
    remember_windows: result.remember_windows === true,
    wallpaper_x: Number.isFinite(result.wallpaper_x) ? Math.min(100, Math.max(0, result.wallpaper_x)) : 50,
    wallpaper_y: Number.isFinite(result.wallpaper_y) ? Math.min(100, Math.max(0, result.wallpaper_y)) : 50,
    animations: result.animations !== false,
    accent: result.accent === 'amber' ? 'amber' : 'orange',
  };
}

export function orderApplications<T extends { id: string }>(apps: T[], order: string[]): T[] {
  const known = new Map(apps.map(app => [app.id, app]));
  const ids = [...new Set([...order, ...apps.map(app => app.id)])];
  return ids.flatMap(id => known.has(id) ? [known.get(id)!] : []);
}

export function dockApplications<T extends { id: string }>(apps: T[], pinned: string[] | null, windows: { id: string }[]): T[] {
  if (pinned === null) return apps;
  const ids = new Set([...pinned, ...windows.map(win => win.id)]);
  return apps.filter(app => ids.has(app.id));
}

export function clampWindow<T extends DesktopWindowState>(win: T, viewportWidth: number, viewportHeight: number): T {
  const availableWidth = Math.max(260, viewportWidth - 20);
  const availableHeight = Math.max(180, viewportHeight - 110);
  const width = Math.min(availableWidth, Math.max(Math.min(420, availableWidth), Number.isFinite(win.width) ? win.width : 780));
  const height = Math.min(availableHeight, Math.max(Math.min(300, availableHeight), Number.isFinite(win.height) ? win.height : 570));
  return { ...win, width, height,
    x: Math.max(0, Math.min(Math.max(0, viewportWidth - width), Number.isFinite(win.x) ? win.x : 20)),
    y: Math.max(0, Math.min(Math.max(0, viewportHeight - 110 - height), Number.isFinite(win.y) ? win.y : 40)),
  };
}

export function focusWindow<T extends DesktopWindowState>(windows: T[], id: string): T[] {
  const order = windows.filter(w => w.id !== id).sort((a, b) => a.z - b.z).map(w => w.id);
  order.push(id);
  return windows.map(win => ({ ...win, z: 10 + order.indexOf(win.id) }));
}

export function restoredGeometry(value: unknown): Partial<Pick<DesktopWindowState, 'x' | 'y' | 'width' | 'height'>> {
  if (!value || typeof value !== 'object') return {};
  const result: Record<string, number> = {};
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const n = (value as Record<string, unknown>)[key];
    if (typeof n === 'number' && Number.isFinite(n)) result[key] = n;
  }
  return result;
}
