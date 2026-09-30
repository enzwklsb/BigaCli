// Public submission only. Read feedback privately in Cloudflare D1 Studio.
const headers = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const json = (body, status = 200) => Response.json(body, { status, headers });

export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== '/api/feedback') return json({ error: 'not_found' }, 404);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    if (!request.headers.get('Content-Type')?.includes('application/json')) return json({ error: 'invalid_request' }, 415);
    let data;
    try {
      const reader = request.body?.getReader();
      if (!reader) return json({ error: 'invalid_request' }, 400);
      const chunks = []; let size = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 65536) { await reader.cancel(); return json({ error: 'too_large' }, 413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      data = JSON.parse(new TextDecoder().decode(bytes));
    } catch { return json({ error: 'invalid_request' }, 400); }
    if (!data || typeof data.content !== 'string' || !data.content.trim() || data.content.length > 10000 ||
      typeof data.id !== 'string' || !/^[a-zA-Z0-9-]{16,80}$/.test(data.id)) return json({ error: 'invalid_request' }, 400);
    try {
      const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(new Date().toISOString().slice(0, 10) + ':' + ip));
      const sender = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
      // Retry after a lost response must not create a second report.
      const existing = await env.DB.prepare('SELECT id FROM feedback WHERE id = ?').bind(data.id).first();
      if (existing) return json({ ok: true });
      const result = await env.DB.prepare(`INSERT OR IGNORE INTO feedback(id, content, sender_hash)
        SELECT ?, ?, ? WHERE (SELECT COUNT(*) FROM feedback WHERE sender_hash = ?
        AND created_at > strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) < 20`)
        .bind(data.id, data.content.trim(), sender, sender).run();
      if (!result.meta.changes) return json({ error: 'too_many_requests' }, 429);
      return json({ ok: true }, 201);
    } catch { return json({ error: 'unavailable' }, 503); }
  },
};
