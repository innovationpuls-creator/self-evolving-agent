import { workerChannel } from './worker-channel.js';
import { runProbes } from './probes.js';
const channel = workerChannel();
try {
  const start = await channel.starting;
  if(start.mode === 'probes') await channel.request('evidence', await runProbes(start.input));
  else if(start.mode === 'hang') { await channel.request('evidence', {pid:process.pid}); await new Promise(()=>{}); }
  else if(start.mode === 'flood') { process.stderr.write('x'.repeat(5*1024*1024)); await new Promise(()=>{}); }
  else if(start.mode === 'duplicate') { await channel.request('evidence', {pid:process.pid}); process.stdout.write(JSON.stringify({kind:'request',requestId:'same',operation:'evidence',input:{}})+'\n'+JSON.stringify({kind:'request',requestId:'same',operation:'evidence',input:{}})+'\n'); await new Promise(()=>{}); }
  else if(start.mode === 'terminal') { process.stdout.write('{"kind":"finished","ok":true}\n{"kind":"ready"}\n'); await new Promise(()=>{}); }
  else if(start.mode === 'malformed') { process.stdout.write('not-json\n'); await new Promise(()=>{}); }
  else if(start.mode === 'oversize') { process.stdout.write('x'.repeat(9*1024*1024)); await new Promise(()=>{}); }
  else if(start.mode === 'forge') { await channel.request('publish', {runId:'forged'}); }
  channel.finish(true);
} catch { channel.finish(false); }
