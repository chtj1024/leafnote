'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../public/markdown');
test('Korean text and supported block types survive Markdown conversion', () => {
  const content = '# 한글 제목\n\n**중요한** 문장과 *기울임*\n\n- [x] 완료\n\n- [ ] 남은 일\n\n- 목록\n\n1. 순서\n\n> 첫 줄\n> 둘째 줄\n\n```javascript\nconsole.log("한글");\n```\n\n---\n';
  const parsed = M.parse(content);
  assert.deepEqual(M.parse(M.stringify(parsed)), parsed);
  assert.equal(parsed.find(b=>b.type==='todo').checked,true);
});
test('code fences can contain nested backticks without truncation',()=>{
  const input=[{type:'code',text:'const a = `x`;\n```\n한글',language:'js'}];
  assert.deepEqual(M.parse(M.stringify(input)),input);
});
test('unsafe HTML and unsafe links are never executable',()=>{
  const html=M.inline('<img src=x onerror=alert(1)> [bad](javascript:alert) [good](https://example.org)');
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes('rel="noopener noreferrer"'));
});
test('nested lists and empty documents parse consistently',()=>{
  const parsed=M.parse('- 상위\n  - 하위\n    - [ ] 할 일');
  assert.equal(parsed[1].indent,1);assert.equal(parsed[2].indent,2);
  assert.deepEqual(M.parse(''),[{type:'paragraph',text:''}]);
});
test('tables preserve alignment, escaped pipes, backslashes, line breaks and rich text',()=>{
  const table={type:'table',text:'',aligns:['left','center','right'],rows:[['항목','내용','메모'],['a | b','C:\\notes\\문서','첫 줄\n다음 줄'],['<u>밑줄</u>','<span style="color:#326ac0">파랑</span>','`a|b`']]};
  assert.deepEqual(M.parse(M.stringify([table])),[table]);
  const bare=M.parse('바로 앞 문장\n이름 | 수량\n--- | ---:\n사과 | 3');
  assert.equal(bare[0].type,'paragraph');assert.equal(bare[1].type,'table');
  assert.deepEqual(bare[1].aligns,[null,'right']);
});
test('an empty one-column table remains editable after saving',()=>{
  const table={type:'table',text:'',rows:[['']],aligns:[null]};
  assert.deepEqual(M.parse(M.stringify([table])),[table]);
});
test('underline and restricted text colors render alongside existing inline formatting',()=>{
  const html=M.inline('<u>**중요**</u> <span style="color:#326ac0">파랑 *기울임*</span>');
  assert.ok(html.includes('<u><strong>중요</strong></u>'));
  assert.ok(html.includes('<span style="color:#326ac0">파랑 <em>기울임</em></span>'));
  assert.equal(M.normalizeColor('rgb(50, 106, 192)'),'#326ac0');
  assert.equal(M.normalizeColor('#abc'),'#aabbcc');
  assert.equal(M.normalizeColor('url(https://example.org)'),null);
  assert.ok(M.inline('[<u>링크</u>](https://example.org)').includes('<u>링크</u></a>'));
  assert.ok(M.inline('`<u>원문</u>`').includes('<code>&lt;u&gt;원문&lt;/u&gt;</code>'));
});
test('allowing text colors never allows HTML attributes or external CSS',()=>{
  for(const input of ['<span style="color:red;background:url(https://example.org)">x</span>','<u onclick="alert(1)">x</u>','<span style="color:#ff0000" onmouseover="alert(1)">x</span>','<img src=x onerror=alert(1)>']){
    const html=M.inline(input);
    assert.ok(!/<(?:span|u|img)[^>]*(?:onmouseover|onclick|onerror|url\()/i.test(html),html);
  }
});

test('highlights preserve other inline styles, table content, links and source code',()=>{
  const text='<mark style="background-color:#fef08a"><u>**형광펜**</u> *강조*</mark>';
  assert.ok(M.inline(text).includes('<mark style="background-color:#fef08a"><u><strong>형광펜</strong></u> <em>강조</em></mark>'));
  assert.equal(M.inline('<mark>기본 노랑</mark>'),'<mark style="background-color:#d8cfad">기본 노랑</mark>');
  assert.ok(M.inline('[<mark>링크</mark>](https://example.org)').includes('<mark style="background-color:#d8cfad">링크</mark></a>'));
  assert.ok(M.inline('`<mark>원문</mark>`').includes('<code>&lt;mark&gt;원문&lt;/mark&gt;</code>'));
  assert.equal(M.inline('<span style="background-color:#abc">호환</span>'),'<span style="background-color:#aabbcc">호환</span>');
  const blocks=[{type:'paragraph',text},{type:'table',text:'',rows:[['제목'],[text]],aligns:[null]}];
  assert.deepEqual(M.parse(M.stringify(blocks)),blocks);
});

test('highlight HTML cannot introduce event handlers, extra styles, or URLs',()=>{
  for(const input of ['<mark onclick="alert(1)">x</mark>','<mark style="background-color:#fef08a" onmouseover="alert(1)">x</mark>','<mark style="background-color:url(https://example.org)">x</mark>','<mark style="background-color:#fff;position:fixed;inset:0">x</mark>','<span style="background-color:#fff;background-image:url(https://example.org)">x</span>']){
    const html=M.inline(input);
    assert.ok(!/<(?:mark|span)[^>]*(?:onmouseover|onclick|url\(|position:)/i.test(html),html);
  }
});
