'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
test('dashboard inline script parses and workbook replacement is not rejected by unchanged date count',()=>{
  const html=fs.readFileSync('aer_dashboard.html','utf8');
  const script=html.slice(html.lastIndexOf('<script>')+8,html.lastIndexOf('</script>'));
  new vm.Script(script);
  assert.doesNotMatch(script,/length === before/);
  assert.match(script,/AER\.parseWorkbook/);assert.match(script,/escapeHtml\(val\)/);
});
test('File handoff accepts only official Pages opener, exposes no URL/localStorage payload',()=>{
  const handlers={},elements={};
  for(const id of ['form','excel','person','residents','status'])elements[id]={addEventListener:(event,fn)=>{handlers[id+event]=fn;}};
  const opener={postMessage:(data,origin)=>{assert.equal(data.type,'aer-ready');assert.equal(origin,'https://emdoc119.github.io');}};
  class File{constructor(){this.size=1;}}
  class DataTransfer{constructor(){this.files=[];this.items={add:f=>this.files.push(f)};}}
  const context={window:{opener,addEventListener:(event,fn)=>{handlers[event]=fn;}},document:{getElementById:id=>elements[id]},File,DataTransfer};
  const js=fs.readFileSync('backend/preview.js','utf8');vm.runInNewContext(js,context);
  const event={origin:'https://emdoc119.github.io',source:opener,data:{type:'aer-excel',file:new File(),person:'SyntheticMe',residents:'SyntheticA'}};
  handlers.message({...event,origin:'https://evil.invalid'});assert.equal(elements.person.value,undefined);
  handlers.message({...event,source:{}});assert.equal(elements.person.value,undefined);
  handlers.message(event);assert.equal(elements.person.value,'SyntheticMe');assert.equal(elements.excel.files.length,1);
  assert.doesNotMatch(js,/localStorage|location\.hash/);
});
