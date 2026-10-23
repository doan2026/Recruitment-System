import { expect, test, type Page, type Route } from '@playwright/test';

const api = 'http://127.0.0.1:4173/api';
const userId = '1795c0de-7908-4ab5-9bed-4c4f1cf9c211';
const peerId = '2795c0de-7908-4ab5-9bed-4c4f1cf9c211';
const chatId = '3795c0de-7908-4ab5-9bed-4c4f1cf9c211';
const reply = (route: Route, data: unknown, status = 200) => route.fulfill({status, contentType:'application/json', body:JSON.stringify(status < 400 ? {data,meta:null} : data)});

async function setup(page: Page, role: 'CANDIDATE' | 'RECRUITER', chat: unknown) {
  await page.addInitScript(() => {
    class Stream extends EventTarget { close() {} }
    (window as any).EventSource = Stream;
    const Native = window.WebSocket;
    class Socket extends EventTarget {
      constructor(url: string | URL) { super(); if (!String(url).includes('/api/chat/ws/chat')) return new Native(url) as unknown as Socket; }
      close() {}
    }
    (window as any).WebSocket = Socket;
  });
  await page.route(api+'/**', route=>reply(route,{code:'FIXTURE_NOT_FOUND'},404));
  await page.route(api+'/auth/me',route=>reply(route,{id:userId,email:'identity@example.test',role}));
  await page.route(api+'/profile/'+userId,route=>reply(route,{fullName:'Identity Fixture'}));
  await page.route(api+'/notifications/unread-count',route=>reply(route,{unread_count:0}));
  await page.route(api+'/chat/chats',route=>reply(route,[chat]));
  await page.route(api+'/chat/chats/*/messages**',route=>reply(route,[]));
  await page.route('https://media.example.test/**',route=>route.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="42" height="42"><rect width="42" height="42" fill="#087f46"/></svg>'}));
}
const conversation = (counterpart?: unknown, extra = {}) => ({id:chatId,title:'Chat với Nhà tuyển dụng',is_group:false,members:[userId,peerId],created_at:'2026-10-23T00:00:00Z',updated_at:'2026-10-23T00:00:00Z',counterpart,...extra});

for (const role of ['CANDIDATE','RECRUITER'] as const) test(`${role} selects the correct peer name and logo/avatar instead of a shared legacy title`,async({page},info)=>{
  const name=role==='CANDIDATE'?'An Việt Digital (Demo)':'Nguyễn Minh Anh';
  const avatar=`https://media.example.test/${role.toLowerCase()}.png`;
  await setup(page,role,conversation({user_id:peerId,kind:role==='CANDIDATE'?'COMPANY':'CANDIDATE',display_name:name,avatar_url:avatar}));
  await page.goto('/'+role.toLowerCase()+'/messages');
  const item=page.getByRole('region',{name:'Danh sách hội thoại'}).getByRole('button',{name:new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'))});
  await expect(item).toBeVisible();
  await expect(item.locator('img')).toHaveAttribute('src',avatar);
  await expect(page.getByText('Chat với Nhà tuyển dụng',{exact:true})).toHaveCount(0);
  await item.click();
  await expect(page).toHaveURL(new RegExp('/'+role.toLowerCase()+'/messages\\?chat='+chatId));
  await expect(page.locator('.chat-thread-header').getByRole('heading',{name,exact:true})).toBeVisible();
  await expect(page.locator('.chat-thread-header img')).toHaveAttribute('src',avatar);
  await expect(page.getByLabel('Nội dung tin nhắn',{exact:true})).toBeEnabled();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({path:info.outputPath('chat-identity-'+role.toLowerCase()+'.png'),fullPage:true,animations:'disabled'});
});

test('broken or absent portraits fall back without hiding the peer name',async({page})=>{
  await setup(page,'RECRUITER',conversation({user_id:peerId,kind:'CANDIDATE',display_name:'Trần Hoàng Nam',avatar_url:'https://media.example.test/broken.png'}));
  await page.route('https://media.example.test/broken.png',route=>route.abort());
  await page.goto('/recruiter/messages?chat='+chatId);
  await expect(page.locator('.chat-thread-header').getByRole('heading',{name:'Trần Hoàng Nam',exact:true})).toBeVisible();
  await expect(page.locator('.chat-identity-avatar img')).toHaveCount(0);
  await expect(page.locator('.chat-thread-header .chat-identity-avatar')).toContainText('TH');
});

test('group conversations preserve their group name and ignore a direct-peer identity',async({page})=>{
  await setup(page,'CANDIDATE',conversation({user_id:peerId,kind:'COMPANY',display_name:'Wrong group identity'},{is_group:true,title:'Nhóm phỏng vấn sản phẩm'}));
  await page.goto('/candidate/messages?chat='+chatId);
  await expect(page.locator('.chat-thread-header').getByRole('heading',{name:'Nhóm phỏng vấn sản phẩm',exact:true})).toBeVisible();
  await expect(page.getByText('Wrong group identity',{exact:true})).toHaveCount(0);
});
