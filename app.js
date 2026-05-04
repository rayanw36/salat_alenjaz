/* ============================================================
   صالة الإنجاز — Frontend logic
   ============================================================ */

const CONFIG = {
    API_URL: "https://script.google.com/macros/s/AKfycbxp_3hap9wK6YWWSnE1BI80g7oG3Gi0aEjOYr-Svjs9dxuSlDfB66q7AY_7NCgjk58TIw/exec",
    AUTO_REFRESH_INTERVAL: 60000,
};

/* ---------- Arabic helpers ---------- */

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toArabicDigits(input) {
    return String(input).replace(/[0-9]/g, d => ARABIC_DIGITS[+d]);
}

function pad2Arabic(n) {
    return toArabicDigits(String(n).padStart(2, '0'));
}

// Arabic plural for hours / minutes
function pluralizeHours(n) {
    if (n === 0) return null;
    if (n === 1) return 'ساعة واحدة';
    if (n === 2) return 'ساعتان';
    if (n >= 3 && n <= 10) return `${toArabicDigits(n)} ساعات`;
    return `${toArabicDigits(n)} ساعة`;
}

function pluralizeMinutes(n) {
    if (n === 0) return null;
    if (n === 1) return 'دقيقة واحدة';
    if (n === 2) return 'دقيقتان';
    if (n >= 3 && n <= 10) return `${toArabicDigits(n)} دقائق`;
    return `${toArabicDigits(n)} دقيقة`;
}

function formatDuration(hours, minutes) {
    const h = pluralizeHours(hours);
    const m = pluralizeMinutes(minutes);
    if (!h && !m) return 'لم تسجل بعد';
    if (h && m) return `${h} و ${m}`;
    return h || m;
}

function formatTotalMinutes(totalMinutes) {
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return formatDuration(h, m);
}

// Arabic day & month names
const ARABIC_DAYS = [
    'الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء',
    'الخميس', 'الجمعة', 'السبت',
];

const ARABIC_MONTHS = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

function formatArabicDate(date) {
    if (typeof date === 'string') date = new Date(date + 'T00:00:00');
    const day = ARABIC_DAYS[date.getDay()];
    const num = toArabicDigits(date.getDate());
    const month = ARABIC_MONTHS[date.getMonth()];
    const year = toArabicDigits(date.getFullYear());
    return `${day}، ${num} ${month} ${year}`;
}

function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/* ---------- Tab navigation ---------- */

const tabButtons = document.querySelectorAll('.tab');
const panels = {
    log: document.getElementById('panel-log'),
    leaderboard: document.getElementById('panel-leaderboard'),
};

let currentTab = 'log';

function switchTab(tabName) {
    if (tabName === currentTab) return;
    currentTab = tabName;

    tabButtons.forEach(btn => {
        const active = btn.dataset.tab === tabName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active);
    });

    Object.entries(panels).forEach(([key, panel]) => {
        const active = key === tabName;
        panel.classList.toggle('active', active);
        panel.hidden = !active;
    });

    if (tabName === 'leaderboard') {
        fetchLeaderboard();
        startAutoRefresh();
    } else {
        stopAutoRefresh();
    }
}

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

/* ---------- Clock construction ---------- */

const clock = document.querySelector('.clock');
const ticksGroup = document.getElementById('clock-ticks');
const numeralsGroup = document.getElementById('clock-numerals');
const hourGroup = document.getElementById('hour-hand-group');
const minuteGroup = document.getElementById('minute-hand-group');
const hourHand = hourGroup.querySelector('.hour-hand');
const hourKnob = hourGroup.querySelector('.hour-knob');
const minuteHand = minuteGroup.querySelector('.minute-hand');
const minuteKnob = minuteGroup.querySelector('.minute-knob');
const readoutTime = document.getElementById('readout-time');
const readoutDigital = document.getElementById('readout-digital');

const CLOCK_CENTER = 200;
const CLOCK_RADIUS = 180;
const HOUR_HAND_LENGTH = 100;   // distance from center -> tip
const MINUTE_HAND_LENGTH = 140;
const SVG_NS = 'http://www.w3.org/2000/svg';

