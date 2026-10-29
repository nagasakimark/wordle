document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    /* ============================================================
       SETTINGS
       ============================================================ */
    const WORD_LENGTH = 5;
    const VISIBLE_ROWS = 6;          // rows shown at start (more are added as needed)
    const HINT_EMOJI_AFTER = 3;      // guesses before the emoji hint unlocks
    const HINT_MEANING_AFTER = 5;    // guesses before the Japanese meaning unlocks
    const HINT_LETTER_AFTER = 8;     // guesses before the first-letter hint unlocks
    const EPOCH = new Date(2025, 0, 1); // used to step through the word list day by day

    const WORD_INFO = window.WORD_INFO || {};

    /* ============================================================
       STATE
       ============================================================ */
    let answerWords = [];
    let allowedSet = new Set();
    let solution = '';
    let currentRow = 0;
    let currentTile = 0;
    let gameOver = false;
    let isAnimating = false;
    let testMode = false;
    let practiceMode = false;
    let guesses = [];                // [{word, results}] for the current game
    let hintsUsed = 0;
    let messageTimer = null;

    let gameStats = loadStats();
    let todayGameState = loadTodayState();
    let soundOn = safeGet('wordleSound') !== 'off';

    /* ============================================================
       DOM
       ============================================================ */
    const $ = id => document.getElementById(id);
    const board = $('board');
    const boardContainer = $('board-container');
    const keyboard = $('keyboard-container');
    const messageContainer = $('message-container');
    const hintBtn = $('hint-btn');
    const hintBox = $('hint-box');
    const modeBadge = $('mode-badge');
    const modals = {
        instructions: $('instructions-modal'),
        statistics: $('statistics-modal'),
        gameOver: $('game-over-modal')
    };

    /* ============================================================
       STORAGE HELPERS (never crash if storage is blocked)
       ============================================================ */
    function safeGet(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }
    function safeSet(key, value) {
        try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
    }

    function dateKey(d) {
        return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
    }
    function todayKey() { return dateKey(new Date()); }
    function yesterdayKey() {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return dateKey(d);
    }

    function loadStats() {
        const fallback = { played: 0, wins: 0, currentStreak: 0, maxStreak: 0, distribution: {}, lastWinDate: '' };
        try {
            const s = JSON.parse(safeGet('wordleStats'));
            if (s && typeof s === 'object') return Object.assign(fallback, s);
        } catch (e) { /* ignore */ }
        return fallback;
    }
    function saveStats() {
        if (testMode || practiceMode) return;
        safeSet('wordleStats', JSON.stringify(gameStats));
    }

    function loadTodayState() {
        try {
            const s = JSON.parse(safeGet('wordleState'));
            if (s && s.date === todayKey()) {
                s.guesses = Array.isArray(s.guesses) ? s.guesses : [];
                return s;
            }
        } catch (e) { /* ignore */ }
        return { date: '', solution: '', played: false, gameOver: false, won: false, guesses: [], hintsUsed: 0 };
    }
    function saveTodayState() {
        if (testMode || practiceMode) return;
        todayGameState.guesses = guesses;
        todayGameState.hintsUsed = hintsUsed;
        safeSet('wordleState', JSON.stringify(todayGameState));
    }

    /* ============================================================
       INIT
       ============================================================ */
    async function initializeGame() {
        document.addEventListener('keydown', handleKeyPress);
        keyboard.addEventListener('click', handleKeyClick);
        // Stop on-screen keys from keeping focus (otherwise a physical Enter
        // press would "click" the last on-screen key again).
        keyboard.addEventListener('mousedown', e => e.preventDefault());

        $('how-to-play').addEventListener('click', () => showModal(modals.instructions));
        $('statistics').addEventListener('click', () => { updateStatistics(); showModal(modals.statistics); });
        $('sound-toggle').addEventListener('click', toggleSound);
        $('share-result').addEventListener('click', shareResults);
        $('practice-btn').addEventListener('click', startPractice);
        $('stats-practice-btn').addEventListener('click', startPractice);
        $('daily-btn').addEventListener('click', startDaily);
        $('start-btn').addEventListener('click', () => hideModal(modals.instructions));
        hintBtn.addEventListener('click', useHint);

        document.querySelectorAll('.close').forEach(btn => {
            btn.addEventListener('click', () => hideModal(btn.closest('.modal')));
        });
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', e => { if (e.target === modal) hideModal(modal); });
        });

        updateSoundButton();
        await loadWords();
        if (!answerWords.length) return;

        // Test mode: ?test=apple
        const testWord = new URLSearchParams(window.location.search).get('test');
        if (testWord && /^[a-zA-Z]{5}$/.test(testWord)) {
            testMode = true;
            solution = testWord.toLowerCase();
            resetBoard();
            document.querySelector('header h1').classList.add('test');
            showMessage('テストモード: ' + solution.toUpperCase(), 3000);
            return;
        }

        startDaily();

        // First visit: show how to play
        if (!safeGet('wordleSeenHelp')) {
            safeSet('wordleSeenHelp', '1');
            showModal(modals.instructions);
        }
    }

    async function loadWords() {
        try {
            const [aRes, gRes] = await Promise.all([fetch('answers.txt'), fetch('allowed_guesses.txt')]);
            if (!aRes.ok || !gRes.ok) throw new Error('HTTP error');
            answerWords = (await aRes.text()).split(/\r?\n/).map(w => w.trim().toLowerCase()).filter(w => w.length === WORD_LENGTH);
            const guessWords = (await gRes.text()).split(/\r?\n/).map(w => w.trim().toLowerCase()).filter(Boolean);
            allowedSet = new Set([...guessWords, ...answerWords]);
        } catch (error) {
            console.error('Error loading word lists:', error);
            showMessage('ことばリストが よみこめません。ページを こうしん してね。', 6000);
        }
    }

    /* ============================================================
       WORD SELECTION
       ============================================================ */
    // Shuffle the answer list in a fixed way, then step through it one word
    // per day, so no word repeats until the whole list has been used.
    function seededShuffle(list, seed) {
        const arr = list.slice();
        let s = seed >>> 0;
        const rand = () => {
            s = (s + 0x6D2B79F5) >>> 0;
            let t = s;
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(rand() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
    }

    function wordForToday() {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const dayIndex = Math.round((today - EPOCH) / 86400000);
        const order = seededShuffle(answerWords, 20250101);
        const n = order.length;
        return order[((dayIndex % n) + n) % n];
    }

    /* ============================================================
       GAME MODES
       ============================================================ */
    function startDaily() {
        practiceMode = false;
        hideModal(modals.gameOver);
        todayGameState = loadTodayState();

        if (todayGameState.date === todayKey() && todayGameState.solution) {
            solution = todayGameState.solution;
        } else {
            solution = wordForToday();
            todayGameState = { date: todayKey(), solution, played: false, gameOver: false, won: false, guesses: [], hintsUsed: 0 };
            saveTodayState();
        }

        resetBoard();
        updateModeBadge();

        // Restore earlier guesses from today
        hintsUsed = todayGameState.hintsUsed || 0;
        todayGameState.guesses.forEach((g, r) => {
            ensureRowExists(r);
            for (let c = 0; c < WORD_LENGTH; c++) {
                const tile = getTile(r, c);
                tile.textContent = g.word[c];
                tile.classList.add('filled', g.results[c]);
            }
            updateKeyboard(g.word.split(''), g.results);
        });
        guesses = todayGameState.guesses.slice();
        currentRow = guesses.length;
        ensureRowExists(currentRow);
        updateHintButton();
        showUsedHints();

        if (todayGameState.gameOver) {
            gameOver = true;
            // The winning guess is the last one, so don't leave an empty row
            removeEmptyRowsAfter(guesses.length - 1);
            setTimeout(() => displayGameOver(), 400);
        }
        setTimeout(() => scrollToRow(currentRow), 200);
    }

    function startPractice() {
        practiceMode = true;
        hideModal(modals.gameOver);
        hideModal(modals.statistics);
        const pool = answerWords.filter(w => w !== solution && w !== todayGameState.solution);
        solution = pool[Math.floor(Math.random() * pool.length)];
        resetBoard();
        updateModeBadge();
        showMessage('れんしゅう モード！ 🎯', 1500);
    }

    function resetBoard() {
        board.innerHTML = '';
        for (let i = 0; i < VISIBLE_ROWS; i++) createRow(i);
        boardContainer.scrollTop = 0;
        document.querySelectorAll('#keyboard-container button[data-key]').forEach(b => {
            b.classList.remove('correct', 'present', 'absent');
        });
        currentRow = 0;
        currentTile = 0;
        gameOver = false;
        isAnimating = false;
        guesses = [];
        hintsUsed = 0;
        hintBox.innerHTML = '';
        hintBox.classList.remove('show');
        updateHintButton();
    }

    function updateModeBadge() {
        if (practiceMode) {
            modeBadge.textContent = '🎯 れんしゅう';
            modeBadge.className = 'mode-badge practice';
        } else {
            modeBadge.textContent = '📅 きょうの ことば';
            modeBadge.className = 'mode-badge daily';
        }
    }

    /* ============================================================
       BOARD
       ============================================================ */
    function createRow(rowIndex) {
        const row = document.createElement('div');
        row.className = 'row';
        row.dataset.row = rowIndex;
        for (let j = 0; j < WORD_LENGTH; j++) {
            const tile = document.createElement('div');
            tile.className = 'tile';
            tile.dataset.row = rowIndex;
            tile.dataset.col = j;
            row.appendChild(tile);
        }
        board.appendChild(row);
    }

    function ensureRowExists(rowIndex) {
        while (board.children.length <= rowIndex) createRow(board.children.length);
    }

    function removeEmptyRowsAfter(rowIndex) {
        // Only trims rows beyond the starting 6 so the board keeps its shape
        while (board.children.length > Math.max(VISIBLE_ROWS, rowIndex + 1)) {
            board.lastElementChild.remove();
        }
    }

    function scrollToRow(rowIndex) {
        const row = board.children[rowIndex];
        if (!row) return;
        const cRect = boardContainer.getBoundingClientRect();
        const rRect = row.getBoundingClientRect();
        if (rRect.bottom > cRect.bottom) {
            boardContainer.scrollTop += rRect.bottom - cRect.bottom + 12;
        } else if (rRect.top < cRect.top) {
            boardContainer.scrollTop -= cRect.top - rRect.top + 12;
        }
    }

    function getTile(row, col) {
        const r = board.children[row];
        return r ? r.children[col] : null;
    }

    /* ============================================================
       INPUT
       ============================================================ */
    function handleKeyPress(e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (document.querySelector('.modal.open')) {
            if (e.key === 'Escape') document.querySelectorAll('.modal.open').forEach(hideModal);
            return;
        }
        if (gameOver || isAnimating) return;

        const key = e.key.toLowerCase();
        if (key === 'backspace') {
            e.preventDefault();
            deleteLetter();
        } else if (key === 'enter') {
            e.preventDefault();
            submitGuess();
        } else if (/^[a-z]$/.test(key)) {
            addLetter(key);
            pressKeyVisual(key);
        }
    }

    function handleKeyClick(e) {
        const target = e.target.closest('button[data-key]');
        if (!target || gameOver || isAnimating) return;
        const key = target.dataset.key;
        if (key === 'backspace') deleteLetter();
        else if (key === 'enter') submitGuess();
        else addLetter(key);
    }

    function pressKeyVisual(key) {
        const btn = keyboard.querySelector(`button[data-key="${key}"]`);
        if (!btn) return;
        btn.classList.add('pressed');
        setTimeout(() => btn.classList.remove('pressed'), 120);
    }

    function addLetter(letter) {
        if (currentTile >= WORD_LENGTH) return;
        ensureRowExists(currentRow);
        const tile = getTile(currentRow, currentTile);
        tile.textContent = letter;
        tile.classList.add('filled');
        currentTile++;
        playSound('type');
        if (currentTile === WORD_LENGTH) submitGuess();   // auto-submit at 5 letters
    }

    function deleteLetter() {
        if (currentTile <= 0) return;
        currentTile--;
        const tile = getTile(currentRow, currentTile);
        tile.textContent = '';
        tile.classList.remove('filled');
    }

    /* ============================================================
       GUESSING
       ============================================================ */
    function submitGuess() {
        if (gameOver || isAnimating) return;
        if (currentTile !== WORD_LENGTH) {
            showMessage('5もじ いれてね');
            shakeRow(currentRow);
            return;
        }

        let word = '';
        for (let i = 0; i < WORD_LENGTH; i++) word += getTile(currentRow, i).textContent;
        word = word.toLowerCase();

        if (!allowedSet.has(word)) {
            // Keep the letters so the student only has to fix the mistake
            showMessage('リストに ない ことばだよ。⌫ で なおしてね', 2200);
            shakeRow(currentRow);
            playSound('bad');
            return;
        }

        isAnimating = true;
        const results = scoreGuess(word, solution);
        animateTiles(currentRow, results, () => afterReveal(word, results));
    }

    function scoreGuess(guess, answer) {
        const results = Array(WORD_LENGTH).fill('absent');
        const remaining = {};
        for (let i = 0; i < WORD_LENGTH; i++) {
            if (guess[i] === answer[i]) results[i] = 'correct';
            else remaining[answer[i]] = (remaining[answer[i]] || 0) + 1;
        }
        for (let i = 0; i < WORD_LENGTH; i++) {
            if (results[i] !== 'correct' && remaining[guess[i]] > 0) {
                results[i] = 'present';
                remaining[guess[i]]--;
            }
        }
        return results;
    }

    function afterReveal(word, results) {
        guesses.push({ word, results });
        updateKeyboard(word.split(''), results);

        if (results.every(r => r === 'correct')) {
            gameWon();
            return;
        }

        currentRow++;
        currentTile = 0;
        isAnimating = false;
        ensureRowExists(currentRow);
        setTimeout(() => scrollToRow(currentRow), 50);

        if (!practiceMode && !testMode) {
            todayGameState.played = true;
            saveTodayState();
        }

        // Friendly nudge when a hint becomes available
        if ([HINT_EMOJI_AFTER, HINT_MEANING_AFTER, HINT_LETTER_AFTER].includes(guesses.length)) {
            showMessage('💡 ヒントが つかえるよ！', 1800);
        }
        updateHintButton();
    }

    function animateTiles(row, results, callback) {
        for (let i = 0; i < WORD_LENGTH; i++) {
            const tile = getTile(row, i);
            setTimeout(() => {
                tile.classList.add('flip');
                setTimeout(() => {
                    tile.classList.add(results[i]);
                    playSound(results[i]);
                }, 250);
                setTimeout(() => tile.classList.remove('flip'), 500);
                if (i === WORD_LENGTH - 1) setTimeout(callback, 550);
            }, i * 250);
        }
    }

    function updateKeyboard(letters, results) {
        letters.forEach((key, i) => {
            const btn = keyboard.querySelector(`button[data-key="${key}"]`);
            if (!btn) return;
            const result = results[i];
            if (result === 'correct') {
                btn.classList.remove('present', 'absent');
                btn.classList.add('correct');
            } else if (result === 'present' && !btn.classList.contains('correct')) {
                btn.classList.remove('absent');
                btn.classList.add('present');
            } else if (result === 'absent' && !btn.classList.contains('correct') && !btn.classList.contains('present')) {
                btn.classList.add('absent');
            }
        });
    }

    /* ============================================================
       HINTS
       ============================================================ */
    function hintLevelsUnlocked() {
        let n = 0;
        if (guesses.length >= HINT_EMOJI_AFTER) n = 1;
        if (guesses.length >= HINT_MEANING_AFTER) n = 2;
        if (guesses.length >= HINT_LETTER_AFTER) n = 3;
        return n;
    }

    function updateHintButton() {
        const unlocked = hintLevelsUnlocked();
        const canUse = !gameOver && hintsUsed < unlocked;
        hintBtn.disabled = !canUse;
        hintBtn.classList.toggle('ready', canUse);
        if (hintsUsed >= 3) {
            hintBtn.textContent = '💡 ヒント おわり';
        } else if (canUse) {
            hintBtn.textContent = `💡 ヒント ${hintsUsed + 1}`;
        } else {
            const need = [HINT_EMOJI_AFTER, HINT_MEANING_AFTER, HINT_LETTER_AFTER][hintsUsed] - guesses.length;
            hintBtn.textContent = gameOver ? '💡 ヒント' : `💡 あと ${need}かい`;
        }
    }

    function hintHtml(level) {
        const info = WORD_INFO[solution] || [];
        if (level === 1) return `<span class="hint-chip">${info[0] || '❓'}</span>`;
        if (level === 2) return `<span class="hint-chip">${info[1] || '???'}</span>`;
        return `<span class="hint-chip">さいしょの もじ: <b>${solution[0].toUpperCase()}</b></span>`;
    }

    function showUsedHints() {
        hintBox.innerHTML = '';
        for (let i = 1; i <= hintsUsed; i++) hintBox.insertAdjacentHTML('beforeend', hintHtml(i));
        hintBox.classList.toggle('show', hintsUsed > 0);
    }

    function useHint() {
        if (hintBtn.disabled) return;
        hintsUsed++;
        showUsedHints();
        playSound('hint');
        updateHintButton();
        saveTodayState();
    }

    /* ============================================================
       WIN
       ============================================================ */
    function gameWon() {
        gameOver = true;
        isAnimating = false;
        const tries = guesses.length;

        if (!practiceMode && !testMode) {
            const today = todayKey();
            if (gameStats.lastWinDate !== today) {
                gameStats.played++;
                gameStats.wins++;
                // Streak only continues if the last win was yesterday
                gameStats.currentStreak = gameStats.lastWinDate === yesterdayKey() ? gameStats.currentStreak + 1 : 1;
                gameStats.maxStreak = Math.max(gameStats.maxStreak, gameStats.currentStreak);
                const idx = tries - 1; // stored 0-based, like the original version
                gameStats.distribution[idx] = (gameStats.distribution[idx] || 0) + 1;
                gameStats.lastWinDate = today;
                saveStats();
            }
            todayGameState.played = true;
            todayGameState.gameOver = true;
            todayGameState.won = true;
            saveTodayState();
        }

        removeEmptyRowsAfter(currentRow);
        updateHintButton();
        bounceRow(currentRow);
        playSound('win');
        setTimeout(() => {
            confetti();
            displayGameOver();
        }, 1200);
    }

    function praiseFor(tries) {
        if (tries === 1) return 'てんさい！ 🤯';
        if (tries === 2) return 'すごすぎる！ 🌟';
        if (tries === 3) return 'すばらしい！ 🎉';
        if (tries === 4) return 'すごい！ 😄';
        if (tries <= 6) return 'よくできました！ 👏';
        if (tries <= 10) return 'がんばったね！ 💪';
        return 'あきらめなかったね！ 🏅';
    }

    function displayGameOver() {
        const tries = guesses.length;
        const info = WORD_INFO[solution] || ['📖', ''];
        $('game-over-title').textContent = praiseFor(tries);
        $('game-over-message').textContent = `${tries}かいで せいかい！` + (hintsUsed ? `（ヒント ${hintsUsed}こ）` : '');
        $('word-emoji').textContent = info[0];
        $('solution-word').textContent = solution.toUpperCase();
        $('word-meaning').textContent = info[1];

        $('share-result').style.display = practiceMode || testMode ? 'none' : '';
        $('daily-countdown-box').style.display = practiceMode ? 'none' : '';
        $('daily-btn').style.display = practiceMode && !todayGameState.gameOver ? '' : 'none';
        updateCountdown();
        showModal(modals.gameOver);
    }

    /* ============================================================
       SHARE / STATS / COUNTDOWN
       ============================================================ */
    function shareResults() {
        const emoji = { correct: '🟩', present: '🟨', absent: '⬜' };
        let text = `NEW HORIZON WORDLE ${todayGameState.date} ${guesses.length}かい\n\n`;
        text += guesses.map(g => g.results.map(r => emoji[r]).join('')).join('\n');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(() => showMessage('コピーしたよ！ 📋'))
                .catch(() => showMessage('コピー できませんでした'));
        } else {
            showMessage('コピー できませんでした');
        }
    }

    function updateStatistics() {
        $('played').textContent = gameStats.played;
        $('win-percentage').textContent = gameStats.played ? Math.round(gameStats.wins / gameStats.played * 100) : 0;
        $('current-streak').textContent = currentStreakValue();
        $('max-streak').textContent = gameStats.maxStreak;

        const container = $('guess-distribution');
        container.innerHTML = '';
        const keys = Object.keys(gameStats.distribution).map(Number).sort((a, b) => a - b);
        if (!keys.length) {
            container.innerHTML = '<p class="empty-stats">まだ データが ないよ。きょうの ことばに チャレンジ！</p>';
        }
        const maxValue = Math.max(1, ...Object.values(gameStats.distribution));
        const todayIdx = todayGameState.won ? todayGameState.guesses.length - 1 : -1;
        for (const i of keys) {
            const count = gameStats.distribution[i] || 0;
            const bar = document.createElement('div');
            bar.className = 'guess-bar';
            bar.innerHTML = `<div class="guess-label">${i + 1}</div>`;
            const countEl = document.createElement('div');
            countEl.className = 'guess-count' + (i === todayIdx ? ' today' : '');
            countEl.textContent = count;
            countEl.style.width = `${Math.max(8, (count / maxValue) * 100)}%`;
            bar.appendChild(countEl);
            container.appendChild(bar);
        }
        updateCountdown();
    }

    function currentStreakValue() {
        // A streak is only "live" if the last win was today or yesterday
        const last = gameStats.lastWinDate;
        if (last && last !== todayKey() && last !== yesterdayKey()) return 0;
        return gameStats.currentStreak;
    }

    function updateCountdown() {
        const now = new Date();
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        const left = tomorrow - now;
        const h = Math.floor(left / 3600000);
        const m = Math.floor((left % 3600000) / 60000);
        const s = Math.floor((left % 60000) / 1000);
        const text = [h, m, s].map(n => String(n).padStart(2, '0')).join(':');
        $('countdown').textContent = text;
        $('game-over-countdown').textContent = text;
    }
    setInterval(() => {
        if (document.querySelector('.modal.open')) updateCountdown();
        // If the day rolls over while the page is open, load the new word
        if (!practiceMode && !testMode && todayGameState.date && todayGameState.date !== todayKey()) startDaily();
    }, 1000);

    /* ============================================================
       UI HELPERS
       ============================================================ */
    function showMessage(message, duration = 1800) {
        messageContainer.textContent = message;
        messageContainer.classList.add('show');
        clearTimeout(messageTimer);
        messageTimer = setTimeout(() => messageContainer.classList.remove('show'), duration);
    }

    function shakeRow(row) {
        const el = board.children[row];
        if (!el) return;
        el.classList.remove('shake');
        void el.offsetWidth; // restart animation
        el.classList.add('shake');
        setTimeout(() => el.classList.remove('shake'), 500);
    }

    function bounceRow(row) {
        const el = board.children[row];
        if (!el) return;
        Array.from(el.children).forEach((tile, i) => {
            setTimeout(() => tile.classList.add('bounce'), i * 100);
        });
    }

    function showModal(modal) { modal.classList.add('open'); }
    function hideModal(modal) { if (modal) modal.classList.remove('open'); }

    /* ============================================================
       CONFETTI (no library needed)
       ============================================================ */
    function confetti() {
        const canvas = $('confetti');
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
        const colors = ['#6aaa64', '#c9b458', '#ff5c8a', '#3fa9f5', '#ff9f1c', '#9b5de5'];
        const pieces = Array.from({ length: 140 }, () => ({
            x: canvas.width / 2 + (Math.random() - 0.5) * 200,
            y: canvas.height / 3,
            vx: (Math.random() - 0.5) * 14,
            vy: Math.random() * -14 - 4,
            size: 6 + Math.random() * 6,
            color: colors[Math.floor(Math.random() * colors.length)],
            rot: Math.random() * 360,
            vr: (Math.random() - 0.5) * 12
        }));
        let frame = 0;
        (function tick() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            pieces.forEach(p => {
                p.vy += 0.35;
                p.vx *= 0.99;
                p.x += p.vx;
                p.y += p.vy;
                p.rot += p.vr;
                ctx.save();
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot * Math.PI / 180);
                ctx.fillStyle = p.color;
                ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
                ctx.restore();
            });
            if (++frame < 180) requestAnimationFrame(tick);
            else ctx.clearRect(0, 0, canvas.width, canvas.height);
        })();
    }

    /* ============================================================
       SOUND (tiny beeps, toggle with the 🔊 button)
       ============================================================ */
    let audioCtx = null;
    function tone(freq, start, dur, type = 'sine', vol = 0.08) {
        const t = audioCtx.currentTime + start;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(vol, t);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        osc.connect(gain).connect(audioCtx.destination);
        osc.start(t);
        osc.stop(t + dur);
    }
    function playSound(kind) {
        if (!soundOn) return;
        try {
            audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
            switch (kind) {
                case 'type': tone(520, 0, 0.05, 'triangle', 0.04); break;
                case 'correct': tone(880, 0, 0.15); break;
                case 'present': tone(660, 0, 0.15); break;
                case 'absent': tone(300, 0, 0.12, 'triangle', 0.05); break;
                case 'bad': tone(200, 0, 0.18, 'square', 0.04); break;
                case 'hint': tone(700, 0, 0.1); tone(1000, 0.1, 0.15); break;
                case 'win': [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.12, 0.3)); break;
            }
        } catch (e) { /* audio not available */ }
    }
    function toggleSound() {
        soundOn = !soundOn;
        safeSet('wordleSound', soundOn ? 'on' : 'off');
        updateSoundButton();
        if (soundOn) playSound('hint');
    }
    function updateSoundButton() {
        const btn = $('sound-toggle');
        btn.textContent = soundOn ? '🔊' : '🔇';
        btn.title = soundOn ? 'おと オン' : 'おと オフ';
    }

    initializeGame();
});
