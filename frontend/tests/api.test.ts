import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, APIError, internetConnected } from '../src/api.ts';

test('une panne de transport affiche un message français, sans Failed to fetch', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  try { await assert.rejects(api('/health'), (error: unknown) => error instanceof APIError && !error.message.includes('Failed to fetch') && error.message.includes('Impossible de joindre Livebox OS')); }
  finally { globalThis.fetch = original; }
});

test('les réponses de proxy invalides sont distinguées des sessions expirées', async () => {
  const original = globalThis.fetch;
  const events: string[] = [];
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent: (event: CustomEvent) => events.push(event.detail) } });
  try {
    globalThis.fetch = async () => new Response('<html>bad gateway</html>', { status: 502 });
    await assert.rejects(api('/status'), (e: unknown) => e instanceof APIError && e.code === 'INVALID_RESPONSE');
    globalThis.fetch = async () => Response.json({ detail: { message: 'Session expirée', code: 'LIVEBOX_SESSION_EXPIRED' } }, { status: 401 });
    await assert.rejects(api('/status'), (e: unknown) => e instanceof APIError && e.code === 'LIVEBOX_SESSION_EXPIRED');
    assert.deepEqual(events, ['LIVEBOX_SESSION_EXPIRED']);
  } finally { globalThis.fetch = original; }
});

test('le client conserve le CSRF en mémoire et reconnaît le WAN Bound réel', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ csrf: 'test-only-csrf' });
    await api('/auth/state');
    globalThis.fetch = async (_, options) => { assert.equal((options?.headers as Record<string, string>)['X-CSRF-Token'], 'test-only-csrf'); assert.equal(options?.credentials, 'same-origin'); return Response.json({ ok: true }); };
    await api('/preferences', {}, 'PUT');
    assert.equal(internetConnected({ wan: { available: true, data: { ConnectionState: 'Bound', LinkState: 'up' } } }), true);
    assert.equal(internetConnected({ wan: { available: true, data: { ConnectionState: 'Bound', LinkState: 'down' } } }), false);
  } finally { globalThis.fetch = original; }
});

