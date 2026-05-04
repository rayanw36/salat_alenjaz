/**
 * صالة الإنجاز — Google Apps Script Backend
 * ============================================================
 * This script handles two endpoints:
 *   doPost(e)  → log a new study session
 *   doGet(e)   → return leaderboard or per-user stats
 *
 * Storage layout (Google Sheet):
 *   Tab "Sessions": Timestamp | UserName | Date | Hours | Minutes | TotalMinutes
 *   Tab "Users":    UserName  | JoinedDate | TotalMinutes | SessionsCount | LongestStreak | CurrentStreak | LastDate
 *
 * The script auto-creates the tabs and headers on first run.
 *
 * تصميم الواجهة الخلفية:
 *   - doPost لحفظ جلسة جديدة في ورقة "Sessions" وتحديث "Users".
 *   - doGet لإرجاع لوحة المتصدرين أو إحصاءات مستخدم معيّن.
 *   - يتم احتساب السلسلة (Streak) عند جلب البيانات لضمان دقتها.
 */

// 🔧 ضع معرّف الشيت هنا (الجزء بين /d/ و /edit في رابط الجدول)
const SHEET_ID = "1LdSg4MxMCe_kSAtqQt64QH9RlCOyj6kU8rXcTwdKrM8";

// ---------- Constants ----------
const SESSION_HEADERS = ['Timestamp', 'UserName', 'Date', 'Hours', 'Minutes', 'TotalMinutes'];
const USER_HEADERS = [
  'UserName', 'JoinedDate', 'TotalMinutes', 'SessionsCount',
  'LongestStreak', 'CurrentStreak', 'LastDate',
];
const SESSIONS_TAB = 'Sessions';
const USERS_TAB = 'Users';

// =====================================================================
// Helpers
// =====================================================================

/**
 * Get the active spreadsheet (by ID), creating tabs if needed.
 */
function getSheet_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sessions = ss.getSheetByName(SESSIONS_TAB);
  if (!sessions) {
    sessions = ss.insertSheet(SESSIONS_TAB);
    sessions.appendRow(SESSION_HEADERS);
    sessions.getRange(1, 1, 1, SESSION_HEADERS.length).setFontWeight('bold');
  }
  let users = ss.getSheetByName(USERS_TAB);
  if (!users) {
    users = ss.insertSheet(USERS_TAB);
    users.appendRow(USER_HEADERS);
    users.getRange(1, 1, 1, USER_HEADERS.length).setFontWeight('bold');
  }
  return { ss, sessions, users };
}

/**
 * Build a JSON response (Apps Script web apps can't set CORS headers,
 * but text/plain POSTs from the browser don't trigger preflight).
 */
function jsonResponse_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Convert a Date or string to a YYYY-MM-DD string in script timezone.
 */
function toDateString_(d) {
  if (!d) return '';
  const tz = Session.getScriptTimeZone();
  if (typeof d === 'string') {
    // If already YYYY-MM-DD, keep it.
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    d = new Date(d);
  }
  return Utilities.formatDate(d, tz, 'yyyy-MM-dd');
}

/**
 * Subtract days from a YYYY-MM-DD string. Returns YYYY-MM-DD.
 */
function addDays_(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toDateString_(d);
}

/**
 * Today's date in script timezone, as YYYY-MM-DD.
 */
function todayStr_() {
  return toDateString_(new Date());
}

/**
 * Compute the start date (YYYY-MM-DD) for a given period.
 * Saudi week: Saturday → Friday.
 */
function periodStart_(period) {
  const today = new Date();
  const tz = Session.getScriptTimeZone();
  const y = parseInt(Utilities.formatDate(today, tz, 'yyyy'), 10);
  const m = parseInt(Utilities.formatDate(today, tz, 'MM'), 10) - 1;
  const d = parseInt(Utilities.formatDate(today, tz, 'dd'), 10);
  const dow = parseInt(Utilities.formatDate(today, tz, 'u'), 10); // 1=Mon..7=Sun

  if (period === 'today') {
    return toDateString_(new Date(y, m, d));
  }
  if (period === 'week') {
    // Saturday is day 6 (Sun=0..Sat=6 in JS).
    // We want the most recent Saturday (today inclusive).
    const jsDow = new Date(y, m, d).getDay(); // 0=Sun..6=Sat
    // Days since last Saturday: (jsDow + 1) % 7
    const back = (jsDow + 1) % 7;
    const start = new Date(y, m, d - back);
    return toDateString_(start);
  }
  if (period === 'month') {
    return toDateString_(new Date(y, m, 1));
  }
  return '0000-01-01'; // 'all' or unknown
}

// =====================================================================
// POST: log a new study session
// =====================================================================

