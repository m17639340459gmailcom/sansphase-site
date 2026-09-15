// Original, quiet synthetic audio for the opt-in localhost preview only.
import { byteRange } from '../../server/http-range.mjs';

function tone(frequency) {
  const rate=22050,seconds=18,frames=rate*seconds;
  const wav=Buffer.alloc(44+frames*2);
  wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);
  wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);
  wav.writeUInt32LE(rate,24);wav.writeUInt32LE(rate*2,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);
  wav.write('data',36);wav.writeUInt32LE(frames*2,40);
  for(let i=0;i<frames;i++) {
    const t=i/rate,envelope=Math.min(1,t/1.5,(seconds-t)/2);
    const note=frequency*[1,1.25,1.5,2][Math.floor(t/3)%4];
    const sample=(Math.sin(2*Math.PI*note*t)+0.3*Math.sin(2*Math.PI*frequency*t))*0.07*envelope;
    wav.writeInt16LE(Math.round(sample*32767),44+i*2);
  }
  return wav;
}
export function createMusicDemo() {
  const files=new Map([['demo-audio-one',tone(220)],['demo-audio-two',tone(261.6256)]]);
  return {
    settings:{title:'本地试听',autoplay:false,tracks:[
      {title:'星轨 · 本地试听',url:'/api/media/demo-audio-one',coverUrl:'/assets/materials/eso-orion.jpg'},
      {title:'微光 · 本地试听',url:'/api/media/demo-audio-two',coverUrl:'/assets/materials/eso-m78.jpg'},
    ]},
    media(id,{range}={}) {
      const file=files.get(id);
      if(!file) return new Response(null,{status:404});
      const part=byteRange(range,file.length);
      const headers={'Content-Type':'audio/wav','Accept-Ranges':'bytes'};
      if(part===false)return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${file.length}`}});
      const body=part?file.subarray(part.start,part.end+1):file;
      headers['Content-Length']=String(body.length);
      if(part)headers['Content-Range']=`bytes ${part.start}-${part.end}/${file.length}`;
      return new Response(body,{status:part?206:200,headers});
    },
  };
}
