// Run: node --test tests/aer_duty_rules.test.js
// Synthetic names only: never commit clinical rosters or personal XLSX fixtures.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'aer_dashboard.html'), 'utf8');
const inline = html.slice(html.lastIndexOf('<script>') + '<script>'.length, html.lastIndexOf('</script>'));
const core = inline.slice(0, inline.indexOf('// ---------- Rendering ----------'));
const ics = inline.slice(inline.indexOf('function icsEscape'), inline.indexOf('function downloadIcs'));

function evaluate(checks) {
  return vm.runInNewContext('(function(){'+ core + '\n' + ics + '\n' + checks+'})()', {AER:require('../lib/aer-parser')}, {timeout: 2000});
}

test('ICU codes preserve title and normalize colleague / handoff groups', () => {
  evaluate(`
    allData = {
      '2026-11-01':{Me:'HEMS/N(I)', A:'N(I)', B:'D'},
      '2026-11-02':{Me:'D(I)', A:'N', B:'D'},
      '2026-11-03':{Me:'N(I)', A:'N', B:'D(I)'},
      '2026-11-04':{Me:'E', A:'D', B:'N'}
    };
    buildEvents('Me', []);
    if(events.length !== 4) throw Error('missing shifts');
    if(events[0].summary !== 'HEMS/N(I)' || events[1].summary !== 'D(I)' || events[2].summary !== 'N(I)') throw Error('raw ICU labels lost');
    if(!events[0].lines.some(([k,v])=>k==='N(함께)'&&v.includes('A'))) throw Error('N ICU coworker missing');
    if(!events[1].lines.some(([k,v])=>k==='전일 N'&&v.includes('A'))) throw Error('N ICU handoff missing');
    if(!events[2].lines.some(([k,v])=>k==='익일 D'&&v.includes('A'))) throw Error('following D handoff missing');
  `);
});

test('ICS events stay all-day, retain ICU code, with stable UID', () => {
  const result = evaluate(`
    allData={'2026-11-01':{Me:'N(I)'},'2026-12-01':{Me:'D(I)'}};
    buildEvents('Me',[]);
    const first=buildIcs(events),second=buildIcs(events);
    const ids1=[...first.matchAll(/^UID:(.+)$/gm)].map(m=>m[1]);
    const ids2=[...second.matchAll(/^UID:(.+)$/gm)].map(m=>m[1]);
    if(ids1.length!==2||ids1.join('|')!==ids2.join('|')) throw Error('unstable UID');
    if(!first.includes('SUMMARY:N(I)')||!first.includes('SUMMARY:D(I)')) throw Error('missing ICU title');
    if(!first.includes('DTSTART;VALUE=DATE:20261101')||!first.includes('DTEND;VALUE=DATE:20261102')) throw Error('not all-day');
    return ids1.length;
  `);
  assert.equal(result, 2);
});

test('unknown personal duty code fails closed', () => {
  evaluate(`
    allData={'2026-11-01':{Me:'UNKNOWN'}};
    let threw=false;
    try{buildEvents('Me',[]);}catch(e){threw=e.message.includes('미지원 근무코드');}
    if(!threw)throw Error('unknown code quietly omitted');
  `);
});
