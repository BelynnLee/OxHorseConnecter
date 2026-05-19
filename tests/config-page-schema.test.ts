import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function uniq<T>(items: Iterable<T>): T[] {
  return Array.from(new Set(items));
}

function extractEnvKeys(source: string): string[] {
  const matches = [
    ...source.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)(?![A-Za-z0-9_])/g),
    ...source.matchAll(/import\.meta\.env\.([A-Z][A-Z0-9_]*)(?![A-Za-z0-9_])/g),
    ...source.matchAll(/\benv\.([A-Z][A-Z0-9_]*)(?![A-Za-z0-9_])/g),
  ];
  return uniq(Array.from(matches, (match) => match[1]));
}

function extractEnvExampleKeys(source: string): string[] {
  return uniq(
    source
      .split(/\r?\n/)
      .map((line) => line.match(/^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=/)?.[1])
      .filter((key): key is string => Boolean(key))
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const CONFIG_ENV_IGNORES = new Set<string>([
  // Derived package metadata and process/system values.
  'npm_package_version',
  'PATH',
  'PATHEXT',
  'SHELL',
  'HOME',
  'USERPROFILE',
  'NO_COLOR',
  'FORCE_COLOR',
  // Test/smoke toggles are intentionally not part of the runtime config page.
  'REAL_PROVIDER_SMOKE',
  'REAL_PROVIDER',
  'REAL_PROVIDER_SMOKE_TIMEOUT_MS',
  'REAL_PROVIDER_SMOKE_CANCEL_DELAY_MS',
  'REAL_PROVIDER_SMOKE_KEEP_TMP',
]);

const ENV_EXAMPLE_IGNORES = new Set<string>([...CONFIG_ENV_IGNORES]);

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      result.push(...(await listSourceFiles(fullPath)));
      continue;
    }
    if (/\.(ts|tsx|js|mjs)$/.test(entry.name)) {
      result.push(fullPath);
    }
  }
  return result;
}

async function extractEnvKeysFromPaths(paths: string[]): Promise<Set<string>> {
  const keys = new Set<string>();
  for (const itemPath of paths) {
    const stat = await fs.stat(itemPath);
    const files = stat.isDirectory() ? await listSourceFiles(itemPath) : [itemPath];
    for (const file of files) {
      const source = await fs.readFile(file, 'utf8');
      for (const key of extractEnvKeys(source)) {
        keys.add(key);
      }
    }
  }
  return keys;
}

async function assertNoRealWorkbenchPathLiterals(repoRoot: string): Promise<void> {
  const scanRoot = path.join(repoRoot, 'apps/web/src');
  const files = (await listSourceFiles(scanRoot)).filter(
    (file) => !file.endsWith(path.join('workbench-v2', 'mockAgentWorkbenchApi.ts'))
  );
  const offenders: string[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, 'utf8');
    if (/E:\\\\ox|E:\/ox/.test(source)) {
      offenders.push(path.relative(repoRoot, file));
    }
  }
  if (offenders.length > 0) {
    throw new Error(
      `Real app code contains hard-coded local workspace paths: ${offenders.join(', ')}`
    );
  }
}

