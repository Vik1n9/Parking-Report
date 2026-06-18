const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'guard.html'), 'utf8');

assert.equal(html.includes('目前區域'), false);
assert.equal(html.includes('id="entryModeLabel"'), false);
assert.equal(html.includes('id="currentZoneName"'), false);
assert.equal(html.includes('id="currentZoneType"'), false);
assert.equal(html.includes('id="rawValue"'), false);
assert.equal(html.includes('id="statusValue"'), false);
assert.equal(html.includes('class="current-zone"'), false);
assert.equal(html.includes('class="value-display"'), false);

console.log('guard UI tests passed');
