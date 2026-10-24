import type { Cell } from './types.js';
import { check, sha } from './policy.js';
const COLUMNS = ['age_band','sex','region','period','domain','code_system','code','label','participants'] as const;
const xml=(v:unknown)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
export function csvCell(v:unknown) {let s=String(v??'');if(/^[\s\uFEFF]*[=+@-]|^[\t\r\n]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}
function crc32(b:Buffer){let c=0xffffffff;for(const n of b){c^=n;for(let i=0;i<8;i++)c=(c>>>1)^(0xedb88320&-(c&1));}return(c^0xffffffff)>>>0;}
/** Small dependency-free OPC ZIP writer. Files are stored (no zip bomb amplification). */
export function zip(files:Record<string,string|Buffer>):Buffer{
  const chunks:Buffer[]=[],central:Buffer[]=[];let offset=0;
  for(const [name,value] of Object.entries(files)){
    const n=Buffer.from(name),b=Buffer.from(value),crc=crc32(b),h=Buffer.alloc(30);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x800,6);h.writeUInt32LE(crc,14);h.writeUInt32LE(b.length,18);h.writeUInt32LE(b.length,22);h.writeUInt16LE(n.length,26);
    const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x800,8);c.writeUInt32LE(crc,16);c.writeUInt32LE(b.length,20);c.writeUInt32LE(b.length,24);c.writeUInt16LE(n.length,28);c.writeUInt32LE(offset,42);
    chunks.push(h,n,b);central.push(c,n);offset+=h.length+n.length+b.length;
  }
  const directory=Buffer.concat(central),e=Buffer.alloc(22),count=Object.keys(files).length;e.writeUInt32LE(0x06054b50);e.writeUInt16LE(count,8);e.writeUInt16LE(count,10);e.writeUInt32LE(directory.length,12);e.writeUInt32LE(offset,16);return Buffer.concat([...chunks,directory,e]);
}
export function xlsx(rows:Cell[],release:string):Buffer{
  const all:(string|number)[][]=[['A-Health Research | approved aggregate export'],['Release',release],['Only published cells. Counts may overlap; do not sum as unique patients.'],[...COLUMNS],...rows.map(r=>COLUMNS.map(k=>r[k]))];
  const sheet=all.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>`<c r="${String.fromCharCode(65+j)}${i+1}" s="${i===0?2:i===3?1:0}" ${typeof v==='number'?'':'t="inlineStr"'}>${typeof v==='number'?`<v>${v}</v>`:`<is><t xml:space="preserve">${xml(v)}</t></is>`}</c>`).join('')}</row>`).join('');
  return zip({
    '[Content_Types].xml':'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Approved aggregates" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FF124B45"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF124B45"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="7" width="17" customWidth="1"/><col min="8" max="8" width="40" customWidth="1"/><col min="9" max="9" width="18" customWidth="1"/></cols><sheetData>${sheet}</sheetData><autoFilter ref="A4:I${all.length}"/></worksheet>`,
  });
}
export function formatExport(rows:Cell[],format:string,meta:{release_id:string;release_hash:string;minimum_cell_size:number}) {
  check(rows.length<=5000&&rows.every(r=>r.participants>=meta.minimum_cell_size),422,'UNSAFE_EXPORT','Export failed disclosure checks.');
  let bytes:Buffer,mime:string;
  if(format==='csv'){bytes=Buffer.from('\uFEFF'+[COLUMNS.map(csvCell).join(','),...rows.map(r=>COLUMNS.map(k=>csvCell(r[k])).join(','))].join('\r\n'));mime='text/csv;charset=utf-8';}
  else if(format==='xlsx'){bytes=xlsx(rows,meta.release_id);mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';}
  else if(format==='json'){bytes=Buffer.from(JSON.stringify({kind:'approved_aggregate_cells',...meta,fee_tzs:0,rows},null,2));mime='application/json';}
  else if(format==='xml'){bytes=Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><research-release id="${xml(meta.release_id)}" hash="${xml(meta.release_hash)}" minimum-cell-size="${meta.minimum_cell_size}" access-fee-tzs="0"><scope>approved_aggregate_cells</scope><rows>${rows.map(r=>`<row>${COLUMNS.map(k=>`<${k}>${xml(r[k])}</${k}>`).join('')}</row>`).join('')}</rows></research-release>`);mime='application/xml';}
  else {throw new Error('Unsupported export format');}
  return {file_name:`ahp-research-${meta.release_id}.${format}`,content_type:mime,content_base64:bytes.toString('base64'),sha256:sha(bytes),size_bytes:bytes.length,fee_tzs:0};
}
