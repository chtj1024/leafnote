'use strict';
const $ = id => document.getElementById(id);
const M = window.Markdown;
const paths = {
  search:'m21 21-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
  plus:'M12 5v14M5 12h14', lock:'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4',
  upload:'M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5', download:'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',
  moon:'M21 13A9 9 0 0 1 11 3a9 9 0 1 0 10 10', sun:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  sidebar:'M3 4h18v16H3zM9 4v16M5.5 8h1M5.5 12h1',
  star:'m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z',
  more:'M5 12h.01M12 12h.01M19 12h.01', code:'m8 7-5 5 5 5m8-10 5 5-5 5M14 4l-4 16',
  copy:'M8 8h13v13H8zM16 8V3H3v13h5', folder:'M3 6h7l2 3h9v11H3z',
  trash:'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  grip:'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01'
};
function icon(name) { return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.plus}"${name === 'grip' || name === 'more' ? ' stroke-width="3"' : ''}/></svg>`; }
function icons(root = document) { root.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon)); }
icons();
const TYPES = [
  ['paragraph','T','텍스트','편하게 생각을 적어보세요','text paragraph'],
  ['h1','H₁','제목 1','크고 선명한 제목','heading title'],
  ['h2','H₂','제목 2','내용을 나누는 중간 제목','heading title'],
  ['h3','H₃','제목 3','작은 주제의 제목','heading title'],
  ['todo','☑','체크리스트','하나씩 해내는 작은 일들','todo check task'],
  ['bullet','•','글머리 목록','순서 없이 정리하기','bullet list'],
  ['number','1.','번호 목록','차근차근 순서대로','number list'],
  ['table','▦','표','행과 열로 내용을 정리하기','table grid'],
  ['quote','“','인용문','기억해두고 싶은 문장','quote'],
  ['code','</>','코드','코드를 있는 그대로','code'],
  ['divider','―','구분선','잠깐 숨을 고르는 선','divider line']
];
let active = null, blocks = [], token = '', sourceMode = false;
let dirty = false, generation = 0, saving = null, saveTimer, fileBusy = false;
let lastSavedMarkdown = '', lastSavedBlockMarkdown = '';
let menuBlock = null, menuIndex = 0, menuMatches = TYPES, menuFromSlash = false, menuQuery = '', pendingSlashEnter = null;
let dragged = null, toastTimer, history = [], historyIndex = -1, lastHistoryTime = 0, lastHistoryKind = '';
let lastSelection = null, leaveResolver = null;
let selectedTableCell = null, selectingText = false;
const safe = fn => (...args) => Promise.resolve().then(() => fn(...args)).catch(err => toast(err.message));
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 5500); }
async function api(url, method = 'GET', data) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json', 'X-Leafnote-Token': token }, body: data === undefined ? undefined : JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || '요청을 처리하지 못했습니다.');
  return value;
}
function editable(id) { return document.querySelector(`.block[data-id="${id}"] .content`); }
function blockElement(id) { return document.querySelector(`.block[data-id="${id}"]`); }
function fresh(b) { return { ...b, id: crypto.randomUUID() }; }
function fromMarkdown(text) { return M.parse(text).map(fresh); }
function domMarkdown(node) {
  if (node.nodeType === 3) return node.textContent.replace(/\u00a0/g, ' ');
  if (node.nodeType !== 1) return '';
  if (node.tagName === 'BR') return '\n';
  let text = Array.from(node.childNodes).map(domMarkdown).join('');
  if (node.tagName === 'CODE') return '`' + text + '`';
  if (node.tagName === 'A' && /^(https?:\/\/|mailto:)/i.test(node.getAttribute('href') || '')) return '[' + text + '](' + node.getAttribute('href') + ')';
  if (!text) return '';
  if (node.tagName === 'B' || node.tagName === 'STRONG' || node.style.fontWeight === 'bold' || Number(node.style.fontWeight) >= 600) text = '**' + text + '**';
  if (node.tagName === 'I' || node.tagName === 'EM' || node.style.fontStyle === 'italic') text = '*' + text + '*';
  if (['S','STRIKE','DEL'].includes(node.tagName) || node.style.textDecoration.includes('line-through')) text = '~~' + text + '~~';
  if (node.tagName === 'U' || node.style.textDecoration.includes('underline')) text = '<u>' + text + '</u>';
  const color = M.normalizeColor(node.tagName === 'FONT' ? node.getAttribute('color') : node.style.color);
  if (color) text = '<span style="color:' + color + '">' + text + '</span>';
  const highlight = M.normalizeColor(node.style.backgroundColor) || (node.tagName === 'MARK' ? '#d8cfad' : null);
  if (highlight) text = '<mark style="background-color:' + highlight + '">' + text + '</mark>';
  if (node.tagName === 'DIV' || node.tagName === 'P') return '\n' + text;
  return text;
}
function syncBlocks() {
  if (sourceMode) return;
  for (const b of blocks) {
    if (b.type === 'table') {
      blockElement(b.id)?.querySelectorAll('.table-cell').forEach(cell => {
        b.rows[Number(cell.dataset.row)][Number(cell.dataset.col)] = Array.from(cell.childNodes).map(domMarkdown).join('').replace(/\n$/, '');
      });
      continue;
    }
    const el = editable(b.id);
    if (el) b.text = b.type === 'code' ? el.innerText.replace(/\r/g, '').replace(/\n$/, '') : Array.from(el.childNodes).map(domMarkdown).join('').replace(/\n$/, '');
    const lang = blockElement(b.id)?.querySelector('.code-language');
    if (lang) b.language = lang.value;
  }
}
function markdown() { if (sourceMode) return $('source').value; syncBlocks(); return M.stringify(blocks); }
function renderBlocks() {
  $('selectionToolbar').hidden = true; lastSelection = null;
  let number = 0;
  $('editor').innerHTML = blocks.map(b => {
    number = b.type === 'number' ? number + 1 : 0;
    const label = TYPES.find(t => t[0] === b.type)?.[2] || '텍스트';
    const handle = `<button class="handle" draggable="true" aria-label="${label} 블록 이동 또는 종류 변경" title="드래그하여 이동 · 클릭하여 종류 변경">${icon('grip')}</button>`;
    if (b.type === 'table') {
      const rowHtml = (row,r) => '<tr>' + row.map((text,c) => {
        const tag = r === 0 ? 'th' : 'td', align = ['left','center','right'].includes(b.aligns?.[c]) ? b.aligns[c] : 'left';
        return `<${tag} style="text-align:${align}"><div class="table-cell" contenteditable="true" role="textbox" aria-label="표 ${r + 1}행 ${c + 1}열" aria-multiline="true" spellcheck="false" data-row="${r}" data-col="${c}">${M.inline(text)}</div></${tag}>`;
      }).join('') + '</tr>';
      return `<div class="block table" data-id="${b.id}">${handle}<div class="table-container"><div class="table-scroll"><table aria-label="편집 가능한 표"><thead>${rowHtml(b.rows[0],0)}</thead><tbody>${b.rows.slice(1).map((row,r) => rowHtml(row,r + 1)).join('')}</tbody></table></div><div class="table-tools" role="toolbar" aria-label="표 편집"><button data-table-action="add-row">+ 행</button><button data-table-action="add-column">+ 열</button><span class="tool-divider"></span><button data-table-action="remove-row" ${b.rows.length <= 1 ? 'disabled' : ''}>행 삭제</button><button data-table-action="remove-column" ${b.rows[0].length <= 1 ? 'disabled' : ''}>열 삭제</button><button data-table-action="remove-table" class="danger" title="표 전체 삭제 · Ctrl+Z로 복원">표 삭제</button><button data-table-action="leave">표 아래에 쓰기</button></div></div></div>`;
    }
    let prefix = '';
    if (b.type === 'todo') prefix = `<input type="checkbox" ${b.checked ? 'checked' : ''} aria-label="할 일 완료">`;
    if (b.type === 'bullet') prefix = '<span class="prefix">•</span>';
    if (b.type === 'number') prefix = `<span class="prefix">${number}.</span>`;
    if (b.type === 'divider') return `<div class="block divider" data-id="${b.id}" tabindex="0" aria-label="구분선">${handle}<hr></div>`;
    const lang = b.type === 'code' ? `<input class="code-language" value="${M.escape(b.language || '')}" placeholder="언어 (예: javascript)" aria-label="코드 언어" maxlength="40">` : '';
    const content = b.type === 'code' ? M.escape(b.text) : M.inline(b.text);
    return `<div class="block ${b.type}${b.checked ? ' done' : ''}" data-id="${b.id}" style="margin-left:${(b.indent || 0) * 22}px">${handle}${lang}${prefix}<div class="content" contenteditable="true" role="textbox" aria-multiline="true" aria-label="${label} 블록" spellcheck="false">${content}</div></div>`;
  }).join('');
  updateCount();
}
function focusBlock(id, end = false) {
  const row = blockElement(id);
  const cells = row?.querySelectorAll('.table-cell');
  const el = cells?.length ? (end ? cells[cells.length - 1] : cells[0]) : editable(id) || row;
  if (!el) return;
  el.focus();
  if (el.classList.contains('content') || el.classList.contains('table-cell')) {
    const range = document.createRange(); range.selectNodeContents(el); range.collapse(!end);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  }
}
function updateCount() {
  const plain = value => { const box = document.createElement('div'); box.innerHTML = M.inline(value); return box.textContent; };
  const text = sourceMode ? $('source').value : blocks.map(b => b.type === 'table' ? b.rows.flat().map(plain).join(' ') : b.type === 'code' ? b.text : plain(b.text)).join(' ');
  $('wordCount').textContent = text.replace(/\s/g, '').length.toLocaleString('ko-KR') + '자';
}
function setStatus(text, error = false) { $('saveStatus').classList.toggle('error', error); $('saveStatus').innerHTML = '<i></i>'; $('saveStatus').append(document.createTextNode(text)); }
function snapshot() { return { blocks: JSON.parse(JSON.stringify(blocks)) }; }
function recordHistory(kind = 'edit') {
  if (sourceMode) return;
  const snap = snapshot(), now = Date.now();
  if (JSON.stringify(history[historyIndex]) === JSON.stringify(snap)) return;
  history = history.slice(0, historyIndex + 1);
  if (kind === 'typing' && lastHistoryKind === 'typing' && now - lastHistoryTime < 650 && historyIndex > 0) history[historyIndex] = snap;
  else { history.push(snap); if (history.length > 100) history.shift(); historyIndex = history.length - 1; }
  lastHistoryTime = now; lastHistoryKind = kind;
}
function hasFile() { return !!active?.id; }
function scheduleSave() {
  clearTimeout(saveTimer);
  setStatus(hasFile() ? '저장 대기 중…' : '저장되지 않음');
  if (hasFile() && !fileBusy) saveTimer = setTimeout(() => flush().catch(() => {}),650);
}
function changed(kind = 'edit') {
  if (!active) return;
  dirty = true; generation++; updateCount(); recordHistory(kind); scheduleSave();
}
function saveContent() {
  const content = markdown(), blockContent = sourceMode ? M.stringify(fromMarkdown(content)) : content;
  const contentChanged = content !== (sourceMode ? lastSavedMarkdown.replace(/\r\n?/g,'\n') : lastSavedBlockMarkdown);
  return {content,blockContent,text:contentChanged ? content : lastSavedMarkdown,contentChanged};
}
function updateFileInfo() {
  $('fileTitle').textContent = active.title;
  $('filePath').textContent = active.path || '';
  $('filePath').title = active.path || '';
  document.title = active.title + ' · Leafnote';
}
function savedDocument(updated, version, content) {
  active = {...active,...updated}; lastSavedMarkdown = content.text; lastSavedBlockMarkdown = content.blockContent;
  if (generation === version) { dirty=false; setStatus('저장됨'); }
  else scheduleSave();
  updateFileInfo();
  window.history.replaceState(null,'',active.id ? '/?document='+encodeURIComponent(active.id) : '/');
}
async function flush() {
  if (saving) { await saving; if (dirty) return flush(); return true; }
  if (!dirty || !hasFile()) return true;
  const id = active.id, version = generation, content = saveContent();
  if (!content.contentChanged) { dirty=false; setStatus('저장됨'); return true; }
  setStatus('저장 중…');
  saving = (async () => {
    try {
      const updated = await api('/api/documents/'+id,'PUT',{revision:active.revision,markdown:content.text});
      savedDocument(updated,version,content);
    } catch (err) { setStatus('저장 실패',true); toast(err.message); throw err; }
    finally { saving=null; }
  })();
  await saving;
  if (dirty) return flush();
  return true;
}
async function saveAs() {
  clearTimeout(saveTimer);
  try {
    if (saving) { try { await saving; } catch {} }
    const version=generation,content=saveContent();
    saving=(async()=>{
      try {
        const updated=await api('/api/save-as','POST',{id:active.id,revision:active.revision,markdown:content.text,format:active.format});
        if (updated.cancelled) return false;
        savedDocument(updated,version,content); return true;
      } finally { saving=null; }
    })();
    const saved=await saving;
    if (saved && dirty) await flush();
    return saved;
  } catch(err) { setStatus('저장 실패',true);toast(err.message);throw err; }
}
async function save() { return hasFile() ? flush() : saveAs(); }
function installDocument(doc) {
  active=doc; blocks=fromMarkdown(doc.markdown); dirty=false; generation++; sourceMode=false; lastSelection=null; selectedTableCell=null;
  $('source').hidden=true; $('editor').hidden=false;
  $('sourceToggle').innerHTML=icon('code')+'<span>마크다운 보기</span>';
  $('loading').hidden=true; $('documentScroll').hidden=false; $('documentScroll').scrollTop=0;
  closePopups(); renderBlocks(); updateFileInfo(); setStatus(hasFile() ? '저장됨' : '새 문서');
  lastSavedMarkdown=doc.markdown; lastSavedBlockMarkdown=markdown();
  history=[snapshot()]; historyIndex=0; lastHistoryKind='';
  window.history.replaceState(null,'',doc.id ? '/?document='+encodeURIComponent(doc.id) : '/');
}
function blankDocument() { installDocument({id:null,title:'제목 없는 문서',path:null,revision:0,markdown:''}); }
async function confirmLeaving() {
  if (saving) { try { await saving; } catch {} }
  if (!dirty) return true;
  let failed=false;
  if (hasFile()) { try { await flush(); return true; } catch { failed=true; } }
  $('unsavedDescription').textContent = failed ? '원본 파일에 저장하지 못했습니다. 다른 이름으로 저장해서 변경 내용을 보관할 수 있습니다.' : '이 문서의 변경 내용을 파일에 저장할 수 있습니다.';
  $('saveLeave').textContent=failed ? '다른 이름으로 저장' : '저장';
  const choice=await new Promise(resolve=>{leaveResolver=resolve;$('unsavedDialog').showModal();});
  if (choice==='discard') return true;
  if (choice!=='save') return false;
  return failed ? saveAs() : save();
}
async function fileOperation(fn) {
  if (fileBusy || !active) return;
  fileBusy=true; clearTimeout(saveTimer); closePopups();
  for (const id of ['newFile','openFile','saveFile','saveAsButton']) $(id).disabled=true;
  try { return await fn(); }
  finally {
    fileBusy=false;
    for (const id of ['newFile','openFile','saveFile','saveAsButton']) $(id).disabled=false;
    if (dirty && hasFile()) scheduleSave();
  }
}
async function newDocument() { if (await confirmLeaving()) { blankDocument(); focusBlock(blocks[0].id); } }
async function openDocument() {
  if (!await confirmLeaving()) return;
  const doc=await api('/api/choose-open','POST',{});
  if (!doc.cancelled) installDocument(doc);
}
function closePopups() { ['fileMenu','blockMenu','highlightMenu','selectionToolbar'].forEach(id=>$(id).hidden=true); menuBlock=null; }
function menuOptions(query = '') {
  const q = query.normalize('NFKC').trim().toLowerCase();
  if (q !== menuQuery) { menuIndex = 0; menuQuery = q; }
  const exact = q ? TYPES.filter(t => [t[0],t[2],...t[4].split(' ')].some(name => name.toLowerCase() === q)) : [];
  menuMatches = exact.length ? exact : TYPES.filter(t => [t[0],t[2],t[4]].some(name => name.toLowerCase().includes(q)));
  menuIndex = Math.min(menuIndex, Math.max(0, menuMatches.length - 1));
  $('blockOptions').innerHTML = menuMatches.length ? menuMatches.map((t, i) => `<button class="block-option ${i === menuIndex ? 'active' : ''}" data-type="${t[0]}" role="menuitem"><span class="block-symbol">${M.escape(t[1])}</span><span><strong>${t[2]}</strong><small>${t[3]}</small></span></button>`).join('') : '<p class="muted" style="padding:9px">일치하는 블록이 없어요.</p>';
}
function showBlockMenu(id, slash = false) {
  closePopups(); menuBlock = id; menuFromSlash = slash; menuIndex = 0; menuOptions();
  const rect = blockElement(id).getBoundingClientRect();
  $('blockMenu').hidden = false;
  const h = Math.min(440, $('blockMenu').offsetHeight);
  $('blockMenu').style.left = Math.max(8, Math.min(rect.left, innerWidth - 282)) + 'px';
  $('blockMenu').style.top = Math.max(8, Math.min(rect.bottom + 5, innerHeight - h - 12)) + 'px';
}
function updateSlashMenu(target) {
  const el = target.closest('.content');
  if (!el) return;
  const row = el.closest('.block');
  if (row.classList.contains('code')) return;
  if (el.textContent.startsWith('/')) {
    if (menuBlock !== row.dataset.id || $('blockMenu').hidden) showBlockMenu(row.dataset.id,true);
    menuOptions(el.textContent.slice(1));
  } else if (menuFromSlash) { $('blockMenu').hidden = true; menuBlock = null; }
}
function convertBlock(type) {
  if (!menuBlock) return;
  syncBlocks(); const id = menuBlock, b = blocks.find(b => b.id === id);
  if (!b) return closePopups();
  if (menuFromSlash) b.text = b.text.replace(/^\/[^\n]*/, '');
  if (b.type === 'table' && type !== 'table') { b.text = b.rows.map(row => row.join('\t')).join('\n'); delete b.rows; delete b.aligns; }
  if (type === 'table' && b.type !== 'table') { b.rows = [[b.text,'',''],['','',''],['','','']]; b.aligns = [null,null,null]; b.text = ''; }
  b.type = type; b.checked = false; b.indent = 0; closePopups();
  if (type === 'divider') {
    const next = fresh({ type:'paragraph', text:'' }); blocks.splice(blocks.indexOf(b) + 1, 0, next);
    renderBlocks(); focusBlock(next.id);
  } else { renderBlocks(); focusBlock(id, true); }
  changed();
}
function focusTableCell(id, row, col, end = false) {
  const el = blockElement(id)?.querySelector(`.table-cell[data-row="${row}"][data-col="${col}"]`);
  if (!el) return;
  el.focus(); const range = document.createRange(); range.selectNodeContents(el); range.collapse(!end);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
  selectedTableCell = {id,row,col};
}
function leaveTable(b) {
  const next = fresh({type:'paragraph',text:''}); blocks.splice(blocks.indexOf(b) + 1,0,next);
  renderBlocks(); focusBlock(next.id); changed();
}
function tableAction(b, action) {
  syncBlocks();
  if (action === 'remove-table') {
    recordHistory(); closePopups();
    const index = blocks.indexOf(b); if (index < 0) return;
    blocks.splice(index,1);
    if (!blocks.length) blocks.push(fresh({type:'paragraph',text:''}));
    selectedTableCell = null; lastSelection = null;
    renderBlocks(); focusBlock(blocks[Math.min(index,blocks.length - 1)].id); changed();
    toast('표를 삭제했습니다. Ctrl+Z로 되돌릴 수 있어요.'); return;
  }
  const selected = selectedTableCell?.id === b.id ? selectedTableCell : {row:b.rows.length - 1,col:b.rows[0].length - 1};
  let row = Math.min(selected.row,b.rows.length - 1), col = Math.min(selected.col,b.rows[0].length - 1);
  if (action === 'leave') { leaveTable(b); return; }
  if (action === 'add-row') { row++; b.rows.splice(row,0,Array(b.rows[0].length).fill('')); }
  if (action === 'add-column') { col++; b.rows.forEach(r => r.splice(col,0,'')); b.aligns.splice(col,0,null); }
  if (action === 'remove-row') { if (b.rows.length <= 1) return; b.rows.splice(row,1); row = Math.min(row,b.rows.length - 1); }
  if (action === 'remove-column') { if (b.rows[0].length <= 1) return; b.rows.forEach(r => r.splice(col,1)); b.aligns.splice(col,1); col = Math.min(col,b.rows[0].length - 1); }
  renderBlocks(); focusTableCell(b.id,row,col); changed();
}
function tableKeydown(e,b,cell) {
  const row = Number(cell.dataset.row), col = Number(cell.dataset.col), cols = b.rows[0].length;
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); syncBlocks(); leaveTable(b); return; }
  if (e.key !== 'Tab' && !(e.key === 'Enter' && !e.shiftKey)) return;
  e.preventDefault(); syncBlocks();
  let nextRow = row, nextCol = col;
  if (e.key === 'Enter') nextRow++;
  else { const index = row * cols + col + (e.shiftKey ? -1 : 1); if (index < 0) { const prev = blocks[blocks.indexOf(b) - 1]; if (prev) focusBlock(prev.id,true); return; } nextRow = Math.floor(index / cols); nextCol = index % cols; }
  if (nextRow >= b.rows.length) { b.rows.push(Array(cols).fill('')); renderBlocks(); changed(); }
  focusTableCell(b.id,nextRow,nextCol);
}
function selectionAtStart(el) {
  const selection = getSelection(); if (!selection.rangeCount || !selection.isCollapsed) return false;
  const range = document.createRange(); range.selectNodeContents(el); range.setEnd(selection.anchorNode, selection.anchorOffset);
  return range.toString().length === 0;
}
function selectionAtEnd(el) {
  const selection = getSelection(); if (!selection.rangeCount || !selection.isCollapsed) return false;
  const range = document.createRange(); range.selectNodeContents(el); range.setStart(selection.anchorNode, selection.anchorOffset);
  return range.toString().length === 0;
}
function splitBlock(b, el) {
  syncBlocks(); const idx = blocks.indexOf(b), s = getSelection();
  if (!s.rangeCount || !el.contains(s.anchorNode) || !el.contains(s.focusNode)) return;
  const r = s.getRangeAt(0); r.deleteContents();
  const tail = document.createRange(); tail.selectNodeContents(el); tail.setStart(r.startContainer, r.startOffset);
  const box = document.createElement('div'); box.append(tail.extractContents());
  b.text = Array.from(el.childNodes).map(domMarkdown).join('').replace(/\n$/, '');
  const nextType = ['bullet','number','todo'].includes(b.type) ? b.type : 'paragraph';
  const next = fresh({ type:nextType, text:Array.from(box.childNodes).map(domMarkdown).join('').replace(/\n$/, ''), checked:false, indent:b.indent || 0 });
  blocks.splice(idx + 1, 0, next); renderBlocks(); focusBlock(next.id); changed();
}
function undo(redo = false) {
  const next = historyIndex + (redo ? 1 : -1);
  if (next < 0 || next >= history.length) return;
  historyIndex = next; const snap = history[next];
  blocks = JSON.parse(JSON.stringify(snap.blocks));
  renderBlocks(); focusBlock(blocks.at(-1).id, true); dirty=true; generation++; scheduleSave(); lastHistoryKind='';
}
$('editor').addEventListener('input', e => {
  const el = e.target.closest('.content,.table-cell');
  if (!el && !e.target.matches('.code-language')) return;
  syncBlocks(); changed('typing');
  updateSlashMenu(e.target);
});
$('editor').addEventListener('compositionend', e => {
  syncBlocks(); changed('typing'); updateSlashMenu(e.target);
  const id = pendingSlashEnter; pendingSlashEnter = null;
  if (id) setTimeout(() => {
    // Let the IME finish its final input event before replacing the editable block.
    if (menuFromSlash && menuBlock === id && !$('blockMenu').hidden && menuMatches[menuIndex]) convertBlock(menuMatches[menuIndex][0]);
  },0);
});
$('editor').addEventListener('keydown', e => {
  const row = e.target.closest('.block'); if (!row) return;
  if (e.isComposing || e.keyCode === 229) {
    if ((e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter') && menuFromSlash && menuBlock === row.dataset.id && !$('blockMenu').hidden) pendingSlashEnter = menuBlock;
    return;
  }
  const b = blocks.find(b => b.id === row.dataset.id), el = e.target.closest('.content');
  const cell = e.target.closest('.table-cell');
  if (cell) { tableKeydown(e,b,cell); return; }
  if (menuBlock === b.id && !$('blockMenu').hidden) {
    if (e.key === 'Escape') { e.preventDefault(); closePopups(); return; }
    if (['ArrowDown','ArrowUp'].includes(e.key)) { e.preventDefault(); menuIndex = (menuIndex + (e.key === 'ArrowDown' ? 1 : -1) + menuMatches.length) % Math.max(menuMatches.length,1); menuOptions(menuFromSlash ? (el?.textContent.slice(1) || '') : ''); $('blockOptions').querySelector('.active')?.scrollIntoView({ block:'nearest' }); return; }
    if (e.key === 'Enter') { e.preventDefault(); if (menuMatches[menuIndex]) convertBlock(menuMatches[menuIndex][0]); return; }
  }
  if (!el) { if (b.type === 'divider' && (e.key === 'Delete' || e.key === 'Backspace')) { e.preventDefault(); blocks.splice(blocks.indexOf(b),1); if (!blocks.length) blocks.push(fresh({type:'paragraph',text:''})); renderBlocks(); focusBlock(blocks[0].id); changed(); } return; }
  if (e.key === 'Tab') {
    e.preventDefault(); syncBlocks();
    if (['bullet','number','todo'].includes(b.type)) { b.indent = Math.max(0,Math.min(6,(b.indent || 0) + (e.shiftKey ? -1 : 1))); renderBlocks(); focusBlock(b.id,true); changed(); }
    else if (b.type === 'code') document.execCommand('insertText', false, '  ');
    return;
  }
  if (e.key === ' ' && b.type === 'paragraph') {
    const shortcuts = { '#':'h1', '##':'h2', '###':'h3', '-':'bullet', '*':'bullet', '1.':'number', '[]':'todo', '[ ]':'todo', '- [ ]':'todo', '>':'quote', '```':'code', '---':'divider' };
    if (shortcuts[el.textContent] && selectionAtEnd(el)) { e.preventDefault(); const type = shortcuts[el.textContent]; menuBlock = b.id; menuFromSlash = false; b.text = ''; el.textContent = ''; convertBlock(type); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey && b.type !== 'code') {
    e.preventDefault();
    if (['bullet','number','todo','quote'].includes(b.type) && !el.textContent.trim()) { syncBlocks(); b.type = 'paragraph'; b.checked = false; b.indent = 0; renderBlocks(); focusBlock(b.id); changed(); }
    else splitBlock(b,el);
    return;
  }
  if (e.key === 'Enter' && b.type === 'code') {
    e.preventDefault();
    if (e.ctrlKey) { syncBlocks(); const next = fresh({type:'paragraph',text:''}); blocks.splice(blocks.indexOf(b)+1,0,next); renderBlocks(); focusBlock(next.id); changed(); }
    else document.execCommand('insertText',false,'\n');
    return;
  }
  if (e.key === 'Backspace' && selectionAtStart(el)) {
    if (b.type !== 'paragraph') { e.preventDefault(); syncBlocks(); b.type = 'paragraph'; b.indent = 0; b.checked = false; renderBlocks(); focusBlock(b.id); changed(); return; }
    const idx = blocks.indexOf(b); if (idx > 0) {
      e.preventDefault(); syncBlocks(); const previous = blocks[idx-1];
      if (previous.type === 'divider') { blocks.splice(idx-1,1); renderBlocks(); focusBlock(b.id); }
      else if (previous.type === 'table') { if (!b.text) { blocks.splice(idx,1); renderBlocks(); changed(); } focusBlock(previous.id,true); return; }
      else { previous.text += b.text; blocks.splice(idx,1); renderBlocks(); focusBlock(previous.id,true); }
      changed(); return;
    }
  }
  if (e.key === 'ArrowUp' && selectionAtStart(el)) { const prev = blocks[blocks.indexOf(b)-1]; if (prev) { e.preventDefault(); focusBlock(prev.id,true); } }
  if (e.key === 'ArrowDown' && selectionAtEnd(el)) { const next = blocks[blocks.indexOf(b)+1]; if (next) { e.preventDefault(); focusBlock(next.id); } }
});
$('editor').addEventListener('paste', e => {
  const el = e.target.closest('.content,.table-cell'); if (!el) return;
  e.preventDefault(); const text = e.clipboardData.getData('text/plain'); const b = blocks.find(b => b.id === el.closest('.block').dataset.id);
  if (b.type === 'table') {
    if (!text.includes('\t')) { document.execCommand('insertText',false,text); return; }
    syncBlocks(); const r = Number(el.dataset.row), c = Number(el.dataset.col), matrix = text.replace(/\r\n?/g,'\n').replace(/\n$/,'').split('\n').map(line => line.split('\t'));
    const cols = Math.max(b.rows[0].length, c + Math.max(...matrix.map(row => row.length)));
    while (b.rows.length < r + matrix.length) b.rows.push(Array(cols).fill(''));
    b.rows.forEach(row => { while (row.length < cols) row.push(''); });
    while (b.aligns.length < cols) b.aligns.push(null);
    matrix.forEach((row,ri) => row.forEach((text,ci) => b.rows[r + ri][c + ci] = text));
    renderBlocks(); focusTableCell(b.id,r,c); changed(); return;
  }
  if (b.type === 'code' || !text.includes('\n')) { document.execCommand('insertText',false,text); return; }
  syncBlocks(); const s = getSelection(); if (!s.rangeCount || !el.contains(s.anchorNode) || !el.contains(s.focusNode)) return;
  const range = s.getRangeAt(0); range.deleteContents();
  const tail = document.createRange(); tail.selectNodeContents(el); tail.setStart(range.startContainer,range.startOffset);
  const box = document.createElement('div'); box.append(tail.extractContents());
  const prefix = Array.from(el.childNodes).map(domMarkdown).join(''), suffix = Array.from(box.childNodes).map(domMarkdown).join('');
  const pasted = fromMarkdown(text); pasted[0].text = prefix + pasted[0].text; pasted.at(-1).text += suffix;
  const idx = blocks.indexOf(b); blocks.splice(idx,1,...pasted); renderBlocks(); focusBlock(pasted.at(-1).id,true); changed();
});
$('editor').addEventListener('click', e => {
  const row = e.target.closest('.block'); if (!row) return;
  const action = e.target.closest('[data-table-action]')?.dataset.tableAction;
  if (action) { const b = blocks.find(b => b.id === row.dataset.id); tableAction(b,action); return; }
  if (e.target.closest('.handle')) showBlockMenu(row.dataset.id);
  if (e.target.matches('input[type=checkbox]')) { const b = blocks.find(b => b.id === row.dataset.id); b.checked = e.target.checked; row.classList.toggle('done',b.checked); changed(); }
  const link = e.target.closest('a'); if (link && !(e.ctrlKey || e.metaKey)) e.preventDefault();
});
$('editor').addEventListener('focusin',e=>{const cell=e.target.closest('.table-cell');if(cell)selectedTableCell={id:cell.closest('.block').dataset.id,row:Number(cell.dataset.row),col:Number(cell.dataset.col)};});
$('editor').addEventListener('mousedown',e=>{if(e.target.closest('[data-table-action]'))e.preventDefault();});
$('editor').addEventListener('dragstart', e => { if (!e.target.closest('.handle')) { e.preventDefault(); return; } syncBlocks(); dragged = e.target.closest('.block').dataset.id; e.dataTransfer.setData('text/plain',dragged); e.dataTransfer.effectAllowed = 'move'; blockElement(dragged).classList.add('dragging'); });
$('editor').addEventListener('dragover', e => { if (!dragged) return; e.preventDefault(); document.querySelectorAll('.drag-over').forEach(el=>el.classList.remove('drag-over')); e.target.closest('.block')?.classList.add('drag-over'); });
$('editor').addEventListener('drop', e => { if (!dragged) return; e.preventDefault(); const target = e.target.closest('.block'); if (target && target.dataset.id !== dragged) { const b = blocks.find(b=>b.id===dragged); blocks.splice(blocks.indexOf(b),1); blocks.splice(blocks.findIndex(b=>b.id===target.dataset.id),0,b); renderBlocks(); changed(); } dragged = null; document.querySelectorAll('.drag-over,.dragging').forEach(el=>el.classList.remove('drag-over','dragging')); });
$('editor').addEventListener('dragend', () => { dragged = null; document.querySelectorAll('.drag-over,.dragging').forEach(el=>el.classList.remove('drag-over','dragging')); });
$('blockOptions').addEventListener('mousedown',e=>e.preventDefault());
$('blockOptions').addEventListener('click',e=>{const button=e.target.closest('[data-type]');if(button)convertBlock(button.dataset.type);});
$('source').addEventListener('input',()=>changed('typing'));
$('source').addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();$('source').setRangeText('  ',$('source').selectionStart,$('source').selectionEnd,'end');changed();}});
$('sourceToggle').addEventListener('click',safe(async()=>{
  if(!active)return;closePopups();if(hasFile())await flush();
  if(sourceMode){blocks=fromMarkdown($('source').value);sourceMode=false;renderBlocks();lastSavedBlockMarkdown=M.stringify(fromMarkdown(lastSavedMarkdown));history=[snapshot()];historyIndex=0;}
  else{const content=markdown();$('source').value=content===lastSavedBlockMarkdown?lastSavedMarkdown:content;sourceMode=true;}
  $('source').hidden=!sourceMode;$('editor').hidden=sourceMode;
  $('sourceToggle').innerHTML=icon(sourceMode?'sidebar':'code')+`<span>${sourceMode?'블록으로 편집':'마크다운 보기'}</span>`;
}));
document.querySelectorAll('[data-format]').forEach(button=>{
  button.addEventListener('mousedown',e=>e.preventDefault());
  button.addEventListener('click',()=>applyRichFormat(button.dataset.format));
});
function rememberSelection() {
  const selection = getSelection();
  if (sourceMode || !selection?.rangeCount || !$('editor').contains(selection.anchorNode) || !$('editor').contains(selection.focusNode)) return false;
  const start = selection.anchorNode.nodeType === 1 ? selection.anchorNode : selection.anchorNode.parentElement;
  const end = selection.focusNode.nodeType === 1 ? selection.focusNode : selection.focusNode.parentElement;
  if (!start.closest('.content,.table-cell') || !end.closest('.content,.table-cell') || start.closest('.code') || end.closest('.code')) { lastSelection = null; return false; }
  lastSelection = selection.getRangeAt(0).cloneRange(); return true;
}
function restoreSelection() {
  rememberSelection();
  if (!lastSelection || !$('editor').contains(lastSelection.startContainer) || !$('editor').contains(lastSelection.endContainer) || sourceMode) { toast('서식을 적용할 글을 먼저 선택해주세요.'); return false; }
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(lastSelection); return true;
}
function applyRichFormat(command, value) {
  if (!restoreSelection()) return;
  document.execCommand(command,false,value); rememberSelection(); syncBlocks(); changed();
}
const HIGHLIGHT_COLORS = [['노랑','#d8cfad'],['주황','#dcc3af'],['초록','#bdcdbb'],['파랑','#becbd6'],['보라','#ccc3d6'],['분홍','#d6bfc6'],['회색','#c9cbc7']];
function highlightButtons(compact = false) {
  return HIGHLIGHT_COLORS.map(([name,color]) => `<button type="button" data-highlight="${color}" aria-label="강조색 ${name}" title="${name}"><span class="highlight-swatch" style="background-color:${color}"></span>${compact ? '' : name}</button>`).join('') + `<button type="button" data-highlight="none" class="clear-highlight" aria-label="강조색 없음" title="강조색 없음"><span class="highlight-swatch no-highlight">×</span>${compact ? '' : '없음'}</button>`;
}
$('highlightOptions').innerHTML = highlightButtons();
$('selectionToolbar').innerHTML = '<span class="selection-caption">강조색</span>' + highlightButtons(true);
function showSelectionToolbar() {
  const toolbar = $('selectionToolbar');
  if (selectingText || !active || sourceMode || !rememberSelection() || !lastSelection || lastSelection.collapsed || !lastSelection.toString().trim() || document.querySelector('dialog[open]') || ['highlightMenu','blockMenu','fileMenu'].some(id => !$(id).hidden)) { toolbar.hidden = true; return; }
  const rect = lastSelection.getBoundingClientRect(), viewport = $('documentScroll').getBoundingClientRect();
  if (!rect.width || rect.bottom <= viewport.top || rect.top >= viewport.bottom) { toolbar.hidden = true; return; }
  toolbar.hidden = false;
  toolbar.style.left = Math.max(8,Math.min(rect.left + rect.width / 2 - toolbar.offsetWidth / 2,innerWidth - toolbar.offsetWidth - 8)) + 'px';
  const above = rect.top - toolbar.offsetHeight - 8;
  const top = above >= Math.max(8,viewport.top + 4) ? above : rect.bottom + 8;
  toolbar.style.top = Math.max(8,Math.min(top,innerHeight - toolbar.offsetHeight - 8)) + 'px';
}
// Split inline ancestors at each boundary so changing a few letters never
// changes the highlight of neighboring letters or removes their other styles.
function splitHighlightBoundary(marker, root) {
  while (marker.parentNode !== root) {
    const parent = marker.parentNode, tail = parent.cloneNode(false);
    while (marker.nextSibling) tail.append(marker.nextSibling);
    parent.after(marker);
    if (tail.hasChildNodes()) marker.after(tail);
    if (!parent.hasChildNodes()) parent.remove();
  }
}
function clearFragmentHighlight(fragment) {
  for (const element of fragment.querySelectorAll('*')) {
    element.style.removeProperty('background-color');
    if (element.tagName === 'MARK') element.replaceWith(...element.childNodes);
  }
}
function applyHighlight(value) {
  if (!restoreSelection() || lastSelection.collapsed || !lastSelection.toString().trim()) { toast('강조할 글자를 드래그해서 선택해주세요.'); return; }
  const color = value === 'none' ? null : HIGHLIGHT_COLORS.find(([,hex]) => hex === value)?.[1];
  if (value !== 'none' && !color) return;
  const range = lastSelection.cloneRange();
  const parts = Array.from($('editor').querySelectorAll('.content,.table-cell')).filter(el => !el.closest('.code') && range.intersectsNode(el)).map(el => {
    const part = document.createRange(); part.selectNodeContents(el);
    if (el.contains(range.startContainer)) part.setStart(range.startContainer,range.startOffset);
    if (el.contains(range.endContainer)) part.setEnd(range.endContainer,range.endOffset);
    return {el,range:part};
  }).filter(part => !part.range.collapsed && part.range.toString());
  const selected = [];
  for (const part of parts) {
    const start = document.createComment('highlight-start'), end = document.createComment('highlight-end');
    const endRange = part.range.cloneRange(); endRange.collapse(false); endRange.insertNode(end);
    const startRange = part.range.cloneRange(); startRange.collapse(true); startRange.insertNode(start);
    splitHighlightBoundary(end,part.el); splitHighlightBoundary(start,part.el);
    const middle = document.createRange(); middle.setStartAfter(start); middle.setEndBefore(end);
    const fragment = middle.extractContents(); clearFragmentHighlight(fragment);
    if (color) { const mark = document.createElement('mark'); mark.style.backgroundColor = color; mark.append(fragment); end.before(mark); }
    else end.before(fragment);
    const result = document.createRange(); result.setStartAfter(start); result.setEndBefore(end);
    start.remove(); end.remove(); part.el.normalize(); selected.push(result);
  }
  if (!selected.length) return;
  const result = document.createRange();
  result.setStart(selected[0].startContainer,selected[0].startOffset);
  result.setEnd(selected.at(-1).endContainer,selected.at(-1).endOffset);
  const selection = getSelection(); selection.removeAllRanges(); selection.addRange(result); lastSelection = result.cloneRange();
  $('highlightButton').style.setProperty('--chosen-highlight',color || 'transparent');
  closePopups(); syncBlocks(); changed('highlight');
}
document.addEventListener('selectionchange',showSelectionToolbar);
$('editor').addEventListener('pointerdown',e=>{if(e.target.closest('.content,.table-cell')){selectingText=true;$('selectionToolbar').hidden=true;}});
document.addEventListener('pointerup',()=>{selectingText=false;showSelectionToolbar();});
$('documentScroll').addEventListener('scroll',()=>{$('selectionToolbar').hidden=true;});
window.addEventListener('resize',()=>{$('selectionToolbar').hidden=true;});
$('highlightButton').addEventListener('mousedown',e=>{e.preventDefault();rememberSelection();});
$('highlightButton').onclick=()=>{
  const wasHidden = $('highlightMenu').hidden;
  if (!restoreSelection() || lastSelection.collapsed) { toast('강조할 글자를 드래그해서 선택해주세요.'); return; }
  closePopups(); if (!wasHidden) return;
  const rect = $('highlightButton').getBoundingClientRect(), menu = $('highlightMenu'); menu.hidden = false;
  menu.style.left = Math.max(8,Math.min(rect.left,innerWidth - menu.offsetWidth - 8)) + 'px';
  menu.style.top = Math.max(8,Math.min(rect.bottom + 6,innerHeight - menu.offsetHeight - 8)) + 'px';
};
for (const id of ['highlightMenu','selectionToolbar']) {
  $(id).addEventListener('mousedown',e=>e.preventDefault());
  $(id).onclick=e=>{const button=e.target.closest('[data-highlight]');if(button)applyHighlight(button.dataset.highlight);};
}

