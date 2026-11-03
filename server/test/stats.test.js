import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calcStats } from '../src/docker.js';

const sample = (over = {}) => ({
  cpu_stats: { cpu_usage: { total_usage: 2_000_000 }, system_cpu_usage: 20_000_000, online_cpus: 4 },
  precpu_stats: { cpu_usage: { total_usage: 1_000_000 }, system_cpu_usage: 10_000_000 },
  memory_stats: { usage: 300, limit: 1000, stats: { inactive_file: 100 } },
  networks: { eth0: { rx_bytes: 10, tx_bytes: 20 }, eth1: { rx_bytes: 5, tx_bytes: 5 } },
  ...over,
});

test('cpu percent uses the delta formula scaled by cores', () => {
  assert.equal(calcStats(sample()).cpu, (1_000_000 / 10_000_000) * 4 * 100);
});

test('memory excludes inactive file cache', () => {
  const s = calcStats(sample());
  assert.equal(s.memUsed, 200);
  assert.equal(s.memLimit, 1000);
});

test('network totals are summed across interfaces', () => {
  const s = calcStats(sample());
  assert.equal(s.netRx, 15);
  assert.equal(s.netTx, 25);
});

test('zero deltas give zero cpu rather than NaN', () => {
  const s = calcStats(sample({ precpu_stats: { cpu_usage: { total_usage: 2_000_000 }, system_cpu_usage: 20_000_000 } }));
  assert.equal(s.cpu, 0);
});

test('handles containers without networks or cache stats', () => {
  const s = calcStats(sample({ networks: undefined, memory_stats: { usage: 50, limit: 100 } }));
  assert.equal(s.netRx, 0);
  assert.equal(s.memUsed, 50);
});
