import {PNG} from 'pngjs';
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
function pixel(image,x,y,channel){return image.data[(clamp(y,0,image.height-1)*image.width+clamp(x,0,image.width-1))*4+channel];}
function sample(image,x,y,channel){const left=Math.floor(x),top=Math.floor(y),fx=x-left,fy=y-top;return pixel(image,left,top,channel)*(1-fx)*(1-fy)+pixel(image,left+1,top,channel)*fx*(1-fy)+pixel(image,left,top+1,channel)*(1-fx)*fy+pixel(image,left+1,top+1,channel)*fx*fy;}
export function fitImage(buffer,width=768,height=1024){
 const original=PNG.sync.read(buffer);if(!original.width||!original.height||original.width>2000||original.height>2000)throw new Error('Unsupported dimensions');
 const scale=Math.min(width/original.width,height/original.height),drawWidth=Math.max(1,Math.round(original.width*scale)),drawHeight=Math.max(1,Math.round(original.height*scale));
 const layout={width,height,drawWidth,drawHeight,left:Math.floor((width-drawWidth)/2),top:Math.floor((height-drawHeight)/2)};const image=new PNG({width,height});image.data.fill(255);
 for(let y=0;y<drawHeight;y++)for(let x=0;x<drawWidth;x++){const sx=(x+.5)*original.width/drawWidth-.5,sy=(y+.5)*original.height/drawHeight-.5,p=((y+layout.top)*width+x+layout.left)*4,alpha=sample(original,sx,sy,3)/255;for(let c=0;c<3;c++)image.data[p+c]=Math.round(sample(original,sx,sy,c)*alpha+255*(1-alpha));}
 return {original,image,layout,buffer:PNG.sync.write(image)};
}
export function restoreMaskedResult(prepared,generatedBuffer,maskedBuffer,band){
 const generated=PNG.sync.read(generatedBuffer),masked=PNG.sync.read(maskedBuffer),{original,image,layout}=prepared;
 if(generated.width!==layout.width||generated.height!==layout.height||masked.width!==layout.width||masked.height!==layout.height)throw new Error('Unexpected provider dimensions');
 const mask=new PNG({width:image.width,height:image.height});let maskPixels=0;
 for(let p=0;p<image.data.length;p+=4){const gray=[masked.data[p],masked.data[p+1],masked.data[p+2]].every(v=>v>=126&&v<=129);const changed=Math.max(...[0,1,2].map(c=>Math.abs(masked.data[p+c]-image.data[p+c])))>3;const value=gray&&changed?255:0;mask.data[p]=value;mask.data[p+3]=255;if(value)maskPixels++;}
 if(maskPixels<100)throw new Error('Provider edit mask is empty');
 const output=new PNG({width:original.width,height:original.height});original.data.copy(output.data);let changedPixels=0;
 for(let y=0;y<original.height;y++)for(let x=0;x<original.width;x++){const ny=(y+.5)/original.height,guard=band?clamp(Math.min((ny-band.top)/.015,(band.bottom-ny)/.015),0,1):1;const sx=layout.left+(x+.5)*layout.drawWidth/original.width-.5,sy=layout.top+(y+.5)*layout.drawHeight/original.height-.5,alpha=sample(mask,sx,sy,0)/255*guard;if(alpha<=0)continue;const p=(y*original.width+x)*4;for(let c=0;c<3;c++)output.data[p+c]=Math.round(original.data[p+c]*(1-alpha)+sample(generated,sx,sy,c)*alpha);changedPixels++;}
 if(!changedPixels)throw new Error('No editable pixels inside upper-body bounds');
 return {buffer:PNG.sync.write(output),changedPixels,maskPixels,width:output.width,height:output.height};
}
