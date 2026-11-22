import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {AppError} from './accounts.mjs';
import {fitImage,restoreMaskedResult} from './image-layout.mjs';
const host='https://yisol-idm-vton.hf.space';
const assets=fileURLToPath(new URL('../dist/',import.meta.url));
export async function runTryOn({body,garment,upperBodyBand}){
 const {Client,handle_file}=await import('@gradio/client');let client,timer;
 try{
  const work=async()=>{const prepared=fitImage(body),preparedGarment=fitImage(garment);client=await Client.connect(host);const personFile=handle_file(new Blob([prepared.buffer],{type:'image/png'}));const garmentFile=handle_file(new Blob([preparedGarment.buffer],{type:'image/png'}));const result=await client.predict('/tryon',[{background:personFile,layers:[],composite:null},garmentFile,'white long-sleeved blouse',true,false,20,42]);
   const fetchImage=async(value)=>{const url=new URL(value?.url||'');if(url.origin!==host||!url.pathname.startsWith('/file='))throw new Error('Invalid result host');const response=await fetch(url,{signal:AbortSignal.timeout(20000)});if(!response.ok)throw new Error('Invalid result');const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>12*1024*1024||bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Invalid image');return bytes;};
   const [generated,masked]=await Promise.all([fetchImage(result.data?.[0]),fetchImage(result.data?.[1])]);return restoreMaskedResult(prepared,generated,masked,upperBodyBand).buffer;};
  return await Promise.race([work(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),180000);})]);
 }catch(e){if(/quota|GPU|exceeded|limit/i.test(e.message||''))throw new Error('الخدمة المجانية وصلت إلى حد الاستخدام أو لا يتوفر GPU الآن. حاولي لاحقاً.');if(e.message==='timeout')throw new Error('انتهت مهلة الانتظار في الخدمة المجانية. حاولي لاحقاً.');throw new Error('تعذرت تجربة القطعة عبر الخدمة الخارجية. قد تكون مشغولة أو غير متاحة حالياً.');}
 finally{clearTimeout(timer);client?.close();}
}
export class TryOnJobs{
 constructor(runner=runTryOn){this.runner=runner;this.jobs=new Map();this.usage=new Map();}
 clean(){const now=Date.now();for(const [id,job]of this.jobs)if(job.expires<now)this.jobs.delete(id);for(const [id,usage]of this.usage)if(usage.until<now)this.usage.delete(id);}
 async start(user,input,catalog,revision){this.clean();if(input?.consent!==true)throw new AppError(400,'يلزم الموافقة على إرسال صورة الجسم والقطعة إلى خدمة التجربة.');const item=catalog.find(c=>c.id===input.itemId);if(!item)throw new AppError(400,'اختاري قطعة موجودة في الكتالوج.');if(item.category!=='shirt, blouse')throw new AppError(422,'تجربة الملابس متاحة حالياً للقميص فقط. الفساتين والبنطال غير مدعومين في هذا الربط.');if(!user.body||input.photoRevision!==revision)throw new AppError(409,'احفظي الصور الحالية في حسابك قبل بدء التجربة.');const analysis=JSON.parse(user.analysis||'{}');if(!analysis.fullBodyVisible)throw new AppError(422,'افحصي صورة الجسم واحفظي نتيجة تظهر فيها المعالم الأساسية أولاً.');if(!analysis.upperBodyBand||analysis.pose!=='upright')throw new AppError(422,'أعيدي فحص الجسم وحفظ نتيجته لتحديد حدود القميص وحماية الرأس والجزء السفلي.');if([...this.jobs.values()].some(j=>j.status==='running'))throw new AppError(429,'تجربة أخرى قيد التنفيذ. انتظري اكتمالها أولاً.');const usage=this.usage.get(user.id)||{count:0,until:Date.now()+3600000};if(usage.count>=5)throw new AppError(429,'الحد التجريبي خمس محاولات في الساعة للحساب. حاولي لاحقاً.');
  if(typeof item.tryOnImage!=='string'||!/^\/assets\/[\w/-]+\.png$/.test(item.tryOnImage)||item.tryOnImage.includes('..'))throw new AppError(422,'صورة القطعة غير مجهزة للتجربة بعد.');const garment=await readFile(path.resolve(assets,'.'+item.tryOnImage));
  // Recheck after disk I/O to avoid allowing two simultaneous starts.
  if([...this.jobs.values()].some(j=>j.status==='running'))throw new AppError(429,'تجربة أخرى قيد التنفيذ.');const id=randomUUID();usage.count++;this.usage.set(user.id,usage);const job={id,userId:user.id,status:'running',itemId:item.id,expires:Date.now()+1800000};this.jobs.set(id,job);
  Promise.resolve().then(()=>this.runner({body:Buffer.from(user.body),garment,upperBodyBand:analysis.upperBodyBand})).then(bytes=>{job.bytes=bytes;job.status='done';},error=>{job.error=error.message;job.status='error';});return this.public(job);
 }
 get(user,id){this.clean();const job=this.jobs.get(id);if(!job||job.userId!==user.id)throw new AppError(404,'انتهت صلاحية النتيجة أو لا تتبع حسابك.');return job;}
 public(job){return {id:job.id,status:job.status,itemId:job.itemId,error:job.error,imageUrl:job.status==='done'?`/api/tryon/${job.id}/image`:null,expiresAt:new Date(job.expires).toISOString()};}
}
