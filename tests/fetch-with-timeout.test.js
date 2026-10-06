const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { createBoundedFetch } = require('../shared/fetch-with-timeout');

test('outbound deadline cancels a stalled response body', async () => {
    const server = http.createServer((req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.write('{');
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        await assert.rejects(async () => {
            const response = await createBoundedFetch(100)(`http://127.0.0.1:${server.address().port}`);
            await response.json();
        }, err => ['TimeoutError', 'AbortError'].includes(err.name));
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
});

test('caller cancellation and request options are preserved', async () => {
    const previous = globalThis.fetch;
    const controller = new AbortController();
    try {
        globalThis.fetch = async (url, options) => {
            assert.equal(options.method, 'POST');
            assert.equal(options.body, 'payload');
            controller.abort();
            assert.equal(options.signal.aborted, true);
            return 'ok';
        };
        assert.equal(await createBoundedFetch(1000)('https://example.test', {
            method: 'POST', body: 'payload', signal: controller.signal,
        }), 'ok');
    } finally { globalThis.fetch = previous; }
});

test('scheduled war save accepts authenticated GET and reports upstream HTTP failures', async () => {
    const handler = require('../api/auto-save-wars');
    const previous = globalThis.fetch;
    const oldSecret = process.env.CRON_SECRET;
    const oldUrl = process.env.RENDER_PROXY_URL;
    process.env.CRON_SECRET = 'test-secret';
    process.env.RENDER_PROXY_URL = 'https://example.test';
    try {
        globalThis.fetch = async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 });
        const res = { status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
        await handler({ method: 'GET', headers: { authorization: 'Bearer test-secret' }, query: {} }, res);
        assert.equal(res.code, 502);
        assert.equal(res.body.classic.error, 'unavailable');
    } finally {
        globalThis.fetch = previous;
        for (const [key, value] of [['CRON_SECRET', oldSecret], ['RENDER_PROXY_URL', oldUrl]]) {
            if (value === undefined) delete process.env[key]; else process.env[key] = value;
        }
    }
});
