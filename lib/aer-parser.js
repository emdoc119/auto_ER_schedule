(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.AER=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';

const DUTY_LABEL = {D:'D', E:'E', N:'N', HEMS:'Heli', 'HEMS/N':'Heli+N 24시간'};
const SKIP = new Set(['O','휴가', undefined, null, '']);
// ICU (I) 겸무 표시 보존 / 기본 근무 그룹 판정 분리.
const SUPPORTED_SHIFT = new Set(['D','E','N','HEMS','HEMS/N']);
function baseDutyCode(raw){
  if(raw == null || SKIP.has(raw)) return null;
  if(typeof raw !== 'string') return null;
  const code = raw.trim();
  const m = code.match(/^(D|E|N|HEMS|HEMS\/N)\(I\)$/);
  return m ? m[1] : code;
}
function isICUDuty(raw){
  return typeof raw === 'string' && /^(D|E|N|HEMS|HEMS\/N)\(I\)$/.test(raw.trim());
}
function stablePersonHash(person){
  let h = 2166136261;
  for(let i=0; i<person.length; i++){ h ^= person.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

function pad(n){ return n < 10 ? '0'+n : ''+n; }
function dstr(y,m,d){ return y+'-'+pad(m)+'-'+pad(d); }
function addDays(dateStr, delta){
  const [y,m,d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m-1, d);
  dt.setDate(dt.getDate()+delta);
  return dstr(dt.getFullYear(), dt.getMonth()+1, dt.getDate());
}

function parseWorkbook(wb, person, XLSX){
  if(!person || !wb || !Array.isArray(wb.SheetNames)) throw Error('이름/통합문서 확인 필요');
  const data = {};
  let sheets = 0;
  for(const sheetName of wb.SheetNames){
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {header:1, raw:true, defval:null});
    const headers = rows.slice(0,30).map((row,i)=>row.slice(7).includes(person)?i:-1).filter(i=>i>=0);
    if(!headers.length) continue;
    if(headers.length!==1) throw Error('중복 이름 헤더');
    const yearMatch=sheetName.match(/(\d{4})년/);
    if(!yearMatch) throw Error('시트 이름에 명시적인 YYYY년 필요');
    const year=Number(yearMatch[1]);
    if(year<2000 || year>2100) throw Error('연도 범위 오류');
    const idx=headers[0], cols={};
    const names=new Set();
    rows[idx].forEach((name,c)=>{
      if(c<7 || name==null || name==='') return;
      if(typeof name!=='string' || names.has(name.trim())) throw Error('의료진 헤더 오류/중복');
      names.add(name.trim()); cols[c]=name.trim();
    });
    let count=0;
    for(const row of rows.slice(idx+1)){
      if(!row || row[0]==null || row[0]==='') continue;
      const m=String(row[0]).match(/^(\d{1,2})월(\d{1,2})일(?:\s|\(|$)/);
      if(!m){ if(/월|일/.test(String(row[0]))) throw Error('날짜 형식 오류'); continue; }
      const month=Number(m[1]), day=Number(m[2]), key=dstr(year,month,day);
      const dt=new Date(Date.UTC(year,month-1,day));
      if(dt.toISOString().slice(0,10)!==key) throw Error('유효하지 않은 날짜');
      if(data[key]) throw Error('시트 간 중복 날짜');
      const dayData={};
      for(const [c,name] of Object.entries(cols)){
        const raw=row[c];
        const code=typeof raw==='string'?raw.trim():raw;
        if(!SKIP.has(code) && !['D','E','E1','MD','N','HEMS','HEMS/N','ICU','EICU','외래/E1'].includes(baseDutyCode(code))) throw Error('미지원 근무코드: '+key);
        dayData[name]=code;
      }
      data[key]=dayData; count++;
    }
    if(!count) throw Error('인식 가능한 날짜 없음');
    sheets++;
  }
  if(!sheets) throw Error('본인 이름이 있는 근무표 시트 없음');
  return data;
}
function namesWithCode(dayData, person, codes, excludeResidents, residents){
  const out = [];
  Object.keys(dayData).forEach(name => {
    if(name === person) return;
    if(excludeResidents && residents.has(name)) return;
    if(codes.includes(baseDutyCode(dayData[name]))) out.push(name);
  });
  return out;
}
function fmtList(arr){ return arr.length ? arr.join(', ') : '없음'; }

function buildEvents(allData, person, residentsList=[]){
  const residents = new Set(residentsList);
  const events = [];
  const dates = Object.keys(allData).sort();
  dates.forEach(dateStr => {
    const dayData = allData[dateStr];
    const rawCode = dayData[person];
    if(SKIP.has(rawCode)) return;
    const myCode = baseDutyCode(rawCode);
    if(!SUPPORTED_SHIFT.has(myCode)){
      throw new Error(`미지원 근무코드: ${dateStr} / ${String(rawCode)} — 일정 누락 방지를 위해 변환을 중단합니다.`);
    }
    const icuCombined = isICUDuty(rawCode);

    const prevData = allData[addDays(dateStr,-1)];
    const nextData = allData[addDays(dateStr, 1)];
    let summary = null, lines = [], cls = '';

    if(myCode === 'D'){
      summary = icuCombined ? rawCode.trim() : 'D'; cls='dD';
      lines.push(['전일 N', prevData ? fmtList(namesWithCode(prevData, person, ['N','HEMS/N'], true, residents)) : '자료없음(전월)']);
      lines.push(['D', fmtList(namesWithCode(dayData, person, ['D'], false, residents))]);
      lines.push(['E', fmtList(namesWithCode(dayData, person, ['E'], true, residents))]);
      lines.push(['MD', fmtList(namesWithCode(dayData, person, ['MD'], true, residents))]);
      lines.push(['N', fmtList(namesWithCode(dayData, person, ['N','HEMS/N'], true, residents))]);
    } else if(myCode === 'E'){
      summary = icuCombined ? rawCode.trim() : 'E'; cls='dE';
      lines.push(['D', fmtList(namesWithCode(dayData, person, ['D'], true, residents))]);
      lines.push(['MD', fmtList(namesWithCode(dayData, person, ['MD'], true, residents))]);
      lines.push(['N', fmtList(namesWithCode(dayData, person, ['N','HEMS/N'], true, residents))]);
    } else if(myCode === 'N' || myCode === 'HEMS/N'){
      summary = icuCombined ? rawCode.trim() : DUTY_LABEL[myCode]; cls = myCode==='N' ? 'dN' : 'dHeliN';
      lines.push(['D', fmtList(namesWithCode(dayData, person, ['D'], true, residents))]);
      lines.push(['E', fmtList(namesWithCode(dayData, person, ['E'], true, residents))]);
      lines.push(['N(함께)', fmtList(namesWithCode(dayData, person, ['N','HEMS/N'], false, residents))]);
      lines.push(['익일 D', nextData ? fmtList(namesWithCode(nextData, person, ['D'], true, residents)) : '자료없음(익월)']);
    } else if(myCode === 'HEMS'){
      summary = icuCombined ? rawCode.trim() : 'Heli'; cls='dHeli';
      lines.push(['D', fmtList(namesWithCode(dayData, person, ['D'], true, residents))]);
      lines.push(['E', fmtList(namesWithCode(dayData, person, ['E'], true, residents))]);
      lines.push(['MD', fmtList(namesWithCode(dayData, person, ['MD'], true, residents))]);
    } else {
      throw Error('미지원 본인 근무코드');
    }
    lines = lines.filter(([label,value]) => value && value !== '없음' && !value.startsWith('자료없음'));
    events.push({dateStr, summary, lines, cls, rawCode, person});
  });

  return events;
}


return {dstr,baseDutyCode,isICUDuty,stablePersonHash,addDays,parseWorkbook,buildEvents};
});
