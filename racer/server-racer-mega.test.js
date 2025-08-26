import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';

async function startServer(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  return { server, port };
}

test('debug credit route credits balance for admin', async () => {
  process.env.NODE_ENV = 'test';
  process.env.SQLITE_PATH = ':memory:';
  process.env.ADMIN_IDS = '1';
  const { default: router } = await import('./server-racer-mega.js?admin');
  const { server, port } = await startServer(router);
  const res = await fetch(`http://127.0.0.1:${port}/api/racer/debug/credit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tg-id': '1',
      'x-admin': '1'
    },
    body: JSON.stringify({ amount: 5 })
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.balance, 5);
  server.close();
});

test('debug credit route rejects non-admin', async () => {
  process.env.NODE_ENV = 'test';
  process.env.SQLITE_PATH = ':memory:';
  process.env.ADMIN_IDS = '1';
  const { default: router } = await import('./server-racer-mega.js?nonadmin');
  const { server, port } = await startServer(router);
  const res = await fetch(`http://127.0.0.1:${port}/api/racer/debug/credit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tg-id': '2'
    },
    body: JSON.stringify({ amount: 5 })
  });
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.equal(body.error, 'NO_ADMIN');
  server.close();
});

test('debug credit route not available in production', async () => {
  process.env.NODE_ENV = 'production';
  process.env.SQLITE_PATH = ':memory:';
  const { default: router } = await import('./server-racer-mega.js?prod');
  const { server, port } = await startServer(router);
  const res = await fetch(`http://127.0.0.1:${port}/api/racer/debug/credit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-tg-id': '1',
      'x-admin': '1'
    },
    body: JSON.stringify({ amount: 5 })
  });
  assert.equal(res.status, 404);
  server.close();
});

