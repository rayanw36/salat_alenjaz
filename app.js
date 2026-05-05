/* ============================================================
   صالة الإنجاز — Frontend logic
   ============================================================ */

const CONFIG = {
    API_URL: "https://script.google.com/macros/s/AKfycbxp_3hap9wK6YWWSnE1BI80g7oG3Gi0aEjOYr-Svjs9dxuSlDfB66q7AY_7NCgjk58TIw/exec",
    AUTO_REFRESH_INTERVAL: 60000,
    POMO_STUDY_SECONDS: 75 * 60,
    POMO_BREAK_SECONDS: 15 * 60,
};

/* ---------- Arabic helpers ---------- */

const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

function toArabicDigits(input) {
    return String(input).replace(/[0-9]/g, d => ARABIC_DIGITS[+d]);
}

function pad2Arabic(n) {
    return toArabicDigits(String(n).padStart(2, '0'));
}

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

/* ---------- Layout: desktop two-column vs mobile tabs ---------- */

const desktopMQ = window.matchMedia('(min-width: 1024px)');
const isDesktop = () => desktopMQ.matches;

const tabButtons = document.querySelectorAll('.tab');
const panels = {
    log: document.getElementById('panel-log'),
    leaderboard: document.getElementById('panel-leaderboard'),
};

let currentTab = 'log';

function applyLayoutMode() {
    if (isDesktop()) {
        // Both panels visible; hidden attribute is overridden by CSS
        Object.values(panels).forEach(p => {
            p.hidden = false;
            p.classList.add('active');
        });
        // Ensure leaderboard is always populated and refreshing
        fetchLeaderboard();
        startAutoRefresh();
    } else {
        Object.entries(panels).forEach(([key, panel]) => {
            const active = key === currentTab;
            panel.hidden = !active;
            panel.classList.toggle('active', active);
        });
        if (currentTab === 'leaderboard') {
            fetchLeaderboard();
            startAutoRefresh();
        } else {
            stopAutoRefresh();
        }
    }
}

function switchTab(tabName) {
    if (tabName === currentTab && !isDesktop()) return;
    currentTab = tabName;

    tabButtons.forEach(btn => {
        const active = btn.dataset.tab === tabName;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active);
    });

    applyLayoutMode();
}

tabButtons.forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

desktopMQ.addEventListener('change', applyLayoutMode);

/* ---------- Clock construction ---------- */

const clock = document.querySelector('.clock');
const ticksGroup = document.getElementById('clock-ticks');
const numeralsGroup = document.getElementById('clock-numerals');
const hourGroup = document.getElementById('hour-hand-group');
const minuteGroup = document.getElementById('minute-hand-group');
const hourHand = hourGroup.querySelector('.hour-hand');
const hourKnob = hourGroup.querySelector('.hour-knob');
const hourKnobInner = hourGroup.querySelector('.hand-knob-inner');
const hourKnobValue = hourGroup.querySelector('.hour-knob-value');
const hourKnobLabel = hourGroup.querySelector('.hour-knob-label');
const minuteHand = minuteGroup.querySelector('.minute-hand');
const minuteKnob = minuteGroup.querySelector('.minute-knob');
const minuteKnobInner = minuteGroup.querySelector('.hand-knob-inner');
const minuteKnobValue = minuteGroup.querySelector('.minute-knob-value');
const minuteKnobLabel = minuteGroup.querySelector('.minute-knob-label');
const readoutTime = document.getElementById('readout-time');
const stepValueHour = document.getElementById('step-value-hour');
const stepValueMinute = document.getElementById('step-value-minute');

const CLOCK_CENTER = 200;
const CLOCK_RADIUS = 180;
const HOUR_HAND_LENGTH = 90;
const MINUTE_HAND_LENGTH = 135;
const HOUR_LABEL_OFFSET = 32;
const MINUTE_LABEL_OFFSET = 30;
const SVG_NS = 'http://www.w3.org/2000/svg';

let selectedHours = 0;
let selectedMinutes = 0;
let dragging = null;
let userInteracted = false;

