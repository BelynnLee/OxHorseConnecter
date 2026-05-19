import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rac-log-test-${prefix}-`));
}

async function main(): Promise<void> {
  const { installFileLogger, flushFileLogger, __test } = await import(
    '../apps/host/src/services/log-file.ts'
  );

  // dailyPath uses .log default extension when filename has none
  {
    const dir = tmpDir('daily');
    try {
      const withExt = __test.dailyPath(dir, 'rac-host.log', '2026-05-09');
      assert.equal(path.basename(withExt), 'rac-host.2026-05-09.log');
      const noExt = __test.dailyPath(dir, 'rac-host', '2026-05-09');
      assert.equal(path.basename(noExt), 'rac-host.2026-05-09.log');
      const customExt = __test.dailyPath(dir, 'service.out', '2026-05-09');
      assert.equal(path.basename(customExt), 'service.2026-05-09.out');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // todayStamp uses the process local date, not the UTC ISO calendar day
  {
    const boundary = new Date('2026-05-17T00:30:00+08:00');
    const expected = `${boundary.getFullYear()}-${String(boundary.getMonth() + 1).padStart(2, '0')}-${String(
      boundary.getDate()
    ).padStart(2, '0')}`;

    assert.equal(__test.todayStamp(boundary), expected);
    if (boundary.getTimezoneOffset() !== 0 && expected !== boundary.toISOString().slice(0, 10)) {
      assert.notEqual(__test.todayStamp(boundary), boundary.toISOString().slice(0, 10));
    }
  }

  // installFileLogger creates the directory and tees stdout writes
  {
    __test.reset();
    const dir = tmpDir('install');
    const logPath = path.join(dir, 'nested', 'host.log');
    try {
      installFileLogger({ filePath: logPath, keepDays: 30 });
      const stamp = __test.todayStamp();
      const expectedFile = path.join(dir, 'nested', `host.${stamp}.log`);

      process.stdout.write('hello\n');
      process.stderr.write('warn\n');

      await flushFileLogger();
      const content = fs.readFileSync(expectedFile, 'utf8');
      assert.match(content, /hello/);
      assert.match(content, /warn/);
    } finally {
      __test.reset();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // pruneOldLogs removes files older than keepDays but keeps recent ones
  {
    const dir = tmpDir('prune');
    try {
      const oldFile = path.join(dir, 'app.2020-01-01.log');
      const recentFile = path.join(dir, `app.${__test.todayStamp()}.log`);
      const unrelated = path.join(dir, 'unrelated.log');
      fs.writeFileSync(oldFile, 'old');
      fs.writeFileSync(recentFile, 'new');
      fs.writeFileSync(unrelated, 'keep');

      // Backdate the old file
      const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      fs.utimesSync(oldFile, oldDate, oldDate);

      __test.pruneOldLogs(dir, 'app.log', 7);

      assert.equal(fs.existsSync(oldFile), false, 'old file should be pruned');
      assert.equal(fs.existsSync(recentFile), true, 'recent file should be kept');
      assert.equal(fs.existsSync(unrelated), true, 'unrelated file should be untouched');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // pruneOldLogs with keepDays<=0 is a no-op
  {
    const dir = tmpDir('prune-zero');
    try {
      const file = path.join(dir, 'app.2020-01-01.log');
      fs.writeFileSync(file, 'data');
      const oldDate = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      fs.utimesSync(file, oldDate, oldDate);

      __test.pruneOldLogs(dir, 'app.log', 0);
      assert.equal(fs.existsSync(file), true, 'keepDays=0 should disable pruning');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // flushFileLogger is safe when no logger was installed
  {
    __test.reset();
    await flushFileLogger();
    // no assertion — should not throw
  }

  console.log('log-file tests passed.');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
