import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadingSync } from '../src/reading-sync.js';
import { createReadingSession, updateReadingAnswer } from '../src/reading-model.js';
import { parseReadingArticles } from './reading-source.js';
import { articleHtml, englishFor } from './reading-fixtures.js';

const [article] = parseReadingArticles(articleHtml);
const memory = () => { const data = new Map(); return {getItem:key=>data.get(key),setItem:(key,value)=>data.set(key,value)}; };
const defer = () => { let resolve; const promise = new Promise((r)=>{resolve=r;}); return {promise,resolve}; };

test('guest drafts, reverse prompts and expanded editors survive reload without server calls', (t) => {
  const storage = memory();
  const request = () => { throw new Error('Guest must not sync'); };
  const first = new ReadingSync({storage,request}); t.after(()=>first.dispose()); first.setOwner('guest');
  const session = createReadingSession(article,'draft'); session.english = englishFor(article); session.mode='en-ja'; session.expanded=[article.sentences[0].id];
  updateReadingAnswer(session,'en-ja',article.sentences[0].id,'本が三冊あります。');
  first.save(session); first.activate('draft');
  const restored = new ReadingSync({storage,request}); t.after(()=>restored.dispose()); restored.setOwner('guest');
  assert.equal(restored.activeId,'draft'); assert.deepEqual(restored.sessions,[session]); assert.equal(restored.status,'local');
  restored.setOwner(null); assert.equal(restored.sessions.length,0);
});

test('editing during a save retains the newer draft and advances its server revision', async (t) => {
  const pending = defer(); let writes=0;
  const sync = new ReadingSync({storage:memory(),request:async (route, options)=> {
    if (!options) return {records:[]};
    writes+=1; return writes===1 ? pending.promise : {revision:2};
  }});
  t.after(()=>sync.dispose()); sync.owner='alice';
  const session = createReadingSession(article,'draft'); sync.save(session);
  const flush = sync.flush();
  updateReadingAnswer(session,'ja-en',article.sentences[0].id,'Newest answer'); sync.save(session);
  pending.resolve({revision:1}); await flush;
  assert.equal(sync.entries.draft.dirty,true); assert.equal(sync.entries.draft.revision,1);
  await sync.flush(); assert.equal(sync.entries.draft.dirty,false); assert.equal(sync.entries.draft.revision,2);
  assert.equal(sync.entries.draft.session.answers['ja-en'][article.sentences[0].id].input,'Newest answer');
});

test('conflicts preserve local answers as a recovered session and adopt the remote version', async (t) => {
  const remote = createReadingSession(article,'draft'); remote.mode='en-ja';
  const sync = new ReadingSync({storage:memory(),uuid:()=> 'recovered',request:async()=>{
    const error = new Error('conflict'); error.status=409; error.current={id:'draft',session:remote,revision:5,deleted:false}; throw error;
  }});
  t.after(()=>sync.dispose()); sync.owner='alice';
  const local = createReadingSession(article,'draft'); updateReadingAnswer(local,'ja-en',article.sentences[0].id,'Local answer');
  sync.save(local); sync.activate('draft'); await sync.flush();
  assert.equal(sync.entries.draft.revision,5); assert.equal(sync.entries.draft.session.mode,'en-ja');
  assert.equal(sync.activeId,'recovered'); assert.equal(sync.entries.recovered.dirty,true);
  assert.equal(sync.entries.recovered.session.answers['ja-en'][article.sentences[0].id].input,'Local answer');
});

test('offline failures keep dirty drafts and retry successfully', async (t) => {
  let offline=true;
  const sync = new ReadingSync({storage:memory(),request:async()=>{if(offline) throw new Error('offline'); return {revision:1};}});
  t.after(()=>sync.dispose()); sync.owner='alice'; sync.save(createReadingSession(article,'draft'));
  await sync.flush(); assert.equal(sync.entries.draft.dirty,true); assert.equal(sync.status,'error');
  offline=false; await sync.flush(); assert.equal(sync.entries.draft.dirty,false); assert.equal(sync.status,'saved');
});

test('switching accounts ignores late responses and keeps caches separate', async (t) => {
  const pending = defer();
  const sync = new ReadingSync({storage:memory(),request:async(route,options)=>options?pending.promise:{records:[]}});
  t.after(()=>sync.dispose()); sync.owner='alice'; sync.save(createReadingSession(article,'alice-only'));
  const flush=sync.flush(); sync.setOwner('bob'); pending.resolve({revision:1}); await flush;
  assert.equal(sync.sessions.length,0); assert.equal(sync.entries['alice-only'],undefined);
  sync.setOwner('guest'); assert.equal(sync.sessions.length,0);
});

test('remote tombstones remove clean sessions but preserve unsynced local answers for conflict recovery', async (t) => {
  let records=[];
  const sync = new ReadingSync({storage:memory(),request:async()=>({records})});
  t.after(()=>sync.dispose()); sync.owner='alice';
  sync.entries.clean={id:'clean',session:createReadingSession(article,'clean'),revision:1,dirty:false};
  records=[{id:'clean',session:null,revision:2,deleted:true}]; await sync.refresh();
  assert.equal(sync.sessions.length,0); assert.equal(sync.entries.clean.deleted,true);
});

test('storage quota failure is visible instead of claiming the draft was saved', (t) => {
  const sync = new ReadingSync({storage:{getItem:()=>null,setItem:()=>{throw new Error('full');}}});
  t.after(()=>sync.dispose()); sync.setOwner('guest'); sync.save(createReadingSession(article,'draft'));
  assert.equal(sync.status,'error'); assert.equal(sync.sessions.length,1);
});
