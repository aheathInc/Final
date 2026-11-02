// Browser UX uses clearly labelled synthetic aggregates; no fake clinical rows enter the live database.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'..');process.env.AHP_SOURCE_ROOT=root;
const env=require('dotenv').parse(fs.readFileSync(path.join(root,'.env')));
const dbUrl=new URL(env.DATABASE_URL);assert.equal(dbUrl.hostname,'127.0.0.1');assert.equal(dbUrl.port,'55432');assert.equal(dbUrl.pathname,'/ahealth_dev');
const {PrismaClient}=createRequire(path.join(root,'packages/database/package.json'))('@prisma/client');
const bcrypt=createRequire(path.join(root,'services/auth/package.json'))('bcrypt');
const prisma=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
const {chromium}=createRequire(path.join(root,'apps/staff-web/package.json'))('@playwright/test');
const {load}=require('./lib/load-typescript.cjs');const {reportFromReleases}=load('services/surveillance/src/services/regional-insights.policy.ts');
const out=path.join(root,'.impeccable/review/openstreetmap');fs.mkdirSync(out,{recursive:true});
const a=(code,name,level,parentCode,latitude=null,longitude=null)=>({code,name,level,parentCode,latitude,longitude});
const areas=[a('C','Synthetic country','country',null,-6,35),a('R1','Synthetic East','region','C',-6.8,39.2),a('R2','Synthetic Central','region','C',-6.2,35.7),a('R3','Synthetic withheld area','region','C',-5,37),a('D','Synthetic district','district','R1',-6.8,39.2),a('W','Synthetic ward','ward','D',-6.8,39.2),a('V','Synthetic village','village','W',-6.8,39.2)];
const releases=['2026-06','2026-07','2026-08','2026-09'].map((period,i)=>({period,publishedAt:new Date('2026-10-01T12:00:00Z'),payload:{version:1,areas,labels:{B50:'Synthetic disease A',J00:'Synthetic disease B'},cells:[{areaCode:'V',conditionCode:'B50',cases:48+i*7},{areaCode:'R2',conditionCode:'B50',cases:30+i*4},{areaCode:'V',conditionCode:'J00',cases:22+i*3}]}}));
async function login(page,email){await page.goto('http://localhost:3000/login');await page.waitForLoadState('networkidle');await page.request.get('http://localhost:3000/api/auth/csrf');await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(env.AHP_LOCAL_TEST_PASSWORD);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL(url=>!url.pathname.includes('/login'));}
async function capture(page,name){await page.evaluate(()=>scrollTo(0,0));await page.waitForTimeout(150);await page.screenshot({path:path.join(out,name+'.png'),fullPage:!(await page.locator('dialog[open]').count())});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal page overflow');}
(async()=>{
 const browser=await chromium.launch({channel:'chrome',headless:true});
 let reviewer;
 try{
  const email='regional-insights-review@dev.local', marker='AHP Local Test: Regional Insights Reviewer';
  const existing=await prisma.user.findUnique({where:{email}});if(existing&&existing.fullName!==marker)throw Error('Refusing to change unmarked account');
  const account={fullName:marker,phoneNumber:'TEST-REGIONAL-REVIEW',role:'platform_admin',status:'active',passwordHash:await bcrypt.hash(env.AHP_LOCAL_TEST_PASSWORD,12),failedLoginCount:0,lockedUntil:null};
  reviewer=await prisma.user.upsert({where:{email},create:{email,...account},update:account});
  const context=await browser.newContext({viewport:{width:1440,height:1100}});const page=await context.newPage();page.setDefaultTimeout(90000);
  await login(page,email);await page.waitForURL('**/admin/dashboard');
  await page.getByRole('heading',{name:'Health & Regional Insights',exact:true}).waitFor();
  const actual=await page.request.get('http://localhost:3000/bff/surveillance/regional-insights');assert.equal(actual.status(),200);
  const live=await actual.json();assert.ok(Array.isArray(live.availablePeriods));assert.ok(!JSON.stringify(live).includes('diagnosisText'));
  console.log('Real administrator routing and authorized report API: PASS');
  let mode='fixture';
  await page.route('**/bff/surveillance/regional-insights?*',async route=>{
   if(mode==='error')return route.fulfill({status:503,json:{error:{message:'Synthetic unavailable service'}}});
   const q=new URL(route.request().url()).searchParams;
   let rows=mode==='empty'?[]:releases.filter(r=>(!q.get('from')||r.period>=q.get('from'))&&(!q.get('to')||r.period<=q.get('to')));
   const report=reportFromReleases(rows,{level:q.get('level')||'region',area:q.get('area')||undefined,condition:q.get('condition')||undefined});
   return route.fulfill({json:{...report,source:'SYNTHETIC ACCEPTANCE DATA — no patient records',availablePeriods:mode==='empty'?[]:releases.map(r=>r.period).reverse()}});
  });
  const errors=[];page.on('pageerror',e=>errors.push(e.stack||e.message));
  async function settledMap(scope=page){
    await scope.locator('.leaflet-container').waitFor();
    await page.waitForFunction(()=>{const parent=document.querySelector('dialog[open]')||document;const tiles=[...parent.querySelectorAll('.leaflet-tile')];return tiles.length>0&&tiles.every(i=>i.complete&&i.naturalWidth>0);},{},{timeout:45000});
    await page.waitForTimeout(400);
  }
  async function fullscreenSize(){
    const size=await page.getByRole('dialog',{name:'Fullscreen disease map'}).boundingBox();
    const viewport=page.viewportSize();assert.ok(Math.abs(size.width-viewport.width)<2&&Math.abs(size.height-viewport.height)<2,'Map dialog fills viewport');
  }
  await page.goto('http://localhost:3000/admin/insights');await settledMap();
  assert.ok(await page.getByRole('link',{name:'OpenStreetMap',exact:true}).isVisible());
  await page.getByRole('button',{name:'Fullscreen map',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Fullscreen disease map'});await dialog.waitFor();await settledMap(dialog);await fullscreenSize();
  await capture(page,'desktop');
  await dialog.getByText('Disease & location filters',{exact:true}).click();
  await dialog.getByLabel('Disease',{exact:true}).selectOption('B50');
  await dialog.getByRole('heading',{name:'Synthetic disease A in all recorded areas',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('dialog [aria-busy="true"]'));
  await dialog.getByLabel('Country',{exact:true}).selectOption('C');
  await dialog.getByLabel('Region',{exact:true}).selectOption('R1');
  await page.waitForFunction(()=>!document.querySelector('dialog [aria-busy="true"]'));
  await dialog.getByLabel('District',{exact:true}).selectOption('D');
  await dialog.getByRole('heading',{name:'Synthetic disease A in Synthetic district',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('dialog [aria-busy="true"]'));
  await settledMap(dialog);await capture(page,'desktop-filters');
  await dialog.getByRole('button',{name:'Reset filters',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('dialog [aria-busy="true"]'));
  await dialog.getByText('Disease & location filters',{exact:true}).click();
  await dialog.getByRole('button',{name:/Synthetic East: .*Filter this area/}).click();
  await dialog.getByRole('heading',{name:'All diseases in Synthetic East',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.querySelector('dialog [aria-busy="true"]'));
  await dialog.getByRole('button',{name:'Zoom in',exact:true}).click();await page.waitForTimeout(300);
  await dialog.getByRole('button',{name:'Zoom out',exact:true}).click();
  await dialog.getByRole('button',{name:'Fit recorded areas',exact:true}).click();
  await page.keyboard.press('Escape');assert.equal(await dialog.count(),0);
  assert.ok(await page.getByRole('button',{name:'Fullscreen map',exact:true}).evaluate(el=>el===document.activeElement),'Focus returns on Escape');
  await page.getByRole('button',{name:'Reset filters',exact:true}).click();await page.getByRole('checkbox',{name:'Compare Synthetic East',exact:true}).waitFor();
  await page.getByRole('button',{name:'Fullscreen map',exact:true}).click();await settledMap(dialog);
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(400);await settledMap(dialog);await fullscreenSize();await capture(page,'mobile');
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';});await capture(page,'mobile-dark');
  await dialog.getByRole('button',{name:'Exit fullscreen',exact:true}).click();assert.equal(await dialog.count(),0);
  mode='empty';await page.goto('http://localhost:3000/admin/insights?map=fullscreen');await dialog.waitFor();await settledMap(dialog);await fullscreenSize();await capture(page,'empty');
  assert.ok((await dialog.innerText()).includes('No publishable areas with recorded map coordinates'));
  assert.equal(await dialog.locator('.leaflet-marker-icon').count(),0);
  await dialog.getByRole('button',{name:'Exit fullscreen',exact:true}).click();
  mode='fixture';await page.route('https://tile.openstreetmap.org/**',route=>route.abort());
  await page.goto('http://localhost:3000/admin/insights?map=fullscreen');await dialog.waitFor();
  await dialog.getByText('OpenStreetMap could not fully load.',{exact:false}).waitFor();await capture(page,'tile-error');
  assert.ok(await dialog.getByRole('button',{name:'Retry map',exact:true}).isVisible());
  await page.unroute('https://tile.openstreetmap.org/**');
  await dialog.getByRole('button',{name:'Retry map',exact:true}).click();await settledMap(dialog);
  assert.equal(await dialog.getByRole('button',{name:'Retry map',exact:true}).count(),0);
  assert.deepEqual(errors,[]);
  console.log('OpenStreetMap tiles and attribution; full viewport desktop/mobile/dark; disease/location filters retained; marker drilldown; zoom; Escape/focus restoration; direct fullscreen URL; no-data and tile-error states: PASS');
 }finally{await browser.close();if(reviewer)await prisma.user.update({where:{id:reviewer.id},data:{status:'suspended'}});await prisma.$disconnect();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
