import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampWindow, focusWindow, orderApplications, dockApplications, restoredGeometry, desktopPreferences } from '../src/desktop.ts';

const sample = { id: 'routers', x: 1800, y: 900, width: 780, height: 570, z: 10, minimized: false, maximized: false };

test('une fenêtre retrouve un écran plus petit sans perdre ses commandes', () => {
  const win = clampWindow(sample, 800, 600);
  assert.ok(win.x >= 0 && win.x + win.width <= 800);
  assert.ok(win.y >= 0 && win.y + win.height <= 490);
  const mobile = clampWindow(sample, 320, 568);
  assert.equal(mobile.width, 300);
  assert.ok(mobile.height <= 458);
});

test('les géométries invalides ne deviennent jamais des positions CSS non finies', () => {
  const win = clampWindow({ ...sample, x: NaN, y: Infinity, width: -5, height: NaN }, 1280, 900);
  assert.ok([win.x, win.y, win.width, win.height].every(Number.isFinite));
  assert.deepEqual(restoredGeometry({ x: 50, width: '780', y: null, height: Infinity, password: 'test' }), { x: 50 });
});

test('le focus reste au-dessus des autres fenêtres et sous le dock', () => {
  const windows = [sample, { ...sample, id: 'vpn', z: 99, minimized: true }];
  const focused = focusWindow(windows, 'routers');
  assert.ok(focused[0].z > focused[1].z && focused[0].z < 5000);
  assert.equal(focused[1].minimized, true);
});

test('réorganiser le bureau conserve les nouvelles applications et ignore les IDs périmés', () => {
  const apps = [{ id: 'status' }, { id: 'routers' }, { id: 'vpn' }];
  assert.deepEqual(orderApplications(apps, ['routers', 'removed', 'routers']).map(a => a.id), ['routers', 'status', 'vpn']);
  assert.deepEqual(dockApplications(apps, ['status'], [{ id: 'vpn' }]).map(a => a.id), ['status', 'vpn']);
  assert.equal(dockApplications(apps, null, []).length, 3);
});

test('une ancienne personnalisation reste compatible avec les options du bureau', () => {
  const defaults = desktopPreferences();
  assert.equal(defaults.wallpaper_x, 50);
  assert.equal(defaults.remember_windows, false);
  assert.equal(defaults.dock_pinned, null);
  assert.equal(desktopPreferences({ wallpaper_x: 500, wallpaper_y: NaN }).wallpaper_x, 100);
  assert.equal(desktopPreferences({ wallpaper_y: NaN }).wallpaper_y, 50);
});
