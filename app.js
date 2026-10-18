import { firebaseConfig, cloudinaryConfig } from "./config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged, updateProfile,
  initializeAuth, inMemoryPersistence, browserSessionPersistence, sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, setDoc, updateDoc, collection, addDoc, query, orderBy,
  onSnapshot, serverTimestamp, where, getDocs, deleteDoc, increment,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ===================== helpers ===================== */
const $ = (s) => document.querySelector(s);
const show = (el) => el.classList.remove("hidden");
const hide = (el) => el.classList.add("hidden");

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 3500);
}

const firebaseReady =
  firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("YOUR_");
const cloudinaryReady =
  cloudinaryConfig.cloudName && !cloudinaryConfig.cloudName.startsWith("YOUR_") &&
  cloudinaryConfig.uploadPreset && !cloudinaryConfig.uploadPreset.startsWith("YOUR_");

window.gsReady = true;                    // ui.js ko batata hai ke app.js load ho gayi
window.gsConfigMissing = !firebaseReady;

// Page kholne par login yaad rakha jaye ya nahi (sirf yeh ek lafz badalna hai):
//   "never"   -> har baar page khulne par pehle landing page (Sign up / Login) dikhega  (hackathon demo ke liye best)
//   "session" -> refresh par login rahega, lekin tab band karke dobara kholne par landing page aayega
//   "always"  -> hamesha login rahega (real apps ki tarah)
const LOGIN_MEMORY = "never";

let auth, db;
if (firebaseReady) {
  const fbApp = initializeApp(firebaseConfig);
  if (LOGIN_MEMORY === "never") auth = initializeAuth(fbApp, { persistence: inMemoryPersistence });
  else if (LOGIN_MEMORY === "session") auth = initializeAuth(fbApp, { persistence: browserSessionPersistence });
  else auth = getAuth(fbApp);
  db = getFirestore(fbApp);
}

const state = {
  me: null,            // { uid, name, photoURL, phone }
  users: [],
  active: null,        // selected peer
  unsubUsers: null,
  unsubMsgs: null,
  unsubChat: null,
  unsubContacts: null,
  typingTimer: null,
  typingShown: false,
  heartbeat: null,
  authMode: "login",
  busyAuth: false,
  avatarFile: null,
  contacts: [],        // saved contacts [{id, name, phone, uid}]
  localContacts: [], cloudContacts: [], syncTried: new Set(), cloudFailShown: false,
  prefs: { fav: [], arch: [], lock: [], pin: "" }, filter: "all", unlocked: new Set(),
  tab: "all",          // "all" | "contacts"
  animateNext: true,   // list ko sirf zaroorat par animate karte hain
  seenIds: null,       // messages jo pehle render ho chuke hain
  stripKey: "",        // online strip ka cache key
  justLoggedOut: false,
  chatMeta: {},        // har dost ki chat ka summary { lastText, lastFrom, lastAt, unread }
  metaUnsubs: {},      // har dost ke chat summary ke listeners
  iAmTyping: false,
};

const chatIdOf = (a, b) => [a, b].sort().join("_");

