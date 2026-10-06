import test from 'node:test';
import assert from 'node:assert/strict';
import { gameStoreFixture } from './fixtures/game-store-fixture.mjs';

test('production store refuses generated scenarios even through saved-review restart', () => {
  const { store, messages, load } = gameStoreFixture({ archivedScenario: false });
  assert.equal(load('@/lib/market/replay-policy').SYNTHETIC_REPLAY_ENABLED, false);
  const originalProfile = JSON.stringify(store.getState().profile);
  for (const id of ['wed-open', 'mon-open', 'tape-2026-10-06', 'unknown']) {
    store.getState().start(id);
    assert.equal(store.getState().engine, null);
    assert.equal(store.getState().phase, 'lobby');
    assert.equal(store.getState().flashOrder, false);
    assert.equal(JSON.stringify(store.getState().profile), originalProfile);
  }
  assert.equal(messages.length, 4);
  assert.ok(messages.every(message => message.includes('真實分鐘 K')));
});

test('hydration disarms an old in-memory scenario without replacing saved history', () => {
  const { store, persistence } = gameStoreFixture({ archivedScenario: false });
  const profile = { ...store.getState().profile, sessions: 3, careerPnl: 1500 };
  persistence.saveProfile(profile);
  store.setState({ phase: 'live', engine: { oldGeneratedEngine: true }, flashOrder: true, paused: false });
  store.getState().hydrate();
  assert.equal(store.getState().phase, 'lobby');
  assert.equal(store.getState().engine, null);
  assert.equal(store.getState().flashOrder, false);
  assert.equal(store.getState().profile.sessions, 3);
  assert.equal(store.getState().profile.careerPnl, 1500);
});