let selectedHours = 0;
let selectedMinutes = 0;
let dragging = null; // 'hour' | 'minute' | null

// Build minute ticks
for (let i = 0; i < 60; i++) {
    const angle = (i * 6) - 90; // 0 at top
    const rad = angle * Math.PI / 180;
    const isMajor = i % 5 === 0;
    const inner = isMajor ? CLOCK_RADIUS - 18 : CLOCK_RADIUS - 10;
    const outer = CLOCK_RADIUS - 4;
    const x1 = CLOCK_CENTER + Math.cos(rad) * inner;
    const y1 = CLOCK_CENTER + Math.sin(rad) * inner;
    const x2 = CLOCK_CENTER + Math.cos(rad) * outer;
    const y2 = CLOCK_CENTER + Math.sin(rad) * outer;
    const tick = document.createElementNS(SVG_NS, 'line');
    tick.setAttribute('x1', x1);
    tick.setAttribute('y1', y1);
    tick.setAttribute('x2', x2);
    tick.setAttribute('y2', y2);
    tick.setAttribute('class', isMajor ? 'tick tick-major' : 'tick');
    tick.setAttribute('stroke-width', isMajor ? 3 : 1);
    tick.setAttribute('stroke-linecap', 'round');
    ticksGroup.appendChild(tick);
}

// Build hour numerals (1-12)
for (let i = 1; i <= 12; i++) {
    const angle = (i * 30) - 90;
    const rad = angle * Math.PI / 180;
    const r = CLOCK_RADIUS - 38;
    const x = CLOCK_CENTER + Math.cos(rad) * r;
    const y = CLOCK_CENTER + Math.sin(rad) * r;
    const text = document.createElementNS(SVG_NS, 'text');
    text.setAttribute('x', x);
    text.setAttribute('y', y);
    text.setAttribute('class', 'numeral');
    text.textContent = toArabicDigits(i);
    numeralsGroup.appendChild(text);
}

/* ---------- Hand positioning ---------- */

function setHourHand(hours) {
    selectedHours = hours;
    // 0..12 maps to 0..360
    const angle = (hours / 12) * 360 - 90;
    const rad = angle * Math.PI / 180;
    const x = CLOCK_CENTER + Math.cos(rad) * HOUR_HAND_LENGTH;
    const y = CLOCK_CENTER + Math.sin(rad) * HOUR_HAND_LENGTH;
    hourHand.setAttribute('x2', x);
    hourHand.setAttribute('y2', y);
    hourKnob.setAttribute('cx', x);
    hourKnob.setAttribute('cy', y);
    hourGroup.setAttribute('aria-valuenow', hours);
    updateReadout();
}

function setMinuteHand(minutes) {
    selectedMinutes = minutes;
    const angle = (minutes / 60) * 360 - 90;
    const rad = angle * Math.PI / 180;
    const x = CLOCK_CENTER + Math.cos(rad) * MINUTE_HAND_LENGTH;
    const y = CLOCK_CENTER + Math.sin(rad) * MINUTE_HAND_LENGTH;
    minuteHand.setAttribute('x2', x);
    minuteHand.setAttribute('y2', y);
    minuteKnob.setAttribute('cx', x);
    minuteKnob.setAttribute('cy', y);
    minuteGroup.setAttribute('aria-valuenow', minutes);
    updateReadout();
}

function updateReadout() {
    readoutTime.textContent = formatDuration(selectedHours, selectedMinutes);
    readoutDigital.textContent = `${pad2Arabic(selectedHours)} : ${pad2Arabic(selectedMinutes)}`;
}

/* ---------- Drag interaction ---------- */

function pointToAngle(clientX, clientY) {
    // Convert screen point to clock coordinate space, then to angle.
    const rect = clock.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    // angle in degrees, 0 at right, increasing clockwise; we want 0 at top.
    let deg = Math.atan2(dy, dx) * 180 / Math.PI;
    deg = (deg + 90 + 360) % 360; // 0 = top, increases clockwise
    return deg;
}