// Phone number ko ek standard format (+923001234567) mein badalta hai
function normalizePhone(raw) {
  let s = String(raw).replace(/[\s\-()]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (/^0\d{10}$/.test(s)) s = "+92" + s.slice(1);   // Pakistan local format 03xx...
  if (!s.startsWith("+")) s = "+" + s;
  return /^\d{8,15}$/.test(s.slice(1)) ? s : "";
}

// numbers ko format se qata nazar sirf aakhri 10 ginti se match karo (0300.., +92300.., 300.. sab barabar)
function samePhone(a, b) {
  const x = String(a || "").replace(/\D/g, ""), y = String(b || "").replace(/\D/g, "");
  if (x.length < 7 || y.length < 7) return false;
  return x.slice(-10) === y.slice(-10);
}

function friendlyError(err) {
  const code = err?.code || "";
  const map = {
    "auth/email-already-in-use": "Yeh email pehle se registered hai. Login try karein.",
    "auth/invalid-email": "Email sahi format mein likhein.",
    "auth/weak-password": "Password kam az kam 6 characters ka rakhein.",
    "auth/invalid-credential": "Email ya password galat hai. Password yaad nahi to 'Password bhool gaye?' dabayein.",
    "auth/missing-email": "Pehle email likhein.",
    "auth/user-not-found": "Is email ka account nahi mila. Pehle Sign up karein.",
    "auth/wrong-password": "Password galat hai.",
    "auth/missing-password": "Password likhein.",
    "auth/too-many-requests": "Bohat zyada koshishein. Thori der baad try karein.",
    "auth/network-request-failed": "Internet connection check karein.",
    "auth/operation-not-allowed": "Firebase Console mein Authentication > Email/Password enable karein.",
    "permission-denied": "Firestore rules ki wajah se permission nahi mili (README dekhein).",
  };
  return map[code] || err?.message || "Kuch ghalat ho gaya. Dobara koshish karein.";
}

function colorFor(str = "") {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
  return `linear-gradient(135deg,hsl(${h},80%,60%),hsl(${(h + 50) % 360},80%,55%))`;
}

function avatarEl(user, small = false, withDot = false) {
  const d = document.createElement("div");
  d.className = "av" + (small ? " sm" : "");
  if (user.photoURL) {
    d.style.backgroundImage = `url("${user.photoURL}")`;
  } else {
    d.style.background = colorFor(user.name);
    d.textContent = (user.name || "?").trim().charAt(0).toUpperCase();
  }
  if (withDot && isOnline(user)) {
    const dot = document.createElement("span");
    dot.className = "dot";
    d.appendChild(dot);
  }
  return d;
}

function isOnline(u) {
  if (!u.online) return false;
  const ms = u.lastSeen?.toMillis ? u.lastSeen.toMillis() : 0;
  return Date.now() - ms < 75000;
}

function lastSeenText(u) {
  if (isOnline(u)) return "online";
  const d = u.lastSeen?.toDate ? u.lastSeen.toDate() : null;
  if (!d) return "offline";
  const same = d.toDateString() === new Date().toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return same ? `last seen aaj ${time}` : `last seen ${d.toLocaleDateString()}`;
}

async function uploadToCloudinary(file, kind = "image") {
  if (!cloudinaryReady) throw new Error("Cloudinary config.js mein set nahi hai.");
  const fd = new FormData();
  if (file instanceof Blob && !file.name) fd.append("file", file, "voice." + (file.type.includes("mp4") ? "m4a" : "webm"));
  else fd.append("file", file);
  fd.append("upload_preset", cloudinaryConfig.uploadPreset);
  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/${kind}/upload`,
    { method: "POST", body: fd }
  );
  const data = await res.json();
  if (!res.ok || !data.secure_url) {
    throw new Error(data?.error?.message || "Upload fail ho gaya.");
  }
  return data.secure_url;
}

/* ===================== landing + modal ===================== */
function openModal(mode) {
  if (!firebaseReady) {
    toast("Pehle config.js mein apni Firebase keys paste karein 🔧");
    return;
  }
  setMode(mode);
  show($("#authModal"));
}
function closeModal() {
  hide($("#authModal"));
  $("#authError").textContent = "";
}
function setMode(mode) {
  state.authMode = mode;
  $("#tabLogin").classList.toggle("active", mode === "login");
  $("#tabSignup").classList.toggle("active", mode === "signup");
  $("#signupOnly").classList.toggle("hidden", mode !== "signup");
  $("#authSubmit").textContent = mode === "signup" ? "Account banao" : "Login";
  $("#passInput").autocomplete = mode === "signup" ? "new-password" : "current-password";
  $("#authError").textContent = "";
}

["#openLogin", "#heroLogin"].forEach((s) => $(s).addEventListener("click", () => openModal("login")));
["#openSignup", "#heroSignup", "#bottomSignup"].forEach((s) => $(s).addEventListener("click", () => openModal("signup")));
$("#closeModal").addEventListener("click", closeModal);
$("#authModal").addEventListener("click", (e) => { if (e.target.id === "authModal") closeModal(); });
$("#tabLogin").addEventListener("click", () => setMode("login"));
$("#tabSignup").addEventListener("click", () => setMode("signup"));

$("#avatarInput").addEventListener("change", (e) => {
  const f = e.target.files[0];
  if (!f) return;
  state.avatarFile = f;
  const prev = $("#avatarPreview");
  prev.textContent = "";
  prev.style.backgroundImage = `url("${URL.createObjectURL(f)}")`;
});

/* ===================== auth ===================== */
$("#authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errBox = $("#authError");
  errBox.classList.remove("ok");
  errBox.textContent = "";

  if (!firebaseReady) {
    errBox.textContent = "⚠️ Pehle config.js mein apni Firebase keys paste karein.";
    return;
  }
  state.authMode = $("#authForm").getAttribute("data-mode") || state.authMode;

  const email = $("#emailInput").value.trim();
  const pass = $("#passInput").value;
  const name = $("#nameInput").value.trim();
  const rawPhone = $("#phoneInput").value.trim();
  const phone = rawPhone ? normalizePhone(rawPhone) : "";

  if (state.authMode === "signup" && name.length < 2) { errBox.textContent = "Apna naam likhein (kam az kam 2 harf)."; return; }
  if (state.authMode === "signup" && rawPhone && !phone) { errBox.textContent = "Phone number sahi nahi hai. Misal: 03001234567 ya +923001234567"; return; }
  if (!email) { errBox.textContent = "Email likhein."; return; }
  if (pass.length < 6) { errBox.textContent = "Password kam az kam 6 characters ka ho."; return; }

  const btn = $("#authSubmit");
  btn.disabled = true;
  btn.textContent = "Please wait…";
  state.busyAuth = true;

  try {
    if (state.authMode === "signup") {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);

      let photoURL = "";
      if (state.avatarFile) {
        try { photoURL = await uploadToCloudinary(state.avatarFile); }
        catch (upErr) { toast("Profile photo upload nahi hui, baad mein dobara try karein."); }
      }

      await updateProfile(cred.user, { displayName: name, photoURL: photoURL || null });
      // Firestore write ka intezar nahi karte (agar database na bana ho to button atak jata hai)
      setDoc(doc(db, "users", cred.user.uid), {
        uid: cred.user.uid,
        name,
        email,
        phone,
        photoURL,
        online: true,
        lastSeen: serverTimestamp(),
        createdAt: serverTimestamp(),
      }).catch((e2) => toast(friendlyError(e2)));
      toast("Account ban gaya! Khush aamdeed 🎉");
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }

    state.busyAuth = false;
    closeModal();
    $("#authForm").reset();
    state.avatarFile = null;
    $("#avatarPreview").style.backgroundImage = "";
    $("#avatarPreview").textContent = "📷";
    await enterApp(auth.currentUser);
  } catch (err) {
    state.busyAuth = false;
    errBox.textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
    btn.textContent = state.authMode === "signup" ? "Account banao" : "Login";
  }
});

/* ----- password reset ----- */
$("#forgotBtn").addEventListener("click", async () => {
  const errBox = $("#authError");
  errBox.classList.remove("ok");
  errBox.textContent = "";
  if (!firebaseReady) {
    errBox.textContent = "⚠️ Pehle config.js mein apni Firebase keys paste karein.";
    return;
  }
  const email = $("#emailInput").value.trim();
  if (!email) {
    errBox.textContent = "Pehle upar apna email likhein, phir 'Password bhool gaye?' dabayein.";
    return;
  }
  const btn = $("#forgotBtn");
  btn.disabled = true;
  try {
    await sendPasswordResetEmail(auth, email);
    errBox.classList.add("ok");
    errBox.textContent = "✅ Reset link bhej diya. Apna email (Inbox aur Spam dono) check karein, link se naya password set karke login karein.";
  } catch (err) {
    errBox.textContent = friendlyError(err);
  } finally {
    btn.disabled = false;
  }
});

if (firebaseReady) {
  onAuthStateChanged(auth, async (user) => {
    if (state.busyAuth) return;          // signup/login khud handle karega
    if (user) await enterApp(user);
    else leaveApp();
  });
}

/* ----- logout ----- */
$("#logoutBtn").addEventListener("click", async () => {
  if (!confirm("Kya aap logout karna chahte hain?")) return;
  state.justLoggedOut = true;
  // Internet na ho to presence update atak sakta hai, is liye zyada intezar nahi karte
  await Promise.race([setPresence(false), new Promise((r) => setTimeout(r, 800))]);
  try { await signOut(auth); }
  catch (err) { state.justLoggedOut = false; toast(friendlyError(err)); }
});

/* ===================== presence ===================== */
async function setPresence(online) {
  if (!state.me) return;
  try {
    await updateDoc(doc(db, "users", state.me.uid), { online, lastSeen: serverTimestamp() });
  } catch (_) { /* ignore */ }
}

document.addEventListener("visibilitychange", () => {
  if (!state.me) return;
  setPresence(document.visibilityState === "visible");
  if (document.visibilityState === "visible" && state.active) clearUnread(state.active.uid);
});
window.addEventListener("pagehide", () => { if (state.me) setPresence(false); });

/* ===================== enter / leave app ===================== */
async function enterApp(user) {
  if (!user || (state.me && state.me.uid === user.uid)) return;
  state.me = { uid: user.uid, name: user.displayName || user.email.split("@")[0], photoURL: user.photoURL || "", phone: "" };

  // agar user doc missing ho (purana account) to bana do
  setDoc(doc(db, "users", user.uid), {
    uid: user.uid, name: state.me.name, email: user.email,
    photoURL: state.me.photoURL, online: true, lastSeen: serverTimestamp(),
  }, { merge: true }).catch((err) => toast(friendlyError(err)));

  hide($("#landing"));
  show($("#app"));

  $("#meName").textContent = state.me.name;
  const meAv = $("#meAvatar");
  meAv.innerHTML = "";
  meAv.appendChild(avatarEl(state.me));

  state.animateNext = true;
  state.stripKey = "";
  setTab("all");
  subscribeUsers();
  loadPrefs();
  subscribeContacts();
  state.heartbeat = setInterval(() => { if (document.visibilityState === "visible") setPresence(true); }, 30000);
  buildEmojiPanel();
}

function leaveApp() {
  state.unsubUsers?.(); state.unsubMsgs?.(); state.unsubChat?.(); state.unsubContacts?.();
  Object.values(state.metaUnsubs).forEach((f) => f());
  state.metaUnsubs = {};
  document.title = "Gupshup — Real-time Chat";
  clearInterval(state.heartbeat);
  Object.assign(state, {
    me: null, askedPhone: false, users: [], contacts: [], localContacts: [], cloudContacts: [], syncTried: new Set(), cloudFailShown: false, filter: "all", unlocked: new Set(), tab: "all", active: null, seenIds: null, stripKey: "",
    chatMeta: {}, iAmTyping: false,
    unsubUsers: null, unsubMsgs: null, unsubChat: null, unsubContacts: null,
  });
  $("#userList").innerHTML = "";
  $("#onlineRow").innerHTML = "";
  $("#messages").innerHTML = "";
  hide($("#onlineStrip"));
  hide($("#chatView")); show($("#emptyState"));
  hide($("#emojiPanel"));
  hide($("#inviteModal")); hide($("#contactModal"));
  $("#app").classList.remove("chat-open");
  hide($("#app")); show($("#landing"));
  window.scrollTo(0, 0);

  // Logout ke baad landing page (Login / Sign up buttons ke saath) dikhao
  if (state.justLoggedOut) {
    state.justLoggedOut = false;
    closeModal();
    $("#authForm").reset();
    toast("Aap logout ho gaye 👋 Dobara Login ya Sign up karein");
    ["#openLogin", "#openSignup"].forEach((s) => {
      const b = $(s);
      b.classList.remove("pulse-cta");
      void b.offsetWidth;
      b.classList.add("pulse-cta");
      setTimeout(() => b.classList.remove("pulse-cta"), 5000);
    });
  }
}

/* ===================== users list ===================== */
function subscribeUsers() {
  state.unsubUsers?.();
  state.unsubUsers = onSnapshot(
    collection(db, "users"),
    (snap) => {
      const all = snap.docs.map((d) => d.data());
      updateMyPhone(all.find((u) => u.uid === state.me.uid));
      if (!state.me.phone && !state.askedPhone) { state.askedPhone = true; setTimeout(openPhoneModal, 900); }
      state.users = all.filter((u) => u.uid !== state.me.uid)
        .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
      syncChatListeners();
      renderUsers();
      if (state.active) {
        const fresh = state.users.find((u) => u.uid === state.active.uid);
        if (fresh) { state.active = fresh; updatePeerHeader(); }
      }
    },
    (err) => toast(friendlyError(err))
  );
}

/* ----- har dost ki chat par nazar: last message, unread badge, naye message ka alert ----- */
let audioCtx;
function playBeep() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    audioCtx.resume?.();
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, t0);
    o.frequency.exponentialRampToValueAtTime(1320, t0 + 0.12);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start(t0);
    o.stop(t0 + 0.26);
  } catch (_) { /* sound na chale to koi masla nahi */ }
}

function updateTitleBadge() {
  const total = Object.values(state.chatMeta).reduce((n, m) => n + (m.unread || 0), 0);
  document.title = total ? `(${total}) Gupshup — Real-time Chat` : "Gupshup — Real-time Chat";
}

function clearUnread(uid) {
  if (!state.me) return;
  const cid = chatIdOf(state.me.uid, uid);
  setDoc(doc(db, "chats", cid), { unread: { [state.me.uid]: 0 } }, { merge: true }).catch(() => {});
}

function notifyIncoming(u, meta) {
  playBeep();
  toast(`💬 ${nameOf(u)}: ${(meta.lastText || "").slice(0, 60)}`);
}

function syncChatListeners() {
  const wanted = new Set(state.users.map((u) => u.uid));
  Object.keys(state.metaUnsubs).forEach((uid) => {
    if (!wanted.has(uid)) {
      state.metaUnsubs[uid]();
      delete state.metaUnsubs[uid];
      delete state.chatMeta[uid];
    }
  });

  state.users.forEach((u) => {
    if (state.metaUnsubs[u.uid]) return;
    const cid = chatIdOf(state.me.uid, u.uid);
    let first = true;
    state.metaUnsubs[u.uid] = onSnapshot(doc(db, "chats", cid), (d) => {
      const data = d.data({ serverTimestamps: "estimate" }) || {};
      const meta = {
        lastText: data.lastText || "",
        lastFrom: data.lastFrom || "",
        lastAt: data.lastAt?.toMillis ? data.lastAt.toMillis() : 0,
        unread: Number(data.unread?.[state.me.uid] || 0),
      };
      const prev = state.chatMeta[u.uid];
      const openNow = state.active?.uid === u.uid && document.visibilityState === "visible";

      if (openNow && meta.unread > 0) { clearUnread(u.uid); meta.unread = 0; }          // chat khuli hai => unread zero
      if (!first && prev && meta.unread > prev.unread && !openNow) notifyIncoming(u, meta); // naya message alert
      first = false;

      const changed = !prev || prev.lastText !== meta.lastText || prev.lastAt !== meta.lastAt || prev.unread !== meta.unread;
      state.chatMeta[u.uid] = meta;
      if (changed) { renderUsers(); updateTitleBadge(); }
    }, () => { /* rules / internet ka masla yahan chup rahta hai, messages wali listener error dikhati hai */ });
  });
}

function contactFor(u) {
  return state.contacts.find((c) => (c.uid && c.uid === u.uid) || samePhone(c.phone, u.phone));
}
function nameOf(u) {
  const c = contactFor(u);
  return c ? c.name : u.name;
}

// "Abhi online" wali strip (sirf tab dobara banti hai jab online log badlein)
function renderOnlineStrip() {
  const strip = $("#onlineStrip");
  const row = $("#onlineRow");
  const online = state.users.filter(isOnline);
  if (!online.length) { hide(strip); row.innerHTML = ""; state.stripKey = ""; return; }
  show(strip);
  const key = online.map((u) => u.uid + "|" + nameOf(u) + "|" + (u.photoURL || "")).join(",");
  if (key === state.stripKey) return;
  state.stripKey = key;
  row.innerHTML = "";
  online.forEach((u, i) => {
    const s = document.createElement("div");
    s.className = "story";
    s.style.animationDelay = i * 60 + "ms";
    const ring = document.createElement("div");
    ring.className = "ring";
    ring.appendChild(avatarEl({ ...u, name: nameOf(u) }));
    const nm = document.createElement("span");
    nm.textContent = (nameOf(u) || "").split(" ")[0];
    s.append(ring, nm);
    s.addEventListener("click", () => tryOpenChat(u));
    row.appendChild(s);
  });
}

function renderUsers() {
  const list = $("#userList");
  const q = $("#searchInput").value.trim().toLowerCase();
  const anim = state.animateNext;
  state.animateNext = false;
  list.innerHTML = "";

  // rows = { user (Gupshup account, ho sakta hai na ho), contact (saved, ho sakta hai na ho) }
  let rows = [];
  if (state.tab === "contacts") {
    rows = state.contacts.map((c) => ({
      contact: c,
      user: state.users.find((u) => (c.uid && u.uid === c.uid) || samePhone(u.phone, c.phone)),
    }));
  } else {
    rows = state.users
      .filter((u) => state.filter === "fav" ? isFav(u.uid) : state.filter === "arch" ? isArch(u.uid) : !isArch(u.uid))
      .map((u) => ({ user: u, contact: contactFor(u) }));
    // favourite upar, phir jis se abhi baat hui
    rows.sort((a, b) => (isFav(b.user.uid) - isFav(a.user.uid))
      || ((state.chatMeta[b.user.uid]?.lastAt || 0) - (state.chatMeta[a.user.uid]?.lastAt || 0)));
  }

  rows = rows.filter((r) => {
    const nm = (r.user ? nameOf(r.user) : r.contact.name) || "";
    const ph = r.user?.phone || r.contact?.phone || "";
    return nm.toLowerCase().includes(q) || ph.includes(q.replace(/\s/g, ""));
  });

  $("#paneTitle").textContent = state.tab === "contacts" ? "Contacts" : state.filter === "fav" ? "Favourites" : state.filter === "arch" ? "Archived" : "Chats";
  $("#filterRow").classList.toggle("hidden", state.tab === "contacts");
  $("#paneCount").textContent = rows.length;
  renderOnlineStrip();

  if (!rows.length) {
    const div = document.createElement("div");
    div.className = "no-users";
    if (state.tab === "contacts") {
      if (state.contacts.length) div.textContent = "Koi contact nahi mila.";
      else { div.className = "no-users contacts-empty"; buildContactsEmpty(div); }
    } else if (state.filter === "fav") {
      div.textContent = "Abhi koi favourite nahi. Chat kholkar ☆ dabayein ⭐";
    } else if (state.filter === "arch") {
      div.textContent = "Koi archived chat nahi 🗂";
    } else {
      div.textContent = state.users.length
        ? "Koi user nahi mila."
        : "Abhi koi aur user nahi hai. Left side ke 🎁 Invite se dost ko bulayein 😊";
    }
    list.appendChild(div);
    return;
  }

  rows.forEach(({ user, contact }, idx) => {
    const row = document.createElement("div");
    row.className = "user" + (anim ? " enter" : "") + (user && state.active?.uid === user.uid ? " active" : "");
    row.style.setProperty("--i", Math.min(idx, 12));

    const shownName = user ? nameOf(user) : contact.name;
    row.appendChild(user ? avatarEl({ ...user, name: shownName }, false, true) : avatarEl({ name: shownName }));

    const meta = document.createElement("div");
    meta.className = "user-meta";
    const nm = document.createElement("b"); nm.textContent = shownName + (user && isFav(user.uid) ? " ⭐" : "");
    const cm = user ? state.chatMeta[user.uid] : null;
    const st = document.createElement("small");
    if (user && isLocked(user.uid)) {
      st.textContent = "🔒 Locked chat";
      st.className = "preview" + (cm && cm.unread ? " unread" : "");
    } else if (cm && cm.lastText) {
      st.textContent = (cm.lastFrom === state.me.uid ? "Aap: " : "") + cm.lastText;
      st.className = "preview" + (cm.unread ? " unread" : "");
    } else if (user) {
      st.textContent = lastSeenText(user);
      if (isOnline(user)) st.className = "on";
    } else {
      st.textContent = "Gupshup par nahi hai";
    }
    meta.append(nm, st);
    const phone = user?.phone || contact?.phone;
    if (phone) {
      const ph = document.createElement("small");
      ph.className = "ph";
      ph.textContent = phone;
      meta.appendChild(ph);
    }
    row.appendChild(meta);

    if (cm && cm.unread) {
      const badge = document.createElement("span");
      badge.className = "badge";
      badge.textContent = cm.unread > 99 ? "99+" : String(cm.unread);
      row.appendChild(badge);
    }

    // contact Gupshup par nahi hai -> WhatsApp se invite
    if (!user && contact) {
      const inv = document.createElement("button");
      inv.className = "inv-mini";
      inv.textContent = "📨 Invite";
      inv.title = "WhatsApp par invite bhejein";
      inv.addEventListener("click", (e) => {
        e.stopPropagation();
        sendInviteToNumber(contact.phone);
      });
      const lk = document.createElement("button");
      lk.className = "inv-mini link";
      lk.textContent = "🔗 Jodein";
      lk.title = "Is contact ko dost ke Gupshup account se jodein";
      lk.addEventListener("click", (e) => { e.stopPropagation(); openLinkModal(contact); });
      row.append(lk, inv);
    }

    if (state.tab === "contacts" && contact) {
      const ed = document.createElement("button");
      ed.className = "del ed"; ed.title = "Naam badlein"; ed.textContent = "✏️";
      ed.addEventListener("click", (e) => { e.stopPropagation(); renameContact(contact); });
      row.appendChild(ed);
      const del = document.createElement("button");
      del.className = "del";
      del.title = "Contact delete karein";
      del.textContent = "🗑";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm(`"${contact.name}" ko contacts se hatana hai?`)) removeContact(contact);
      });
      row.appendChild(del);
    }

    row.addEventListener("click", (e) => {
      if (user) tryOpenChat(user);
      else if (contact) openLinkModal(contact);
    });
    list.appendChild(row);
  });
}
$("#searchInput").addEventListener("input", renderUsers);
setInterval(() => { if (state.me) renderUsers(); }, 30000); // online status refresh

/* ===================== chat ===================== */
function updatePeerHeader() {
  const u = state.active;
  if (!u) return;
  $("#peerName").textContent = nameOf(u);
  const st = $("#peerStatus");
  st.textContent = lastSeenText(u);
  st.className = isOnline(u) ? "on" : "";
  const holder = $("#peerAvatar");
  holder.innerHTML = "";
  holder.appendChild(avatarEl({ ...u, name: nameOf(u) }, true, true));
  syncHeaderButtons();
}

async function tryOpenChat(user) {
  if (isLocked(user.uid) && !state.unlocked.has(user.uid)) {
    if (!(await verifyPin("🔒 " + nameOf(user) + " ki chat locked hai"))) return;
    state.unlocked.add(user.uid);
  }
  openChat(user);
}

function openChat(user) {
  if (state.active && state.active.uid !== user.uid) state.unlocked.delete(state.active.uid);   // chat chhodte hi dobara lock
  state.unsubMsgs?.(); state.unsubChat?.();
  state.active = user;
  state.seenIds = null;
  state.typingShown = false;
  state.iAmTyping = false;
  clearUnread(user.uid);
  if (state.chatMeta[user.uid]) { state.chatMeta[user.uid].unread = 0; updateTitleBadge(); }
  renderUsers();
  hide($("#emptyState")); show($("#chatView"));
  $("#app").classList.add("chat-open");
  hide($("#emojiPanel"));
  updatePeerHeader();
  $("#messages").innerHTML = "";

  const cid = chatIdOf(state.me.uid, user.uid);

  state.unsubMsgs = onSnapshot(
    query(collection(db, "chats", cid, "messages"), orderBy("createdAt", "asc")),
    { includeMetadataChanges: true },   // 🕓 -> ✓ badalne ke liye
    (snap) => renderMessages(snap.docs.map((d) => ({
      id: d.id,
      ...d.data({ serverTimestamps: "estimate" }),
      pending: d.metadata.hasPendingWrites,
    }))),
    (err) => toast(friendlyError(err))
  );

  // typing indicator
  state.unsubChat = onSnapshot(doc(db, "chats", cid), (d) => {
    const typing = d.data()?.typing || {};
    renderTyping(!!typing[user.uid]);
  }, () => {});

  setTimeout(() => $("#msgInput").focus(), 50);
}

function renderMessages(msgs) {
  const box = $("#messages");
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 140;
  const firstLoad = state.seenIds === null;
  const prevSeen = state.seenIds || new Set();
  box.innerHTML = "";
  let lastDay = "";

  msgs.forEach((m) => {
    const date = m.createdAt?.toDate ? m.createdAt.toDate() : new Date();
    const dayKey = date.toDateString();
    if (dayKey !== lastDay) {
      lastDay = dayKey;
      const day = document.createElement("div");
      day.className = "day";
      const today = new Date().toDateString();
      const yest = new Date(Date.now() - 864e5).toDateString();
      day.textContent = dayKey === today ? "Aaj" : dayKey === yest ? "Kal" : date.toLocaleDateString();
      box.appendChild(day);
    }

    const isNew = !firstLoad && !prevSeen.has(m.id);
    const el = document.createElement("div");
    el.className = "msg " + (m.from === state.me.uid ? "mine" : "theirs")
      + (m.imageUrl && !m.text ? " img-only" : "") + (isNew ? " new" : "");
    if (m.imageUrl) {
      const img = document.createElement("img");
      img.src = m.imageUrl;
      img.alt = "photo";
      img.loading = "lazy";
      img.addEventListener("click", () => window.open(m.imageUrl, "_blank"));
      img.addEventListener("load", () => { box.scrollTop = box.scrollHeight; });
      el.appendChild(img);
    }
    if (m.audioUrl) {
      const au = document.createElement("audio");
      au.controls = true; au.preload = "none"; au.src = m.audioUrl; au.className = "voice";
      el.appendChild(au);
    }
    if (m.text) {
      const p = document.createElement("span");
      p.textContent = m.text;            // textContent => XSS safe
      el.appendChild(p);
    }
    const t = document.createElement("span");
    t.className = "time";
    t.textContent = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      + (m.from === state.me.uid ? (m.pending ? " 🕓" : " ✓") : "");
    el.appendChild(t);
    box.appendChild(el);
  });

  state.seenIds = new Set(msgs.map((m) => m.id));

  if (state.typingShown) appendTypingBar();
  if (nearBottom || msgs.length <= 1 || msgs[msgs.length - 1]?.from === state.me.uid) {
    box.scrollTop = box.scrollHeight;
  }
}

function appendTypingBar() {
  const box = $("#messages");
  if (box.querySelector(".typing-bar")) return;
  const tb = document.createElement("div");
  tb.className = "typing-bar";
  tb.innerHTML = "<i></i><i></i><i></i>";
  box.appendChild(tb);
  box.scrollTop = box.scrollHeight;
}
function renderTyping(isTyping) {
  state.typingShown = isTyping;
  const box = $("#messages");
  const existing = box.querySelector(".typing-bar");
  if (isTyping) appendTypingBar();
  else existing?.remove();
}

async function setTyping(flag) {
  if (!state.active) return;
  const cid = chatIdOf(state.me.uid, state.active.uid);
  try {
    await setDoc(doc(db, "chats", cid), {
      members: [state.me.uid, state.active.uid],
      typing: { [state.me.uid]: flag },
    }, { merge: true });
  } catch (_) { /* ignore */ }
}

$("#msgInput").addEventListener("input", () => {
  if (!state.iAmTyping) { state.iAmTyping = true; setTyping(true); }   // har key par write nahi
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => { state.iAmTyping = false; setTyping(false); }, 1800);
});

async function sendMessage({ text = "", imageUrl = "", audioUrl = "", audioSecs = 0 }) {
  if (!state.active) return;
  const cid = chatIdOf(state.me.uid, state.active.uid);
  const peerUid = state.active.uid;
  await addDoc(collection(db, "chats", cid, "messages"), {
    from: state.me.uid,
    to: peerUid,
    text,
    imageUrl,
    ...(audioUrl ? { audioUrl, audioSecs } : {}),
    createdAt: serverTimestamp(),
  });
  state.iAmTyping = false;
  clearTimeout(state.typingTimer);
  // chat ka summary: list mein last message aur samne wale ke liye unread badge
  setDoc(doc(db, "chats", cid), {
    members: [state.me.uid, peerUid],
    lastText: text || (audioUrl ? "🎤 Voice message" : "📷 Photo"),
    lastFrom: state.me.uid,
    lastAt: serverTimestamp(),
    unread: { [peerUid]: increment(1) },
    typing: { [state.me.uid]: false },
  }, { merge: true }).catch(() => {});
}

$("#msgForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#msgInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  hide($("#emojiPanel"));

  const sb = $("#sendBtn");           // send button ki chhoti si animation
  sb.classList.remove("fly");
  void sb.offsetWidth;
  sb.classList.add("fly");

  const slow = setTimeout(() => toast("⚠️ Message abhi tak server par nahi pahuncha. Internet ya Firestore Rules check karein (🩺 Connection check dabayein)."), 6000);
  try { await sendMessage({ text }); }
  catch (err) { toast(friendlyError(err)); input.value = text; }
  finally { clearTimeout(slow); }
});

// photo bhejna
$("#attachBtn").addEventListener("click", () => $("#imgInput").click());
$("#imgInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file || !state.active) return;
  if (!file.type.startsWith("image/")) { toast("Sirf image select karein."); return; }
  if (file.size > 8 * 1024 * 1024) { toast("Image 8MB se chhoti honi chahiye."); return; }

  const box = $("#messages");
  const note = document.createElement("div");
  note.className = "uploading";
  note.textContent = "📤 Photo upload ho rahi hai…";
  box.appendChild(note);
  box.scrollTop = box.scrollHeight;

  try {
    const url = await uploadToCloudinary(file);
    await sendMessage({ imageUrl: url });
  } catch (err) {
    toast(err.message || "Photo bhejne mein masla aaya.");
  } finally {
    note.remove();
  }
});

/* ===================== emoji ===================== */
function buildEmojiPanel() {
  const panel = $("#emojiPanel");
  if (panel.childElementCount) return;
  const list = "😀 😁 😂 🤣 😊 😍 😘 😎 🤩 🥳 😇 🙂 😉 😋 🤔 😴 😢 😭 😡 🥺 😅 🙈 👍 👎 👏 🙌 🙏 💪 🤝 👋 ❤️ 💙 💜 🔥 ✨ 🎉 🎁 💯 ✅ ❌ 🚀 ⭐ 🌙 ☀️ 🍕 ☕ 🎵 📸 💻 📱".split(" ");
  list.forEach((em) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = em;
    b.addEventListener("click", () => {
      const inp = $("#msgInput");
      inp.value += em;
      inp.focus();
    });
    panel.appendChild(b);
  });
}
$("#emojiBtn").addEventListener("click", () => $("#emojiPanel").classList.toggle("hidden"));

/* ===================== mobile back ===================== */
$("#backBtn").addEventListener("click", () => {
  $("#app").classList.remove("chat-open");
  state.unsubMsgs?.(); state.unsubChat?.();
  state.active = null;
  hide($("#chatView")); show($("#emptyState"));
  renderUsers();
});

/* ===================== contacts ===================== */
/*
  Contacts "local-first" hain:
   - save karte hi foran list mein aa jate hain (server ka intezar nahi)
   - is device ke localStorage mein bhi mehfooz rehte hain
   - background mein Firestore se sync hote hain (rules / internet theek ho to)
*/
const LS_KEY = () => `gs_contacts_${state.me.uid}`;

function loadLocalContacts() {
  try { return JSON.parse(localStorage.getItem(LS_KEY()) || "[]"); } catch (_) { return []; }
}
function persistLocalContacts() {
  try { localStorage.setItem(LS_KEY(), JSON.stringify(state.localContacts)); } catch (_) { /* ignore */ }
}
function rebuildContacts() {
  const map = new Map();
  state.localContacts.forEach((c) => map.set(c.id, c));
  state.cloudContacts.forEach((c) => map.set(c.id, { ...(map.get(c.id) || {}), ...c }));
  state.contacts = [...map.values()].sort((a, b) => (a.name || "").localeCompare(b.name || ""));
}
function refreshContactsUI() {
  rebuildContacts();
  renderUsers();
  if (state.active) updatePeerHeader();
}

function cloudFailed(err) {
  if (state.cloudFailShown) return;
  state.cloudFailShown = true;
  toast(err?.code === "permission-denied"
    ? "⚠️ Contact is device par save hai, lekin cloud mein nahi. Firestore Rules mein contacts wala hissa add karein (README)."
    : "⚠️ Contact is device par save hai, cloud sync abhi nahi hua.");
}

function pushContact(c) {
  return setDoc(
    doc(db, "users", state.me.uid, "contacts", c.id),
    { name: c.name, phone: c.phone || "", uid: c.uid || "", createdAt: serverTimestamp() },
    { merge: true }
  ).catch(cloudFailed);
}

function subscribeContacts() {
  state.unsubContacts?.();
  state.localContacts = loadLocalContacts();
  state.cloudContacts = [];
  rebuildContacts();
  state.unsubContacts = onSnapshot(
    collection(db, "users", state.me.uid, "contacts"),
    (snap) => {
      state.cloudContacts = snap.docs.map((d) => ({ id: d.id, ...d.data(), pending: false }));
      const cloudIds = new Set(state.cloudContacts.map((c) => c.id));
      let changed = false;
      state.localContacts.forEach((c) => {
        if (cloudIds.has(c.id)) {
          if (c.pending) { c.pending = false; changed = true; }
        } else if (c.pending && !state.syncTried.has(c.id)) {
          state.syncTried.add(c.id);            // jo cloud tak nahi pahunche unhe dobara bhejo
          pushContact(c);
        }
      });
      if (changed) persistLocalContacts();
      refreshContactsUI();
    },
    (err) => { cloudFailed(err); refreshContactsUI(); }
  );
}

// Contact save / update (foran). true => pehle se saved tha (sirf update hua)
function saveContact({ name, phone = "", uid = "" }) {
  const id = phone ? phone.replace(/\D/g, "") : uid;
  const existed = state.contacts.some((c) => c.id === id);
  const entry = { id, name, phone, uid, pending: true };
  const i = state.localContacts.findIndex((c) => c.id === id);
  if (i >= 0) state.localContacts[i] = { ...state.localContacts[i], ...entry };
  else state.localContacts.push(entry);
  persistLocalContacts();
  state.cloudContacts = state.cloudContacts.map((c) => (c.id === id ? { ...c, name, phone, uid } : c));
  refreshContactsUI();
  state.syncTried.add(id);
  pushContact(entry);
  return existed;
}

function removeContact(c) {
  state.localContacts = state.localContacts.filter((x) => x.id !== c.id);
  state.cloudContacts = state.cloudContacts.filter((x) => x.id !== c.id);
  persistLocalContacts();
  refreshContactsUI();
  deleteDoc(doc(db, "users", state.me.uid, "contacts", c.id)).catch(() => {});
}

function renameContact(c) {
  const nn = prompt("Naya naam likhein:", c.name || "");
  if (nn === null) return;
  const name = nn.trim();
  if (!name) return;
  saveContact({ name, phone: c.phone || "", uid: c.uid || "" });
  toast("Naam badal gaya ✅");
}

// Gupshup user ko ek click mein save (naam aur number khud aa jata hai)
function quickSave(u) {
  saveContact({ name: u.name, phone: u.phone || "", uid: u.uid });
  toast(`⭐ ${u.name} contacts mein save ho gaya`);
}

/* ----- apna number ----- */
function updateMyPhone(mine) {
  if (!state.me) return;
  const el = $("#mePhone");
  const ph = mine?.phone || "";
  state.me.phone = ph;
  if (ph) { el.textContent = ph; el.classList.remove("addnum"); el.title = "Number copy karne ke liye click karein"; }
  else { el.textContent = "+ Apna number add karein"; el.classList.add("addnum"); el.title = ""; }
}

function openPhoneModal() {
  $("#myPhoneInput").value = "";
  $("#myPhoneError").textContent = "";
  show($("#phoneModal"));
  setTimeout(() => $("#myPhoneInput").focus(), 60);
}
$("#mePhone").addEventListener("click", async () => {
  if (!state.me) return;
  if (!state.me.phone) { openPhoneModal(); return; }
  try { await navigator.clipboard.writeText(state.me.phone); toast("Aapka number copy ho gaya 📋 Dost ko bhej dein"); }
  catch (_) { toast("Aapka number: " + state.me.phone); }
});
$("#phoneLater").addEventListener("click", () => hide($("#phoneModal")));
$("#phoneForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const p = normalizePhone($("#myPhoneInput").value.trim());
  if (!p) { $("#myPhoneError").textContent = "Number sahi nahi hai. Misal: 03001234567"; return; }
  const btn = $("#phoneSave");
  btn.disabled = true;
  try {
    await setDoc(doc(db, "users", state.me.uid), { phone: p }, { merge: true });
    state.me.phone = p;
    updateMyPhone({ phone: p });
    hide($("#phoneModal"));
    toast("✅ Aapka number save ho gaya. Ab dost aapko number se dhoond sakte hain.");
  } catch (err) { $("#myPhoneError").textContent = friendlyError(err); }
  finally { btn.disabled = false; }
});

/* ----- tabs ----- */
function setTab(t) {
  state.tab = t;
  state.animateNext = true;
  $("#tabAll").classList.toggle("active", t === "all");
  $("#tabContacts").classList.toggle("active", t === "contacts");
  renderUsers();
}
$("#tabAll").addEventListener("click", () => setTab("all"));
$("#tabContacts").addEventListener("click", () => setTab("contacts"));

/* ----- contacts tab khali ho to madad ----- */
const supportsPicker = () => "contacts" in navigator && "ContactsManager" in window;

function buildContactsEmpty(box) {
  box.innerHTML = "";
  const t = document.createElement("div");
  t.className = "ce-title";
  t.textContent = "Abhi koi contact save nahi 📇";
  const p = document.createElement("p");
  p.textContent = "Contact save karne ke aasan tareeqe:";
  box.append(t, p);
  const mk = (label, fn) => {
    const b = document.createElement("button");
    b.className = "ea";
    b.textContent = label;
    b.addEventListener("click", fn);
    box.appendChild(b);
  };
  mk("⭐ Gupshup users mein se ek click mein chunein", () => setTab("all"));
  mk("＋ Number likh kar save karein", openContactModal);
  if (supportsPicker()) mk("📱 Phone ke contacts se import", importFromPhone);
}

/* ----- contact save wala popup ----- */
let nameAutofilled = false;

function openContactModal() {
  $("#contactForm").reset();
  $("#contactError").textContent = "";
  $("#cHint").textContent = "";
  $("#cHint").className = "c-hint";
  nameAutofilled = false;
  hide($("#bulkWrap"));
  $("#importBtn").classList.toggle("hidden", !supportsPicker());
  show($("#contactModal"));
  setTimeout(() => $("#cPhone").focus(), 50);
}
function closeContactModal() { hide($("#contactModal")); }

$("#addContactBtn").addEventListener("click", openContactModal);
$("#contactCancel").addEventListener("click", closeContactModal);
$("#contactClose").addEventListener("click", closeContactModal);
$("#contactModal").addEventListener("click", (e) => { if (e.target.id === "contactModal") closeContactModal(); });

// number likhte hi dikhao ke ye Gupshup par hai ya nahi, aur naam khud bhar do
$("#cPhone").addEventListener("input", () => {
  const raw = $("#cPhone").value.trim();
  const hint = $("#cHint");
  const nameInput = $("#cName");
  if (raw.replace(/\D/g, "").length < 10) { hint.textContent = ""; hint.className = "c-hint"; return; }
  const p = normalizePhone(raw);
  if (!p) { hint.textContent = "Number sahi nahi lag raha."; hint.className = "c-hint warn"; return; }
  if (samePhone(p, state.me.phone)) { hint.textContent = "Ye aapka apna number hai."; hint.className = "c-hint warn"; return; }
  const peer = state.users.find((u) => samePhone(u.phone, p));
  if (peer) {
    hint.textContent = `✅ ${peer.name} Gupshup par hai`;
    hint.className = "c-hint ok";
    if (!nameInput.value.trim() || nameAutofilled) { nameInput.value = peer.name; nameAutofilled = true; }
  } else {
    hint.textContent = "ℹ️ Ye number abhi Gupshup par nahi hai. Phir bhi save ho jayega, baad mein 📨 Invite bhej sakte hain.";
    hint.className = "c-hint";
    if (nameAutofilled) { nameInput.value = ""; nameAutofilled = false; }
  }
});
$("#cName").addEventListener("input", () => { nameAutofilled = false; });

// Save: bilkul instant (koi network intezar nahi)
$("#contactForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const errBox = $("#contactError");
  errBox.textContent = "";
  const phone = normalizePhone($("#cPhone").value.trim());
  let name = $("#cName").value.trim();

  if (!phone) { errBox.textContent = "Number sahi nahi hai. Misal: 03001234567 ya +923001234567"; return; }
  if (samePhone(phone, state.me.phone)) { errBox.textContent = "Ye aapka apna number hai."; return; }
  const peer = state.users.find((u) => samePhone(u.phone, phone));
  if (!name && peer) name = peer.name;
  if (!name) { errBox.textContent = "Naam likhein."; return; }

  const existed = saveContact({ name, phone, uid: peer ? peer.uid : "" });
  closeContactModal();
  toast(existed
    ? `${name} ka contact update ho gaya ✅`
    : peer
      ? `${name} save ho gaya ✅ Ab chat kar sakte hain`
      : `${name} save ho gaya ✅ Ye number abhi Gupshup par nahi, 📨 Invite bhej dein.`);
  setTab("contacts");
  if (!peer && state.users.length) {
    const saved = state.contacts.find((c) => c.phone === phone);
    setTimeout(() => saved && openLinkModal(saved), 450);   // number match nahi hua => dost ka account chunne do
  }
});

// Bahut saare number ek saath (har line mein naam + number)
$("#bulkToggle").addEventListener("click", () => {
  $("#bulkWrap").classList.toggle("hidden");
  setTimeout(() => $("#bulkText").focus(), 50);
});
$("#bulkSave").addEventListener("click", () => {
  const lines = $("#bulkText").value.split(/\r?\n/);
  let ok = 0;
  let bad = 0;
  lines.forEach((line) => {
    if (!line.trim()) return;
    const m = line.match(/\+?\d[\d\s\-()]{6,}\d/);
    const phone = m ? normalizePhone(m[0]) : "";
    if (!phone || samePhone(phone, state.me.phone)) { bad++; return; }
    const peer = state.users.find((u) => samePhone(u.phone, phone));
    let name = line.replace(m[0], " ").replace(/[,;:|]+/g, " ").replace(/\s+/g, " ").trim();
    if (!name) name = peer ? peer.name : phone;
    saveContact({ name, phone, uid: peer ? peer.uid : "" });
    ok++;
  });
  if (!ok) { $("#contactError").textContent = "Koi sahi number nahi mila. Har line mein naam aur number likhein."; return; }
  closeContactModal();
  toast(`✅ ${ok} contact save ho gaye` + (bad ? `, ${bad} line ghalat thi` : ""));
  setTab("contacts");
});

// Phone ke contacts se import (Android Chrome par, https/deploy ke baad)
async function importFromPhone() {
  try {
    const picked = await navigator.contacts.select(["name", "tel"], { multiple: true });
    let ok = 0;
    picked.forEach((c) => {
      const phone = normalizePhone((c.tel && c.tel[0]) || "");
      if (!phone || samePhone(phone, state.me.phone)) return;
      const peer = state.users.find((u) => samePhone(u.phone, phone));
      saveContact({ name: (c.name && c.name[0]) || (peer ? peer.name : phone), phone, uid: peer ? peer.uid : "" });
      ok++;
    });
    closeContactModal();
    toast(ok ? `✅ ${ok} contact import ho gaye` : "Koi sahi number nahi mila.");
    if (ok) setTab("contacts");
  } catch (_) { /* user ne cancel kar diya */ }
}
$("#importBtn").addEventListener("click", importFromPhone);

// Chat ke upar "⭐ Save contact" (agar ye dost abhi saved nahi)
$("#headSave").addEventListener("click", () => { if (state.active) quickSave(state.active); });

/* ===================== naye features: favourite, archive, lock, voice, call ===================== */
const PREF_KEY = () => `gs_prefs_${state.me.uid}`;
function loadPrefs() {
  let p = {};
  try { p = JSON.parse(localStorage.getItem(PREF_KEY()) || "{}"); } catch (_) { /* ignore */ }
  state.prefs = { fav: p.fav || [], arch: p.arch || [], lock: p.lock || [], pin: p.pin || "" };
}
function savePrefs() { try { localStorage.setItem(PREF_KEY(), JSON.stringify(state.prefs)); } catch (_) { /* ignore */ } }
const isFav = (uid) => state.prefs.fav.includes(uid);
const isArch = (uid) => state.prefs.arch.includes(uid);
const isLocked = (uid) => state.prefs.lock.includes(uid);
function togglePref(list, uid) {
  const a = state.prefs[list];
  const i = a.indexOf(uid);
  if (i >= 0) a.splice(i, 1); else a.push(uid);
  savePrefs();
  return i < 0;
}

/* ----- filter chips (Sab / Favourites / Archived) ----- */
document.querySelectorAll("#filterRow .chip").forEach((b) => {
  b.addEventListener("click", () => {
    state.filter = b.dataset.f;
    state.animateNext = true;
    document.querySelectorAll("#filterRow .chip").forEach((x) => x.classList.toggle("active", x === b));
    if (state.tab !== "all") setTab("all"); else renderUsers();
  });
});

/* ----- PIN popup ----- */
async function hashPin(pin) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("gs:" + pin));
    return [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
  } catch (_) { return "p" + btoa(pin); }
}
let pinResolve = null;
function askPin(title, sub = "") {
  return new Promise((res) => {
    pinResolve = res;
    $("#pinTitle").textContent = title;
    $("#pinSub").textContent = sub;
    $("#pinInput").value = "";
    $("#pinError").textContent = "";
    show($("#pinModal"));
    setTimeout(() => $("#pinInput").focus(), 60);
  });
}
function closePin(val) { hide($("#pinModal")); const r = pinResolve; pinResolve = null; r && r(val); }
$("#pinForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const v = $("#pinInput").value.trim();
  if (!/^\d{4,6}$/.test(v)) { $("#pinError").textContent = "4 se 6 ginti wala PIN likhein."; return; }
  closePin(v);
});
$("#pinCancel").addEventListener("click", () => closePin(null));

async function ensurePin() {            // pehli baar lock karte waqt PIN banwao
  if (state.prefs.pin) return true;
  const a = await askPin("🔒 Naya PIN banayein", "4 se 6 ginti. Ye PIN sirf is device par rahega.");
  if (!a) return false;
  const b = await askPin("🔒 PIN dobara likhein");
  if (!b) return false;
  if (a !== b) { toast("PIN match nahi hua, dobara try karein."); return false; }
  state.prefs.pin = await hashPin(a);
  savePrefs();
  return true;
}
async function verifyPin(title = "🔒 Chat locked hai") {
  const v = await askPin(title, "Apna PIN likhein");
  if (!v) return false;
  if ((await hashPin(v)) === state.prefs.pin) return true;
  toast("❌ PIN galat hai");
  return false;
}

/* ----- chat header buttons ----- */
function syncHeaderButtons() {
  const u = state.active;
  if (!u) return;
  $("#favBtn").textContent = isFav(u.uid) ? "⭐" : "☆";
  $("#favBtn").classList.toggle("on", isFav(u.uid));
  $("#archBtn").classList.toggle("on", isArch(u.uid));
  $("#archBtn").title = isArch(u.uid) ? "Archive se wapas laayein" : "Chat archive karein";
  $("#lockBtn").textContent = isLocked(u.uid) ? "🔒" : "🔓";
  $("#lockBtn").classList.toggle("on", isLocked(u.uid));
  $("#headSave").classList.toggle("hidden", !!contactFor(u));
}
$("#favBtn").addEventListener("click", () => {
  const u = state.active; if (!u) return;
  const now = togglePref("fav", u.uid);
  toast(now ? `⭐ ${nameOf(u)} favourites mein add ho gaya` : "Favourites se hata diya");
  syncHeaderButtons(); renderUsers();
});
$("#archBtn").addEventListener("click", () => {
  const u = state.active; if (!u) return;
  const now = togglePref("arch", u.uid);
  toast(now ? "🗂 Chat archive ho gayi (upar Archived tab mein milegi)" : "Chat archive se wapas aa gayi");
  syncHeaderButtons(); renderUsers();
});
$("#lockBtn").addEventListener("click", async () => {
  const u = state.active; if (!u) return;
  if (isLocked(u.uid)) {
    if (!(await verifyPin("🔓 Lock hatane ke liye PIN"))) return;
    togglePref("lock", u.uid);
    toast("Chat unlock ho gayi");
  } else {
    if (!(await ensurePin())) return;
    togglePref("lock", u.uid);
    state.unlocked.add(u.uid);
    toast("🔒 Chat lock ho gayi. Dobara kholne par PIN poochha jayega.");
  }
  syncHeaderButtons(); renderUsers();
});

/* ----- voice message ----- */
const rec = { mr: null, chunks: [], stream: null, t0: 0, timer: null, cancelled: false };
function fmtSec(s) { return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function resetRecUI() {
  clearInterval(rec.timer);
  $("#micBtn").classList.remove("rec");
  hide($("#micCancel"));
  $("#msgInput").placeholder = "Message likho…";
  $("#msgInput").disabled = false;
}
async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast("Is browser mein voice message support nahi."); return; }
  try { rec.stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch (_) { toast("Microphone ki ijazat dein (browser mein 🔒 icon)."); return; }
  const mime = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
  rec.mr = new MediaRecorder(rec.stream, mime ? { mimeType: mime } : undefined);
  rec.chunks = []; rec.cancelled = false;
  rec.mr.ondataavailable = (e) => e.data.size && rec.chunks.push(e.data);
  rec.mr.onstop = onRecStop;
  rec.mr.start();
  rec.t0 = Date.now();
  $("#micBtn").classList.add("rec");
  show($("#micCancel"));
  $("#msgInput").disabled = true;
  rec.timer = setInterval(() => {
    const s = Math.floor((Date.now() - rec.t0) / 1000);
    $("#msgInput").placeholder = `🎙 Record ho raha hai… ${fmtSec(s)}  (bhejne ke liye 🎤 dobara dabayein)`;
    if (s >= 120) stopRecording(false);
  }, 250);
}
function stopRecording(cancel) {
  if (!rec.mr || rec.mr.state === "inactive") return;
  rec.cancelled = cancel;
  rec.mr.stop();
}
async function onRecStop() {
  rec.stream?.getTracks().forEach((t) => t.stop());
  const secs = Math.round((Date.now() - rec.t0) / 1000);
  resetRecUI();
  if (rec.cancelled || secs < 1) { if (!rec.cancelled) toast("Voice bohat chhoti thi."); return; }
  const blob = new Blob(rec.chunks, { type: rec.mr.mimeType || "audio/webm" });
  const note = document.createElement("div");
  note.className = "uploading";
  note.textContent = "📤 Voice message bhej raha hoon…";
  $("#messages").appendChild(note);
  $("#messages").scrollTop = $("#messages").scrollHeight;
  try {
    const url = await uploadToCloudinary(blob, "video");
    await sendMessage({ audioUrl: url, audioSecs: secs });
  } catch (err) { toast(err.message || "Voice bhejne mein masla aaya."); }
  finally { note.remove(); }
}
$("#micBtn").addEventListener("click", () => {
  if (!state.active) return;
  if (rec.mr && rec.mr.state === "recording") stopRecording(false); else startRecording();
});
$("#micCancel").addEventListener("click", () => stopRecording(true));

/* ----- contact ko Gupshup account se jodna (agar number match na ho) ----- */
let linkTarget = null;
function openLinkModal(contact) {
  linkTarget = contact;
  $("#linkWho").textContent = `"${contact.name}" ka Gupshup account chunein`;
  const box = $("#linkList");
  box.innerHTML = "";
  if (!state.users.length) {
    box.innerHTML = '<p class="pin-sub">Abhi koi aur user Gupshup par nahi hai. Pehle dost ko 📨 invite karein, wo signup kare, phir yahan aayein.</p>';
  }
  state.users.forEach((u) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "link-row";
    b.appendChild(avatarEl(u));
    const t = document.createElement("span");
    t.innerHTML = "<b></b><small></small>";
    t.querySelector("b").textContent = u.name;
    t.querySelector("small").textContent = u.phone || "number add nahi kiya";
    b.appendChild(t);
    b.addEventListener("click", () => {
      saveContact({ name: linkTarget.name, phone: linkTarget.phone || "", uid: u.uid });
      hide($("#linkModal"));
      toast(`🔗 ${linkTarget.name} ab ${u.name} se juda hai ✅`);
      state.tab = "contacts"; renderUsers();
      openChat(u);
    });
    box.appendChild(b);
  });
  show($("#linkModal"));
}
$("#linkClose").addEventListener("click", () => hide($("#linkModal")));
$("#linkInvite").addEventListener("click", () => { hide($("#linkModal")); if (linkTarget?.phone) sendInviteToNumber(linkTarget.phone); });
$("#linkModal").addEventListener("click", (e) => { if (e.target.id === "linkModal") hide($("#linkModal")); });

/* ===================== invite friends ===================== */
function inviteLink() {
  return location.origin + location.pathname.replace(/index\.html$/, "");
}
function inviteText() {
  return `Salam! Main Gupshup par hoon 💬 Ye ek real-time chat app hai. Sign up karke mujhse chat karo: ${inviteLink()}`;
}

function sendInviteToNumber(rawPhone) {
  const p = normalizePhone(rawPhone);
  if (!p) { toast("Number sahi nahi hai. Misal: 03001234567"); return false; }
  const digits = p.replace(/\D/g, "");
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(inviteText())}`, "_blank", "noopener");
  return true;
}

