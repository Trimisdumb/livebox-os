import type { RecordData } from './api';

const models: Record<string, string> = {
  'livebox 4': '4', 'livebox fibre': '5', 'livebox 5': '5', 'livebox 6': '6', 'livebox 7': '7',
};

export function liveboxModel(info: RecordData): string | null {
  const found = new Set([info.ProductClass, info.ModelName].flatMap(value => {
    if (typeof value !== 'string') return [];
    const model = models[value.trim().toLowerCase()];
    return model ? [model] : [];
  }));
  return found.size === 1 ? [...found][0] : null;
}

export function liveboxPhoto(info: RecordData): { model: string; path: string; credit: string } | null {
  const model = liveboxModel(info);
  if (model === '4' || model === '6') return { model, path: `/hardware/livebox-${model}.jpg`, credit: 'Poudou99 · CC BY-SA 4.0' };
  if (model === '5') return { model, path: '/hardware/livebox-5.png', credit: 'Théodu57 · CC BY-SA 4.0' };
  return null;
}
