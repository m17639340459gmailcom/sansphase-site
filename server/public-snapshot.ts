// Only public, sanitized content is shared. The database revision is checked
// on every read, including media authorization and conditional HTTP requests.
export function createPublicSnapshotCache<T extends {expiresAt?:number}, V>({load,revision,now=Date.now}:{load:()=>Promise<T>|T;revision:()=>V;now?:()=>number}):()=>Promise<T> {
  let cached:{version:V;value:T;expiresAt:number}|undefined;
  let pending:{version:V;promise:Promise<T>}|undefined;
  return async function snapshot() {
    for(let attempt=0;attempt<3;attempt++) {
      const version=revision();
      if(cached?.version===version && now()<cached.expiresAt) return cached.value;
      const work=pending?.version===version ? pending : {version,promise:Promise.resolve().then(load)};
      pending=work;
      try {
        const value=await work.promise;
        if(revision()!==version) continue;
        cached={version,value,expiresAt:Math.min(value.expiresAt ?? Infinity,now()+60000)};
        return value;
      } finally {
        if(pending===work) pending=undefined;
      }
    }
    throw Object.assign(new Error('Content changed during snapshot construction'),{status:503});
  };
}
