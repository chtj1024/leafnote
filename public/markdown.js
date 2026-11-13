(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Markdown = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  function normalizeColor(value) {
    const s = String(value || '').trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(s)) return s;
    if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map(c => c + c).join('');
    const m = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
    if (m && m.slice(1).every(n => Number(n) <= 255)) return '#' + m.slice(1).map(n => Number(n).toString(16).padStart(2,'0')).join('');
    return null;
  }
  function inline(text) {
    const tokens = [];
    const hold = html => { tokens.push(html); return `\u0000${tokens.length - 1}\u0000`; };
    const format = value => escape(value).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/~~(.+?)~~/g, '<s>$1</s>').replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');
    let s = String(text).replace(/\u0000/g, '');
    s = s.replace(/`([^`\n]+)`/g, (_, code) => hold('<code>' + escape(code) + '</code>'));
    s = s.replace(/<(mark|span)\s+style=(['"])\s*background-color\s*:\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\s*;?\s*\2\s*>/gi, (_, tag, q, color) => hold('<' + tag.toLowerCase() + ' style="background-color:' + normalizeColor(color) + '">'));
    s = s.replace(/<mark\s*>/gi, () => hold('<mark style="background-color:#d8cfad">'));
    s = s.replace(/<\/mark\s*>/gi, () => hold('</mark>'));
    s = s.replace(/<span\s+style=(['"])\s*color\s*:\s*(#[0-9a-f]{3}(?:[0-9a-f]{3})?)\s*;?\s*\1\s*>/gi, (_, q, color) => hold('<span style="color:' + normalizeColor(color) + '">'));
    s = s.replace(/<\/?u\s*>|<\/span\s*>|<br\s*\/?>/gi, tag => hold(tag.toLowerCase().startsWith('<br') ? '<br>' : tag.toLowerCase().startsWith('</span') ? '</span>' : tag.toLowerCase().startsWith('</u') ? '</u>' : '<u>'));
    s = s.replace(/\[([^\]\n]+)\]\(([^\s)]+)\)/g, (_, label, href) => {
      if (!/^(https?:\/\/|mailto:)/i.test(href)) return label;
      return hold(`<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${format(label)}</a>`);
    });
    s = format(s);
    // Tokens can appear inside a link label. Expand until no tokens remain.
    for (let pass = 0; pass <= tokens.length && /\u0000\d+\u0000/.test(s); pass++) s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)] || '');
    return s.replace(/\n/g, '<br>');
  }
  function tableRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    let trailingSlashes = 0;
    for (let j = s.length - 2; j >= 0 && s[j] === '\\'; j--) trailingSlashes++;
    if (s.endsWith('|') && trailingSlashes % 2 === 0) s = s.slice(0,-1);
    const clean = value => value.trim().split(/(`[^`]*`)/g).map((part,i) => i % 2 ? part : part.replace(/<br\s*\/?>/gi,'\n')).join('');
    const cells = []; let cell = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && (s[i + 1] === '|' || s[i + 1] === '\\')) { cell += s[++i]; continue; }
      if (s[i] === '|') { cells.push(clean(cell)); cell = ''; } else cell += s[i];
    }
    cells.push(clean(cell)); return cells;
  }
  function tableStart(lines, i) {
    if (i + 1 >= lines.length || !lines[i].includes('|')) return false;
    const head = tableRow(lines[i]), separators = tableRow(lines[i + 1]);
    return head.length === separators.length && separators.every(c => /^:?-{3,}:?$/.test(c));
  }
  function parse(markdown) {
    const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n'), blocks = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      let m;
      if (tableStart(lines, i)) {
        const head = tableRow(line), separators = tableRow(lines[i + 1]);
        const aligns = separators.map(s => s.startsWith(':') && s.endsWith(':') ? 'center' : s.endsWith(':') ? 'right' : s.startsWith(':') ? 'left' : null);
        const rows = [head]; i += 2;
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
          const row = tableRow(lines[i++]);
          rows.push(Array.from({length:head.length}, (_, c) => row[c] || ''));
        }
        blocks.push({type:'table', text:'', rows, aligns}); continue;
      }
      if ((m = line.match(/^\s*(`{3,}|~{3,})(.*)$/))) {
        const marker = m[1], language = m[2].trim();
        const code = []; i++;
        while (i < lines.length && !new RegExp('^\\s*' + marker[0] + '{' + marker.length + ',}\\s*$').test(lines[i])) code.push(lines[i++]);
        if (i < lines.length) i++;
        blocks.push({ type: 'code', text: code.join('\n'), language }); continue;
      }
      if ((m = line.match(/^(#{1,3})\s+(.*)$/))) blocks.push({ type: 'h' + m[1].length, text: m[2] });
      else if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) blocks.push({ type: 'divider', text: '' });
      else if ((m = line.match(/^(\s*)[-*+] \[([ xX])\]\s?(.*)$/))) blocks.push({ type: 'todo', text: m[3], checked: m[2] !== ' ', indent: Math.min(6, Math.floor(m[1].length / 2)) });
      else if ((m = line.match(/^(\s*)[-*+]\s+(.*)$/))) blocks.push({ type: 'bullet', text: m[2], indent: Math.min(6, Math.floor(m[1].length / 2)) });
      else if ((m = line.match(/^(\s*)\d+[.)]\s+(.*)$/))) blocks.push({ type: 'number', text: m[2], indent: Math.min(6, Math.floor(m[1].length / 2)) });
      else if ((m = line.match(/^>\s?(.*)$/))) {
        const quote = [m[1]];
        while (i + 1 < lines.length && /^>/.test(lines[i + 1])) quote.push(lines[++i].replace(/^>\s?/, ''));
        blocks.push({ type: 'quote', text: quote.join('\n') });
      } else {
        const paragraph = [line];
        while (i + 1 < lines.length && lines[i + 1].trim() && !tableStart(lines, i + 1) && !/^(#{1,3}\s|\s*[-*+]\s|\s*\d+[.)]\s|>|\s*(`{3,}|~{3,})|---+\s*$)/.test(lines[i + 1])) paragraph.push(lines[++i]);
        blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
      }
      i++;
    }
    return blocks.length ? blocks : [{ type: 'paragraph', text: '' }];
  }
  function stringify(blocks) {
    let number = 0;
    return blocks.map(b => {
      if (b.type !== 'number') number = 0;
      const indent = '  '.repeat(b.indent || 0);
      if (b.type === 'table') {
        const count = Math.max(1, ...b.rows.map(r => r.length));
        const row = cells => '| ' + Array.from({length:count}, (_, c) => String(cells[c] || '').replace(/\\/g,'\\\\').replace(/\|/g,'\\|').replace(/\n/g,'<br>')).join(' | ') + ' |';
        const separator = Array.from({length:count}, (_, c) => ({left:':---',right:'---:',center:':---:'}[b.aligns?.[c]] || '---'));
        return [row(b.rows[0] || []), '| ' + separator.join(' | ') + ' |', ...b.rows.slice(1).map(row)].join('\n');
      }
      if (/^h[123]$/.test(b.type)) return '#'.repeat(Number(b.type[1])) + ' ' + b.text;
      if (b.type === 'bullet') return indent + '- ' + b.text;
      if (b.type === 'number') return indent + (++number) + '. ' + b.text;
      if (b.type === 'todo') return indent + '- [' + (b.checked ? 'x' : ' ') + '] ' + b.text;
      if (b.type === 'quote') return b.text.split('\n').map(t => '> ' + t).join('\n');
      if (b.type === 'code') {
        const longest = Math.max(2, ...(b.text.match(/`+/g) || []).map(x => x.length));
        const fence = '`'.repeat(longest + 1);
        return fence + (b.language || '') + '\n' + b.text + '\n' + fence;
      }
      if (b.type === 'divider') return '---';
      return b.text;
    }).join('\n\n') + '\n';
  }
  return { parse, stringify, inline, escape, normalizeColor };
});