// Build minute ticks
for (let i = 0; i < 60; i++) {
    const angle = (i * 6) - 90;
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

// Build hour numerals
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
    selectedHours = Math.max(0, Math.min(12, hours));
    const angle = (selectedHours / 12) * 360 - 90;
    const rad = angle * Math.PI / 180;
    const x = CLOCK_CENTER + Math.cos(rad) * HOUR_HAND_LENGTH;
    const y = CLOCK_CENTER + Math.sin(rad) * HOUR_HAND_LENGTH;
    hourHand.setAttribute('x2', x);
    hourHand.setAttribute('y2', y);
    hourKnob.setAttribute('cx', x);
    hourKnob.setAttribute('cy', y);
    hourKnobInner.setAttribute('cx', x);
    hourKnobInner.setAttribute('cy', y);
    hourKnobValue.setAttribute('x', x);
    hourKnobValue.setAttribute('y', y);
    // Label below the knob, but pushed outward radially so it never crosses center.
    const labelX = CLOCK_CENTER + Math.cos(rad) * (HOUR_HAND_LENGTH + HOUR_LABEL_OFFSET);
    const labelY = CLOCK_CENTER + Math.sin(rad) * (HOUR_HAND_LENGTH + HOUR_LABEL_OFFSET);
    hourKnobLabel.setAttribute('x', labelX);
    hourKnobLabel.setAttribute('y', labelY);
    hourKnobValue.textContent = toArabicDigits(Math.round(selectedHours));
    hourGroup.setAttribute('aria-valuenow', Math.round(selectedHours));
    updateReadout();
}

function setMinuteHand(minutes) {
    selectedMinutes = Math.max(0, Math.min(59, Math.round(minutes)));
    const angle = (selectedMinutes / 60) * 360 - 90;
    const rad = angle * Math.PI / 180;
    const x = CLOCK_CENTER + Math.cos(rad) * MINUTE_HAND_LENGTH;
    const y = CLOCK_CENTER + Math.sin(rad) * MINUTE_HAND_LENGTH;
    minuteHand.setAttribute('x2', x);
    minuteHand.setAttribute('y2', y);
    minuteKnob.setAttribute('cx', x);
    minuteKnob.setAttribute('cy', y);
    minuteKnobInner.setAttribute('cx', x);
    minuteKnobInner.setAttribute('cy', y);
    minuteKnobValue.setAttribute('x', x);
    minuteKnobValue.setAttribute('y', y);
    const labelX = CLOCK_CENTER + Math.cos(rad) * (MINUTE_HAND_LENGTH + MINUTE_LABEL_OFFSET);
    const labelY = CLOCK_CENTER + Math.sin(rad) * (MINUTE_HAND_LENGTH + MINUTE_LABEL_OFFSET);
    minuteKnobLabel.setAttribute('x', labelX);
    minuteKnobLabel.setAttribute('y', labelY);
    minuteKnobValue.textContent = pad2Arabic(selectedMinutes);
    minuteGroup.setAttribute('aria-valuenow', selectedMinutes);
    updateReadout();
}

function updateReadout() {
    const hr = Math.round(selectedHours);
    readoutTime.textContent = formatDuration(hr, selectedMinutes);
    stepValueHour.textContent = toArabicDigits(hr);
    stepValueMinute.textContent = pad2Arabic(selectedMinutes);
}

function killHints() {
    if (userInteracted) return;
    userInteracted = true;
    document.querySelectorAll('.hand-knob.hint').forEach(k => k.classList.remove('hint'));
}

/* ---------- Drag interaction ---------- */

function pointToAngle(clientX, clientY) {
    const rect = clock.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = clientX - cx;
    const dy = clientY - cy;
    let deg = Math.atan2(dy, dx) * 180 / Math.PI;
    deg = (deg + 90 + 360) % 360;
    return deg;
}

function onPointerDown(e, which) {
    e.preventDefault();
    dragging = which;
    killHints();
    const target = which === 'hour' ? hourGroup : minuteGroup;
    target.classList.add('dragging');
    try { target.setPointerCapture(e.pointerId); } catch (_) {}
}

function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    const angle = pointToAngle(e.clientX, e.clientY);

    if (dragging === 'hour') {
        let hours = (angle / 360) * 12;
        hours = Math.round(hours);
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
    try { target.releasePointerCapture(e.pointerId); } catch (_) {}
    dragging = null;
}

hourGroup.addEventListener('pointerdown', e => onPointerDown(e, 'hour'));
minuteGroup.addEventListener('pointerdown', e => onPointerDown(e, 'minute'));
window.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
window.addEventListener('pointercancel', onPointerUp);

