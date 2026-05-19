import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  formatClockTime,
  formatCompactDateTime,
  formatDate,
  formatDateTime,
  formatRelativeTime,
} from '../apps/web/src/lib/format.ts';
import { __test as loggerTest } from '../packages/logger/src/logger.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const webSrc = path.join(repoRoot, 'apps', 'web', 'src');
const sampleIso = '2026-05-17T09:11:48.000Z';
const sampleDate = new Date(sampleIso);

function expectedLocal(options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(undefined, options).format(sampleDate);
}

function walkFiles(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
    } else if (/\.(ts|tsx)$/u.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

{
  assert.equal(
    formatDateTime(sampleIso),
    expectedLocal({
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }),
  );
  assert.equal(
    formatClockTime(sampleIso),
    expectedLocal({ hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  );
  assert.equal(
    formatDate(sampleIso),
    expectedLocal({ year: 'numeric', month: '2-digit', day: '2-digit' }),
  );

  const utcClock = new Intl.DateTimeFormat(undefined, {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(sampleDate);
  if (sampleDate.getTimezoneOffset() !== 0) {
    assert.notEqual(formatClockTime(sampleIso), utcClock);
  }

  assert.doesNotMatch(formatDateTime(sampleIso), /T09:11:48|Z/u);
  assert.equal(formatDateTime('not-a-date'), 'not-a-date');
  assert.equal(formatDateTime(null), '-');
}

{
  const now = new Date('2026-05-17T09:12:00.000Z');
  assert.equal(
    formatCompactDateTime(sampleIso, undefined, now),
    new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(sampleDate),
  );

  const olderIso = '2026-05-15T09:11:48.000Z';
  const olderDate = new Date(olderIso);
  assert.equal(
    formatCompactDateTime(olderIso, undefined, now),
    new Intl.DateTimeFormat(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(olderDate),
  );
}

{
  const nowMs = Date.parse('2026-05-17T09:11:48.000Z');
  assert.equal(
    formatRelativeTime('2026-05-17T09:10:48.000Z', 'en', nowMs),
    new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' }).format(-1, 'minute'),
  );
}

{
  const formatted = loggerTest.formatLocalIsoTime(sampleDate);
  assert.match(formatted, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/u);
  assert.equal(loggerTest.prettyTranslateTime, 'SYS:HH:MM:ss');
  if (sampleDate.getTimezoneOffset() !== 0) {
    assert.notEqual(formatted, sampleDate.toISOString());
  }
}

{
  const forbiddenPattern = /\b(?:new Intl\.DateTimeFormat|toLocaleTimeString|toLocaleDateString)\b/u;
  const allowed = path.normalize(path.join(webSrc, 'lib', 'format.ts'));
  const offenders = walkFiles(webSrc)
    .filter((file) => path.normalize(file) !== allowed)
    .filter((file) => forbiddenPattern.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(repoRoot, file));

  assert.deepEqual(offenders, [], 'time display formatting must go through apps/web/src/lib/format.ts');
}

console.log(`time format tests passed in ${Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'local'} timezone.`);
