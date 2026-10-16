'use strict';
document.getElementById('form').addEventListener('submit',async e=>{
  e.preventDefault();
  const status=document.getElementById('status'), result=document.getElementById('result'), button=document.getElementById('submit');
  result.textContent='';button.disabled=true;status.textContent='읽기 및 비교 중…';
  try{
    const file=document.getElementById('excel').files[0];
    if(!file || !file.name.toLowerCase().endsWith('.xlsx') || file.size>8*1024*1024)throw Error('8 MiB 이하 .xlsx 파일을 선택하세요.');
    const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
    for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const response=await fetch('/api/preview',{method:'POST',headers:{'Content-Type':'application/json','X-AER-Preview':'1'},body:JSON.stringify({xlsx:btoa(binary),person:document.getElementById('person').value.trim(),residents:document.getElementById('residents').value.split(',').map(s=>s.trim()).filter(Boolean)})});
    if(!response.ok)throw Error(await response.text());
    const plan=await response.json();
    status.textContent=`기존 ${plan.existingCount}건 · 신규 ${plan.counts.create} · 변경 ${plan.counts.update} · 동일 ${plan.counts.noop} · 검토 ${plan.counts.review} · 실제 반영 0건`;
    const rows=plan.actions.map(a=>`${a.desired?.start.date||a.date||''} ${a.action} ${a.desired?.summary||''}${a.reason?' ('+a.reason+')':''}\n${a.desired?.description||''}`);
    result.textContent=(plan.blocked?'검토 항목이 있어 전체 적용을 보류해야 합니다.\n\n':'')+rows.join('\n\n');
  }catch(err){status.textContent=err.message;}finally{button.disabled=false;}
});

// Transfer the selected File without putting roster data in URLs, storage or public requests.
window.addEventListener('message',e=>{
  if(e.origin!=='https://emdoc119.github.io' || e.source!==window.opener || e.data?.type!=='aer-excel')return;
  const {file,person,residents}=e.data;
  if(!(file instanceof File) || file.size>8*1024*1024 || typeof person!=='string' || typeof residents!=='string')return;
  const transfer=new DataTransfer();transfer.items.add(file);
  document.getElementById('excel').files=transfer.files;
  document.getElementById('person').value=person;
  document.getElementById('residents').value=residents;
  document.getElementById('status').textContent='웹에서 전달된 Excel입니다. 이름과 파일을 확인한 뒤 비교 버튼을 누르세요.';
});
if(window.opener)window.opener.postMessage({type:'aer-ready'},'https://emdoc119.github.io');
