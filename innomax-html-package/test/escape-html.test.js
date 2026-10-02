// The browser helper every innerHTML template now goes through.
const fs = require('fs');
const vm = require('vm');

const window = {};
vm.runInNewContext(fs.readFileSync(require.resolve('../assets/js/escape-html.js'), 'utf8'), { window });
const { escapeHtml, safeUrl } = window;

describe('escapeHtml', () => {
  it('neutralises markup and attribute breakouts', () => {
    expect(escapeHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
    expect(escapeHtml(`" onmouseover='x' \``)).toBe('&quot; onmouseover=&#39;x&#39; &#96;');
    expect(escapeHtml('Pandora & Co')).toBe('Pandora &amp; Co');
  });
  it('renders null and undefined as empty, numbers as text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42)).toBe('42');
  });
});

describe('safeUrl', () => {
  it.each(['https://x.supabase.co/a.png', '/assets/img/a.webp', 'assets/img/a.webp', 'mailto:a@b.c', 'photo.png'])('keeps %s', (u) => {
    expect(safeUrl(u)).toBe(escapeHtml(u));
  });
  it.each(['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,<script>', 'vbscript:x'])('drops %s', (u) => {
    expect(safeUrl(u)).toBe('#');
  });
});