function onPointerDown(e, which) {
    e.preventDefault();
    dragging = which;
    const target = which === 'hour' ? hourGroup : minuteGroup;
    target.classList.add('dragging');
    try {
        target.setPointerCapture(e.pointerId);
    } catch (_) { /* not all browsers */ }
}

function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const angle = pointToAngle(e.clientX, e.clientY);

    if (dragging === 'hour') {
        // 0..360 -> 0..12, snap to nearest 15-min increment (i.e. quarter hour)
        let hours = (angle / 360) * 12;
        hours = Math.round(hours * 4) / 4; // 0.25 increments
        if (hours >= 12) hours = 0;
        setHourHand(hours);
    } else {
        let minutes = Math.round((angle / 360) * 60);
        if (minutes >= 60) minutes = 0;
        setMinuteHand(minutes);
    }
}

function onPointerUp(e) {
    if (!dragging) return;
    const target = dragging === 'hour' ? hourGroup : minuteGroup;
    target.classList.remove('dragging');
    try {
        target.releasePointerCapture(e.pointerId);
    } catch (_) {}
    dragging = null;
}

hourGroup.addEventListener('pointerdown', e => onPointerDown(e, 'hour'));
minuteGroup.addEventListener('pointerdown', e => onPointerDown(e, 'minute'));
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

// Tap on clock face (not on hands) sets the closer hand.
clock.addEventListener('pointerdown', e => {
    if (dragging) return;
    if (e.target.closest('.hand-group')) return;
    // Use pointer position to set minute hand directly (more useful).
    const angle = pointToAngle(e.clientX, e.clientY);
    let minutes = Math.round((angle / 360) * 60);
    if (minutes >= 60) minutes = 0;
    setMinuteHand(minutes);
});

// Keyboard accessibility for hands
hourGroup.addEventListener('keydown', e => {
    let h = selectedHours;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') h = Math.min(12, h + 0.25);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') h = Math.max(0, h - 0.25);
    else if (e.key === 'Home') h = 0;
    else if (e.key === 'End') h = 12;
    else return;
    e.preventDefault();
    setHourHand(h);
});

minuteGroup.addEventListener('keydown', e => {
    let m = selectedMinutes;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') m = Math.min(59, m + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') m = Math.max(0, m - 1);
    else if (e.key === 'Home') m = 0;
    else if (e.key === 'End') m = 59;
    else if (e.key === 'PageUp') m = Math.min(59, m + 5);
    else if (e.key === 'PageDown') m = Math.max(0, m - 5);
    else return;
    e.preventDefault();
    setMinuteHand(m);
});

// Initialize hands at 0
setHourHand(0);
setMinuteHand(0);

/* ---------- Form fields ---------- */

const nameInput = document.getElementById('user-name');
const dateInput = document.getElementById('session-date');
const dateDisplay = document.getElementById('date-display');
const submitBtn = document.getElementById('btn-submit');

// Restore name from localStorage
const savedName = localStorage.getItem('salat_user_name');
if (savedName) nameInput.value = savedName;

nameInput.addEventListener('change', () => {
    localStorage.setItem('salat_user_name', nameInput.value.trim());
});

// Default date = today
dateInput.value = todayISO();
updateDateDisplay();

dateInput.addEventListener('change', updateDateDisplay);

function updateDateDisplay() {
    if (!dateInput.value) {
        dateDisplay.textContent = '';
        return;
    }
    dateDisplay.textContent = formatArabicDate(dateInput.value);
}

/* ---------- Submission ---------- */

