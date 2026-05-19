import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';

async function main(): Promise<void> {
  process.env.JWT_SECRET = process.env.JWT_SECRET ?? 'j'.repeat(64);
  process.env.PROVIDER_SECRET_KEY = process.env.PROVIDER_SECRET_KEY ?? 'p'.repeat(64);
  process.env.ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'NativeTerminalAuthPassword-2026!';
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:3000';
  process.env.CORS_ORIGINS = 'http://127.0.0.1:3000,http://localhost:5173';

  const { originAllowed, parseCookieHeader, requestIsHttps, requestUrl } =
    await import('../apps/host/src/services/native-terminal-auth.ts');

  assert.deepEqual(Array.from(parseCookieHeader('rac_auth=hello%20world; theme=dark').entries()), [
    ['rac_auth', 'hello world'],
    ['theme', 'dark'],
  ]);

  assert.equal(originAllowed(undefined), true);
  assert.equal(originAllowed('http://127.0.0.1:3000'), true);
  assert.equal(originAllowed('http://localhost:5173'), true);
  assert.equal(originAllowed('http://evil.test'), false);

  assert.equal(
    requestUrl({
      url: '/api/agent/native-terminal?provider=codex',
    } as IncomingMessage).searchParams.get('provider'),
    'codex'
  );
  assert.equal(
    requestIsHttps({
      headers: { 'x-forwarded-proto': 'https,http' },
      socket: {},
    } as IncomingMessage),
    true
  );
}

main().then(() => console.log('native terminal auth tests passed'));
