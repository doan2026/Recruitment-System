import { test, expect, type Page, type Route } from "@playwright/test";

const origin = "http://127.0.0.1:4173";
const api = origin + "/api";
const id = "1795c0de-7908-4ab5-9bed-4c4f1cf9c211";
type Role = "CANDIDATE" | "RECRUITER" | "ADMIN";
const homes = { CANDIDATE: "/candidate/dashboard", RECRUITER: "/recruiter/dashboard", ADMIN: "/admin" };
const reply = (route: Route, data: unknown, status = 200) => route.fulfill({status, contentType: "application/json", body: JSON.stringify(status < 400 ? {data,meta:null} : data)});

async function setup(page: Page, role: Role | null) {
  await page.addInitScript(() => {
    (window as any).__streams = 0;
    class TestStream extends EventTarget { constructor() { super(); (window as any).__streams++; } close() {} }
    (window as any).EventSource = TestStream;
  });
  await page.route(api + "/**", route => reply(route, {code:"UNMOCKED_FIXTURE"},404));
  await page.route(api + "/auth/me", route => role ? reply(route,{id,email:"portal@example.test",role}) : reply(route,{code:"AUTH_INVALID"},401));
  await page.route(api + "/auth-cookie/refresh", route => reply(route,{code:"AUTH_INVALID"},401));
  await page.route(api + "/profile/" + id, route => reply(route,{userId:id,fullName:"Portal Fixture",avatarUrl:null}));
  await page.route(api + "/notifications/unread-count", route => reply(route,{unread_count:0}));
  await page.route(api + "/notifications", route => reply(route,[]));
  await page.route(api + "/chat/chats", route => reply(route,[]));
  await page.route(api + "/companies/me", route => reply(route,{code:"COMPANY_NOT_FOUND"},404));
  await page.route(api + "/applications/bookmarks", route => reply(route,[]));
  await page.route(api + "/applications/my", route => reply(route,[]));
  await page.route(api + "/interviews/my**", route => reply(route,{items:[],nextCursor:null}));
  await page.route(api + "/admin/stats/overview**", route => reply(route,{totals:{},daily:[]}));
  await page.route(api + "/admin/stats/funnel**", route => reply(route,[]));
  await page.route(api + "/admin/users**", route => reply(route,[]));
  await page.route(api + "/jobs/search**", route => reply(route,{items:[],total:0,page:1,limit:10,source:"POSTGRESQL",hasMore:false,nextCursor:null}));
}

async function openMenu(page: Page) {
  const toggle = page.getByRole("button",{name:"Mở menu",exact:true});
  if (await toggle.isVisible()) await toggle.click();
}
async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
}

for (const role of ["CANDIDATE","RECRUITER","ADMIN"] as const) {
  test(`${role} home and navigation never link into another role workspace`,async({page},info)=>{
    await setup(page,role);
    await page.goto(homes[role]);
    await expect(page.locator('.workspace-header')).toHaveCount(1);
    await expect(page.getByRole('link',{name:'CareerHub - Trang chủ'})).toHaveAttribute('href',homes[role]);
    await openMenu(page);
    const nav=page.locator('.workspace-navigation');
    await expect(nav).toBeVisible();
    const links=await nav.locator('a').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('href')));
    expect(links.every(href=>href?.startsWith('/'+role.toLowerCase()+'/') || (role==='ADMIN' && href==='/admin'))).toBe(true);
    await nav.getByRole('link',{name:'Thông báo',exact:true}).click();
    await expect(page).toHaveURL(origin+'/'+role.toLowerCase()+'/notifications');
    await expect(page.getByRole('heading',{name:'Thông báo',exact:true})).toBeVisible();
    await expect(page.locator('.workspace-header')).toHaveCount(1);
    await page.getByRole('link',{name:'CareerHub - Trang chủ'}).click();
    await expect(page).toHaveURL(origin+homes[role]);
    await fits(page);
    await page.screenshot({path:info.outputPath('portal-'+role.toLowerCase()+'.png'),fullPage:true,animations:'disabled'});
  });

  test(`${role} legacy notifications keep the role and existing query`,async({page})=>{
    await setup(page,role);
    await page.goto('/notifications?source=mail');
    await expect(page).toHaveURL(origin+'/'+role.toLowerCase()+'/notifications?source=mail');
    await expect(page.getByRole('heading',{name:'Thông báo',exact:true})).toBeVisible();
  });

  test(`${role} cross-portal deep link cannot load candidate or recruiter private data`,async({page})=>{
    await setup(page,role);
    const foreign=role==='CANDIDATE'?'/recruiter/dashboard':'/candidate/dashboard';
    let reads=0;
    await page.route(api+'/applications/my',route=>{reads++;return reply(route,[]);});
    await page.route(api+'/companies/me',route=>{reads++;return reply(route,{code:'COMPANY_NOT_FOUND'},404);});
    await page.goto(foreign);
    await expect(page.getByRole('heading',{name:'Bạn không có quyền truy cập',exact:true})).toBeVisible();
    expect(reads).toBe(0);
    await page.getByRole('link',{name:'Về không gian của tôi',exact:true}).click();
    await expect(page).toHaveURL(origin+homes[role]);
  });
}

