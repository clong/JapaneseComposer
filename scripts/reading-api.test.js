import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createReadingApi } from './reading-api.js';

function response() {
  return { headersSent:false, writeHead(status,headers) {this.status=status;this.headers=headers;this.headersSent=true;}, end(body) {this.data=JSON.parse(body);} };
}
function request(method, body) {
  const req=Readable.from(body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))]);
  req.method=method;return req;
}
test('Reading API bounds input and requires account authentication for every session operation', async () => {
  let calls=0;
  const api=createReadingApi({dbPath:'unused',runSqlite:()=>{throw new Error('No storage without authentication');},isDbReady:()=>true,
    getUser:async(req,res)=>{res.writeHead(401,{});res.end(JSON.stringify({error:'Sign in required'}));return null;},
    source:{list:async()=>({articles:[],fetchedAt:100,stale:false})},
    ai:{grade:async(body)=>{calls++;return {results:body.answers};}}
  });
  for (const [route,method] of [['sessions','GET'],['sessions/private','GET'],['sessions/private','PUT'],['sessions/private','DELETE']]) {
    const res=response();await api(request(method,{}),res,new URL(`http://localhost/api/reading/${route}`));assert.equal(res.status,401);
  }
  for (const [body,status] of [['not json',400],['a'.repeat(1500001),413]]) {
    const res=response();await api(request('POST',body),res,new URL('http://localhost/api/reading/grade'));assert.equal(res.status,status);
  }
  assert.equal(calls,0);
  const res=response(); await api(request('POST',{answers:[]}),res,new URL('http://localhost/api/reading/grade')); assert.equal(calls,1);assert.equal(res.status,200);
  const unrelated=await api(request('GET'),response(),new URL('http://localhost/api/lookup'));assert.equal(unrelated,false);
});