function openInvite() {
  const link = inviteLink();
  $("#inviteLink").value = link;
  const isLocal = /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname) || location.protocol === "file:";
  $("#inviteWarn").classList.toggle("hidden", !isLocal);
  const text = encodeURIComponent(inviteText());
  $("#shareWa").href = `https://wa.me/?text=${text}`;
  $("#shareMail").href = `mailto:?subject=${encodeURIComponent("Gupshup par aao!")}&body=${text}`;
  $("#shareNative").classList.toggle("hidden", !navigator.share);
  $("#invPhone").value = "";
  show($("#inviteModal"));
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (_) {
    const el = $("#inviteLink");
    el.select();
    el.setSelectionRange(0, 99999);
    try { return document.execCommand("copy"); } catch (_2) { return false; }
  }
}

$("#inviteBtn").addEventListener("click", openInvite);
$("#inviteCta").addEventListener("click", openInvite);
$("#inviteClose").addEventListener("click", () => hide($("#inviteModal")));
$("#inviteModal").addEventListener("click", (e) => { if (e.target.id === "inviteModal") hide($("#inviteModal")); });

$("#copyInvite").addEventListener("click", async () => {
  const ok = await copyText($("#inviteLink").value);
  toast(ok ? "Link copy ho gaya ✅ Ab dost ko bhej dein" : "Copy nahi hua, link select karke khud copy karein.");
});
$("#shareNative").addEventListener("click", async () => {
  try { await navigator.share({ title: "Gupshup", text: "Gupshup par aao, real-time chat karein 💬", url: inviteLink() }); }
  catch (_) { /* user ne cancel kar diya */ }
});
$("#invSend").addEventListener("click", () => {
  if (sendInviteToNumber($("#invPhone").value.trim())) toast("WhatsApp khul raha hai… message bhej dein 📨");
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  hide($("#inviteModal"));
  hide($("#contactModal"));
});

/* ===================== connection check ===================== */
$("#diagBtn").addEventListener("click", async () => {
  if (!state.me) return;
  toast("🩺 Check ho raha hai…");
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 7000));
  try {
    await Promise.race([
      updateDoc(doc(db, "users", state.me.uid), { ping: serverTimestamp() }),
      timeout,
    ]);
    toast("✅ Firestore theek chal raha hai. Message ke liye dono ne ek doosre ko list mein dekhna hai (badge / alert aayega).");
  } catch (err) {
    toast(err.message === "timeout"
      ? "❌ Server tak nahi pahunch pa raha: internet check karein, aur Firebase mein Firestore Database bana hua ho."
      : "❌ " + friendlyError(err));
  }
});

/* ===================== setup warning ===================== */
if (!firebaseReady) {
  console.warn("config.js mein Firebase keys set karein.");
}