// Tap on clock face (not on hands) sets the minute hand.
clock.addEventListener('pointerdown', e => {
    if (dragging) return;
    if (e.target.closest('.hand-group')) return;
    killHints();
    const angle = pointToAngle(e.clientX, e.clientY);
    let minutes = Math.round((angle / 360) * 60);
    if (minutes >= 60) minutes = 0;
    setMinuteHand(minutes);
});

// Keyboard accessibility for hands
hourGroup.addEventListener('keydown', e => {
    let h = selectedHours;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') h = Math.min(12, h + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') h = Math.max(0, h - 1);
    else if (e.key === 'Home') h = 0;
    else if (e.key === 'End') h = 12;
    else return;
    e.preventDefault();
    killHints();
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
    killHints();
    setMinuteHand(m);
});

// Initialize
setHourHand(0);
setMinuteHand(0);

/* ---------- Stepper buttons ---------- */

document.querySelectorAll('.step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        killHints();
        const step = parseInt(btn.dataset.step, 10);
        const target = btn.dataset.target;
        if (target === 'hour') {
            setHourHand(Math.max(0, Math.min(12, Math.round(selectedHours) + step)));
        } else {
            let m = selectedMinutes + step;
            // wrap minutes within 0-59 without affecting hours
            if (m < 0) m = 0;
            if (m > 59) m = 59;
            setMinuteHand(m);
        }
    });
});

/* ---------- Quick presets ---------- */

document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        killHints();
        setHourHand(parseInt(btn.dataset.h, 10));
        setMinuteHand(parseInt(btn.dataset.m, 10));
    });
});

/* ---------- Form fields ---------- */

const nameInput = document.getElementById('user-name');
const dateInput = document.getElementById('session-date');
const dateDisplay = document.getElementById('date-display');
const submitBtn = document.getElementById('btn-submit');

const savedName = localStorage.getItem('salat_user_name');
if (savedName) nameInput.value = savedName;

nameInput.addEventListener('change', () => {
    localStorage.setItem('salat_user_name', nameInput.value.trim());
});

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

/* ---------- Submission (optimistic UX) ---------- */

submitBtn.addEventListener('click', () => {
    const userName = nameInput.value.trim();
    const date = dateInput.value;
    const hours = Math.round(selectedHours);
    const minutes = selectedMinutes;
    const totalMinutes = hours * 60 + minutes;

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

    // Optimistic: show success quickly, then sync.
    fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ userName, date, hours, minutes }),
    })
    .then(r => r.json())
    .then(data => {
        if (!data.success) throw new Error(data.error || 'حدث خطأ غير متوقع');
        localStorage.setItem('salat_user_name', userName);
        showToast('تم تسجيل جلستك بنجاح! بارك الله في وقتك ✨', 'success');
        launchConfetti();
        setHourHand(0);
        setMinuteHand(0);
        // Refresh leaderboard immediately (cache will be invalidated server-side)
        invalidateLeaderboardCache();
        if (!isDesktop()) {
            setTimeout(() => switchTab('leaderboard'), 900);
        } else {
            fetchLeaderboard();
        }
    })
    .catch(err => {
        console.error(err);
        showToast(`تعذّر التسجيل: ${err.message || err}`, 'error');
    })
    .finally(() => {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
    });
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
const CONFETTI_COLORS = ['#B8941F', '#D4AF37', '#E8C763', '#F5DA8C'];

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

/* ============================================================
   Pomodoro timer
   ============================================================ */

const pomoTimeEl = document.getElementById('pomo-time');
const pomoPhaseEl = document.getElementById('pomo-phase');
const pomoRingEl = document.getElementById('pomo-ring-progress');
const pomoToggleBtn = document.getElementById('pomo-toggle');
const pomoToggleIcon = document.getElementById('pomo-icon');
const pomoToggleLabel = document.getElementById('pomo-toggle-label');
const pomoSkipBtn = document.getElementById('pomo-skip');
const pomoResetBtn = document.getElementById('pomo-reset');
const pomoCounterEl = document.getElementById('pomo-counter');
const pomoCyclesEl = document.getElementById('pomo-cycles');

const POMO_RING_CIRCUMFERENCE = 540.354; // 2π × 86

