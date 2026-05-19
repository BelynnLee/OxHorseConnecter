// Remote Agent Console - Baseline Load Test
//
// Hits the public API endpoints with concurrent requests and prints latency
// percentiles. Establishes a baseline for capacity planning.
//
// Usage:
//   node scripts/load-test.mjs                                    # Default: localhost, 30s, 10 concurrency
//   node scripts/load-test.mjs --url http://127.0.0.1:3001       # Target URL
//   node scripts/load-test.mjs --duration 60 --concurrency 50    # Heavier load
//   node scripts/load-test.mjs --token <jwt>                     # Auth-required endpoints
//
// Tests these endpoints:
//   - GET /api/health   (no auth)
//   - GET /api/sessions (auth, optional)
//
// Note: This is intentionally simple — no external deps. For more rigorous
// load testing, use k6 (k6.io) or autocannon with a real auth flow.

import { performance } from 'node:perf_hooks';
import { argv } from 'node:process';

const DEFAULTS = {
  url: 'http://127.0.0.1:3001',
  duration: 30,
  concurrency: 10,
  token: '',
};

function fail(message) {
  console.error(`load-test: ${message}`);
  process.exit(2);
}

function parseArgs() {
  const args = { ...DEFAULTS };
  for (let i = 2; i < argv.length; i += 2) {
    const raw = argv[i];
    if (!raw.startsWith('--')) fail(`unexpected argument: ${raw}`);
    const key = raw.slice(2);
    const value = argv[i + 1];
    if (value === undefined) fail(`--${key} requires a value`);
    if (!(key in args)) fail(`unknown option: --${key}`);
    if (key === 'duration' || key === 'concurrency') {
      const num = Number(value);
      if (!Number.isFinite(num) || num <= 0) fail(`--${key} must be a positive number, got: ${value}`);
      args[key] = num;
    } else {
      args[key] = value;
    }
  }
  return args;
}

async function probeEndpoint(url, headers, latencies, errors) {
  const start = performance.now();
  try {
    const res = await fetch(url, { headers });
    const elapsed = performance.now() - start;
    if (res.ok) {
      latencies.push(elapsed);
    } else {
      errors.push(`${res.status} ${url}`);
    }
    // Drain body
    await res.arrayBuffer();
  } catch (err) {
    errors.push(`${err.code || 'ERR'} ${url}: ${err.message}`);
  }
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100));
  return sorted[idx];
}

function summarize(name, latencies, errors, durationSec) {
  const sorted = [...latencies].sort((a, b) => a - b);
  const total = latencies.length + errors.length;
  const rps = (total / durationSec).toFixed(1);
  const p50 = percentile(sorted, 50).toFixed(1);
  const p95 = percentile(sorted, 95).toFixed(1);
  const p99 = percentile(sorted, 99).toFixed(1);
  const max = sorted.length ? sorted[sorted.length - 1].toFixed(1) : '0.0';
  const errPct = total > 0 ? ((errors.length / total) * 100).toFixed(2) : '0.00';

  console.log(`\n=== ${name} ===`);
  console.log(`  Requests/sec : ${rps}`);
  console.log(`  Total requests : ${total}`);
  console.log(`  Errors : ${errors.length} (${errPct}%)`);
  console.log(`  Latency p50 : ${p50} ms`);
  console.log(`  Latency p95 : ${p95} ms`);
  console.log(`  Latency p99 : ${p99} ms`);
  console.log(`  Latency max : ${max} ms`);
  if (errors.length > 0 && errors.length <= 5) {
    console.log(`  Sample errors :`);
    errors.slice(0, 5).forEach((e) => console.log(`    - ${e}`));
  } else if (errors.length > 5) {
    const sample = errors.slice(0, 3);
    console.log(`  First 3 errors :`);
    sample.forEach((e) => console.log(`    - ${e}`));
  }
}

async function runScenario(name, url, headers, args) {
  const latencies = [];
  const errors = [];
  const start = Date.now();
  const endTime = start + args.duration * 1000;

  console.log(`Running ${name} for ${args.duration}s with ${args.concurrency} concurrency...`);

  const workers = Array.from({ length: args.concurrency }, async () => {
    while (Date.now() < endTime) {
      await probeEndpoint(url, headers, latencies, errors);
    }
  });
  await Promise.all(workers);

  const elapsed = (Date.now() - start) / 1000;
  summarize(name, latencies, errors, elapsed);
}

async function main() {
  const args = parseArgs();
  console.log(`Target : ${args.url}`);
  console.log(`Duration : ${args.duration}s`);
  console.log(`Concurrency : ${args.concurrency}`);

  // Health endpoint — no auth
  await runScenario('GET /api/health', `${args.url}/api/health`, {}, args);

  // Sessions list — auth required (optional)
  if (args.token) {
    await runScenario(
      'GET /api/sessions',
      `${args.url}/api/sessions`,
      { Authorization: `Bearer ${args.token}` },
      args,
    );
  } else {
    console.log('\nSkipping authenticated endpoints (pass --token <jwt> to include).');
  }

  console.log('\nLoad test complete.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
