// Spatial fields are tied to the approved C artwork's anatomy, in 512 px coordinates.
// They move existing pixels continuously; no cut-out joints or new character artwork.
export type MotionGrade = 7 | 8 | 9 | 10;
type Point = readonly [number, number];

export const growthMotionGrades = {
  7: {cycle:3.6,flow:8,colours:['#69caff','#b6baff'],colourOpacity:.36,shineOpacity:.22,kind:'phoenix'},
  8: {cycle:3.2,flow:7,colours:['#53d5fa','#a281f5','#ec99d7'],colourOpacity:.46,shineOpacity:.28,kind:'phoenix'},
  9: {cycle:5.2,flow:6.5,colours:['#53ded6','#699cf8','#bb8eec','#b8ebfa'],colourOpacity:.58,shineOpacity:.34,kind:'dragon'},
  10:{cycle:4.8,flow:6,colours:['#f7cf72','#c08df0','#ef94c8','#83dce9','#f3e3a1'],colourOpacity:.68,shineOpacity:.40,kind:'dragon'},
} as const;

const smooth = (value:number):number => {const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
const g9Whisker:readonly Point[]=[[465,314],[471,335],[492,333],[505,314],[504,289],[494,269],[477,253],[453,239],[446,220],[434,208],[414,203]];
const g10Whisker:readonly Point[]=[[190,337],[172,323],[155,324],[142,345],[126,374],[105,396],[78,406],[56,405],[43,396],[42,378],[52,355],[71,330],[82,310],[77,296],[61,286],[43,284],[28,292],[18,307],[16,317]];

function curvePosition(path:readonly Point[],x:number,y:number):{distance:number;progress:number} {
  const lengths=path.slice(1).map((point,index)=>Math.hypot(point[0]-path[index][0],point[1]-path[index][1]));
  const total=lengths.reduce((sum,value)=>sum+value,0);
  let offset=0,distance=Infinity,progress=0;
  for(let index=0;index<lengths.length;index++){
    const a=path[index],b=path[index+1],dx=b[0]-a[0],dy=b[1]-a[1];
    const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));
    const separation=Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);
    if(separation<distance){distance=separation;progress=(offset+t*lengths[index])/total;}
    offset+=lengths[index];
  }
  return {distance,progress};
}

export function growthMotionVector(grade:MotionGrade,phase:0|1,x:number,y:number):[number,number] {
  if(grade<9){
    const leftRoot=grade===7?[284,252]:[238,237],rightRoot=grade===7?[358,255]:[294,237];
    const left=smooth((leftRoot[0]-x)/105)*smooth((leftRoot[1]+46-y)/64);
    const right=smooth((x-rightRoot[0])/100)*smooth((rightRoot[1]+46-y)/64);
    if(phase===0){
      const fold=grade===7?.12:.16;
      const dx=fold*((x-leftRoot[0])*left+(x-rightRoot[0])*right);
      const dy=-fold*((leftRoot[1]-y)*left+(rightRoot[1]-y)*right)-.045*(Math.abs(x-leftRoot[0])*left+Math.abs(x-rightRoot[0])*right);
      return [dx||0,dy||0];
    }
    const tail=smooth((y-300)/135)*smooth((x-4)/40)*smooth((405-x)/90);
    return [7*tail+.016*((x-leftRoot[0])*left+(x-rightRoot[0])*right),2.5*tail+3*(left-right)];
  }
  const paths=grade===9?[g9Whisker]:[g10Whisker,g10Whisker.map(([px,py])=>[512-px,py] as Point)];
  let vx=0,vy=0;
  for(const [index,path] of paths.entries()){
    const {distance,progress}=curvePosition(path,x,y);
    const weight=smooth((46-distance)/32)*Math.pow(progress,1.45);
    if(weight===0)continue;
    const amplitude=grade===9?9:15;
    const angle=progress*Math.PI*1.65+index*.85+phase*Math.PI/2;
    vx+=amplitude*weight*Math.cos(angle);vy+=amplitude*.8*weight*Math.sin(angle);
  }
  return [vx,vy];
}
