const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
class Sheet {
  constructor(rows=[]){this.rows=rows;this.failWrite=false;}
  getLastRow(){let n=this.rows.length;while(n && this.rows[n-1].every(x=>x===''))n--;return n;}
  getLastColumn(){return Math.max(1,...this.rows.map(r=>r.length));}
  getDataRange(){return this.getRange(1,1,Math.max(this.rows.length,1),this.getLastColumn());}
  getRange(r,c,n=1,m=1){const self=this;return {
    getValues(){return Array.from({length:n},(_,i)=>Array.from({length:m},(_,j)=>self.rows[r+i-1]?.[c+j-1]??''));},
    getFormulas(){return this.getValues().map(row=>row.map(v=>typeof v==='string'&&v.startsWith('=')?v:''));},
    getValue(){return this.getValues()[0][0];},
    setValue(v){return this.setValues([[v]]);},
    setValues(values){if(self.failWrite)throw Error('fixture storage failure');for(let i=0;i<n;i++){self.rows[r+i-1]??=[];for(let j=0;j<m;j++)self.rows[r+i-1][c+j-1]=values[i][j];}return this;},
    clearContent(){return this.setValues(Array.from({length:n},()=>Array(m).fill('')));}
  };}
}

module.exports=function fixture(){
 const headers=['EntryID','Date','Time','Meal','Item','Kcal','Protein_g','Carbs_g','Fat_g','Source'];
 const sheets={Food:new Sheet([headers,['f1','2026-11-15','12:00','Lunch','Fixture yogurt',120,20,6,0,'label']])};
 const ss={getSheetByName:n=>sheets[n]||null,insertSheet:n=>(sheets[n]=new Sheet()),getSpreadsheetTimeZone:()=> 'Europe/Dublin'};
 const ctx=vm.createContext({LockService:{getScriptLock:()=>({tryLock:()=>true,waitLock(){},releaseLock(){}})},Utilities:{formatDate:d=>d.toISOString().slice(0,10),getUuid:()=>Math.random().toString(36).slice(2)}});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../../backend/food-v2.gs'),'utf8'),ctx);
 const deep=x=>JSON.parse(JSON.stringify(x));
 const get=()=>deep({workouts:[],weight:[],nutrition:[],food:sheets.Food.rows.slice(1).filter(r=>r[0]).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]]))),...ctx.pulseFoodV2Get(ss)});
 const post=p=>deep(ctx.pulseFoodV2Post(ss,deep(p)));
 return {get,post,sheets,ctx,ss};
};
