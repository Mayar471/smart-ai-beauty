import test from 'node:test';
import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {fitImage,restoreMaskedResult} from '../adapters/image-layout.mjs';
function solid(width,height,r,g,b){const p=new PNG({width,height});for(let i=0;i<p.data.length;i+=4){p.data[i]=r;p.data[i+1]=g;p.data[i+2]=b;p.data[i+3]=255;}return p;}
test('portrait preparation contains landscape photos without stretching and restores original dimensions outside mask',()=>{
 const input=solid(100,60,40,80,120),prepared=fitImage(PNG.sync.write(input),80,120);
 assert.deepEqual(prepared.layout,{width:80,height:120,drawWidth:80,drawHeight:48,left:0,top:36});
 assert.deepEqual([...prepared.image.data.subarray(0,4)],[255,255,255,255]);
 const masked=PNG.sync.read(prepared.buffer),generated=solid(80,120,200,50,20);
 for(let y=46;y<66;y++)for(let x=20;x<40;x++){const i=(y*80+x)*4;masked.data[i]=masked.data[i+1]=masked.data[i+2]=127;}
 const restored=restoreMaskedResult(prepared,PNG.sync.write(generated),PNG.sync.write(masked));const output=PNG.sync.read(restored.buffer);
 assert.equal(output.width,100);assert.equal(output.height,60);assert.equal(restored.maskPixels,400);assert.ok(restored.changedPixels>400);
 assert.deepEqual([...output.data.subarray(0,4)],[40,80,120,255]);
 const center=(25*100+35)*4;assert.deepEqual([...output.data.subarray(center,center+4)],[200,50,20,255]);
 for(let y=0;y<60;y++)for(let x=0;x<100;x++)if(x<24||x>51||y<11||y>39){const i=(y*100+x)*4;assert.deepEqual(output.data.subarray(i,i+4),input.data.subarray(i,i+4));}
});
test('provider masks must match dimensions and contain an edit region',()=>{
 const prepared=fitImage(PNG.sync.write(solid(30,40,50,60,70)),30,40);
 assert.throws(()=>restoreMaskedResult(prepared,prepared.buffer,prepared.buffer),/empty/);
 assert.throws(()=>restoreMaskedResult(prepared,PNG.sync.write(solid(10,10,1,2,3)),prepared.buffer),/dimensions/);
});

test('upper-body guard preserves head and lower body even when provider mask covers them',()=>{
 const source=solid(40,80,20,60,90),prepared=fitImage(PNG.sync.write(source),40,80),generated=solid(40,80,220,30,10),masked=solid(40,80,127,127,127);
 const output=PNG.sync.read(restoreMaskedResult(prepared,PNG.sync.write(generated),PNG.sync.write(masked),{top:.3,bottom:.6}).buffer);
 for(let y=0;y<80;y++)for(let x=0;x<40;x++){const i=(y*40+x)*4;if((y+.5)/80<=.3||(y+.5)/80>=.6)assert.deepEqual(output.data.subarray(i,i+4),source.data.subarray(i,i+4));}
 assert.equal(output.data[(36*40+20)*4],220);
});