let pomoState = 'idle';   // idle | running | paused
let pomoPhase = 'study';  // study | break
let pomoRemaining = CONFIG.POMO_STUDY_SECONDS;
let pomoTotal = CONFIG.POMO_STUDY_SECONDS;
let pomoTickHandle = null;
let pomoLastTickTs = 0;

function getPomoCyclesToday() {
    return parseInt(localStorage.getItem(`pomo_cycles_${todayISO()}`) || '0', 10);
}

function setPomoCyclesToday(n) {
    localStorage.setItem(`pomo_cycles_${todayISO()}`, String(n));
    updatePomoCounter();
}

function updatePomoCounter() {
    const n = getPomoCyclesToday();
    if (n > 0) {
        pomoCounterEl.hidden = false;
        pomoCyclesEl.textContent = toArabicDigits(n);
    } else {
        pomoCounterEl.hidden = true;
    }
}

function formatPomoTime(seconds) {
    const total = Math.ceil(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${pad2Arabic(m)}:${pad2Arabic(s)}`;
}

function updatePomoDisplay() {
    pomoTimeEl.textContent = formatPomoTime(pomoRemaining);

    // Phase label & ring color
    if (pomoPhase === 'study') {
        pomoPhaseEl.textContent = pomoState === 'running' ? 'وقت التركيز' :
                                  pomoState === 'paused' ? 'متوقف مؤقتاً' : 'جاهز للبدء';
        pomoPhaseEl.classList.remove('break');
        pomoRingEl.classList.remove('break');
    } else {
        pomoPhaseEl.textContent = pomoState === 'running' ? 'وقت الراحة' :
                                  pomoState === 'paused' ? 'الراحة متوقفة' : 'انتهت الراحة';
        pomoPhaseEl.classList.add('break');
        pomoRingEl.classList.add('break');
    }

    // Toggle button label & icon
    if (pomoState === 'running') {
        pomoToggleIcon.textContent = '⏸';
        pomoToggleLabel.textContent = 'إيقاف مؤقت';
        pomoToggleBtn.classList.add('running');
    } else if (pomoState === 'paused') {
        pomoToggleIcon.textContent = '▶';
        pomoToggleLabel.textContent = 'متابعة';
        pomoToggleBtn.classList.remove('running');
    } else {
        pomoToggleIcon.textContent = '▶';
        pomoToggleLabel.textContent = pomoPhase === 'study' ? 'ابدأ التركيز' : 'ابدأ الراحة';
        pomoToggleBtn.classList.remove('running');
    }

    // Ring progress
    const progress = pomoTotal > 0 ? pomoRemaining / pomoTotal : 0;
    pomoRingEl.style.strokeDashoffset = String(POMO_RING_CIRCUMFERENCE * (1 - progress));

    // Sync focus mode if open
    if (typeof syncFocusDisplay === 'function') syncFocusDisplay();
}

function startPomoInterval() {
    if (pomoTickHandle) return;
    pomoLastTickTs = Date.now();
    pomoTickHandle = setInterval(pomoTick, 250);
}

function stopPomoInterval() {
    if (pomoTickHandle) {
        clearInterval(pomoTickHandle);
        pomoTickHandle = null;
    }
}

function pomoTick() {
    const now = Date.now();
    const delta = (now - pomoLastTickTs) / 1000;
    pomoLastTickTs = now;
    pomoRemaining = Math.max(0, pomoRemaining - delta);
    updatePomoDisplay();

    if (pomoRemaining <= 0.001) {
        completePomoPhase();
    }
}

function completePomoPhase() {
    stopPomoInterval();
    playBell();
    if (navigator.vibrate) navigator.vibrate([180, 80, 180]);

    if (pomoPhase === 'study') {
        const cycles = getPomoCyclesToday() + 1;
        setPomoCyclesToday(cycles);
        // Auto-add 75 minutes to the clock for easy logging
        addStudyMinutesToClock(75);
        showToast('أحسنت! ٧٥ دقيقة تركيز ✨ تمّت إضافتها لجلستك. وقت الراحة ☕', 'success', 5000);
        // Switch to break
        pomoPhase = 'break';
        pomoTotal = CONFIG.POMO_BREAK_SECONDS;
        pomoRemaining = CONFIG.POMO_BREAK_SECONDS;
        pomoState = 'running';
        startPomoInterval();
    } else {
        showToast('انتهت الراحة! جاهز لجلسة جديدة؟', 'info', 4000);
        pomoPhase = 'study';
        pomoTotal = CONFIG.POMO_STUDY_SECONDS;
        pomoRemaining = CONFIG.POMO_STUDY_SECONDS;
        pomoState = 'idle';
    }
    updatePomoDisplay();
}

function addStudyMinutesToClock(minutes) {
    const totalNow = Math.round(selectedHours) * 60 + selectedMinutes + minutes;
    const newH = Math.min(12, Math.floor(totalNow / 60));
    const newM = totalNow >= 12 * 60 ? 59 : totalNow % 60;
    setHourHand(newH);
    setMinuteHand(newM);
}

function togglePomo() {
    if (pomoState === 'idle' || pomoState === 'paused') {
        pomoState = 'running';
        startPomoInterval();
    } else {
        pomoState = 'paused';
        stopPomoInterval();
    }
    updatePomoDisplay();
}

function resetPomo() {
    stopPomoInterval();
    pomoState = 'idle';
    pomoPhase = 'study';
    pomoTotal = CONFIG.POMO_STUDY_SECONDS;
    pomoRemaining = CONFIG.POMO_STUDY_SECONDS;
    updatePomoDisplay();
}

function skipPomo() {
    if (pomoState === 'idle') return;
    completePomoPhase();
}

pomoToggleBtn.addEventListener('click', togglePomo);
pomoSkipBtn.addEventListener('click', skipPomo);
pomoResetBtn.addEventListener('click', resetPomo);

// Focus mode — full-page timer + leaderboard
const focusOverlay = document.getElementById('focus-overlay');
const focusCloseBtn = document.getElementById('focus-close');
const focusExpandBtn = document.getElementById('pomo-expand');
const focusTimeEl = document.getElementById('focus-time');
const focusPhaseEl = document.getElementById('focus-phase');
const focusRingEl = document.getElementById('focus-ring-progress');
const focusToggleBtn = document.getElementById('focus-toggle');
const focusToggleIcon = document.getElementById('focus-icon');
const focusToggleLabel = document.getElementById('focus-toggle-label');
const focusSkipBtn = document.getElementById('focus-skip-btn');
const focusResetBtn = document.getElementById('focus-reset-btn');
const focusCounterEl = document.getElementById('focus-counter');
const focusCyclesEl = document.getElementById('focus-cycles');
const focusLeaderboardList = document.getElementById('focus-leaderboard-list');

let focusMode = false;

focusExpandBtn.addEventListener('click', enterFocusMode);
focusCloseBtn.addEventListener('click', exitFocusMode);
focusToggleBtn.addEventListener('click', togglePomo);
focusSkipBtn.addEventListener('click', skipPomo);
focusResetBtn.addEventListener('click', resetPomo);

document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && focusMode) exitFocusMode();
});

function enterFocusMode() {
    focusMode = true;
    focusOverlay.hidden = false;
    document.body.style.overflow = 'hidden';
    syncFocusDisplay();
    loadFocusLeaderboard();
}

function exitFocusMode() {
    focusMode = false;
    focusOverlay.hidden = true;
    document.body.style.overflow = '';
}

function syncFocusDisplay() {
    if (!focusMode) return;
    focusTimeEl.textContent = formatPomoTime(pomoRemaining);

    if (pomoPhase === 'study') {
        focusPhaseEl.textContent = pomoState === 'running' ? 'وقت التركيز' :
                                   pomoState === 'paused' ? 'متوقف مؤقتاً' : 'جاهز للبدء';
        focusPhaseEl.classList.remove('break');
        focusRingEl.classList.remove('break');
    } else {
        focusPhaseEl.textContent = pomoState === 'running' ? 'وقت الراحة' :
                                   pomoState === 'paused' ? 'الراحة متوقفة' : 'انتهت الراحة';
        focusPhaseEl.classList.add('break');
        focusRingEl.classList.add('break');
    }

    if (pomoState === 'running') {
        focusToggleIcon.textContent = '⏸';
        focusToggleLabel.textContent = 'إيقاف مؤقت';
        focusToggleBtn.classList.add('running');
    } else if (pomoState === 'paused') {
        focusToggleIcon.textContent = '▶';
        focusToggleLabel.textContent = 'متابعة';
        focusToggleBtn.classList.remove('running');
    } else {
        focusToggleIcon.textContent = '▶';
        focusToggleLabel.textContent = pomoPhase === 'study' ? 'ابدأ التركيز' : 'ابدأ الراحة';
        focusToggleBtn.classList.remove('running');
    }

    const progress = pomoTotal > 0 ? pomoRemaining / pomoTotal : 0;
    focusRingEl.style.strokeDashoffset = String(POMO_RING_CIRCUMFERENCE * (1 - progress));

    const n = getPomoCyclesToday();
    if (n > 0) {
        focusCounterEl.hidden = false;
        focusCyclesEl.textContent = toArabicDigits(n);
    } else {
        focusCounterEl.hidden = true;
    }
}

// Focus mode period filter
let focusPeriod = 'today';
const focusPeriodBtns = document.querySelectorAll('.focus-period-btn');

focusPeriodBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        if (btn.classList.contains('active')) return;
        focusPeriod = btn.dataset.period;
        focusPeriodBtns.forEach(b => b.classList.toggle('active', b === btn));
        loadFocusLeaderboard();
    });
});

function loadFocusLeaderboard() {
    if (CONFIG.API_URL.includes('PASTE_YOUR')) {
        focusLeaderboardList.innerHTML = '<div class="leaderboard-empty"><p>لم يتم ربط الخادم</p></div>';
        return;
    }
    const cacheKey = `lb_cache_${focusPeriod}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try { renderFocusLeaderboard(JSON.parse(cached)); } catch (_) {}
    }
    fetch(`${CONFIG.API_URL}?period=${encodeURIComponent(focusPeriod)}`)
        .then(r => r.json())
        .then(data => {
            if (Array.isArray(data)) {
                try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch (_) {}
                renderFocusLeaderboard(data);
            }
        })
        .catch(() => {});
}

