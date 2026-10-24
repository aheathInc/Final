/** UI-independent state machine. All care/payment writes call existing authenticated service APIs. */
export type Step={state:string;context:Record<string,any>;response:string;terminate:boolean};
export type UssdApi=(service:'auth'|'consultation'|'doctor'|'appointment'|'payment',path:string,method:'GET'|'POST',body?:unknown,key?:string)=>Promise<any>;
const root='A-Health\n1. Pata huduma hospitalini\n2. Ziara/foleni yangu\n3. Bili na malipo\n4. Miadi yangu\n0. Toka';
function page(items:any[],title:string,label:(v:any)=>string,offset=0){
 return title.slice(0,40)+'\n'+items.slice(offset,offset+3).map((item,index)=>`${index+1}. ${label(item).replace(/[\r\n]/g,' ').slice(0,30)}`).join('\n')
  +(offset+3<items.length?'\n9. Zaidi':'')+(offset>0?'\n8. Nyuma':'')+'\n0. Toka';
}
function pick(items:any[],choice:string,offset=0){if(!/^[1-3]$/.test(choice))return undefined;return items[offset+Number(choice)-1];}
export async function ussdStep(state:string,context:Record<string,any>,choice:string,api:UssdApi,requestKey:string,now=new Date()):Promise<Step>{
 const next=(s:string,response:string,extra:Record<string,any>={},terminate=false):Step=>({state:s,context:{...context,...(s!==state?{offset:0}:{}),...extra},response,terminate});
 const end=(msg:string)=>next('closed',msg,{},true);
 if(choice==='0'&&state!=='otp')return end('Asante kwa kutumia A-Health.');
 const menuMap:Record<string,{items:any[];title:string;label:(v:any)=>string}>={
  facility:{items:context.facilities??[],title:'Chagua kituo',label:x=>x.name},
  department:{items:context.departments??[],title:'Thibitisha idara (si diagnosis)',label:x=>x.name},
  doctor:{items:context.doctors??[],title:'Daktari; foleni AHP tu',label:x=>`${x.full_name??'Daktari'} (${x.waiting_for_this_clinician??0})`},
  bill:{items:context.bills??[],title:'Chagua bili',label:x=>`${x.title}: ${x.amount} ${x.currency}`},
  slot:{items:context.slots??[],title:'Miadi ya simu (saa Dar)',label:x=>new Date(x.starts_at).toLocaleString('en-GB',{timeZone:'Africa/Dar_es_Salaam',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})},
 };
 if(menuMap[state]&&['8','9'].includes(choice)){
  const m=menuMap[state],offset=Number(context.offset??0);
  const updated=choice==='9'?(offset+3<m.items.length?offset+3:offset):Math.max(0,offset-3);
  return next(state,page(m.items,m.title,m.label,updated),{offset:updated});
 }
 if(state==='root'){
   if(choice==='1')return next('urgency','Unahitaji msaada wa dharura?\n1. Ndiyo / sijui\n2. Hapana, endelea\n0. Toka');
   if(choice==='2'){
     const data=await api('consultation','/front-desk/visits?limit=3','GET');const rows=Array.isArray(data.data)?data.data:[];
     return end(rows.length?rows.map((x:any)=>`${x.ticket??x.id}: ${x.status}. Makadirio ya muda hayajathibitishwa.`).join('\n'):'Hakuna ziara iliyorudishwa kwa akaunti hii.');
   }
   if(choice==='3'){
     const d=await api('payment','/payments/bills','GET');const bills=(d.data??[]).filter((x:any)=>x.status==='due'&&new Date(x.expires_at)>now).slice(0,100);
     if(!bills.length)return end('Hakuna bili inayodaiwa sasa.');
     return next('bill',page(bills,'Chagua bili',x=>`${x.title}: ${x.amount} ${x.currency}`),{bills});
   }
   if(choice==='4'){
     const d=await api('appointment','/appointments?limit=3','GET');return end((d.data??[]).map((x:any)=>`${x.starts_at??x.scheduled_at??''}: ${x.status}`).join('\n')||'Hakuna miadi iliyorudishwa.');
   }
   return next('root',root);
 }
 if(state==='urgency'){
   if(choice==='1')return end('Omba msaada wa hospitali au huduma ya dharura sasa. USSD haitumi ambulance. Usisubiri foleni ya kawaida.');
   if(choice!=='2')return next('urgency','Chagua 1 kwa msaada wa haraka, 2 kuendelea, 0 kutoka.');
   return next('region','Andika mkoa unaotaka kupata huduma (au 99 kwa vituo vyote).');
 }
 if(state==='region'){
   if(choice.trim().length<1||choice.length>50)return next('region','Andika jina au code ya mkoa (herufi zisizozidi 50).');
   const d=await api('consultation','/front-desk/facilities?limit=100','GET');
   const all=Array.isArray(d.data)?d.data.map((x:any)=>({id:x.id,name:x.name,region_code:x.region_code})):[];
   const facilities=all.filter((x:any)=>choice==='99'||String(x.region_code??'').toLowerCase()===choice.toLowerCase()||String(x.name??'').toLowerCase().includes(choice.toLowerCase())).slice(0,100);
   if(!facilities.length)return next('region','Hakuna kituo cha A-Health kilichopatikana. Jaribu mkoa/code nyingine au 99.');
   return next('facility',page(facilities,'Chagua kituo',x=>x.name),{facilities});
 }
 if(state==='facility'){
   const f=pick(context.facilities??[],choice,context.offset??0);if(!f)return next('facility','Chagua namba ya kituo iliyoonyeshwa.');
   return next('symptoms','Eleza tatizo kuu kwa kifupi (herufi 1-300). Huu si utambuzi wa ugonjwa.',{facility:f,facilities:[]});
 }
 if(state==='symptoms'){
   if(!choice.trim()||choice.length>300)return next('symptoms','Maelezo yawe kati ya herufi 1 na 300.');
   const d=await api('consultation',`/front-desk/facilities/${context.facility.id}/navigation`,'POST',{text:choice});
   const all=await api('consultation',`/front-desk/facilities/${context.facility.id}/departments`,'GET');
   const suggested=(d.suggestions??[]).map((x:any)=>x.department_id);
   const departments=(all.data??[]).sort((a:any,b:any)=>Number(suggested.includes(b.id))-Number(suggested.includes(a.id))).slice(0,100);
   if(!departments.length)return end('Kituo hakina idara inayopokea kupitia A-Health. Wasiliana na reception.');
   return next('department',page(departments,'Thibitisha idara (mapendekezo si diagnosis)',x=>x.name),{departments,symptoms:choice});
 }
 if(state==='department'){
   const d=pick(context.departments??[],choice,context.offset??0);if(!d)return next('department','Chagua idara kwenye orodha.');
   const board=await api('consultation',`/front-desk/facilities/${context.facility.id}/departments/${d.id}/queue`,'GET');
   const doctors=(board.providers??[]).filter((x:any)=>x.receiving_new_patients).map((x:any)=>({id:x.id,full_name:x.full_name,waiting_for_this_clinician:x.waiting_for_this_clinician})).slice(0,100);
   if(!doctors.length)return end('Hakuna daktari anayepokea requests sasa. Tafadhali wasiliana na kituo.');
   return next('doctor',page(doctors,'Daktari; foleni ya AHP tu, muda haujahakikiwa',x=>`${x.full_name??'Daktari'} (${x.waiting_for_this_clinician??0} wanasubiri)`),{department:d,doctors,departments:[]});
 }
 if(state==='doctor'){
   const d=pick(context.doctors??[],choice,context.offset??0);if(!d)return next('doctor','Chagua namba ya daktari.');
   return next('timing','Chagua huduma\n1. Hospitalini sasa / pre-registration\n2. Miadi ya simu baadaye\n0. Toka',{doctor:d,doctors:[]});
 }
 if(state==='timing'){
   if(choice==='1')return next('confirm_visit','Shiriki maelezo haya na idara uliyochagua?\n1. Nakubali, tuma ombi\n0. Situmi');
   if(choice==='2'){
     const from=now.toISOString().slice(0,10),to=new Date(now.getTime()+30*86400000).toISOString().slice(0,10);
     const d=await api('doctor',`/clinicians/${context.doctor.id}/slots?from=${from}&to=${to}`,'GET');
     const slots=(d.data??[]).filter((x:any)=>!x.is_booked&&x.modality==='voice').slice(0,100);
     if(!slots.length)return end('Hakuna nafasi ya miadi ya simu iliyochapishwa.');
     return next('slot',page(slots,'Miadi ya simu (saa Dar es Salaam)',x=>new Date(x.starts_at).toLocaleString('en-GB',{timeZone:'Africa/Dar_es_Salaam',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})),{slots});
   }
   return next('timing','Chagua 1 sasa, 2 baadaye, 0 kutoka.');
 }
 if(state==='slot'){
   const slot=pick(context.slots??[],choice,context.offset??0);if(!slot)return next('slot','Chagua nafasi iliyo kwenye orodha.');
   return next('confirm_slot','Unakubali kuhifadhi miadi na kushiriki sababu na daktari?\n1. Ndiyo\n0. Hapana',{slot,slots:[]});
 }
 if(state==='confirm_slot'){
   if(choice!=='1')return next('confirm_slot','Chagua 1 kuthibitisha au 0 kutoka.');
   const result=await api('appointment','/appointments','POST',{slot_id:context.slot.id,reason:context.symptoms},requestKey);
   return end(`Miadi imehifadhiwa. Rejea ${result.id}. Hii si uthibitisho wa malipo wala simu iliyopigwa.`);
 }
 if(state==='confirm_visit'){
   if(choice!=='1')return next('confirm_visit','Chagua 1 kutuma au 0 kutoka.');
   const result=await api('consultation','/front-desk/visits','POST',{request_key:requestKey,facility_id:context.facility.id,department_id:context.department.id,requested_clinician_id:context.doctor.id,purpose:context.symptoms,share_with_department:true,urgent_help_requested:false},requestKey);
   return end(`Ombi limehifadhiwa. Rejea ${result.ticket??result.id}. Nenda reception/triage uthibitishwe. Daktari bado hajaanza huduma.`);
 }
 if(state==='bill'){
   const bill=pick(context.bills??[],choice,context.offset??0);if(!bill)return next('bill','Chagua namba ya bili iliyoonyeshwa.');
   const options=await api('payment','/payments/options','GET');
   return next('wallet',`${bill.amount} ${bill.currency}\n1. M-Pesa\n2. Mixx by Yas (Tigo Pesa)\n3. Airtel Money\n0. Toka`,{bill,options,bills:[]});
 }
 if(state==='wallet'){
   const provider=({'1':'mpesa','2':'tigo_pesa','3':'airtel_money'} as Record<string,string>)[choice];
   if(!provider)return next('wallet','Chagua 1 M-Pesa, 2 Mixx, 3 Airtel.');
   if(!context.options.providers.includes(provider))return end('Provider huyo hajasanidiwa.');
   if(context.options.requires_email)return next('email','Provider anahitaji email ya mlipaji. Andika email, au 0 kutumia njia nyingine.',{provider});
   return next('confirm_payment','Thibitisha kulipa bili kwa namba hii. PIN itaingizwa kwa provider, si hapa.\n1. Endelea\n0. Acha',{provider});
 }
 if(state==='email'){
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(choice)||choice.length>150)return next('email','Email haijakubalika. Andika tena au 0 kutoka.');
   return next('confirm_payment','1. Omba malipo kwa wallet ya namba hii\n0. Acha\nUsiweke PIN kwenye A-Health.',{email:choice});
 }
 if(state==='confirm_payment'){
   if(choice!=='1')return next('confirm_payment','Chagua 1 kuendelea au 0 kutoka.');
   const result=await api('payment','/payments/intents','POST',{bill_id:context.bill.id,method:'mobile_money',provider:context.provider,payer_phone:context.phone,...(context.email?{payer_email:context.email}:{})},requestKey);
   return end(result.environment==='simulated'?'MAJARIBIO: ombi limehifadhiwa, hakuna fedha zilizotumwa.':`Ombi la malipo ${result.id}. Idhinisha kwenye wallet yako. Malipo yanasubiri uthibitisho wa provider.`);
 }
 return next('root',root);
}
export const USSD_MAIN_MENU=root;
