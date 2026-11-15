/** Pulse Food v2 opt-in extension. Not a replacement for the existing backend.
 * Read backend/README.md before integration. No live deployment is performed by this file.
 */
var PULSE_FOOD_V2_SHEET = '_PulseFoodV2';
var PULSE_FOOD_HEADERS = ['EntryID','Date','Time','Meal','Item','Kcal','Protein_g','Carbs_g','Fat_g','Source'];

function pulseFoodV2Empty_() {
  return {version:1,revision:0,products:[],recipes:[],days:[],targets:[],portions:{}};
}
// Chunked immutable snapshots; the manifest is replaced only after all chunks exist.
var PULSE_FOOD_V2_MAX = 2000000;
var PULSE_FOOD_V2_CHUNK = 40000;
function pulseFoodV2Hash_(text) {
  var h=2166136261;
  for(var i=0;i<text.length;i++) h=Math.imul(h^text.charCodeAt(i),16777619);
  return (h>>>0).toString(16);
}
function pulseFoodV2ReadState_(ss) {
  var sh=ss.getSheetByName(PULSE_FOOD_V2_SHEET);
  if(!sh || sh.getLastRow()<2) return pulseFoodV2Empty_();
  if(sh.getRange(1,1).getValue()!=='PulseFoodV2JSON') throw new Error('Reserved Food v2 sheet has an unexpected format');
  var raw=sh.getRange(2,1).getValue();
  if(!raw) return pulseFoodV2Empty_();
  var manifest=JSON.parse(String(raw)),s;
  // Read earlier development snapshots without silently discarding them.
  if(manifest.version===1 && manifest.products) s=manifest;
  else {
    if(manifest.storage!==2 || !Number.isInteger(manifest.count) || manifest.count<1 || manifest.count>50 || !Number.isInteger(manifest.length) || manifest.length<1 || manifest.length>PULSE_FOOD_V2_MAX || typeof manifest.generation!=='string') throw new Error('Unsupported Food v2 manifest');
    var rows=sh.getLastRow()>2?sh.getRange(3,1,sh.getLastRow()-2,3).getValues():[];
    var chunks=rows.filter(function(r){return r[0]===manifest.generation;}).sort(function(a,b){return a[1]-b[1];});
    if(chunks.length!==manifest.count || chunks.some(function(r,i){return r[1]!==i || typeof r[2]!=='string' || r[2].slice(0,5)!=='JSON:';})) throw new Error('Incomplete Food v2 snapshot');
    var json=chunks.map(function(r){return r[2].slice(5);}).join('');
    if(json.length!==manifest.length || pulseFoodV2Hash_(json)!==manifest.hash) throw new Error('Food v2 snapshot integrity check failed');
    s=JSON.parse(json);
    if(s.revision!==manifest.revision) throw new Error('Food v2 revision mismatch');
  }
  if(s.version!==1 || !Number.isInteger(s.revision) || s.revision<0 || !Array.isArray(s.products) || !Array.isArray(s.recipes) || !Array.isArray(s.days) || !Array.isArray(s.targets) || !s.portions || typeof s.portions!=='object') throw new Error('Unsupported Food v2 state');
  return s;
}
function pulseFoodV2WriteState_(ss,state) {
  var json=JSON.stringify(state);
  if(json.length>PULSE_FOOD_V2_MAX) throw new Error('Food library is full; export and review storage before adding more');
  var sh=ss.getSheetByName(PULSE_FOOD_V2_SHEET);
  if(!sh){sh=ss.insertSheet(PULSE_FOOD_V2_SHEET);sh.getRange(1,1).setValue('PulseFoodV2JSON');}
  var generation=String(state.revision)+'-'+Utilities.getUuid(),chunks=[];
  for(var i=0;i<json.length;i+=PULSE_FOOD_V2_CHUNK) chunks.push([generation,chunks.length,'JSON:'+json.slice(i,i+PULSE_FOOD_V2_CHUNK)]);
  var start=Math.max(3,sh.getLastRow()+1);
  sh.getRange(start,1,chunks.length,3).setValues(chunks);
  // setValue is the metadata commit point. Unreferenced partial chunks are ignored.
  sh.getRange(2,1).setValue(JSON.stringify({storage:2,generation:generation,revision:state.revision,count:chunks.length,length:json.length,hash:pulseFoodV2Hash_(json)}));
}
function pulseFoodV2Date_(value,ss) {
  if(value instanceof Date) return Utilities.formatDate(value,ss.getSpreadsheetTimeZone(),'yyyy-MM-dd');
  return String(value==null?'':value).slice(0,10);
}
function pulseFoodV2Num_(x) {return x==='' || x==null || !Number.isFinite(Number(x)) ? null : Number(x);}
function pulseFoodV2Food_(ss) {
  var sh=ss.getSheetByName('Food');
  if(!sh) throw new Error('Food sheet is missing');
  var range=sh.getDataRange(),values=range.getValues(),formulas=range.getFormulas();
  var headers=values[0]||[];
  // Preserve all unrelated columns; require each known header exactly once.
  PULSE_FOOD_HEADERS.forEach(function(h){if(headers.filter(function(x){return x===h;}).length!==1) throw new Error('Unexpected Food schema: '+h);});
  var index={};headers.forEach(function(h,i){index[h]=i;});
  var records=values.slice(1).map(function(row,i){var original=row.map(function(v,j){return (formulas[i+1]||[])[j]||v;});return {row:i+2,raw:original,entry:{
    id:String(row[index.EntryID]),date:pulseFoodV2Date_(row[index.Date],ss),time:String(row[index.Time]||''),meal:String(row[index.Meal]||''),item:String(row[index.Item]||''),
    kcal:pulseFoodV2Num_(row[index.Kcal]),protein:pulseFoodV2Num_(row[index.Protein_g]),carbs:pulseFoodV2Num_(row[index.Carbs_g]),fat:pulseFoodV2Num_(row[index.Fat_g]),source:String(row[index.Source]||'')
  }};});
  return {sheet:sh,index:index,records:records};
}
/** Same canonical representation as the client; null macros are distinct from zero. */
function pulseFoodV2Signature_(records,date) {
  return JSON.stringify(records.filter(function(r){return r.date===date;}).map(function(r){return [r.id,r.date,r.time,r.meal,r.item,r.kcal,r.protein,r.carbs,r.fat,r.source];}).sort(function(a,b){var x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0;}));
}
function pulseFoodV2Get(ss) {
  var lock=LockService.getScriptLock();lock.waitLock(10000);
  try{
    var state=pulseFoodV2ReadState_(ss), food=pulseFoodV2Food_(ss).records.map(function(r){return r.entry;});
    // A late log/edit/delete (including a manual Sheet edit) reopens the day for reporting.
    state.days=state.days.map(function(d){return {date:d.date,signature:d.signature,closed:d.closed===true && d.signature===pulseFoodV2Signature_(food,d.date)};});
    return {capabilities:{foodV2:true},foodV2:state};
  }finally{lock.releaseLock();}
}
function pulseFoodV2Text_(x,label,max,optional) {
  if(optional && (x==null || x==='')) return '';
  if(typeof x!=='string' || !x.trim() || x.length>(max||200) || /^[\s]*[=+@-]/.test(x) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x)) throw new Error('Invalid '+label);
  if(label==='id' && ['__proto__','constructor','prototype'].indexOf(x.trim())>=0) throw new Error('Invalid id');
  return x.trim();
}
function pulseFoodV2ValidDate_(d) {
  if(typeof d!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d+'T12:00:00Z')) || new Date(d+'T12:00:00Z').toISOString().slice(0,10)!==d) throw new Error('Invalid date');
  return d;
}
function pulseFoodV2Macro_(x,label,optional) {
  if(optional && (x==='' || x==null)) return null;
  if((typeof x!=='number' && typeof x!=='string') || x==='' || x==null || !Number.isFinite(Number(x)) || Number(x)<0 || Number(x)>100000) throw new Error('Invalid '+label);
  return Number(x);
}
function pulseFoodV2Portion_(r) {
  var q=pulseFoodV2Macro_(r.quantity,'quantity',false);
  if(q<=0) throw new Error('Quantity must be greater than zero');
  return {quantity:q,unit:pulseFoodV2Text_(r.unit,'unit',30)};
}
function pulseFoodV2Record_(r,recipe) {
  if(!r || typeof r!=='object') throw new Error('Missing record');
  var portion=pulseFoodV2Portion_(r);
  var out={id:pulseFoodV2Text_(r.id,'id',100),name:pulseFoodV2Text_(r.name,'name',200),quantity:portion.quantity,unit:portion.unit,kcal:pulseFoodV2Macro_(r.kcal,'calories'),protein:pulseFoodV2Macro_(r.protein,'protein',true),carbs:pulseFoodV2Macro_(r.carbs,'carbs',true),fat:pulseFoodV2Macro_(r.fat,'fat',true)};
  // Recipe totals are derived from the ingredients, not trusted client totals.
  if(recipe) {
    if(!Array.isArray(r.ingredients) || !r.ingredients.length || r.ingredients.length>100) throw new Error('Recipe needs ingredients');
    out.ingredients=r.ingredients.map(function(i){return {name:pulseFoodV2Text_(i.name,'ingredient name',200),kcal:pulseFoodV2Macro_(i.kcal,'ingredient calories'),protein:pulseFoodV2Macro_(i.protein,'ingredient protein',true),carbs:pulseFoodV2Macro_(i.carbs,'ingredient carbs',true),fat:pulseFoodV2Macro_(i.fat,'ingredient fat',true)};});
    ['kcal','protein','carbs','fat'].forEach(function(k){out[k]=out.ingredients.some(function(i){return i[k]===null;})?null:Math.round(out.ingredients.reduce(function(sum,i){return sum+i[k];},0)*10000)/10000;});
  }
  return out;
}
function pulseFoodV2Expected_(a,b) {
  if(!b || typeof b!=='object') return false;
  return ['date','time','meal','item','source'].every(function(k){return a[k]===String(b[k]==null?'':b[k]);}) && ['kcal','protein','carbs','fat'].every(function(k){return a[k]===pulseFoodV2Num_(b[k]);});
}
function pulseFoodV2Post(ss,payload) {
  var actions=['logFoodV2','updateFood','saveFoodProduct','saveFoodRecipe','setFoodDay','setFoodTargets'];
  if(!payload || actions.indexOf(payload.action)<0) return null; // let the existing router handle it
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(10000)) return {ok:false,committed:false,error:'Another save is running. Refresh before trying again.'};
  var rollback=null;
  try{
    var s=pulseFoodV2ReadState_(ss);
    if(!Number.isInteger(payload.expectedRevision) || payload.expectedRevision!==s.revision) throw new Error('Food settings changed on another device. Refresh before saving.');
    if(payload.action==='logFoodV2') {
      if(!Array.isArray(payload.entries) || !payload.entries.length || payload.entries.length>100) throw new Error('Invalid food batch');
      var food=pulseFoodV2Food_(ss), seen={}, newRows=[], oldLast=food.sheet.getLastRow();
      payload.entries.forEach(function(e){
        var id=pulseFoodV2Text_(e.id,'id',100);
        if(['__proto__','constructor','prototype'].indexOf(id)>=0 || seen[id]) throw new Error('Duplicate or invalid id');
        seen[id]=true;
        var portion=e.quantity==null?null:pulseFoodV2Portion_(e);
        var record={id:id,date:pulseFoodV2ValidDate_(e.date),time:String(e.time||''),meal:pulseFoodV2Text_(e.meal,'meal',60),item:pulseFoodV2Text_(e.item,'item',500),kcal:pulseFoodV2Macro_(e.kcal,'calories'),protein:pulseFoodV2Macro_(e.protein,'protein',true),carbs:pulseFoodV2Macro_(e.carbs,'carbs',true),fat:pulseFoodV2Macro_(e.fat,'fat',true),source:pulseFoodV2Text_(e.source,'source',100,true)};
        if(!/^\d{2}:\d{2}(:\d{2})?$/.test(record.time) && record.time!=='') throw new Error('Invalid time');
        var existing=food.records.filter(function(r){return r.entry.id===id;});
        if(existing.length){
          if(existing.length!==1 || JSON.stringify(existing[0].entry)!==JSON.stringify(record)) throw new Error('Entry ID already exists with different data');
          var previousPortion=s.portions[id]||null;
          if(JSON.stringify(previousPortion)!==JSON.stringify(portion)) throw new Error('Entry ID already exists with different portion');
          return;
        }
        var row=Array(food.sheet.getLastColumn()).fill('');
        ['id','date','time','meal','item','kcal','protein','carbs','fat','source'].forEach(function(k,i){row[food.index[PULSE_FOOD_HEADERS[i]]]=record[k]==null?'':record[k];});
        newRows.push(row);
        if(portion) s.portions[id]=portion;
        s.days=s.days.map(function(d){return d.date===record.date?{date:d.date,closed:false,signature:d.signature}:d;});
      });
      s.revision++;if(JSON.stringify(s).length>PULSE_FOOD_V2_MAX) throw new Error('Food library is full');
      if(newRows.length){
        rollback=function(){food.sheet.getRange(oldLast+1,1,newRows.length,newRows[0].length).clearContent();};
        food.sheet.getRange(oldLast+1,1,newRows.length,newRows[0].length).setValues(newRows);
      }
    }else if(payload.action==='updateFood') {
      var food=pulseFoodV2Food_(ss), matches=food.records.filter(function(r){return r.entry.id===payload.id;});
      if(matches.length!==1) throw new Error('Food item missing or duplicated. Refresh before editing.');
      var current=matches[0];
      if(!pulseFoodV2Expected_(current.entry,payload.expected)) throw new Error('This food item changed. Refresh before editing.');
      pulseFoodV2Text_(payload.id,'id',100);
      var e=payload.entry||{}, portion=pulseFoodV2Portion_(e);
      var v={EntryID:current.entry.id,Date:pulseFoodV2ValidDate_(e.date),Time:String(e.time==null?current.entry.time:e.time),Meal:pulseFoodV2Text_(e.meal,'meal',60),Item:pulseFoodV2Text_(e.item,'item',500),Kcal:pulseFoodV2Macro_(e.kcal,'calories'),Protein_g:pulseFoodV2Macro_(e.protein,'protein',true),Carbs_g:pulseFoodV2Macro_(e.carbs,'carbs',true),Fat_g:pulseFoodV2Macro_(e.fat,'fat',true),Source:pulseFoodV2Text_(e.source,'source',100,true)};
      if(!/^\d{2}:\d{2}(:\d{2})?$/.test(v.Time) && v.Time!=='') throw new Error('Invalid time');
      var row=current.raw.slice();Object.keys(v).forEach(function(k){row[food.index[k]]=v[k]==null?'':v[k];});
      s.portions[payload.id]=portion;
      s.days=s.days.map(function(d){return d.date===current.entry.date || d.date===v.Date ? {date:d.date,closed:false,signature:d.signature}:d;});
      // Validate metadata size before changing Food. Writes do not delete or append the food item.
      s.revision++;if(JSON.stringify(s).length>PULSE_FOOD_V2_MAX) throw new Error('Food library is full');
      rollback=function(){food.sheet.getRange(current.row,1,1,current.raw.length).setValues([current.raw]);};
      food.sheet.getRange(current.row,1,1,row.length).setValues([row]);
    }else{
      if(payload.action==='saveFoodProduct' || payload.action==='saveFoodRecipe'){
        var key=payload.action==='saveFoodRecipe'?'recipes':'products', record=pulseFoodV2Record_(payload.record,key==='recipes');
        var i=s[key].findIndex(function(r){return r.id===record.id;});
        if(i<0) s[key].push(record);else s[key][i]=record;
      }else if(payload.action==='setFoodDay'){
        var date=pulseFoodV2ValidDate_(payload.date);
        if(typeof payload.closed!=='boolean') throw new Error('Invalid day status');
        var signature=pulseFoodV2Signature_(pulseFoodV2Food_(ss).records.map(function(r){return r.entry;}),date);
        if(payload.signature!==signature) throw new Error('Food entries changed. Refresh before closing this day.');
        var day={date:date,closed:payload.closed,signature:signature};
        s.days=s.days.filter(function(d){return d.date!==date;}).concat([day]);
      }else if(payload.action==='setFoodTargets'){
        var t=payload.record||{}, target={date:pulseFoodV2ValidDate_(t.date),kcal:pulseFoodV2Macro_(t.kcal,'calorie target',true),protein:pulseFoodV2Macro_(t.protein,'protein target'),carbs:pulseFoodV2Macro_(t.carbs,'carb target',true),fat:pulseFoodV2Macro_(t.fat,'fat target',true)};
        if(target.protein<=0 || (target.kcal!==null && target.kcal<=0)) throw new Error('Targets must be positive');
        s.targets=s.targets.filter(function(r){return r.date!==target.date;}).concat([target]).sort(function(a,b){return a.date.localeCompare(b.date);});
      }
      s.revision++;
    }
    pulseFoodV2WriteState_(ss,s);rollback=null;
    return {ok:true,revision:s.revision};
  }catch(error){
    if(rollback){try{rollback();}catch(restoreError){return {ok:false,error:'Save could not be completed or restored. Stop editing and inspect Food and Food v2 metadata.'};}}
    return {ok:false,committed:false,error:String(error.message||error)};
  }finally{lock.releaseLock();}
}