submitBtn.addEventListener('click', async () => {
    const userName = nameInput.value.trim();
    const date = dateInput.value;
    // Convert hour-quarter increments to whole hours + carry fractional to minutes
    const totalMinutes = Math.round(selectedHours * 60) + selectedMinutes;
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (!userName) {
        showToast('فضلاً، اكتب اسمك أولاً.', 'error');
        nameInput.focus();
        return;
    }
    if (!date) {
        showToast('فضلاً، اختر تاريخ الجلسة.', 'error');
        return;
    }
    if (totalMinutes <= 0) {
        showToast('اسحب العقارب لاختيار مدة الجلسة.', 'error');
        return;
    }
    if (CONFIG.API_URL.includes('PASTE_YOUR')) {
        showToast('لم يتم ربط الخادم بعد. عدّل CONFIG.API_URL.', 'error');
        return;
    }

    submitBtn.classList.add('loading');
    submitBtn.disabled = true;

    try {
        // Apps Script: send as text/plain to avoid CORS preflight.
        const res = await fetch(CONFIG.API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({ userName, date, hours, minutes }),
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'حدث خطأ غير متوقع');

        localStorage.setItem('salat_user_name', userName);
        showToast('تم تسجيل جلستك بنجاح! بارك الله في وقتك ✨', 'success');
        launchConfetti();

        // Reset clock
        setHourHand(0);
        setMinuteHand(0);

        // Switch to leaderboard after a short pause
        setTimeout(() => switchTab('leaderboard'), 1100);
    } catch (err) {
        console.error(err);
        showToast(`تعذّر التسجيل: ${err.message || err}`, 'error');
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    }
});

/* ---------- Toast ---------- */

const toastContainer = document.getElementById('toast-container');

function showToast(message, type = 'info', duration = 3500) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => toast.remove());
    }, duration);
}

/* ---------- Confetti ---------- */

const confettiContainer = document.getElementById('confetti-container');
const CONFETTI_COLORS = ['#D4AF37', '#E8C763', '#F5DA8C', '#F5F0E1'];

function launchConfetti() {
    for (let i = 0; i < 36; i++) {
        const piece = document.createElement('div');
        piece.className = 'confetti-piece';
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        piece.style.animationDelay = `${Math.random() * 0.4}s`;
        piece.style.animationDuration = `${1.2 + Math.random() * 1.2}s`;
        piece.style.transform = `rotate(${Math.random() * 360}deg)`;
        piece.style.width = `${6 + Math.random() * 6}px`;
        piece.style.height = `${10 + Math.random() * 8}px`;
        confettiContainer.appendChild(piece);
        setTimeout(() => piece.remove(), 2400);
    }
}

/* ---------- Leaderboard ---------- */

const leaderboardList = document.getElementById('leaderboard-list');
const refreshBtn = document.getElementById('btn-refresh');
const periodButtons = document.querySelectorAll('.period-btn');

let currentPeriod = 'today';
let autoRefreshTimer = null;

periodButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.classList.contains('active')) return;
        currentPeriod = btn.dataset.period;
        periodButtons.forEach(b => {
            const active = b === btn;
            b.classList.toggle('active', active);
            b.setAttribute('aria-selected', active);
        });
        fetchLeaderboard();
    });
});

refreshBtn.addEventListener('click', () => {
    refreshBtn.classList.add('spinning');
    fetchLeaderboard();
    setTimeout(() => refreshBtn.classList.remove('spinning'), 700);
});

function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(fetchLeaderboard, CONFIG.AUTO_REFRESH_INTERVAL);
}

function stopAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

async function fetchLeaderboard() {
    if (CONFIG.API_URL.includes('PASTE_YOUR')) {
        renderLeaderboardError('لم يتم ربط الخادم بعد. عدّل CONFIG.API_URL في app.js');
        return;
    }
    try {
        const res = await fetch(`${CONFIG.API_URL}?period=${encodeURIComponent(currentPeriod)}`);
        const data = await res.json();
        if (!Array.isArray(data)) {
            throw new Error(data.error || 'استجابة غير متوقعة من الخادم');
        }
        renderLeaderboard(data);
    } catch (err) {
        console.error(err);
        renderLeaderboardError(`تعذّر تحميل اللوحة: ${err.message || err}`);
    }
}

function renderLeaderboardError(msg) {
    leaderboardList.innerHTML = `
        <div class="leaderboard-empty">
            <div class="leaderboard-empty-icon">⚠️</div>
            <p>${msg}</p>
        </div>
    `;
}

