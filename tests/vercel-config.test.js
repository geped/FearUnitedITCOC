const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Vercel function rules name distinct existing endpoints and preserve dataset bundling', () => {
    const root = path.resolve(__dirname, '..');
    const config = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
    const endpoints = fs.readdirSync(path.join(root, 'api'))
        .filter(name => name.endsWith('.js')).map(name => `api/${name}`);
    endpoints.push('api/admin/users.js');
    assert.deepEqual(Object.keys(config.functions).sort(), endpoints.sort());
    for (const name of Object.keys(config.functions)) {
        assert.equal(fs.statSync(path.join(root, name)).isFile(), true);
        assert.equal(config.functions[name].maxDuration, 60);
    }
    assert.equal(config.functions['api/lookup.js'].includeFiles, 'data/coc-village/**');
});
