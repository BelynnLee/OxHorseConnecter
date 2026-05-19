import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchema } from '../packages/storage/src/schema.ts';
import { TelegramRepository } from '../packages/storage/src/repositories/telegram-repo.ts';
import {
  chunkTelegramText,
  escapeMarkdownV2,
  normalizeTelegramCommand,
  stripBotMention,
  threadKeyFromId,
} from '../apps/host/src/services/telegram-utils.ts';

{
  const chunks = chunkTelegramText(`hello\n${'x'.repeat(5000)}`, 4096);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => chunk.length <= 4096));
  assert.equal(escapeMarkdownV2('a_b*c'), 'a\\_b\\*c');
  assert.deepEqual(normalizeTelegramCommand('/model@my_bot gpt-5 high'), {
    name: 'model',
    args: 'gpt-5 high',
  });
  assert.equal(stripBotMention('hello @my_bot', 'my_bot'), 'hello');
  assert.equal(threadKeyFromId(undefined), '');
  assert.equal(threadKeyFromId(1), '');
  assert.equal(threadKeyFromId(42), '42');
}

{
  const db = new Database(':memory:');
  initSchema(db);
  const repo = new TelegramRepository(db);
  const now = '2026-05-13T00:00:00.000Z';

  repo.upsertBinding({
    id: 'binding-1',
    chatId: '100',
    chatType: 'private',
    userId: '200',
    threadKey: '',
    sessionId: 'session-1',
    topicMode: false,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(repo.findBinding({
    chatId: '100',
    chatType: 'private',
    userId: '200',
    threadKey: '',
  })?.sessionId, 'session-1');

  repo.upsertBinding({
    id: 'binding-2',
    chatId: '100',
    chatType: 'private',
    userId: '200',
    threadKey: '',
    sessionId: 'session-2',
    topicMode: false,
    createdAt: now,
    updatedAt: now,
  });
  assert.equal(repo.listBindings({
    chatId: '100',
    chatType: 'private',
    userId: '200',
  }).length, 1);
  assert.equal(repo.findBindingBySession('session-2')?.id, 'binding-1');

  repo.createCallbackToken({
    token: 'token-1',
    kind: 'approval',
    chatId: '100',
    userId: '200',
    sessionId: 'session-2',
    approvalId: 'approval-1',
    action: 'approve',
    expiresAt: '2099-01-01T00:00:00.000Z',
    createdAt: now,
  });
  assert.equal(repo.findCallbackToken('token-1')?.approvalId, 'approval-1');
  repo.resolveCallbackToken('token-1', '2026-05-13T00:01:00.000Z');
  assert.equal(repo.findCallbackToken('token-1')?.resolvedAt, '2026-05-13T00:01:00.000Z');

  assert.equal(repo.acquireGatewayLock({
    name: 'telegram:test',
    keyHash: 'hash',
    ownerId: 'owner-a',
    ttlMs: 10_000,
  }), true);
  assert.equal(repo.acquireGatewayLock({
    name: 'telegram:test',
    keyHash: 'hash',
    ownerId: 'owner-b',
    ttlMs: 10_000,
  }), false);
  repo.releaseGatewayLock('telegram:test', 'owner-a');
  assert.equal(repo.acquireGatewayLock({
    name: 'telegram:test',
    keyHash: 'hash',
    ownerId: 'owner-b',
    ttlMs: 10_000,
  }), true);
}

console.log('telegram gateway tests passed');
