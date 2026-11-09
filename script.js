// ===== 設定 =====
// Firebaseコンソール → プロジェクトの設定 → マイアプリ(Web) に表示される値を貼り付けます
const firebaseConfig = {
  apiKey: "AIzaSyDdlgR4e4wW-IWSWn9GW12MfNc82OxzQhw",
  authDomain: "soji-map.firebaseapp.com",
  projectId: "soji-map",
  appId: "1:791879190531:web:1df919c600d2ebb43ea636"
};
// 「掃除済み」ボタンの合言葉。空文字なら誰でも押せます
const ADMIN_PIN = "";
const TOP_N = 3;          // ピンクにするブロック数
const STALE_DAYS = 7;     // 青にする放置日数
// ================

const $ = id => document.getElementById(id);
const names = [];
for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) names.push("ABCD"[c] + (r + 1));

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
};
const me = {
  id: store.get("souji_uid") || "u" + Math.random().toString(36).slice(2, 10),
  name: store.get("souji_name") || ""
};
store.set("souji_uid", me.id);
$("name").value = me.name;
$("name").addEventListener("change", e => {
  me.name = e.target.value.trim();
  store.set("souji_name", me.name);
  render();
});

const state = { blocks: {}, votes: [], users: {} };
const configured = firebaseConfig.apiKey !== "YOUR_API_KEY";
let db = null;

if (!configured) {
  $("banner").hidden = false;
} else {
  firebase.initializeApp(firebaseConfig);
  db = firebase.firestore();
  const fail = e => say("通信エラー: " + e.message);
  db.collection("blocks").onSnapshot(snap => {
    state.blocks = {}; snap.forEach(d => state.blocks[d.id] = d.data()); render();
  }, fail);
  db.collection("votes").onSnapshot(snap => {
    state.votes = snap.docs.map(d => d.data()); render();
  }, fail);
  db.collection("users").onSnapshot(snap => {
    state.users = {}; snap.forEach(d => state.users[d.id] = d.data()); render();
  }, fail);
}

// ----- 集計 -----
function weekStart() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 月曜0時
  return d.getTime();
}
function cleanedAt(nm) { return (state.blocks[nm] && state.blocks[nm].lastCleanedAt) || 0; }
function since(nm) { return Math.max(weekStart(), cleanedAt(nm)); }
function count(nm) { return state.votes.filter(v => v.blockId === nm && v.createdAt > since(nm)).length; }
function voted(nm) { return state.votes.some(v => v.blockId === nm && v.userId === me.id && v.createdAt > since(nm)); }
function days(nm) {
  const t = cleanedAt(nm);
  return t ? Math.floor((Date.now() - t) / 86400000) : null;
}
function level(nm) {
  const top = names.map(n => [count(n), n]).filter(x => x[0] > 0)
    .sort((a, b) => b[0] - a[0]).slice(0, TOP_N).map(x => x[1]);
  if (top.includes(nm)) return "pink";
  const d = days(nm);
  if (d === null || d >= STALE_DAYS) return "blue";
  return "";
}

// ----- 表示 -----
function say(t) { $("toast").textContent = t; }

function build(id, handler, mode) {
  const g = $(id); g.innerHTML = "";
  names.forEach(nm => {
    const b = document.createElement("button");
    const d = days(nm), dt = d === null ? "記録なし" : d + "日";
    b.className = "cell" + (mode === "result" ? " " + level(nm) : "") + (mode === "vote" && voted(nm) ? " mine" : "");
    b.setAttribute("aria-label", nm + "ブロック");
    b.innerHTML = mode === "result"
      ? `<small>${nm}</small><span class="n">${count(nm)}票</span><small>${dt}</small>`
      : mode === "vote"
        ? `<small>${nm}</small><span class="n">${count(nm)}</span>`
        : `<small>${nm}</small><span class="n">${dt}</span>`;
    b.onclick = () => handler(nm);
    g.appendChild(b);
  });
}

function render() {
  const mine = state.users[me.id];
  $("pts").textContent = (mine ? mine.points : 0) + " pt";
  build("g-vote", vote, "vote");
  build("g-result", nm => say(`${nm}: ${count(nm)}票 / ${days(nm) === null ? "掃除の記録なし" : days(nm) + "日掃除なし"}`), "result");
  build("g-admin", clean, "admin");
  const rank = Object.values(state.users).filter(u => u.points > 0)
    .sort((a, b) => b.points - a.points).slice(0, 5);
  $("rank").innerHTML = rank.length
    ? rank.map(u => `<li>${esc(u.name)}(${u.points}pt)</li>`).join("")
    : "<li>まだ投票がありません</li>";
}
function esc(s) { return String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

// ----- 操作 -----
function vote(nm) {
  if (!db) { say("先にFirebaseを設定してください"); return; }
  if (!me.name) { say("先に名前を入力してください"); $("name").focus(); return; }
  if (voted(nm)) { say(nm + "には投票済みです"); return; }
  const batch = db.batch();
  batch.set(db.collection("votes").doc(nm + "_" + me.id),
    { blockId: nm, userId: me.id, createdAt: Date.now() });
  batch.set(db.collection("users").doc(me.id),
    { name: me.name, points: firebase.firestore.FieldValue.increment(1) }, { merge: true });
  batch.commit().then(() => say(nm + "に投票しました +1pt"))
    .catch(e => say("投票に失敗しました: " + e.message));
}

function clean(nm) {
  if (!db) { say("先にFirebaseを設定してください"); return; }
  if (ADMIN_PIN && prompt("合言葉を入力してください") !== ADMIN_PIN) { say("合言葉が違います"); return; }
  db.collection("blocks").doc(nm).set({ lastCleanedAt: Date.now() })
    .then(() => say(nm + "を掃除済みにしました"))
    .catch(e => say("保存に失敗しました: " + e.message));
}

document.querySelectorAll("nav button").forEach(btn => btn.onclick = () => {
  document.querySelectorAll("nav button").forEach(b => b.setAttribute("aria-selected", b === btn));
  ["vote", "result", "admin"].forEach(t => $(t).hidden = t !== btn.dataset.tab);
  say("");
});
render();