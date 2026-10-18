# Gupshup — Real-time Chat App

HTML + CSS + JavaScript + Firebase (Auth + Firestore) + Cloudinary

## Files
- `index.html` — landing page, login/signup modal, chat UI
- `style.css`  — poora design
- `app.js`     — auth, real-time chat, photo upload
- `config.js`  — **sirf yahan apni keys daalni hain**

## Setup (10 minute)

### 1) Firebase
1. https://console.firebase.google.com par project banayein
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable**
3. **Build → Firestore Database → Create database** (production mode)
4. **Project settings (gear) → Your apps → Web (`</>`)** → app register karein → jo `firebaseConfig` mile use `config.js` mein paste karein
5. Firestore → **Rules** mein yeh paste karke **Publish** karein:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == uid;
      match /contacts/{cid} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }
    match /chats/{chatId} {
      allow read, write: if request.auth != null && request.auth.uid in chatId.split('_');
      match /messages/{msgId} {
        allow read: if request.auth != null && request.auth.uid in chatId.split('_');
        allow create: if request.auth != null
                      && request.auth.uid in chatId.split('_')
                      && request.resource.data.from == request.auth.uid;
      }
    }
  }
}
```

### 2) Cloudinary
1. https://cloudinary.com par free account banayein
2. Dashboard se **Cloud name** copy karein
3. **Settings → Upload → Upload presets → Add upload preset**
   - Signing Mode: **Unsigned**
   - Preset name copy karein
4. Dono values `config.js` mein paste karein

### 3) Run karein
`app.js` ES module use karta hai, is liye **double-click se na kholein**.
- VS Code mein **Live Server** extension install karein → `index.html` par right click → *Open with Live Server*
- ya terminal mein: `npx serve` ya `python -m http.server 5500`

Deploy ke liye Firebase Hosting / Netlify / Vercel (drag & drop folder) use kar sakte hain.
Deploy ke baad Firebase → Authentication → Settings → **Authorized domains** mein apna domain add karna na bhoolein.

## Test kaise karein
Do alag browsers (ya ek normal + ek incognito window) mein do accounts banayein, aur ek doosre ko message bhejein.
