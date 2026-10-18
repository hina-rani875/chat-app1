# Gupshup — Contacts aur Features (Presentation Guide)

## Slide 1 — Problem
- Pehle contact save karne par app server se number dhoondta tha aur jawab ka intezar karta tha → button slow, offline par fail.

## Slide 2 — Hamara hal: "Local-first contacts"
- Save dabate hi contact FORAN list mein (0 second).
- Device par mehfooz (localStorage) + background mein Firestore sync.
- Cloud fail ho to bhi contact nahi jata; app khud dobara sync karta hai.

## Slide 3 — Contact kaise save karein (4 tareeqe)
1. **⭐ Ek click:** Chat kholein → upar "＋ Save contact" (naam + number khud aa jata hai).
2. **Number likhein:** Chats ke upar "＋" → number likhein → naam khud bhar jata hai agar dost Gupshup par hai → Save.
3. **Bulk:** "＋" → "Bahut saare number ek saath" → har line `Ali 03001234567`.
4. **Phone se import:** (Android Chrome, https par) "📱 Phone ke contacts se import".

## Slide 4 — Contact use kaise karein
- Contacts tab mein save kiye hue naam dikhte hain; click karo → chat.
- Dost Gupshup par nahi? "📨 Invite" dabao → WhatsApp par link jata hai.
- ✏️ naam badlo, 🗑 delete.
- Apna number: profile card par click → copy ho kar dost ko bhej do.

## Slide 5 — Naye features
- ⭐ **Favourites:** header ka ☆; favourites list mein sab se upar.
- 🗂 **Archive:** chat chhupao; "Archived" chip mein wapas milti hai.
- 🔒 **Chat Lock:** 4–6 digit PIN; locked chat ka preview chhup jata hai, kholne par PIN.
- 🎤 **Voice message:** mic dabao → bolo → dobara dabao → send (🗑 = cancel).
- 📞📹 **Voice / Video call:** Jitsi link message mein jata hai, dono "Call join karein" dabate hain.
- Animations: list slide-in, popups, record pulse, send button, chips.

## Slide 6 — Technology
HTML + CSS + JS (ES modules) · Firebase Auth + Firestore (real-time onSnapshot) · Cloudinary (photo/voice) · Jitsi (calls)

## Demo script (2 minute)
1. Signup → apna number add karo.  2. Dusre browser se dusra account.  3. Contact save (number likhte hi naam auto-fill).  4. Chat → message, photo, voice.  5. ⭐ 🔒 🗂.  6. Video call.

## Zaroori
- Firestore Rules mein `users/{uid}/contacts/{id}` wala hissa Publish hona chahiye (README), warna contact sirf device par rahega (app warning dikhata hai).
- Lock/Favourite/Archive abhi isi device par save hote hain.
