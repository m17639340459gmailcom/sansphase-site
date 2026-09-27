const base=process.env.HEALTHCHECK_URL||'http://127.0.0.1:4176/healthz';
try {
  const response=await fetch(base,{signal:AbortSignal.timeout(10000),redirect:'error'});
  const result=await response.json();
  if(!response.ok||result.status!=='ok'||!result.release) throw Error('Unhealthy');
  if(process.env.EXPECTED_RELEASE && result.release!==process.env.EXPECTED_RELEASE) throw Error('Wrong release');
  console.log(JSON.stringify({status:'ok',release:result.release}));
} catch {
  console.error('Health check failed. Check the website service and database.');
  process.exitCode=1;
}