async function main(): Promise<void> {
  // Avoid noisy startup warnings if any config modules are imported during this check.
  if (!process.env.PROVIDER_SECRET_KEY) {
    process.env.PROVIDER_SECRET_KEY = 'a'.repeat(64);
  }
  if (!process.env.JWT_SECRET) {
    process.env.JWT_SECRET = 'j'.repeat(64);
  }
  if (!process.env.ADMIN_PASSWORD) {
    process.env.ADMIN_PASSWORD = 'ConfigSchemaPassword-2026!';
  }

  const { CONFIG_FIELDS, CONFIG_FIELD_BY_KEY } =
    await import('../apps/host/src/routes/config-fields.ts');
  const { normalizeValue, validateEffectiveConfig } =
    await import('../apps/host/src/routes/config-state.ts');
  const { envPath, workspaceRoot } = await import('../apps/host/src/services/env-path.ts');

  assert.equal(workspaceRoot, repoRoot);
  assert.equal(envPath, path.join(repoRoot, '.env'));

  await assertNoRealWorkbenchPathLiterals(repoRoot);

  const envKeys = await extractEnvKeysFromPaths([
    path.join(repoRoot, 'apps/host/src'),
    path.join(repoRoot, 'apps/web/src/api/client.ts'),
    path.join(repoRoot, 'packages/logger/src'),
    path.join(repoRoot, 'packages/security/src'),
    path.join(repoRoot, 'packages/executors/src'),
  ]);

  const fieldKeys = new Set(CONFIG_FIELDS.map((field) => field.key));
  const field = (key: string) => {
    const value = CONFIG_FIELD_BY_KEY.get(key);
    if (!value) throw new Error(`Missing config field: ${key}`);
    return value;
  };

  assert.equal(
    normalizeValue(field('PUBLIC_BASE_URL'), 'http://console.example.com'),
    'http://console.example.com'
  );
  assert.throws(
    () => normalizeValue(field('PUBLIC_BASE_URL'), 'ws://console.example.com'),
    /PUBLIC_BASE_URL must be a valid http\(s\) URL/
  );
  assert.equal(normalizeValue(field('VITE_WS_URL'), 'ws://127.0.0.1:3001'), 'ws://127.0.0.1:3001');
  assert.equal(
    normalizeValue(field('VITE_WS_URL'), 'wss://console.example.com'),
    'wss://console.example.com'
  );
  assert.throws(
    () => normalizeValue(field('VITE_WS_URL'), 'http://127.0.0.1:3001'),
    /VITE_WS_URL must be a valid ws\(s\) URL/
  );

  const unusedFields = CONFIG_FIELDS.map((field) => field.key).filter((key) => !envKeys.has(key));

  const missingFields = Array.from(envKeys)
    .filter((key) => !fieldKeys.has(key) && !CONFIG_ENV_IGNORES.has(key))
    .sort();
  const envExamplePath = path.join(repoRoot, '.env.example');
  const envExampleSource = await fs.readFile(envExamplePath, 'utf8');
  const envExampleKeys = extractEnvExampleKeys(envExampleSource);
  const missingExampleFields = envExampleKeys
    .filter((key) => !fieldKeys.has(key) && !ENV_EXAMPLE_IGNORES.has(key))
    .sort();

  if (unusedFields.length > 0) {
    throw new Error(
      `Config fields include keys not referenced by runtime source files: ${unusedFields.join(', ')}`
    );
  }

  if (missingFields.length > 0) {
    throw new Error(
      `Runtime source files reference env keys missing from /api/config schema: ${missingFields.join(', ')}`
    );
  }

  if (missingExampleFields.length > 0) {
    throw new Error(
      `.env.example includes host config keys missing from /api/config schema: ${missingExampleFields.join(', ')}`
    );
  }

  const originalEnv = { ...process.env };
  try {
    process.env.NODE_ENV = 'production';
    delete process.env.REQUIRE_HTTPS;
    delete process.env.AGENT_SECURITY_PROFILE;
    delete process.env.JWT_SECRET;
    delete process.env.ADMIN_PASSWORD;
    delete process.env.REMOTE_REGISTRATION_TOKEN;
    delete process.env.PROVIDER_SECRET_KEY;
    delete process.env.ALLOWED_WORK_DIR;
    delete process.env.ALLOW_QUERY_TOKEN_AUTH;
    delete process.env.CODEX_FULL_AUTO;
    delete process.env.CLAUDE_CODE_SKIP_PERMISSIONS;

    assert.throws(
      () =>
        validateEffectiveConfig({
          PUBLIC_BASE_URL: 'http://console.example.com',
          REQUIRE_HTTPS: 'true',
          AGENT_SECURITY_PROFILE: 'strict',
          JWT_SECRET: 'j'.repeat(32),
          ADMIN_PASSWORD: 'AdminPassword-2026!',
          REMOTE_REGISTRATION_TOKEN: 'r'.repeat(32),
          PROVIDER_SECRET_KEY: 'p'.repeat(32),
        }),
      /PUBLIC_BASE_URL must use https/
    );

    assert.throws(
      () =>
        validateEffectiveConfig({
          PUBLIC_BASE_URL: 'https://console.example.com',
          REQUIRE_HTTPS: 'true',
          AGENT_SECURITY_PROFILE: 'strict',
          JWT_SECRET: 'short',
          ADMIN_PASSWORD: 'AdminPassword-2026!',
          REMOTE_REGISTRATION_TOKEN: 'r'.repeat(32),
          PROVIDER_SECRET_KEY: 'p'.repeat(32),
        }),
      /JWT_SECRET must be at least 32 characters/
    );

    assert.throws(
      () =>
        validateEffectiveConfig({
          PUBLIC_BASE_URL: 'https://console.example.com',
          REQUIRE_HTTPS: 'true',
          AGENT_SECURITY_PROFILE: 'strict',
          JWT_SECRET: 'j'.repeat(32),
          ADMIN_PASSWORD: 'AdminPassword-2026!',
          REMOTE_REGISTRATION_TOKEN: 'r'.repeat(32),
          PROVIDER_SECRET_KEY: 'p'.repeat(32),
        }),
      /ALLOWED_WORK_DIR is required/
    );

    assert.throws(
      () =>
        validateEffectiveConfig({
          PUBLIC_BASE_URL: 'https://console.example.com',
          REQUIRE_HTTPS: 'true',
          AGENT_SECURITY_PROFILE: 'strict',
          JWT_SECRET: 'j'.repeat(32),
          ADMIN_PASSWORD: 'AdminPassword-2026!',
          REMOTE_REGISTRATION_TOKEN: 'r'.repeat(32),
          PROVIDER_SECRET_KEY: 'p'.repeat(32),
          ALLOWED_WORK_DIR: repoRoot,
          ALLOW_QUERY_TOKEN_AUTH: 'true',
        }),
      /ALLOW_QUERY_TOKEN_AUTH cannot be enabled/
    );

    assert.throws(
      () =>
        validateEffectiveConfig({
          PUBLIC_BASE_URL: 'https://console.example.com',
          REQUIRE_HTTPS: 'true',
          AGENT_SECURITY_PROFILE: 'strict',
          JWT_SECRET: 'j'.repeat(32),
          ADMIN_PASSWORD: 'AdminPassword-2026!',
          REMOTE_REGISTRATION_TOKEN: 'r'.repeat(32),
          PROVIDER_SECRET_KEY: 'p'.repeat(32),
          ALLOWED_WORK_DIR: repoRoot,
          CODEX_FULL_AUTO: 'true',
        }),
      /CODEX_FULL_AUTO cannot be enabled/
    );

    assert.throws(
      () =>
        validateEffectiveConfig({
          PUBLIC_BASE_URL: 'https://console.example.com',
          REQUIRE_HTTPS: 'true',
          AGENT_SECURITY_PROFILE: 'strict',
          JWT_SECRET: 'j'.repeat(32),
          ADMIN_PASSWORD: 'AdminPassword-2026!',
          REMOTE_REGISTRATION_TOKEN: 'r'.repeat(32),
          PROVIDER_SECRET_KEY: 'p'.repeat(32),
          ALLOWED_WORK_DIR: repoRoot,
          CLAUDE_CODE_SKIP_PERMISSIONS: 'true',
        }),
      /CLAUDE_CODE_SKIP_PERMISSIONS cannot be enabled/
    );

    assert.doesNotThrow(() =>
      validateEffectiveConfig({
        PUBLIC_BASE_URL: 'https://console.example.com',
        REQUIRE_HTTPS: 'true',
        AGENT_SECURITY_PROFILE: 'strict',
        JWT_SECRET: 'j'.repeat(32),
        ADMIN_PASSWORD: 'AdminPassword-2026!',
        REMOTE_REGISTRATION_TOKEN: 'r'.repeat(32),
        PROVIDER_SECRET_KEY: 'p'.repeat(32),
        ALLOWED_WORK_DIR: repoRoot,
        CODEX_FULL_AUTO: 'false',
        CLAUDE_CODE_SKIP_PERMISSIONS: 'false',
      })
    );
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
  }

  console.log('[config-page-schema] ok');
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
