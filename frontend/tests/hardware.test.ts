import assert from 'node:assert/strict';
import test from 'node:test';
import { liveboxModel, liveboxPhoto } from '../src/hardware.ts';

test('les photos suivent uniquement les modèles identifiés et documentés', () => {
  for (const model of ['4', '5', '6']) {
    assert.equal(liveboxPhoto({ ProductClass: `Livebox ${model}` })?.model, model);
  }
  // ProductClass naming is documented by LiveboxMonitor's LmLiveboxInfoApi.
  assert.equal(liveboxModel({ ProductClass: 'Livebox Fibre' }), '5');
  assert.equal(liveboxPhoto({ ProductClass: 'Livebox Fibre' })?.path, '/hardware/livebox-5.png');
});

test('un modèle inconnu, ambigu ou sans photo licenciée conserve le visuel neutre', () => {
  for (const info of [{}, { ProductClass: 'Livebox' }, { ProductClass: 'Livebox 7' }, { ProductClass: 'Livebox W7' }, { ProductClass: 'Livebox Pro 4' }, { ProductClass: 'Livebox 4', ModelName: 'Livebox 6' }]) {
    assert.equal(liveboxPhoto(info), null);
  }
});