$('newFile').onclick=safe(()=>fileOperation(newDocument));
$('openFile').onclick=safe(()=>fileOperation(openDocument));
$('saveFile').onclick=safe(()=>fileOperation(save));
$('saveAsButton').onclick=safe(()=>fileOperation(saveAs));
$('moreButton').onclick=e=>{e.stopPropagation();const was=$('fileMenu').hidden;closePopups();$('fileMenu').hidden=!was;};
function leaveChoice(choice) { const resolve=leaveResolver;leaveResolver=null;$('unsavedDialog').close();resolve?.(choice); }
$('cancelLeave').onclick=()=>leaveChoice('cancel');
$('discardLeave').onclick=()=>leaveChoice('discard');
$('saveLeave').onclick=()=>leaveChoice('save');
$('unsavedDialog').addEventListener('cancel',e=>{e.preventDefault();leaveChoice('cancel');});
const FONT_SIZES = [10,12,14,16,18,20,22,24,28,32,36];
function setFontSize(value, persist = true) {
  const requested = Number(value), size = FONT_SIZES.includes(requested) ? requested : 14;
  document.documentElement.style.setProperty('--editor-font-size',size+'px');
  $('fontSize').value = String(size);
  if (persist) { try { localStorage.setItem('leafnote.fontSize',String(size)); } catch {} }
}
let savedFontSize = 14;
try { savedFontSize = localStorage.getItem('leafnote.fontSize') || 14; } catch {}
setFontSize(savedFontSize,false);
$('fontSize').addEventListener('change',e=>{closePopups();setFontSize(e.target.value);});
window.addEventListener('storage',e=>{if(e.key==='leafnote.fontSize')setFontSize(e.newValue,false);});
function setTheme(dark){document.body.classList.toggle('dark',dark);$('themeButton').innerHTML=icon(dark?'sun':'moon')+(dark?'라이트 모드':'다크 모드');localStorage.setItem('leafnote.dark',dark?'1':'0');}
setTheme(localStorage.getItem('leafnote.dark')==='1');$('themeButton').onclick=()=>setTheme(!document.body.classList.contains('dark'));
document.addEventListener('pointerdown',e=>{
  if(!e.target.closest('#editor,.format-tools,.popup'))lastSelection=null;
  if(!e.target.closest('.popup')&&!e.target.closest('.handle')&&!e.target.closest('#moreButton')&&!e.target.closest('#highlightButton'))closePopups();
});
document.addEventListener('keydown',e=>{
  if(e.isComposing)return;
  const command=e.ctrlKey||e.metaKey;
  if(command&&e.key.toLowerCase()==='u'&&!sourceMode&&$('editor').contains(getSelection()?.anchorNode)){e.preventDefault();applyRichFormat('underline');}
  if(command&&e.key.toLowerCase()==='s'){e.preventDefault();safe(()=>fileOperation(e.shiftKey?saveAs:save))();}
  if(command&&e.key.toLowerCase()==='o'){e.preventDefault();safe(()=>fileOperation(openDocument))();}
  if(command&&e.key.toLowerCase()==='n'){e.preventDefault();safe(()=>fileOperation(newDocument))();}
  if(command&&e.key.toLowerCase()==='z'&&!sourceMode&&active&&!document.querySelector('dialog[open]')){e.preventDefault();syncBlocks();undo(e.shiftKey);}
  if(e.key==='Escape')closePopups();
});
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&dirty&&!fileBusy)flush().catch(()=>{});});
window.addEventListener('online',()=>{if(dirty&&!fileBusy)flush().catch(()=>{});});
safe(async()=>{
  const data=await api('/api/bootstrap'); token=data.token;
  const requested=new URLSearchParams(location.search).get('document');
  if(requested) { try { installDocument(await api('/api/documents/'+encodeURIComponent(requested))); } catch(err) { blankDocument();toast(err.message); } }
  else blankDocument();
})().catch(()=>{});
