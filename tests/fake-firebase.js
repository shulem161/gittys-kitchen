(function(){
const L=()=>{const d=JSON.parse(localStorage.getItem("__fakedb")||'{"users":{},"names":{},"accounts":{}}');d.recipes=d.recipes||{};d.submissions=d.submissions||{};d.photos=d.photos||{};d.feedback=d.feedback||{};d.meta=d.meta||{};d.resets=d.resets||{};d.requests=d.requests||{};d.plans=d.plans||{};d.menus=d.menus||{};d.golive=d.golive||{};d.threads=d.threads||{};return d};
const W=d=>{localStorage.setItem("__fakedb",JSON.stringify(d));fire()};
let subs=[];function fire(){setTimeout(()=>subs.forEach(s=>s()),0)}
window.addEventListener("storage",e=>{if(e.key==="__fakedb")fire()});
const rnd=()=>Math.random().toString(36).slice(2,12);
let cur=JSON.parse(sessionStorage.getItem("__me")||"null"), al=[];
const acct=a=>(L().accounts[a.email]||{});
window.__fakeVerify=()=>{const d=L();if(cur&&d.accounts[cur.email]){d.accounts[cur.email].verified=true;W(d)}};
window.__fakeMails=()=>L().mails||[];
const mail=(to,kind,extra)=>{const d=L();d.mails=d.mails||[];d.mails.push(Object.assign({to,kind,at:Date.now()},extra||{}));W(d)};
const mkUser=a=>a&&{uid:a.uid,email:a.email,get emailVerified(){return !!acct(a).verified},
 sendEmailVerification:async()=>mail(a.email,"verify"),reload:async()=>{},getIdToken:async()=>"t",
 verifyBeforeUpdateEmail:async ne=>{if(L().accounts[ne])throw{code:"auth/email-already-in-use"};mail(ne,"change",{from:a.email})},delete:async()=>{const d=L();delete d.accounts[a.email];W(d);setCur(null)},
 reauthenticateWithCredential:async c=>{const x=L().accounts[a.email];if(!x||x.pw!==c.p)throw{code:"auth/invalid-credential"}},
 updatePassword:async np=>{if(np.length<6)throw{code:"auth/weak-password"};const d=L();d.accounts[a.email].pw=np;W(d)}};
function setCur(a){cur=a;sessionStorage.setItem("__me",JSON.stringify(a));al.forEach(f=>setTimeout(()=>f(mkUser(a)),0))}
const authObj={get currentUser(){return mkUser(cur)},
 onAuthStateChanged(f){al.push(f);setTimeout(()=>f(mkUser(cur)),5)},
 async createUserWithEmailAndPassword(email,pw){const d=L();if(d.accounts[email])throw{code:"auth/email-already-in-use"};if(pw.length<6)throw{code:"auth/weak-password"};const a={uid:rnd(),email,pw};d.accounts[email]=a;W(d);setCur({uid:a.uid,email});return{user:mkUser(cur)}},
 async signInWithEmailAndPassword(email,pw){const a=L().accounts[email];if(!a||a.pw!==pw)throw{code:"auth/invalid-credential"};setCur({uid:a.uid,email});return{user:mkUser(cur)}},
 async signOut(){setCur(null)},
 async sendPasswordResetEmail(e){if(L().accounts[e])mail(e,"reset")}};
function doc(col,id){return{_col:col,_id:id,id,
 async get(){const v=L()[col][id];return{exists:!!v,data:()=>v}},
 async set(o,opt){const d=L();if(col==="names"&&d.names[id]&&!(o.email===""&&cur&&d.names[id].uid===cur.uid)){const rs=o.code&&d.resets[o.code];if(!(rs&&rs.key===id&&rs.uid===d.names[id].uid&&(!rs.expires||rs.expires>Date.now())))throw{code:"permission-denied"}}const v=JSON.parse(JSON.stringify(o));d[col][id]=opt&&opt.merge&&d[col][id]?Object.assign(d[col][id],v):v;W(d)},
 async update(o){const d=L();if(!d[col][id])throw{code:"not-found"};Object.assign(d[col][id],o);W(d)},
 async delete(){const d=L();delete d[col][id];W(d)},
 onSnapshot(cb){let last;const s=()=>{const v=L()[col][id];const k=JSON.stringify(v);if(k===last)return;last=k;cb({exists:!!v,data:()=>v&&JSON.parse(k)})};subs.push(s);setTimeout(s,5);return()=>{subs=subs.filter(x=>x!==s)}}}}
const fs={enablePersistence(){return Promise.resolve()},batch(){const ops=[];return{set(ref,o){ops.push([ref,o,0])},update(ref,o){ops.push([ref,o,1])},async commit(){const d=L();ops.forEach(([r,o,u])=>{const v=JSON.parse(JSON.stringify(o));d[r._col][r._id]=u?Object.assign(d[r._col][r._id]||{},v):v});W(d)}}},collection(col){const mk=flt=>({doc:id=>doc(col,id||("a"+Date.now().toString(36)+Math.random().toString(36).slice(2,8))),where:(k,op,v)=>mk(x=>(!flt||flt(x))&&(op==="array-contains"?Array.isArray(x[k])&&x[k].includes(v):x[k]===v)),async get(){const c=L()[col];return {docs:Object.keys(c).filter(id=>!flt||flt(c[id])).map(id=>({id,data:()=>c[id]}))}},onSnapshot(cb){const s=()=>{const c=L()[col];cb({docs:Object.keys(c).filter(id=>!flt||flt(c[id])).map(id=>({id,data:()=>c[id]}))})};subs.push(s);setTimeout(s,5);return()=>{subs=subs.filter(x=>x!==s)}}});return mk(null)}};
const authFn=()=>authObj;authFn.EmailAuthProvider={credential:(e,p)=>({e,p})};
window.firebase={apps:[],initializeApp(){this.apps.push(1)},auth:authFn,firestore:()=>fs};
})();
