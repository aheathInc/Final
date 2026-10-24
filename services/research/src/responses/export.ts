import { zip, csvCell } from '../portal/export.js';
import { check, sha } from '../portal/policy.js';
import { TABLES } from '../warehouse/catalog.js';
import type { CdmRow } from '../warehouse/sql.js';
const xml=(v:unknown)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const col=(i:number):string=>{let s='';for(let n=i+1;n>0;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
const csv=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?String(v):typeof v==='boolean'?(v?'true':'false'):csvCell(v);
export function tableCsv(columns:string[],rows:Record<string,unknown>[]):string{
  return '\uFEFF'+[columns.map(csvCell).join(','),...rows.map(r=>columns.map(c=>csv(r[c])).join(','))].join('\r\n');
}
export function tableXlsx(columns:string[],rows:Record<string,unknown>[],title:string):Buffer{
  const all:unknown[][]=[[title],['Pseudonymized or aggregate research output; use only under the approved project.'],columns,...rows.map(r=>columns.map(c=>r[c]??null))];
  const sheet=all.map((row,i)=>`<row r="${i+1}">${row.map((v,j)=>`<c r="${col(j)}${i+1}" s="${i===0?2:i===2?1:0}" ${typeof v==='number'?'':typeof v==='boolean'?'t="b"':'t="inlineStr"'}>${typeof v==='number'?`<v>${v}</v>`:typeof v==='boolean'?`<v>${v?1:0}</v>`:`<is><t xml:space="preserve">${xml(v)}</t></is>`}</c>`).join('')}</row>`).join('');
  return zip({
    '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml':'<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Approved research output" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml':'<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="18"/><color rgb="FF124B45"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF124B45"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    'xl/worksheets/sheet1.xml':`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A4" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="${columns.length}" width="22" customWidth="1"/></cols><sheetData>${sheet}</sheetData><autoFilter ref="A3:${col(columns.length-1)}${all.length}"/></worksheet>`,
  });
}
export function outputTable(rows:Record<string,unknown>[],columns:string[],format:string,meta:Record<string,unknown>){
  check(rows.length<=20000&&columns.length<=24,413,'EXPORT_TOO_LARGE','Research output is too large for this endpoint.');let bytes:Buffer,mime:string;
  if(format==='csv'){bytes=Buffer.from(tableCsv(columns,rows));mime='text/csv;charset=utf-8';}
  else if(format==='xlsx'){bytes=tableXlsx(columns,rows,'A-Health | approved research responses');mime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';}
  else if(format==='json'){bytes=Buffer.from(JSON.stringify({metadata:meta,columns,rows},null,2));mime='application/json';}
  else if(format==='xml'){bytes=Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><research-output access-fee-tzs="0"><metadata>${Object.entries(meta).map(([k,v])=>`<item key="${xml(k)}">${xml(v)}</item>`).join('')}</metadata><rows>${rows.map(r=>`<row>${columns.map(c=>`<field key="${xml(c)}">${xml(r[c])}</field>`).join('')}</row>`).join('')}</rows></research-output>`);mime='application/xml';}
  else throw Error('Unsupported approved export format');
  check(bytes.length<=16*1024*1024,413,'EXPORT_TOO_LARGE','Use a smaller approved release.');
  return {file_name:`ahp-research-output-${String(meta.output_id)}.${format}`,content_type:mime,content_base64:bytes.toString('base64'),sha256:sha(bytes),size_bytes:bytes.length,fee_tzs:0};
}
export function omopZip(tables:Record<string,CdmRow[]>,manifest:Record<string,unknown>,outputId:string){
  const files:Record<string,string|Buffer>={},hashes:Record<string,string>={};let size=0;
  for(const t of TABLES){const name='cdm/'+t.name+'.csv';const bytes=Buffer.from(tableCsv(t.columns.map(c=>c.name),tables[t.name]??[]));size+=bytes.length;check(size<=32*1024*1024,413,'EXPORT_TOO_LARGE','Partition the approved OMOP extract.');files[name]=bytes;hashes[name]=sha(bytes);}
  files['manifest.json']=JSON.stringify({...manifest,output_id:outputId,cdm_version:'5.4',fee_tzs:0,files:hashes},null,2);
  files['data-dictionary.json']=JSON.stringify({cdm_version:'5.4',tables:TABLES},null,2);
  files['README.txt']='Approved pseudonymized OMOP 5.4 research extract. Not anonymous. All 39 CDM relation headers are present. Vocabulary CSVs intentionally contain headers only: obtain the exact licensed Athena vocabulary release in manifest.json. Source identifiers, exact birth dates and unreviewed free text are excluded. Follow the project authorization; do not re-identify or redistribute.\n';
  const bytes=zip(files);return {file_name:`ahp-omop-${outputId}.zip`,content_type:'application/zip',content_base64:bytes.toString('base64'),sha256:sha(bytes),size_bytes:bytes.length,fee_tzs:0};
}
