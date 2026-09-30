import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import worker from './worker.mjs';
const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const env = { DB: { prepare(sql) { return { bind(...params) { const stmt = db.prepare(sql); return {
  first: async () => stmt.get(...params), run: async () => ({ meta: stmt.run(...params) }),
}; } }; } } };
const send = (data, method = 'POST') => worker.fetch(new Request('https://test/api/feedback', {
  method, headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '127.0.0.1' },
  ...(method === 'POST' ? { body: JSON.stringify(data) } : {}),
}), env);
const report = { id: 'feedback-test-0001', content: "日本語 / 中文 / English <script>alert('x')</script>" };
assert.equal((await send(report)).status, 201);
assert.equal((await send(report)).status, 200);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM feedback').get().n, 1);
assert.equal(db.prepare('SELECT content FROM feedback').get().content, report.content);
assert.equal((await send({}, 'GET')).status, 405);
assert.equal((await send({}, 'OPTIONS')).headers.get('Access-Control-Allow-Origin'), '*');
assert.equal((await send({ ...report, content: '' })).status, 400);
assert.equal((await send({ ...report, content: 'a'.repeat(10001) })).status, 400);
for (let n = 2; n <= 20; n++) assert.equal((await send({ ...report, id: 'feedback-test-' + String(n).padStart(4, '0') })).status, 201);
assert.equal((await send({ ...report, id: 'feedback-test-0021' })).status, 429);
assert.equal((await worker.fetch(new Request('https://test/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(report) }), {})).status, 503);
db.close();
console.log('Feedback: save, retry deduplication, private reads, validation, throttling and DB failure passed.');