function renderLeaderboard(rows) {
    if (!rows || rows.length === 0) {
        leaderboardList.innerHTML = `
            <div class="leaderboard-empty">
                <div class="leaderboard-empty-icon">📚</div>
                <p>لا توجد جلسات بعد — كن أول المسجلين!</p>
            </div>
        `;
        return;
    }

    leaderboardList.innerHTML = '';

    rows.forEach((row, idx) => {
        const rank = idx + 1;
        const el = document.createElement('button');
        el.className = `leaderboard-row rank-${rank}`;
        el.style.animationDelay = `${idx * 60}ms`;
        el.type = 'button';

        let badgeHtml;
        if (rank === 1) badgeHtml = `<div class="rank-badge medal-gold">🥇</div>`;
        else if (rank === 2) badgeHtml = `<div class="rank-badge medal-silver">🥈</div>`;
        else if (rank === 3) badgeHtml = `<div class="rank-badge medal-bronze">🥉</div>`;
        else badgeHtml = `<div class="rank-badge muted">${toArabicDigits(rank)}</div>`;

        const streak = row.currentStreak || 0;
        const streakHtml = streak >= 3
            ? `<span class="row-streak">🔥 ${toArabicDigits(streak)} ${streak === 2 ? 'يومان' : streak <= 10 ? 'أيام' : 'يوماً'} متتالية</span>`
            : '';

        const timeStr = formatTotalMinutes(row.totalMinutes || 0);
        const sessionsStr = row.sessionsCount
            ? `${toArabicDigits(row.sessionsCount)} ${row.sessionsCount === 1 ? 'جلسة' : row.sessionsCount === 2 ? 'جلستان' : row.sessionsCount <= 10 ? 'جلسات' : 'جلسة'}`
            : '';

        el.innerHTML = `
            ${badgeHtml}
            <div class="row-info">
                <div class="row-name">${escapeHtml(row.userName)}</div>
                ${streakHtml}
            </div>
            <div class="row-time">
                ${timeStr}
                ${sessionsStr ? `<small>${sessionsStr}</small>` : ''}
            </div>
        `;

        el.addEventListener('click', () => openUserModal(row.userName));
        leaderboardList.appendChild(el);
    });
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
}

/* ---------- Personal stats modal ---------- */

const modalOverlay = document.getElementById('modal-overlay');
const modalClose = document.getElementById('modal-close');
const modalAvatar = document.getElementById('modal-avatar');
const modalTitle = document.getElementById('modal-title');
const modalSubtitle = document.getElementById('modal-subtitle');
const statTotal = document.getElementById('stat-total');
const statAverage = document.getElementById('stat-average');
const statLongest = document.getElementById('stat-longest');
const statCurrent = document.getElementById('stat-current');
const weeklyChart = document.getElementById('weekly-chart');

modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => {
    if (e.target === modalOverlay) closeModal();
});
window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && modalOverlay.classList.contains('active')) closeModal();
});

function openModal() {
    modalOverlay.classList.add('active');
    modalOverlay.setAttribute('aria-hidden', 'false');
}

function closeModal() {
    modalOverlay.classList.remove('active');
    modalOverlay.setAttribute('aria-hidden', 'true');
}

