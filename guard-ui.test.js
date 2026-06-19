const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, 'guard.html'), 'utf8');

assert.match(html, /<link rel="icon" href="data:,">/);

assert.equal(html.includes('目前區域'), false);
assert.equal(html.includes('id="entryModeLabel"'), false);
assert.equal(html.includes('id="currentZoneName"'), false);
assert.equal(html.includes('id="currentZoneType"'), false);
assert.equal(html.includes('id="rawValue"'), false);
assert.equal(html.includes('id="statusValue"'), false);
assert.equal(html.includes('class="current-zone"'), false);
assert.equal(html.includes('class="value-display"'), false);

assert.match(html, /class="card order-card"/);
assert.match(html, /class="card input-card"/);
assert.match(html, /class="card secondary-card"/);
assert.match(html, /@media\(max-height:880px\) and \(max-width:440px\)/);
assert.match(html, /\.fn-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
assert.match(html, /\.share\{grid-column:auto/);
assert.match(html, /\.secondary-card\{display:none\}/);
assert.equal(html.includes('id="emptyBtn"'), false);
assert.match(html, /function markFull\(\)/);
assert.match(html, /text:'全滿'/);
assert.match(html, /text:'未停車'/);
assert.match(
  html,
  /text:'全滿'[\s\S]+text:'0'[\s\S]+text:'未停車'/
);

assert.match(html, /--bg:#f3f7fb/);
assert.match(html, /--text:#07111f/);
assert.match(html, /--sub:#172033/);
assert.match(html, /--border:#172033/);
assert.match(html, /--surface:#ffffff/);
assert.match(html, /--key-bg:#ffffff/);
assert.match(html, /--key-ink:#07111f/);
assert.match(html, /--calc:'Avenir Next','Arial Rounded MT Bold','Helvetica Neue','PingFang TC','Microsoft JhengHei',sans-serif/);
assert.equal(html.includes('--bg:#0d1720'), false);
assert.equal(html.includes('backdrop-filter:blur'), false);
assert.match(html, /\.key:focus-visible,\s*\.fn-btn:focus-visible,\s*\.bottom-btn:focus-visible/);
assert.match(html, /\.zone-chip\.active\{[\s\S]*box-shadow:0 0 0 3px var\(--focus\)/);
assert.match(html, /@media\(prefers-contrast:more\)/);
assert.match(html, /\.key\{[\s\S]*background:var\(--key-bg\);[\s\S]*color:var\(--key-ink\);[\s\S]*font-family:var\(--calc\);[\s\S]*font-size:1\.75rem/);
assert.match(html, /\.key\.action-key\{[\s\S]*font-family:var\(--sans\);[\s\S]*font-size:1rem/);
assert.match(html, /\.key\.full-key,\s*\.key\.empty-key\{[\s\S]*background:var\(--key-bg\);[\s\S]*color:var\(--key-ink\);[\s\S]*border-color:var\(--border\)/);
assert.equal(html.includes('.key.full-key{color:#5a0c07'), false);
assert.equal(html.includes('.key.empty-key{color:var(--text);background:var(--surface3)}'), false);

console.log('guard UI tests passed');