test('candidate and employer public entries and auth headers are independent',async({page},info)=>{
  await setup(page,null);
  await page.goto('/');
  await expect(page.getByRole('heading',{level:1})).toContainText('Công việc phù hợp');
  await expect(page.locator('main a[href^="/admin"]')).toHaveCount(0);
  await page.screenshot({path:info.outputPath('candidate-landing.png'),fullPage:true,animations:'disabled'});
  await page.goto('/recruiter');
  await expect(page.getByRole('heading',{level:1})).toContainText('Đội ngũ phù hợp');
  await expect(page.locator('a[href^="/candidate"], a[href="/login"], a[href="/admin/login"]')).toHaveCount(0);
  await fits(page);
  await page.screenshot({path:info.outputPath('recruiter-landing.png'),fullPage:true,animations:'disabled'});
  for(const [path,home] of [['/login','/'],['/recruiter/login','/recruiter'],['/admin/login','/admin']]){
    await page.goto(path);
    await expect(page.getByRole('link',{name:'CareerHub - Trang chủ'})).toHaveAttribute('href',home);
    await expect(page.getByRole('navigation',{name:'Chọn khu vực đăng nhập'})).toHaveCount(0);
    await expect(page.locator('.workspace-header,.topbar')).toHaveCount(0);
    await fits(page);
  }
});

for(const role of ['RECRUITER','ADMIN'] as const) test(`${role} opening candidate homepage returns to its own home`,async({page})=>{
  await setup(page,role);
  await page.goto('/');
  await expect(page).toHaveURL(origin+homes[role]);
  await expect(page.getByRole('heading',{name:'Công việc phù hợp.',exact:false})).toHaveCount(0);
});

test('home search submits a real keyword filter to public jobs',async({page})=>{
  await setup(page,null);
  let keyword='';
  await page.route(api+'/jobs/search**',route=>{keyword=new URL(route.request().url()).searchParams.get('q')??'';return reply(route,{items:[],total:0,page:1,limit:10,source:'POSTGRESQL',hasMore:false,nextCursor:null});});
  await page.goto('/');
  await page.getByLabel('Vị trí hoặc kỹ năng').fill('Frontend');
  await page.getByRole('button',{name:'Tìm việc',exact:true}).click();
  await expect(page).toHaveURL(/\/candidate\/jobs\?q=Frontend/);
  await expect.poll(()=>keyword).toBe('Frontend');
});

test('notification inbox is lazy and the same SSE connection survives portal navigation',async({page})=>{
  await setup(page,'CANDIDATE');
  let inboxReads=0;
  await page.route(api+'/notifications',route=>{inboxReads++;return reply(route,[]);});
  await page.goto('/candidate/dashboard');
  await expect(page.getByRole('region',{name:'Thống kê của tôi'})).toBeVisible();
  expect(inboxReads).toBe(0);
  const count=await page.evaluate(()=>(window as any).__streams);
  expect(count).toBe(1);
  await page.getByRole('link',{name:'Thông báo',exact:true}).first().click();
  await expect(page).toHaveURL(origin+'/candidate/notifications');
  await expect.poll(()=>inboxReads).toBe(1);
  expect(await page.evaluate(()=>(window as any).__streams)).toBe(count);
});

test('mobile drawer supports Escape and closes after keyboard navigation',async({page},info)=>{
  test.skip(info.project.name!=='mobile-chrome','Mobile navigation');
  await setup(page,'RECRUITER');
  await page.goto('/recruiter/dashboard');
  await expect(page.locator('.workspace-sidebar')).toBeHidden();
  await page.getByRole('button',{name:'Mở menu',exact:true}).click();
  await expect(page.locator('.workspace-sidebar')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button',{name:'Mở menu',exact:true})).toBeFocused();
  await openMenu(page);
  const link=page.locator('.workspace-navigation').getByRole('link',{name:'Tin nhắn',exact:true});
  await link.focus();await page.keyboard.press('Enter');
  await expect(page).toHaveURL(origin+'/recruiter/messages');
  await expect(page.locator('.workspace-sidebar')).toBeHidden();
  await fits(page);
});
