import test from 'node:test';
import assert from 'node:assert/strict';
import {TryOnJobs} from '../adapters/tryon.mjs';
import {loadCatalog} from '../adapters/catalog.mjs';
test('try-on requires opt-in, supported garment and matching checked photos; jobs are private',async()=>{
 const catalog=await loadCatalog(),shirt=catalog.find(c=>c.category==='shirt, blouse'),dress=catalog.find(c=>c.category==='dress');let complete,received;
 const jobs=new TryOnJobs(input=>{received=input;return new Promise(resolve=>complete=resolve);});const user={id:'first',body:Buffer.from('private-test-image'),analysis:JSON.stringify({fullBodyVisible:true,pose:'upright',upperBodyBand:{top:.25,bottom:.6}})};const input={itemId:shirt.id,consent:true,photoRevision:'revision-1'};
 await assert.rejects(jobs.start(user,{...input,consent:false},catalog,'revision-1'),e=>e.status===400);
 await assert.rejects(jobs.start(user,{...input,itemId:dress.id},catalog,'revision-1'),e=>e.status===422);
 await assert.rejects(jobs.start(user,{...input,photoRevision:'old'},catalog,'revision-1'),e=>e.status===409);
 await assert.rejects(jobs.start({...user,analysis:'{}'},input,catalog,'revision-1'),e=>e.status===422);
 await assert.rejects(jobs.start({...user,analysis:JSON.stringify({fullBodyVisible:true,pose:'upright'})},input,catalog,'revision-1'),e=>e.status===422);
 const job=await jobs.start(user,input,catalog,'revision-1');assert.equal(job.status,'running');assert.throws(()=>jobs.get({id:'other'},job.id),e=>e.status===404);
 await assert.rejects(jobs.start(user,input,catalog,'revision-1'),e=>e.status===429);
 await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(received.body,user.body);assert.ok(received.garment.length>1000);complete(Buffer.from('test-result'));await new Promise(resolve=>setImmediate(resolve));
 const done=jobs.get(user,job.id);assert.equal(done.status,'done');assert.equal(jobs.public(done).imageUrl,`/api/tryon/${job.id}/image`);assert.equal(jobs.public(done).bytes,undefined);
 done.expires=0;assert.throws(()=>jobs.get(user,job.id),e=>e.status===404);
});
