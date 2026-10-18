// Yeh normal (non-module) script hai, is liye buttons hamesha kaam karte hain.
// Agar app.js load na ho to modal mein wajah dikha di jati hai.
(function () {
  var $ = function (s) { return document.querySelector(s); };

  function setMode(mode) {
    var form = $("#authForm");
    form.setAttribute("data-mode", mode);
    $("#tabLogin").classList.toggle("active", mode === "login");
    $("#tabSignup").classList.toggle("active", mode === "signup");
    $("#signupOnly").classList.toggle("hidden", mode !== "signup");
    $("#authSubmit").textContent = mode === "signup" ? "Account banao" : "Login";
    $("#authError").textContent = "";
  }

  // app.js load na ho to asli error yahin pakad lete hain taake popup mein dikha sakein
  var loadError = "";
  window.addEventListener("error", function (e) {
    if (!window.gsReady && e && e.message && !loadError) loadError = e.message;
  });
  var moduleTag = document.querySelector('script[type="module"]');
  if (moduleTag) {
    moduleTag.addEventListener("error", function () {
      if (!loadError) loadError = "app.js file nahi mili ya load nahi hui (file ka naam / folder check karein).";
    });
  }

  function warning() {
    if (!window.gsReady) {
      var hint = "";
      if (/config\.js|export named|firebaseConfig|cloudinaryConfig/i.test(loadError)) {
        hint = " → config.js mein 'export const firebaseConfig' aur 'export const cloudinaryConfig' dono hone chahiye.";
      } else if (/gstatic|firebase|fetch|Failed to load|network|dynamically imported/i.test(loadError)) {
        hint = " → Internet check karein ya VPN/ad-blocker band karke dekhein.";
      }
      return "⚠️ App load nahi hui" + (loadError ? ": " + loadError : ".") + hint +
        " (Page Live Server se kholein aur F12 → Console dekhein.)";
    }
    if (window.gsConfigMissing) {
      return "⚠️ Pehle config.js mein apni Firebase keys paste karein.";
    }
    return "";
  }

  function openModal(mode) {
    setMode(mode);
    $("#authModal").classList.remove("hidden");
    $("#authError").textContent = warning();
  }

  function closeModal() {
    $("#authModal").classList.add("hidden");
    $("#authError").textContent = "";
  }

  ["#openLogin", "#heroLogin"].forEach(function (s) {
    $(s).addEventListener("click", function () { openModal("login"); });
  });
  ["#openSignup", "#heroSignup", "#bottomSignup"].forEach(function (s) {
    $(s).addEventListener("click", function () { openModal("signup"); });
  });

  $("#closeModal").addEventListener("click", closeModal);
  $("#authModal").addEventListener("click", function (e) {
    if (e.target.id === "authModal") closeModal();
  });
  $("#tabLogin").addEventListener("click", function () { setMode("login"); $("#authError").textContent = warning(); });
  $("#tabSignup").addEventListener("click", function () { setMode("signup"); $("#authError").textContent = warning(); });

  // Page reload hone se bachao; asli kaam app.js karta hai
  $("#authForm").addEventListener("submit", function (e) {
    e.preventDefault();
    if (!window.gsReady) $("#authError").textContent = warning();
  });

  $("#avatarInput").addEventListener("change", function (e) {
    var f = e.target.files[0];
    if (!f) return;
    var prev = $("#avatarPreview");
    prev.textContent = "";
    prev.style.backgroundImage = 'url("' + URL.createObjectURL(f) + '")';
  });
})();
