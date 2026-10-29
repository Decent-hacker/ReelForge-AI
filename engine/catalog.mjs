import {DatabaseSync} from 'node:sqlite';
import {open,readFile,unlink,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export class Catalog {
  constructor(root){this.root=path.resolve(root);this.nonce=randomUUID();this.db=null;this.lock=null;}
  async open(){
    await mkdir(this.root,{recursive:true});const file=path.join(this.root,'service.lock');
    for(let attempt=0;attempt<2;attempt++){
      try{this.lock=await open(file,'wx');await this.lock.writeFile(JSON.stringify({pid:process.pid,nonce:this.nonce,createdAt:new Date().toISOString()}));break;}
      catch(error){
        if(error.code!=='EEXIST')throw error;
        let owner;try{owner=JSON.parse(await readFile(file,'utf8'));}catch{throw new Error('The data-directory owner lock is unreadable. Check that another ReelForge instance is not running.');}
        let alive=true;try{process.kill(owner.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}
        if(alive)throw new Error('This data directory is already owned by a ReelForge backend. Use the existing instance.');
        if(attempt===0)await unlink(file);
      }
    }
    if(!this.lock)throw new Error('Could not acquire project-data ownership.');
    try{
      this.db=new DatabaseSync(path.join(this.root,'catalog.sqlite'));
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
        CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,revision INTEGER NOT NULL,updated_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,kind TEXT NOT NULL,status TEXT NOT NULL,stage TEXT NOT NULL,progress REAL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,error TEXT,result_json TEXT);
        CREATE INDEX IF NOT EXISTS jobs_project_date ON jobs(project_id,created_at);
        CREATE TABLE IF NOT EXISTS job_events(id INTEGER PRIMARY KEY AUTOINCREMENT,job_id TEXT NOT NULL,at TEXT NOT NULL,status TEXT NOT NULL,stage TEXT NOT NULL,progress REAL,message TEXT);
        PRAGMA user_version=1;`);
    }catch(error){await this.close();throw error;}
    return this;
  }
  project(p){this.db.prepare('INSERT INTO projects(id,name,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,revision=excluded.revision,updated_at=excluded.updated_at').run(p.id,p.name,p.revision||0,p.updatedAt||p.createdAt);}
  createJob(projectId,kind,payload={}){
    const now=new Date().toISOString(),job={id:randomUUID(),projectId,kind,status:'queued',stage:'queued',progress:null,createdAt:now,updatedAt:now};
    this.db.prepare('INSERT INTO jobs(id,project_id,kind,status,stage,progress,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(job.id,projectId,kind,job.status,job.stage,null,JSON.stringify(payload),now,now);
    this.event(job,'Queued for local execution.');return job;
  }
  event(job,message=null){this.db.prepare('INSERT INTO job_events(job_id,at,status,stage,progress,message) VALUES(?,?,?,?,?,?)').run(job.id,new Date().toISOString(),job.status,job.stage,job.progress??null,message);}
  updateJob(job,{message=null,result=null}={}){
    job.updatedAt=new Date().toISOString();this.db.prepare('UPDATE jobs SET status=?,stage=?,progress=?,updated_at=?,error=?,result_json=COALESCE(?,result_json) WHERE id=?').run(job.status,job.stage,job.progress??null,job.updatedAt,job.error||null,result?JSON.stringify(result):null,job.id);this.event(job,message);
  }
  jobs(projectId){return this.db.prepare('SELECT * FROM jobs WHERE project_id=? ORDER BY created_at DESC LIMIT 100').all(projectId).map(row=>this.decode(row));}
  job(id){const row=this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id);return row?{...this.decode(row),events:this.db.prepare('SELECT at,status,stage,progress,message FROM job_events WHERE job_id=? ORDER BY id DESC LIMIT 500').all(id).reverse()}:null;}
  decode(row){return {id:row.id,projectId:row.project_id,kind:row.kind,status:row.status,stage:row.stage,progress:row.progress,createdAt:row.created_at,updatedAt:row.updated_at,error:row.error,result:row.result_json?JSON.parse(row.result_json):null};}
  interrupt(){
    const rows=this.db.prepare("SELECT * FROM jobs WHERE status IN ('running','queued')").all();
    for(const row of rows){const job=this.decode(row);Object.assign(job,{status:'failed',stage:'interrupted',error:'Backend stopped before this job completed. Retry explicitly; partial files are not completed output.'});this.updateJob(job,{message:job.error});}
    return rows.length;
  }
  async close(){if(this.db){this.db.close();this.db=null;}if(this.lock){await this.lock.close();this.lock=null;const file=path.join(this.root,'service.lock');try{const owner=JSON.parse(await readFile(file,'utf8'));if(owner.nonce===this.nonce)await unlink(file);}catch(e){if(e.code!=='ENOENT')throw e;}}}
}