/**
 * POST handler.
 * Frontend sends Content-Type: text/plain (to skip CORS preflight) — JSON in body.
 *
 * Expected body: { userName, date, hours, minutes }
 */
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

    // ---- Validation ----
    if (!userName) {
      return jsonResponse_({ success: false, error: 'الاسم مطلوب' });
    }
    if (userName.length > 40) {
      return jsonResponse_({ success: false, error: 'الاسم طويل جداً' });
    }
    if (totalMinutes <= 0) {
      return jsonResponse_({ success: false, error: 'المدة يجب أن تكون أكبر من صفر' });
    }
    if (totalMinutes > 24 * 60) {
      return jsonResponse_({ success: false, error: 'المدة لا يمكن أن تتجاوز 24 ساعة' });
    }

    const { sessions, users } = getSheet_();

    // ---- Append session row ----
    sessions.appendRow([
      new Date(),    // server-side timestamp
      userName,
      date,
      hours,
      minutes,
      totalMinutes,
    ]);

    // ---- Update users tab ----
    upsertUser_(users, userName, date, totalMinutes);

    return jsonResponse_({ success: true });
  } catch (err) {
    return jsonResponse_({ success: false, error: String(err && err.message || err) });
  }
}

/**
 * Insert or update a user row, recomputing streaks.
 */
function upsertUser_(usersSheet, userName, date, addedMinutes) {
  const lastRow = usersSheet.getLastRow();
  let rowIdx = -1;
  let row = null;

  if (lastRow >= 2) {
    const data = usersSheet.getRange(2, 1, lastRow - 1, USER_HEADERS.length).getValues();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim().toLowerCase() === userName.toLowerCase()) {
        rowIdx = i + 2; // sheet row index
        row = data[i];
        break;
      }
    }
  }

  if (rowIdx === -1) {
    // New user
    usersSheet.appendRow([
      userName,        // UserName
      date,            // JoinedDate
      addedMinutes,    // TotalMinutes
      1,               // SessionsCount
      1,               // LongestStreak
      1,               // CurrentStreak
      date,            // LastDate
    ]);
    return;
  }

  // Existing user — recompute streak from sessions (most accurate).
  const totalMinutes = Number(row[2] || 0) + addedMinutes;
  const sessionsCount = Number(row[3] || 0) + 1;
  const joinedDate = row[1] || date;

  // Recompute streaks based on all session dates for this user.
  const allDates = getUserSessionDates_(userName);
  // Make sure today's date is included.
  if (allDates.indexOf(date) === -1) allDates.push(date);
  const { longest, current } = computeStreaks_(allDates);

  const longestStreak = Math.max(Number(row[4] || 0), longest);
  const lastDate = (date > toDateString_(row[6])) ? date : toDateString_(row[6]);

  usersSheet.getRange(rowIdx, 1, 1, USER_HEADERS.length).setValues([[
    userName,
    joinedDate,
    totalMinutes,
    sessionsCount,
    longestStreak,
    current,
    lastDate,
  ]]);
}

/**
 * Get all distinct session dates (YYYY-MM-DD) for a user, sorted ascending.
 */
function getUserSessionDates_(userName) {
  const { sessions } = getSheet_();
  const lastRow = sessions.getLastRow();
  if (lastRow < 2) return [];
  const data = sessions.getRange(2, 1, lastRow - 1, SESSION_HEADERS.length).getValues();
  const set = {};
  const target = userName.toLowerCase();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][1] || '').trim().toLowerCase() === target) {
      const ds = toDateString_(data[i][2]);
      if (ds) set[ds] = true;
    }
  }
  return Object.keys(set).sort();
}

/**
 * Compute longest and current streak from a sorted list of YYYY-MM-DD strings.
 * "Current" streak ends today or yesterday (today not yet logged ≠ broken).
 */
function computeStreaks_(sortedDates) {
  if (!sortedDates || sortedDates.length === 0) return { longest: 0, current: 0 };

  let longest = 1;
  let run = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const prev = sortedDates[i - 1];
    const cur = sortedDates[i];
    if (addDays_(prev, 1) === cur) {
      run++;
      if (run > longest) longest = run;
    } else if (cur !== prev) {
      run = 1;
    }
  }

  // Current streak: count consecutive days ending at the latest date,
  // but only if that latest date is today or yesterday.
  const today = todayStr_();
  const yesterday = addDays_(today, -1);
  const latest = sortedDates[sortedDates.length - 1];

  if (latest !== today && latest !== yesterday) {
    return { longest, current: 0 };
  }

  let current = 1;
  for (let i = sortedDates.length - 2; i >= 0; i--) {
    if (addDays_(sortedDates[i], 1) === sortedDates[i + 1]) {
      current++;
    } else if (sortedDates[i] !== sortedDates[i + 1]) {
      break;
    }
  }
  return { longest, current };
}

// =====================================================================
// GET: leaderboard or per-user stats
// =====================================================================

/**
 * GET handler.
 *   ?period=today|week|month|all  → leaderboard array
 *   ?period=user&name=XXX         → personal stats object
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const period = (params.period || 'all').toLowerCase();

    if (period === 'user') {
      return jsonResponse_(getUserStats_(params.name || ''));
    }

    return jsonResponse_(getLeaderboard_(period));
  } catch (err) {
    return jsonResponse_({ error: String(err && err.message || err) });
  }
}

/**
 * Build the leaderboard for a given period.
 */
