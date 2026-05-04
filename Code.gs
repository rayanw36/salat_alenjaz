/**
 * صالة الإنجاز — Google Apps Script Backend (optimized)
 * ============================================================
 * Endpoints:
 *   doPost(e)  → log a new study session (single sheet write)
 *   doGet(e)   → leaderboard (cached) or per-user stats
 *
 * Storage: ONE tab only.
 *   "Sessions": Timestamp | UserName | Date | Hours | Minutes | TotalMinutes
 *
 * Speed:
 *   - POST does just one append (no streak recomputation, no Users tab).
 *     ~300–500ms instead of ~2s.
 *   - GET caches results in CacheService for 30s, so repeated polls are
 *     essentially free. Cache is invalidated on POST.
 *   - Streaks and totals are computed on the fly from raw Sessions data.
 *     Single source of truth → no consistency bugs.
 */

// 🔧 ضع معرّف الشيت هنا (الجزء بين /d/ و /edit في رابط الجدول)
const SHEET_ID = "1LdSg4MxMCe_kSAtqQt64QH9RlCOyj6kU8rXcTwdKrM8";

const SESSIONS_TAB = 'Sessions';
const HEADERS = ['Timestamp', 'UserName', 'Date', 'Hours', 'Minutes', 'TotalMinutes'];

// =====================================================================
// Helpers
// =====================================================================

function getSessionsSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sheet = ss.getSheetByName(SESSIONS_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(SESSIONS_TAB);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function toDateString_(d) {
  if (!d) return '';
  const tz = Session.getScriptTimeZone();
  if (typeof d === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    d = new Date(d);
  }
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

function addDays_(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateString_(d);
}

function todayStr_() {
  return toDateString_(new Date());
}

/**
 * Period start (YYYY-MM-DD). Saudi week: Saturday → Friday.
 */
function periodStart_(period) {
  const today = new Date();
  const tz = Session.getScriptTimeZone();
  const y = parseInt(Utilities.formatDate(today, tz, 'yyyy'), 10);
  const m = parseInt(Utilities.formatDate(today, tz, 'MM'), 10) - 1;
  const d = parseInt(Utilities.formatDate(today, tz, 'dd'), 10);

  if (period === 'today') {
    return toDateString_(new Date(y, m, d));
  }
  if (period === 'week') {
    const jsDow = new Date(y, m, d).getDay(); // 0=Sun..6=Sat
    const back = (jsDow + 1) % 7;             // days since last Saturday
    return toDateString_(new Date(y, m, d - back));
  }
  if (period === 'month') {
    return toDateString_(new Date(y, m, 1));
  }
  return '0000-01-01';
}

function clearLeaderboardCache_() {
  try {
    CacheService.getScriptCache().removeAll(['lb_today', 'lb_week', 'lb_month', 'lb_all']);
  } catch (_) {}
}

// =====================================================================
// POST: log a new study session  (~300-500ms)
// =====================================================================

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ success: false, error: 'لم يتم استلام بيانات' });
    }

    const payload = JSON.parse(e.postData.contents);
    const userName = String(payload.userName || '').trim();
    const date = toDateString_(payload.date) || todayStr_();
    const hours = Math.max(0, Math.floor(Number(payload.hours) || 0));
    const minutes = Math.max(0, Math.floor(Number(payload.minutes) || 0));
    const totalMinutes = hours * 60 + minutes;

    if (!userName)         return jsonResponse_({ success: false, error: 'الاسم مطلوب' });
    if (userName.length > 40) return jsonResponse_({ success: false, error: 'الاسم طويل جداً' });
    if (totalMinutes <= 0) return jsonResponse_({ success: false, error: 'المدة يجب أن تكون أكبر من صفر' });
    if (totalMinutes > 24 * 60) return jsonResponse_({ success: false, error: 'المدة لا يمكن أن تتجاوز 24 ساعة' });

    // Single sheet operation: append the row.
    getSessionsSheet_().appendRow([new Date(), userName, date, hours, minutes, totalMinutes]);

    // Invalidate cached leaderboards so the next GET shows fresh data.
    clearLeaderboardCache_();

    return jsonResponse_({ success: true });
  } catch (err) {
    return jsonResponse_({ success: false, error: String(err && err.message || err) });
  }
}

// =====================================================================
// GET: leaderboard (cached) or user stats
// =====================================================================

function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const period = (params.period || 'all').toLowerCase();

    if (period === 'user') {
      return jsonResponse_(getUserStats_(params.name || ''));
    }

    return jsonResponse_(getLeaderboardCached_(period));
  } catch (err) {
    return jsonResponse_({ error: String(err && err.message || err) });
  }
}

/**
 * Wrap leaderboard computation with a 30-second script-level cache.
 * Repeated polls (auto-refresh, multiple users) are nearly free.
 */
function getLeaderboardCached_(period) {
  const cache = CacheService.getScriptCache();
  const key = `lb_${period}`;

  const cached = cache.get(key);
  if (cached) {
    try { return JSON.parse(cached); } catch (_) {}
  }

  const result = computeLeaderboard_(period);

  try {
    cache.put(key, JSON.stringify(result), 30);
  } catch (_) {
    // CacheService rejects entries > 100KB. Fall back silently.
  }

  return result;
}

