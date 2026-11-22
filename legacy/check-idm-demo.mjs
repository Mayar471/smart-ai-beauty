// Tests only images already published by the provider as its examples.
import {Client} from '@gradio/client';
const host='https://yisol-idm-vton.hf.space';
const config=await fetch(host+'/config',{signal:AbortSignal.timeout(15000)}).then(r=>r.json());
const person=config.components.find(c=>c.id===12).props.samples[0][0];
const garment=config.components.find(c=>c.id===19).props.samples[0][0];
const client=await Client.connect(host);
try{const result=await client.predict('/tryon',[person,garment,'A garment from the official demo examples',true,false,20,42]);console.log(JSON.stringify({ok:true,data:result.data}));}
catch(e){console.log(JSON.stringify({ok:false,message:e.message||String(e)}));process.exitCode=1;}
finally{client.close();}
