# صالة الإنجاز · Salat Al-Enjaz

> منصة عربية أنيقة لتسجيل ساعات الدراسة والمنافسة بين الأصدقاء — تعمل من المتصفح مباشرةً، بدون تثبيت، عبر GitHub Pages.

> An elegant Arabic web app for logging study hours and competing with friends — runs straight in the browser via GitHub Pages, no install required.

---

## ✨ المميزات · Features

- **🕐 ساعة تفاعلية بالسحب** — اسحب عقربَي الساعات والدقائق لاختيار مدة جلستك (تعمل باللمس وبالفأرة).
- **🏆 لوحة متصدرين متجددة** — تصفية حسب اليوم / الأسبوع / الشهر / كل الأوقات، مع ميداليات للأوائل.
- **🔥 سلاسل (Streaks)** — احتفظ بسلسلتك من الأيام المتتالية.
- **📊 إحصائيات شخصية** — انقر اسم أي صديق لرؤية مجموعه ومتوسطه ورسم آخر سبعة أيام.
- **🌙 تصميم ليلي ذهبي** — ألوان فاخرة، خط Tajawal، زجاجية شفافة.
- **📱 يعمل على الجوال والحاسب** — تخطيط متجاوب من أوّل بكسل.

---

- **Drag-clock interface** — pull the hour and minute hands to choose session length (works on touch and mouse).
- **Live leaderboard** — filter by today / week / month / all-time, with medals for top 3.
- **Streaks** — keep a running streak of consecutive study days.
- **Personal stats** — tap any name for total / average / 7-day chart.
- **Dark + gold theme** — Arabic-first typography (Tajawal), glassmorphic cards.
- **Responsive** — mobile-first, looks great on desktop too.

---

## 🛠️ الإعداد · Setup

### 1) أنشئ Google Sheet

1. افتح [Google Sheets](https://sheets.google.com) ثم أنشئ ملفاً جديداً (أي اسم).
2. انسخ معرّف الملف من الرابط (الجزء بين `/d/` و `/edit`).

### 2) انشر سكربت Apps Script

1. افتح [Apps Script](https://script.google.com/) → **New project**.
2. الصق محتوى ملف [`Code.gs`](Code.gs).
3. عدّل ثابت `SHEET_ID` ليطابق معرّف شيتك.
4. اضغط **Deploy → New deployment → Web app**.
   - **Execute as:** Me
   - **Who has access:** Anyone
5. انسخ الرابط (`https://script.google.com/macros/s/.../exec`).

### 3) اربط الواجهة

1. افتح ملف [`app.js`](app.js).
2. عدّل القيمة في أعلى الملف:
   ```js
   const CONFIG = {
       API_URL: "ضع_رابط_Apps_Script_هنا",
       AUTO_REFRESH_INTERVAL: 60000,
   };
   ```

### 4) فعّل GitHub Pages

1. ادفع الكود إلى مستودع على GitHub.
2. **Settings → Pages → Source: `main` branch → Save**.
3. انتظر ~1 دقيقة، الموقع جاهز على `https://<username>.github.io/<repo>`.

### 5) شارك الرابط

- مجرد نسخ ولصق الرابط للأصدقاء — لا تسجيل دخول، يكتب كل واحد اسمه ويبدأ.

---

### English setup

1. Create a Google Sheet (any name). Copy its ID from the URL (between `/d/` and `/edit`).
2. Open [Apps Script](https://script.google.com/) → New project → paste [`Code.gs`](Code.gs) → set the `SHEET_ID` constant → **Deploy → New deployment → Web app** with **Execute as: Me** and **Who has access: Anyone**. Copy the deployment URL.
3. In [`app.js`](app.js), set `CONFIG.API_URL` to the deployment URL.
4. Push to GitHub. In repo **Settings → Pages**, select the `main` branch and save.
5. After ~1 minute, the site is live. Share the URL with your friends.

---

## 🧱 البنية · Project structure

```
salat-alenjaz/
├── index.html        صفحة الموقع — RTL، عربية بالكامل
├── styles.css        التصميم — ألوان ذهبية وزجاجية
├── app.js            المنطق — السحب، الواجهة الخلفية، اللوحة
├── Code.gs           سكربت Google Apps Script (الواجهة الخلفية)
├── README.md         هذا الملف
├── .gitignore
└── LICENSE
```

> ملاحظة: لا يوجد أي build / npm / framework — كل شيء HTML/CSS/JS صرف.

---

## 🧮 منطق السلسلة (Streak)

السلسلة = عدد الأيام المتتالية التي سُجِّلت فيها دقيقة دراسة على الأقل.

- تُحتسب على الخادم (داخل Apps Script) عند جلب البيانات.
- عدم تسجيل اليوم لا يكسر السلسلة، فقط تخطّي يوم سابق يكسرها.
- تظهر السلسلة في لوحة المتصدرين عندما تكون 3 أيام أو أكثر.

---

## 🖼️ Screenshots

> ضع لقطات الشاشة هنا بعد النشر.
> Place screenshots here after deployment.

```
  [ Screenshot: Clock interface ]
  [ Screenshot: Leaderboard ]
  [ Screenshot: Personal stats modal ]
```

---

## 🪪 الترخيص · License

[MIT](LICENSE) — استخدمه وعدّله بحريّة.

---

> صنع بشغف لرفقاء الإنجاز. كن أنت السبب في إكمال صديقك جلسته اليوم.
> Built with passion for study companions. Be the reason a friend finishes their session today.
