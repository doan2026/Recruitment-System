// Run only against isolated local fixtures. See docs/system-regression-2026-10-16.md.
// node scripts/test-system-browser.cjs <ignored-accounts.json> <ignored-state.json>
const fs=require('node:fs');
const path=require('node:path');
const accountsFile=path.resolve(process.argv[2] || '.cache/system-accounts.json');
const stateFile=path.resolve(process.argv[3] || '.cache/system-state.json');
const artifacts=path.resolve('.cache/system-browser');
fs.mkdirSync(artifacts,{recursive:true});
const {chromium,expect}=require('../frontend/node_modules/@playwright/test');
const {accounts,batch}=JSON.parse(fs.readFileSync(accountsFile,'utf8'));
const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
for(const [name,role] of Object.entries({candidate:'CANDIDATE',recruiter:'RECRUITER',admin:'ADMIN',outsider:'CANDIDATE'})){
 const a=accounts[name];
 if(!a||a.role!==role||!a.email.endsWith('@careerhub.local')||!a.password)throw new Error('Only isolated local fixture accounts are supported');
}
for(const key of ['applicationId','aiApplicationId','aiCvId','chatId']){
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(state[key]||''))throw new Error('Missing synthetic fixture ID: '+key);
}
const checks=[];let browser,stage='login';
function check(name){checks.push(name);console.log('PASS '+name)}
async function signIn(role){
 const a=accounts[role],ctx=await browser.newContext({locale:'vi-VN',timezoneId:'Asia/Ho_Chi_Minh'}),page=await ctx.newPage();
 await page.goto('http://localhost:3000'+(role==='admin'?'/admin/login':role==='recruiter'?'/recruiter/login':'/login'));
 await page.getByLabel(role==='admin'?'Email quản trị':role==='recruiter'?'Email công việc':'Email',{exact:true}).fill(a.email);
 await page.getByLabel('Mật khẩu',{exact:true}).fill(a.password);
 const login=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth-cookie/login'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Đăng nhập',exact:true}).click();
 const response=await login;if(!response.ok())throw new Error('Login HTTP '+response.status());
 const data=(await response.json()).data;if(Object.keys(data).join(',')!=='user')throw new Error('Credentials leaked in login response');
 await expect(page).toHaveURL(new RegExp(role==='admin'?'/admin$':role==='recruiter'?'/recruiter/jobs$':'/candidate/profile$'));
 if((await page.evaluate(()=>document.cookie)).includes('careerhub_'))throw new Error('Session cookie is readable');
 const cookies=await ctx.cookies();if(!cookies.some(c=>c.name==='careerhub_token'&&c.httpOnly)||!cookies.some(c=>c.name==='careerhub_refresh'&&c.httpOnly))throw new Error('Missing HttpOnly session');
 return {page,ctx};
}
(async()=>{
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server']});
 const candidate=await signIn('candidate'),recruiter=await signIn('recruiter'),admin=await signIn('admin');
 check('Actual browser login for Candidate, Recruiter and Admin; credentials stay HttpOnly');
 stage='reload';
 await candidate.page.reload();await expect(candidate.page.getByRole('heading',{name:'Hồ sơ cá nhân',exact:true})).toBeVisible();
 if(!(await candidate.page.request.get('http://localhost:3000/api/auth/me')).ok())throw new Error('Reload lost identity');
 check('Candidate identity rehydrates from cookies after a full page reload');
 stage='refresh';
 await candidate.ctx.clearCookies({name:'careerhub_token'});
 const renewed=candidate.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/auth-cookie/refresh'&&r.request().method()==='POST');
 await candidate.page.reload();
 const refreshed=await renewed;
 if(!refreshed.ok()||Object.keys((await refreshed.json()).data).join(',')!=='user')throw new Error('Refresh failed or exposed credentials');
 await expect(candidate.page.getByRole('heading',{name:'H\u1ed3 s\u01a1 c\u00e1 nh\u00e2n',exact:true})).toBeVisible();
 if(!(await candidate.page.request.get('http://localhost:3000/api/auth/me')).ok())throw new Error('Refreshed identity missing');
 check('Missing access cookie is recovered by real refresh rotation without exposing tokens');
 stage='candidate';
 await candidate.page.goto('http://localhost:3000/candidate/applications');
 await expect(candidate.page.getByText('HIRED',{exact:true}).first()).toBeVisible();
 await candidate.page.goto('http://localhost:3000/candidate/interviews');
 await expect(candidate.page.getByText('System test office',{exact:false})).toBeVisible();
 check('Candidate views actual hired application and real GMT+7 interview schedule');
 stage='recruiter';
 await recruiter.page.goto('http://localhost:3000/recruiter/applications');
 await recruiter.page.locator('a[href=\"/recruiter/applications/'+state.applicationId+'\"]').click();
 await expect(recruiter.page).toHaveURL(new RegExp('/recruiter/applications/'+state.applicationId+'$'));
 await expect(recruiter.page.getByText('HIRED',{exact:true}).first()).toBeVisible();
 check('Recruiter company pipeline opens the stored application detail without mock candidate data');
 stage='admin';
 const dates='from='+new Date(Date.now()-7*86400000).toISOString().slice(0,10)+'&to='+new Date().toISOString().slice(0,10);
 for(const kind of ['csv','xlsx']){
   const r=await admin.page.request.get('http://localhost:3000/api/admin/stats/export?type='+kind+'&'+dates);
   if(!r.ok())throw new Error('Admin export '+r.status());
   if(kind==='xlsx'&&(await r.body()).subarray(0,2).toString()!=='PK')throw new Error('Invalid XLSX');
 }
 if((await candidate.page.request.get('http://localhost:3000/api/admin/users')).status()!==403)throw new Error('Candidate accessed Admin');
 check('Admin exports real CSV/XLSX; Candidate session cannot read Admin resources');
 stage='workspace';
 for(const tab of ['users','companies','jobs','reports']){
  await admin.page.goto('http://localhost:3000/admin/'+tab);
  await expect(admin.page.getByRole('navigation',{name:'Ch\u1ee9c n\u0103ng qu\u1ea3n tr\u1ecb'})).toBeVisible();
  await expect(admin.page.getByRole('button',{name:'T\u1ea3i l\u1ea1i d\u1eef li\u1ec7u',exact:true})).toBeEnabled();
 }
 await candidate.page.goto('http://localhost:3000/candidate/dashboard');
 await expect(candidate.page.getByRole('region',{name:'Th\u1ed1ng k\u00ea c\u1ee7a t\u00f4i'})).toBeVisible();
 const synthetic=await signIn('outsider');
 await synthetic.page.goto('http://localhost:3000/candidate/cvs/'+state.aiCvId);
 await expect(synthetic.page.getByRole('heading',{name:'Synthetic AI CV '+batch})).toBeVisible();
 check('Actual Docker UI loads all Admin workspaces, owned dashboard and private CV metadata');
 stage='schedule-ui';
 if(!state.aiInterviewId){
  const read=await recruiter.page.request.get('http://localhost:3000/api/applications/'+state.aiApplicationId);const app=(await read.json()).data;
  if(app.status==='APPLIED'){
   const move=await recruiter.page.request.patch('http://localhost:3000/api/applications/'+state.aiApplicationId+'/status',{data:{status:'REVIEWING',expectedVersion:app.version,note:'Synthetic browser scheduling'}});
   if(!move.ok())throw new Error('Review transition failed');
  }
  await recruiter.page.goto('http://localhost:3000/recruiter/applications/'+state.aiApplicationId+'/interview');
  await recruiter.page.getByLabel('V\u00f2ng ph\u1ecfng v\u1ea5n').fill('1');
  const start=new Date(Date.now()+7*86400000).toISOString().slice(0,10)+'T14:30';
  await recruiter.page.getByLabel('Th\u1eddi gian d\u1ef1 ki\u1ebfn').fill(start);
  await recruiter.page.getByLabel('\u0110\u1ecba \u0111i\u1ec3m',{exact:true}).fill('Synthetic browser office');
  const saved=recruiter.page.waitForResponse(r=>new URL(r.url()).pathname==='/api/interviews'&&r.request().method()==='POST');
  await recruiter.page.getByRole('button',{name:'G\u1eedi l\u1ecbch ph\u1ecfng v\u1ea5n',exact:true}).click();
  const record=await saved;if(!record.ok())throw new Error('Schedule UI HTTP '+record.status());
  state.aiInterviewId=(await record.json()).data.id;fs.writeFileSync(stateFile,JSON.stringify(state));
 }
 await synthetic.page.goto('http://localhost:3000/candidate/interviews');
 await expect(synthetic.page.getByText('Synthetic browser office',{exact:false})).toBeVisible();
 check('Candidate reads persisted interview; first fixture creation uses the actual Recruiter form');
 stage='chat';
 for(const p of [candidate.page,recruiter.page])await p.goto('http://localhost:3000/messages?chat='+state.chatId);
 await expect(candidate.page.getByPlaceholder('Nhập tin nhắn...')).toBeVisible();
 await expect(recruiter.page.getByPlaceholder('Nhập tin nhắn...')).toBeVisible();
 await candidate.page.evaluate(()=>new Promise((resolve,reject)=>{
   window.__testNotifications=[];
   const source=window.__testEventSource=new EventSource('http://localhost:8080/notifications/stream',{withCredentials:true});
   const timeout=setTimeout(()=>reject(new Error('SSE did not open')),10000);
   source.onopen=()=>{clearTimeout(timeout);resolve(true)};
   source.addEventListener('notification',e=>window.__testNotifications.push(JSON.parse(e.data)));
 }));
 const message='Browser real-time integration '+batch+' '+Date.now();
 await recruiter.page.getByPlaceholder('Nhập tin nhắn...').fill(message);
 await recruiter.page.getByRole('button',{name:'Gửi',exact:true}).click();
 await expect(candidate.page.getByText(message,{exact:true}).first()).toBeVisible({timeout:20000});
 check('Recruiter sends through actual UI; Candidate receives message over WebSocket');
 await candidate.page.waitForFunction(text=>window.__testNotifications.some(n=>n.body?.includes(text)),message,{timeout:20000});
 check('Kafka projects chat message and browser receives authenticated SSE notification');
 stage='logout';
 await candidate.page.goto('http://localhost:3000/candidate/profile');
 await candidate.page.getByRole('button',{name:'\u0110\u0103ng xu\u1ea5t',exact:true}).click();
 await expect(candidate.page).toHaveURL(/\/login$/);
 if((await candidate.ctx.cookies()).some(c=>c.name==='careerhub_token'||c.name==='careerhub_refresh'))throw new Error('Logout retained session cookies');
 if((await candidate.page.request.get('http://localhost:3000/api/auth/me')).status()!==401)throw new Error('Logout retained identity');
 check('Actual logout clears HttpOnly cookies and authenticated identity');
 await admin.page.goto('http://localhost:3000/admin/users');
 await admin.page.getByRole('button',{name:'\u0110\u0103ng xu\u1ea5t',exact:true}).click();
 await expect(admin.page).toHaveURL(/\/admin\/login$/);
 if((await admin.ctx.cookies()).some(c=>c.name==='careerhub_token'||c.name==='careerhub_refresh'))throw new Error('Admin logout retained session cookies');
 check('Admin signs out directly from its workspace using the real cookie proxy');
 stage='complete';
})().catch(async e=>{const message=Object.values(accounts).reduce((value,a)=>value.replaceAll(a.password,'[REDACTED]'),String(e.message));console.log('FAIL stage='+stage+' type='+e.name+' '+message.replace(/https?:\/\/\S+/g,'[URL]').slice(0,1400));if(browser){for(const c of browser.contexts())for(const p of c.pages())await p.screenshot({fullPage:true,path:artifacts+'/failure-'+c.pages().indexOf(p)+'-'+browser.contexts().indexOf(c)+'.png'}).catch(()=>{})}process.exitCode=1}).finally(async()=>{
 if(browser){for(const c of browser.contexts())for(const p of c.pages())await p.evaluate(()=>window.__testEventSource?.close()).catch(()=>{});await browser.close()}
 fs.writeFileSync(artifacts+'/result.json',JSON.stringify({stage,checks,date:new Date().toISOString()}));
});