function renderFocusLeaderboard(rows) {
    if (!rows || rows.length === 0) {
        focusLeaderboardList.innerHTML = '<div class="leaderboard-empty"><div class="leaderboard-empty-icon">📚</div><p>لا توجد جلسات بعد</p></div>';
        return;
    }
    focusLeaderboardList.innerHTML = '';
    rows.slice(0, 10).forEach((row, idx) => {
        const rank = idx + 1;
        const el = document.createElement('div');
        el.className = `leaderboard-row rank-${rank}`;
        let badgeHtml;
        if (rank === 1) badgeHtml = '<div class="rank-badge medal-gold">🥇</div>';
        else if (rank === 2) badgeHtml = '<div class="rank-badge medal-silver">🥈</div>';
        else if (rank === 3) badgeHtml = '<div class="rank-badge medal-bronze">🥉</div>';
        else badgeHtml = `<div class="rank-badge muted">${toArabicDigits(rank)}</div>`;
        el.innerHTML = `
            ${badgeHtml}
            <div class="row-info"><div class="row-name">${escapeHtml(row.userName)}</div></div>
            <div class="row-time">${formatTotalMinutes(row.totalMinutes || 0)}</div>
        `;
        focusLeaderboardList.appendChild(el);
    });
}

// Bell sound via Web Audio API (no external file)
let audioCtx = null;
function playBell() {
    try {
        if (!audioCtx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) return;
            audioCtx = new Ctx();
        }
        const t = audioCtx.currentTime;
        // Two-note chime
        [900, 600].forEach((freq, i) => {
            const o = audioCtx.createOscillator();
            const g = audioCtx.createGain();
            o.type = 'sine';
            o.frequency.value = freq;
            g.gain.setValueAtTime(0.0001, t + i * 0.18);
            g.gain.exponentialRampToValueAtTime(0.25, t + i * 0.18 + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.5);
            o.connect(g);
            g.connect(audioCtx.destination);
            o.start(t + i * 0.18);
            o.stop(t + i * 0.18 + 0.5);
        });
    } catch (_) {}
}