async function openUserModal(userName) {
    // Reset to loading state
    modalAvatar.textContent = userName.trim().charAt(0) || '?';
    modalTitle.textContent = userName;
    modalSubtitle.textContent = 'جاري تحميل البيانات…';
    statTotal.textContent = '—';
    statAverage.textContent = '—';
    statLongest.textContent = '—';
    statCurrent.textContent = '—';
    weeklyChart.innerHTML = '';
    openModal();

    if (CONFIG.API_URL.includes('PASTE_YOUR')) {
        modalSubtitle.textContent = 'لم يتم ربط الخادم بعد';
        return;
    }

    try {
        const url = `${CONFIG.API_URL}?period=user&name=${encodeURIComponent(userName)}`;
        const res = await fetch(url);
        const data = await res.json();
        if (!data || data.error) throw new Error(data.error || 'لا توجد بيانات');

        modalSubtitle.textContent = data.joinedDate
            ? `انضم في ${formatArabicDate(data.joinedDate)}`
            : '';

        statTotal.textContent = formatTotalMinutes(data.totalMinutes || 0);
        statAverage.textContent = formatTotalMinutes(Math.round(data.avgPerDay || 0));
        statLongest.textContent = `${toArabicDigits(data.longestStreak || 0)} يوم`;
        statCurrent.textContent = `${toArabicDigits(data.currentStreak || 0)} يوم`;

        renderWeeklyChart(data.last7Days || []);
    } catch (err) {
        console.error(err);
        modalSubtitle.textContent = `تعذّر تحميل البيانات: ${err.message || err}`;
    }
}

function renderWeeklyChart(days) {
    // days: array of { date: YYYY-MM-DD, minutes: number }, oldest first, length 7.
    weeklyChart.innerHTML = '';
    const W = 350;
    const H = 160;
    const pad = { top: 14, right: 10, bottom: 36, left: 10 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;

    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
        <linearGradient id="chartBarGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#E8C763"/>
            <stop offset="100%" stop-color="#D4AF37" stop-opacity="0.6"/>
        </linearGradient>
    `;
    weeklyChart.appendChild(defs);

    const max = Math.max(60, ...days.map(d => d.minutes || 0));
    const barCount = 7;
    const slot = innerW / barCount;
    const barW = Math.min(34, slot * 0.62);

    // For RTL, draw oldest on the right, today on the left? Spec says "last 7 days".
    // We'll show oldest -> newest from RIGHT to LEFT (RTL reading order).
    days.slice(0, 7).forEach((d, i) => {
        const reversedIdx = (barCount - 1) - i; // from right to left
        const minutes = d.minutes || 0;
        const h = (minutes / max) * innerH;
        const x = pad.left + reversedIdx * slot + (slot - barW) / 2;
        const y = pad.top + (innerH - h);

        // Bar
        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', barW);
        rect.setAttribute('height', Math.max(2, h));
        rect.setAttribute('rx', 4);
        rect.setAttribute('class', 'chart-bar');
        weeklyChart.appendChild(rect);

        // Value above bar (only if > 0)
        if (minutes > 0) {
            const valueText = document.createElementNS(SVG_NS, 'text');
            valueText.setAttribute('x', x + barW / 2);
            valueText.setAttribute('y', y - 4);
            valueText.setAttribute('class', 'chart-value');
            const vh = Math.floor(minutes / 60);
            const vm = minutes % 60;
            valueText.textContent = vh > 0
                ? `${toArabicDigits(vh)}س${vm > 0 ? ` ${toArabicDigits(vm)}د` : ''}`
                : `${toArabicDigits(vm)}د`;
            weeklyChart.appendChild(valueText);
        }

        // Day label
        const date = new Date(d.date + 'T00:00:00');
        const label = document.createElementNS(SVG_NS, 'text');
        label.setAttribute('x', x + barW / 2);
        label.setAttribute('y', H - 16);
        label.setAttribute('class', 'chart-label');
        label.textContent = ARABIC_DAYS[date.getDay()].slice(0, 3);
        weeklyChart.appendChild(label);

        const dayNum = document.createElementNS(SVG_NS, 'text');
        dayNum.setAttribute('x', x + barW / 2);
        dayNum.setAttribute('y', H - 2);
        dayNum.setAttribute('class', 'chart-label');
        dayNum.style.fontSize = '10px';
        dayNum.textContent = toArabicDigits(date.getDate());
        weeklyChart.appendChild(dayNum);
    });
}

/* ---------- Page lifecycle ---------- */

// Pause auto-refresh when tab is hidden, resume when visible.
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopAutoRefresh();
    } else if (currentTab === 'leaderboard') {
        fetchLeaderboard();
        startAutoRefresh();
    }
});

// Initial readout
updateReadout();