/**
 * Single pass over Sessions:
 *  - aggregate totals & sessions in the period
 *  - track all-time dates per user for streak computation
 */
function computeLeaderboard_(period) {
  const sheet = getSessionsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const startDate = periodStart_(period);
  const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();

  const agg = {}; // key: lowercase name → { displayName, totalMinutes, sessionsCount, datesAll }

  for (let i = 0; i < data.length; i++) {
    const userName = String(data[i][1] || '').trim();
    if (!userName) continue;
    const dateStr = toDateString_(data[i][2]);
    const total = Number(data[i][5] || 0);
    const key = userName.toLowerCase();

    if (!agg[key]) {
      agg[key] = {
        displayName: userName,
        totalMinutes: 0,
        sessionsCount: 0,
        datesAll: {},
      };
    }
    agg[key].datesAll[dateStr] = true;

    if (dateStr >= startDate) {
      agg[key].totalMinutes += total;
      agg[key].sessionsCount += 1;
    }
  }

  const result = [];
  for (const k in agg) {
    if (agg[k].totalMinutes === 0) continue; // exclude users with no sessions in period
    const sortedDates = Object.keys(agg[k].datesAll).sort();
    const streaks = computeStreaks_(sortedDates);
    result.push({
      userName: agg[k].displayName,
      totalMinutes: agg[k].totalMinutes,
      sessionsCount: agg[k].sessionsCount,
      currentStreak: streaks.current,
      longestStreak: streaks.longest,
    });
  }

  result.sort((a, b) => b.totalMinutes - a.totalMinutes);
  return result;
}

/**
 * Streak from a sorted list of YYYY-MM-DD dates.
 * Current streak = consecutive run ending today or yesterday.
 */
function computeStreaks_(sortedDates) {
  if (!sortedDates || sortedDates.length === 0) return { longest: 0, current: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    if (addDays_(sortedDates[i - 1], 1) === sortedDates[i]) {
      run++;
      if (run > longest) longest = run;
    } else if (sortedDates[i] !== sortedDates[i - 1]) {
      run = 1;
    }
  }

  const today = todayStr_();
  const yesterday = addDays_(today, -1);
  const latest = sortedDates[sortedDates.length - 1];

  if (latest !== today && latest !== yesterday) {
    return { longest: longest, current: 0 };
  }

  let current = 1;
  for (let i = sortedDates.length - 2; i >= 0; i--) {
    if (addDays_(sortedDates[i], 1) === sortedDates[i + 1]) {
      current++;
    } else if (sortedDates[i] !== sortedDates[i + 1]) {
      break;
    }
  }
  return { longest: longest, current: current };
}

/**
 * Personal stats — totals + last 7 days breakdown.
 * Single pass over Sessions, no caching (per-user data).
 */
function getUserStats_(userName) {
  userName = String(userName || '').trim();
  if (!userName) return { error: 'الاسم مطلوب' };

  const sheet = getSessionsSheet_();
  const lastRow = sheet.getLastRow();

  const today = todayStr_();
  const last7 = [];
  const last7Index = {};
  for (let i = 6; i >= 0; i--) {
    const d = addDays_(today, -i);
    last7.push({ date: d, minutes: 0 });
    last7Index[d] = last7.length - 1;
  }

  let totalMinutes = 0;
  let sessionsCount = 0;
  const allDates = {};
  let displayName = userName;
  let firstDate = null;

  if (lastRow >= 2) {
    const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
    const target = userName.toLowerCase();
    for (let i = 0; i < data.length; i++) {
      const rowName = String(data[i][1] || '').trim();
      if (rowName.toLowerCase() !== target) continue;
      displayName = rowName;
      const dateStr = toDateString_(data[i][2]);
      const minutes = Number(data[i][5] || 0);
      totalMinutes += minutes;
      sessionsCount += 1;
      allDates[dateStr] = true;
      if (last7Index.hasOwnProperty(dateStr)) {
        last7[last7Index[dateStr]].minutes += minutes;
      }
      if (!firstDate || dateStr < firstDate) firstDate = dateStr;
    }
  }

  if (sessionsCount === 0) {
    return { error: 'لا توجد بيانات لهذا المستخدم' };
  }

  const sortedDates = Object.keys(allDates).sort();
  const streaks = computeStreaks_(sortedDates);
  const activeDays = sortedDates.length;
  const avgPerDay = activeDays > 0 ? Math.round(totalMinutes / activeDays) : 0;

  return {
    userName: displayName,
    joinedDate: firstDate || today,
    totalMinutes: totalMinutes,
    sessionsCount: sessionsCount,
    longestStreak: streaks.longest,
    currentStreak: streaks.current,
    avgPerDay: avgPerDay,
    last7Days: last7,
  };
}

/*
 خطوات النشر:
 1. الصق هذا الكود في Apps Script (استبدل القديم بالكامل)
 2. تأكّد أن SHEET_ID صحيح
 3. احفظ ثم Deploy → Manage deployments → اضغط القلم بجانب الإصدار النشط
 4. New version → Deploy
    (لا تحتاج رابطاً جديداً، نفس الـ URL سيشتغل)
 5. ملاحظة: الورقة "Users" القديمة لم تعد ضرورية ويمكن حذفها إن أردت.
    البيانات كلها مستنبطة من ورقة "Sessions" مباشرة.
*/