// Initial Pomodoro UI
updatePomoDisplay();
updatePomoCounter();

/* ============================================================
   Leaderboard (with stale-while-revalidate cache)
   ============================================================ */

const leaderboardList = document.getElementById('leaderboard-list');
const refreshBtn = document.getElementById('btn-refresh');
const periodButtons = document.querySelectorAll('.period-btn');

let currentPeriod = 'today';
let autoRefreshTimer = null;
let activeFetchController = null;

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
    invalidateLeaderboardCache();
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

function invalidateLeaderboardCache() {
    ['today', 'week', 'month', 'all'].forEach(p => {
        localStorage.removeItem(`lb_cache_${p}`);
    });
}

function fetchLeaderboard() {
    if (CONFIG.API_URL.includes('PASTE_YOUR')) {
        renderLeaderboardError('لم يتم ربط الخادم بعد. عدّل CONFIG.API_URL في app.js');
        return;
    }

    // Show cached data immediately for perceived speed
    const cacheKey = `lb_cache_${currentPeriod}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
        try {
            const data = JSON.parse(cached);
            renderLeaderboard(data, /* stale */ true);
        } catch (_) {
            renderSkeleton();
        }
    } else {
        renderSkeleton();
    }

    // Cancel any in-flight request for the same list
    if (activeFetchController) activeFetchController.abort();
    activeFetchController = new AbortController();

    fetch(`${CONFIG.API_URL}?period=${encodeURIComponent(currentPeriod)}`, {
        signal: activeFetchController.signal,
    })
    .then(r => r.json())
    .then(data => {
        if (!Array.isArray(data)) {
            throw new Error(data.error || 'استجابة غير متوقعة من الخادم');
        }
        try { localStorage.setItem(cacheKey, JSON.stringify(data)); } catch (_) {}
        renderLeaderboard(data, /* stale */ false);
    })
    .catch(err => {
        if (err.name === 'AbortError') return;
        console.error(err);
        if (!cached) {
            renderLeaderboardError(`تعذّر تحميل اللوحة: ${err.message || err}`);
        }
    });
}

function renderSkeleton() {
    leaderboardList.classList.remove('stale');
    leaderboardList.innerHTML = '';
    for (let i = 0; i < 4; i++) {
        const sk = document.createElement('div');
        sk.className = 'lb-skeleton';
        leaderboardList.appendChild(sk);
    }
}

function renderLeaderboardError(msg) {
    leaderboardList.classList.remove('stale');
    leaderboardList.innerHTML = `
        <div class="leaderboard-empty">
            <div class="leaderboard-empty-icon">⚠️</div>
            <p>${msg}</p>
        </div>
    `;
}

function renderLeaderboard(rows, stale) {
    leaderboardList.classList.toggle('stale', !!stale);

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
        el.style.animationDelay = `${Math.min(idx, 6) * 50}ms`;
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
        const sessionsCount = row.sessionsCount || 0;
        const sessionsStr = sessionsCount
            ? `${toArabicDigits(sessionsCount)} ${sessionsCount === 1 ? 'جلسة' : sessionsCount === 2 ? 'جلستان' : sessionsCount <= 10 ? 'جلسات' : 'جلسة'}`
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
    weeklyChart.innerHTML = '';
    const W = 350;
    const H = 160;
    const pad = { top: 14, right: 10, bottom: 36, left: 10 };
    const innerW = W - pad.left - pad.right;
    const innerH = H - pad.top - pad.bottom;

    const defs = document.createElementNS(SVG_NS, 'defs');
    defs.innerHTML = `
        <linearGradient id="chartBarGradient" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#D4AF37"/>
            <stop offset="100%" stop-color="#B8941F" stop-opacity="0.7"/>
        </linearGradient>
    `;
    weeklyChart.appendChild(defs);

    const max = Math.max(60, ...days.map(d => d.minutes || 0));
    const barCount = 7;
    const slot = innerW / barCount;
    const barW = Math.min(34, slot * 0.62);

    days.slice(0, 7).forEach((d, i) => {
        const reversedIdx = (barCount - 1) - i;
        const minutes = d.minutes || 0;
        const h = (minutes / max) * innerH;
        const x = pad.left + reversedIdx * slot + (slot - barW) / 2;
        const y = pad.top + (innerH - h);

        const rect = document.createElementNS(SVG_NS, 'rect');
        rect.setAttribute('x', x);
        rect.setAttribute('y', y);
        rect.setAttribute('width', barW);
        rect.setAttribute('height', Math.max(2, h));
        rect.setAttribute('rx', 4);
        rect.setAttribute('class', 'chart-bar');
        weeklyChart.appendChild(rect);

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

document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        stopAutoRefresh();
    } else {
        applyLayoutMode();
    }
});

// Initial layout
applyLayoutMode();
updateReadout();
