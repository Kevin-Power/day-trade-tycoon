import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveHostingRuntime } from './runtime-path.mjs';

test('default runtime uses the stable user-profile directory, independent of MSIX LocalAppData', () => {
  const profile = join(tmpdir(), 'fixture-user-profile');
  for (const service of ['DayTradeTycoon', 'RichmanAcademy']) {
    const expected = resolve(profile, 'YilutekServices', service);
    assert.equal(resolveHostingRuntime(service, [], { USERPROFILE: profile, LOCALAPPDATA: join(profile, 'virtualized-appdata') }), expected);
    assert.equal(resolveHostingRuntime(service, [], { USERPROFILE: profile, LOCALAPPDATA: join(profile, 'outside-appdata') }), expected);
  }
});

test('explicit runtime remains authoritative without requiring a user profile', () => {
  const explicit = join(tmpdir(), 'isolated-host-fixture');
  assert.equal(resolveHostingRuntime('DayTradeTycoon', ['node', 'supervisor', 'status', '--runtime', explicit], {}), resolve(explicit));
  assert.equal(resolveHostingRuntime('RichmanAcademy', ['node', 'supervisor', 'stage', '--runtime', explicit], { USERPROFILE: 'ignored' }), resolve(explicit));
});

test('missing runtime argument and missing profile fail closed', () => {
  assert.throws(() => resolveHostingRuntime('DayTradeTycoon', ['--runtime'], {}), /requires a directory/);
  assert.throws(() => resolveHostingRuntime('DayTradeTycoon', ['--runtime', '--source'], {}), /requires a directory/);
  assert.throws(() => resolveHostingRuntime('DayTradeTycoon', [], {}), /USERPROFILE is unavailable/);
});
