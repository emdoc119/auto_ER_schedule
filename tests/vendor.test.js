'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createHash}=require('node:crypto');
test('Pages uses the pinned local SheetJS browser asset and parses synthetic XLSX without a CDN',()=>{
  const html=fs.readFileSync('aer_dashboard.html','utf8'),asset=fs.readFileSync('vendor/xlsx-0.20.3.full.min.js');
  assert.match(html,/<script src="vendor\/xlsx-0\.20\.3\.full\.min\.js"><\/script>/);
  assert.doesNotMatch(html,/script src="https:\/\/(cdn\.sheetjs\.com|cdnjs\.cloudflare\.com).*xlsx/);
  const expected=fs.readFileSync('vendor/README.md','utf8').match(/SHA-256: `([0-9a-f]{64})`/)[1];
  assert.equal(createHash('sha256').update(asset).digest('hex'),expected);
  const context=vm.createContext({});
  vm.runInContext(asset.toString('utf8'),context,{timeout:5000});
  vm.runInContext(fs.readFileSync('lib/aer-parser.js','utf8'),context,{timeout:1000});
  const result=vm.runInContext(`(()=>{
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([
      [null,null,null,null,null,null,null,'SyntheticMe','SyntheticA'],
      ['11월1일',null,null,null,null,null,null,'D(I)','N(I)']
    ]),'2026년11월');
    const binary=XLSX.write(wb,{type:'array',bookType:'xlsx'});
    const reread=XLSX.read(binary,{type:'array'});
    const events=AER.buildEvents(AER.parseWorkbook(reread,'SyntheticMe',XLSX),'SyntheticMe',[]);
    return {version:XLSX.version,count:events.length,title:events[0].summary};
  })()`,context,{timeout:5000});
  assert.equal(result.version,'0.20.3');assert.equal(result.count,1);assert.equal(result.title,'D(I)');
});