function getLeaderboard_(period) {
  const { sessions, users } = getSheet_();
  const lastRow = sessions.getLastRow();
  if (lastRow < 2) return [];

  const startDate = periodStart_(period);
  const data = sessions.getRange(2, 1, lastRow - 1, SESSION_HEADERS.length).getValues();

  // Aggregate by user name (case-insensitive).
  const agg = {};
  for (let i = 0; i < data.length; i++) {
    const userName = String(data[i][1] || '').trim();
    if (!userName) continue;
    const dateStr = toDateString_(data[i][2]);
    if (dateStr < startDate) continue;
    const total = Number(data[i][5] || 0);
    const key = userName.toLowerCase();
    if (!agg[key]) {
      agg[key] = { userName: userName, totalMinutes: 0, sessionsCount: 0 };
    }
    agg[key].totalMinutes += total;
    agg[key].sessionsCount += 1;
  }

  // Attach streaks from Users tab (always all-time streak).
  const userMap = readUsersMap_(users);
  const result = Object.keys(agg).map(k => {
    const u = userMap[k] || {};
    return {
      userName: agg[k].userName,
      totalMinutes: agg[k].totalMinutes,
      sessionsCount: agg[k].sessionsCount,
      currentStreak: Number(u.currentStreak || 0),
      longestStreak: Number(u.longestStreak || 0),
    };
  });

  result.sort((a, b) => b.totalMinutes - a.totalMinutes);
  return result;
}

/**
 * Read the Users tab into a map keyed by lowercase username.
 */
function readUsersMap_(usersSheet) {
  const lastRow = usersSheet.getLastRow();
  const map = {};
  if (lastRow < 2) return map;
  const data = usersSheet.getRange(2, 1, lastRow - 1, USER_HEADERS.length).getValues();
  for (let i = 0; i < data.length; i++) {
    const userName = String(data[i][0] || '').trim();
    if (!userName) continue;
    map[userName.toLowerCase()] = {
      userName: userName,
      joinedDate: toDateString_(data[i][1]),
      totalMinutes: Number(data[i][2] || 0),
      sessionsCount: Number(data[i][3] || 0),
      longestStreak: Number(data[i][4] || 0),
      currentStreak: Number(data[i][5] || 0),
      lastDate: toDateString_(data[i][6]),
    };
  }
  return map;
}

/**
 * Personal stats for a user, including last 7-day breakdown.
 */
function getUserStats_(userName) {
  userName = String(userName || '').trim();
  if (!userName) return { error: 'الاسم مطلوب' };

  const { sessions, users } = getSheet_();
  const userMap = readUsersMap_(users);
  const u = userMap[userName.toLowerCase()];

  // Build last 7 days breakdown (oldest → newest).
  const today = todayStr_();
  const last7 = [];
  for (let i = 6; i >= 0; i--) {
    last7.push({ date: addDays_(today, -i), minutes: 0 });
  }
  const last7Index = {};
  last7.forEach((d, idx) => { last7Index[d.date] = idx; });

  const lastRow = sessions.getLastRow();
  let totalMinutes = 0;
  let sessionsCount = 0;
  const allDates = {};

  if (lastRow >= 2) {
    const data = sessions.getRange(2, 1, lastRow - 1, SESSION_HEADERS.length).getValues();
    const target = userName.toLowerCase();
    for (let i = 0; i < data.length; i++) {
      if (String(data[i][1] || '').trim().toLowerCase() !== target) continue;
      const dateStr = toDateString_(data[i][2]);
      const minutes = Number(data[i][5] || 0);
      totalMinutes += minutes;
      sessionsCount += 1;
      allDates[dateStr] = true;
      if (last7Index.hasOwnProperty(dateStr)) {
        last7[last7Index[dateStr]].minutes += minutes;
      }
    }
  }

  if (sessionsCount === 0 && !u) {
    return { error: 'لا توجد بيانات لهذا المستخدم' };
  }

  const sortedDates = Object.keys(allDates).sort();
  const { longest, current } = computeStreaks_(sortedDates);
  const joinedDate = (u && u.joinedDate) || sortedDates[0] || today;

  // Average per active day
  const activeDays = sortedDates.length;
  const avgPerDay = activeDays > 0 ? Math.round(totalMinutes / activeDays) : 0;

  return {
    userName: (u && u.userName) || userName,
    joinedDate: joinedDate,
    totalMinutes: totalMinutes,
    sessionsCount: sessionsCount,
    longestStreak: longest,
    currentStreak: current,
    avgPerDay: avgPerDay,
    last7Days: last7,
  };
}

/*
 خطوات النشر:
 1. الصق هذا الكود في Apps Script
 2. عدّل SHEET_ID بمعرف الشيت
 3. احفظ ثم Deploy → New deployment → Web app
 4. Execute as: Me
 5. Who has access: Anyone
 6. انسخ الـ URL والصقه في app.js داخل CONFIG.API_URL
*/
