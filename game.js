document.addEventListener('DOMContentLoaded', () => {
    // Game settings
    const WORD_LENGTH = 5;
    // No ATTEMPTS constant as we now have infinite attempts
    let answerWords = [];
    let allowedGuesses = [];
    let solution = '';
    let currentRow = 0;
    let currentTile = 0;
    let gameOver = false;
    let isAnimating = false;
    let testMode = false; // Flag to indicate test mode
    
    // State for statistics
    let gameStats = getGameStats();
    let todayGameState = getTodayGameState();

    // DOM elements
    const board = document.getElementById('board');
    const keyboard = document.getElementById('keyboard-container');
    const messageContainer = document.getElementById('message-container');
    const modals = {
        instructions: document.getElementById('instructions-modal'),
        statistics: document.getElementById('statistics-modal'),
        gameOver: document.getElementById('game-over-modal')
    };
    const closeButtons = document.querySelectorAll('.close');
    
    // Initialize the game
    async function initializeGame() {
        // Create initial rows for the board
        createInitialRows();
        
        // Add keyboard event listeners
        document.addEventListener('keydown', handleKeyPress);
        keyboard.addEventListener('click', handleKeyClick);
        
        // Set up modal controls
        document.getElementById('how-to-play').addEventListener('click', () => showModal(modals.instructions));
        document.getElementById('statistics').addEventListener('click', () => {
            updateStatistics();
            showModal(modals.statistics);
        });
        document.getElementById('share-result').addEventListener('click', shareResults);
        
        closeButtons.forEach(button => {
            button.addEventListener('click', function() {
                const modal = button.closest('.modal');
                hideModal(modal);
            });
        });

        // Load words and set today's word
        await loadWords();
        
        // Check if test mode is active and indicate it visually
        if (testMode) {
            document.querySelector('header h1').style.color = '#c9b458';
            showMessage('テストモード: ' + solution, 3000);
        }
        
        // Check if we already played today
        if (todayGameState.played) {
            // Load the existing game state
            loadGameState();
            
            if (todayGameState.gameOver) {
                setTimeout(() => {
                    displayGameOver(todayGameState.won);
                }, 500);
            }
        }
    }
    
    // Create initial rows for the board
    function createInitialRows() {
        // Start with 6 rows (standard Wordle experience)
        for (let i = 0; i < 6; i++) {
            createRow(i);
        }
    }
    
    // Create a single row with the given index
    function createRow(rowIndex) {
        const row = document.createElement('div');
        row.classList.add('row');
        row.setAttribute('data-row', rowIndex);
        
        for (let j = 0; j < WORD_LENGTH; j++) {
            const tile = document.createElement('div');
            tile.classList.add('tile');
            tile.setAttribute('data-row', rowIndex);
            tile.setAttribute('data-col', j);
            row.appendChild(tile);
        }
        
        board.appendChild(row);
        
        // Scroll to the new row (both when loading and creating new rows)
        if (rowIndex > 5) { // Only auto-scroll when adding rows beyond the initial set
            scrollToRow(rowIndex);
        }
    }
    
    // Scroll to a specific row
    function scrollToRow(rowIndex) {
        const boardContainer = document.getElementById('board-container');
        const row = document.querySelector(`.row[data-row="${rowIndex}"]`);
        if (row) {
            // Add a slight delay to ensure rendering is complete
            setTimeout(() => {
                // Calculate position to scroll the row fully into view
                const containerRect = boardContainer.getBoundingClientRect();
                const rowRect = row.getBoundingClientRect();
                const offsetBottom = rowRect.bottom - containerRect.bottom;
                
                if (offsetBottom > 0) {
                    // Need to scroll down to show the entire row
                    boardContainer.scrollTop += offsetBottom + 10; // Add extra padding
                }
            }, 100);
        }
    }
    
    // Ensure we have enough rows for the current guess
    function ensureRowExists(rowIndex) {
        if (!document.querySelector(`.row[data-row="${rowIndex}"]`)) {
            createRow(rowIndex);
        }
    }
    
    // Load words from the wordlist files
    async function loadWords() {
        try {
            // Load answer words
            const answersResponse = await fetch('answers.txt');
            const answersText = await answersResponse.text();
            answerWords = answersText.trim().split('\n');
            
            // Load allowed guesses
            const guessesResponse = await fetch('allowed_guesses.txt');
            const guessesText = await guessesResponse.text();
            allowedGuesses = guessesText.trim().split('\n');
            
            // Select today's word
            selectTodaysWord();
            
        } catch (error) {
            console.error('Error loading word lists:', error);
            showMessage('単語リストの読み込みエラー。ページを更新してください。');
        }
    }
    
    // Select a word based on today's date or test parameter
    function selectTodaysWord() {
        const today = new Date();
        const dateString = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
        
        // Check URL for test parameter
        const urlParams = new URLSearchParams(window.location.search);
        const testWord = urlParams.get('test');
        
        if (testWord && testWord.length === WORD_LENGTH) {
            // Use the test word and enable test mode
            solution = testWord.toLowerCase();
            testMode = true;
            
            // In test mode, we don't want to save the solution or state
            return;
        }
        
        // If we already have a solution for today, use it
        if (todayGameState.date === dateString && todayGameState.solution) {
            solution = todayGameState.solution;
            return;
        }
        
        // Otherwise, select a new word from the answers list
        const seed = dateString;
        const randomIndex = getRandomIndexFromSeed(seed, answerWords.length);
        solution = answerWords[randomIndex].toLowerCase().trim();
        
        // Save today's solution
        todayGameState.date = dateString;
        todayGameState.solution = solution;
        saveTodayGameState();
    }
    
    // Generate a random index from a seed value
    function getRandomIndexFromSeed(seed, max) {
        let hash = 0;
        for (let i = 0; i < seed.length; i++) {
            const char = seed.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        
        // Make sure the hash is positive and within range
        return Math.abs(hash) % max;
    }
    
    // Handle physical keyboard input
    function handleKeyPress(e) {
        if (gameOver || isAnimating) return;
        
        const key = e.key.toLowerCase();
        
        if (key === 'backspace') {
            deleteLetter();
        } else if (/^[a-z]$/.test(key)) {
            addLetter(key);
        }
    }
    
    // Handle on-screen keyboard clicks
    function handleKeyClick(e) {
        if (gameOver || isAnimating) return;
        
        const target = e.target;
        if (!target.matches('button')) return;
        
        const key = target.getAttribute('data-key');
        
        if (key === 'backspace') {
            deleteLetter();
        } else if (key !== 'enter') { // Ignore enter key clicks
            addLetter(key);
        }
    }
    
    // Add a letter to the current position
    function addLetter(letter) {
        if (currentTile < WORD_LENGTH) {
            // Make sure we have a row for the current guess
            ensureRowExists(currentRow);
            
            const tile = getTileElement(currentRow, currentTile);
            tile.textContent = letter;
            tile.classList.add('filled');
            
            currentTile++;
            
            // Auto-submit when we have 5 letters
            if (currentTile === WORD_LENGTH) {
                submitGuess();
            }
        }
    }
    
    // Delete the last letter
    function deleteLetter() {
        if (currentTile > 0) {
            currentTile--;
            const tile = getTileElement(currentRow, currentTile);
            tile.textContent = '';
            tile.classList.remove('filled');
        }
    }
    
    // Submit the current guess
    function submitGuess() {
        // Check if the row is complete (should always be true with auto-submit)
        if (currentTile !== WORD_LENGTH) {
            return;
        }
        
        // Get the current word
        let word = '';
        for (let i = 0; i < WORD_LENGTH; i++) {
            word += getTileElement(currentRow, i).textContent;
        }
        word = word.toLowerCase();
        
        // Check if word is in the list of allowed guesses or answers
        if (!answerWords.some(w => w.trim().toLowerCase() === word) && 
            !allowedGuesses.some(w => w.trim().toLowerCase() === word)) {
            showMessage('単語リストにありません');
            shakeRow(currentRow);
            // Clear the current guess so the user can try again
            for (let i = 0; i < WORD_LENGTH; i++) {
                const tile = getTileElement(currentRow, i);
                tile.textContent = '';
                tile.classList.remove('filled');
            }
            currentTile = 0;
            return;
        }
        
        // Evaluate the guess and animate tiles
        isAnimating = true;
        evaluateGuess(word);
    }
    
    // Evaluate the current guess
    function evaluateGuess(guess) {
        const solutionChars = solution.split('');
        const guessChars = guess.split('');
        
        // Create a map to track letter frequencies in the solution
        const letterFrequency = {};
        solutionChars.forEach(char => {
            letterFrequency[char] = (letterFrequency[char] || 0) + 1;
        });
        
        // First pass: Find correct placements
        const results = Array(WORD_LENGTH).fill('absent');
        for (let i = 0; i < WORD_LENGTH; i++) {
            if (guessChars[i] === solutionChars[i]) {
                results[i] = 'correct';
                letterFrequency[guessChars[i]]--;
            }
        }
        
        // Second pass: Find present but wrong position
        for (let i = 0; i < WORD_LENGTH; i++) {
            if (results[i] === 'absent' && letterFrequency[guessChars[i]] && letterFrequency[guessChars[i]] > 0) {
                results[i] = 'present';
                letterFrequency[guessChars[i]]--;
            }
        }
        
        // Animate tiles and update keyboard
        animateTiles(currentRow, results, () => {
            // Store the guess result
            todayGameState.guesses.push({
                word: guess,
                results: results
            });
            
            // Update keyboard colors
            updateKeyboard(guessChars, results);
            
            // Check if the game is over
            const isCorrect = results.every(result => result === 'correct');
            if (isCorrect) {
                gameWon();
            } else {
                // Move to the next row (infinite guesses)
                currentRow++;
                currentTile = 0;
                isAnimating = false;
                
                // Create the next row immediately
                ensureRowExists(currentRow);
                
                // Ensure we scroll to show the new row properly
                scrollToRow(currentRow);
                
                // Save game state
                saveTodayGameState();
            }
        });
    }
    
    // Animate the tiles flipping
    function animateTiles(row, results, callback) {
        let delay = 0;
        
        for (let i = 0; i < WORD_LENGTH; i++) {
            const tile = getTileElement(row, i);
            
            setTimeout(() => {
                tile.classList.add('flip');
                
                setTimeout(() => {
                    tile.classList.add(results[i]);
                    
                    // When the last tile is done, call the callback
                    if (i === WORD_LENGTH - 1) {
                        setTimeout(callback, 500);
                    }
                }, 250); // Mid-flip
            }, delay);
            
            delay += 250;
        }
    }
    
    // Update keyboard colors
    function updateKeyboard(guessChars, results) {
        for (let i = 0; i < WORD_LENGTH; i++) {
            const key = guessChars[i];
            const keyButton = document.querySelector(`button[data-key="${key}"]`);
            const result = results[i];
            
            if (keyButton) {
                // Only upgrade the key color (absent → present → correct)
                if (result === 'correct') {
                    keyButton.classList.remove('present', 'absent');
                    keyButton.classList.add('correct');
                } else if (result === 'present' && !keyButton.classList.contains('correct')) {
                    keyButton.classList.remove('absent');
                    keyButton.classList.add('present');
                } else if (!keyButton.classList.contains('correct') && !keyButton.classList.contains('present')) {
                    keyButton.classList.add('absent');
                }
            }
        }
    }
    
    // Handle a game win
    function gameWon() {
        gameOver = true;
        isAnimating = false;
        
        // Update statistics
        gameStats.played++;
        gameStats.wins++;
        gameStats.currentStreak++;
        gameStats.maxStreak = Math.max(gameStats.maxStreak, gameStats.currentStreak);
        
        // Check if we need to extend the distribution array
        if (currentRow >= Object.keys(gameStats.distribution).length) {
            gameStats.distribution[currentRow] = 1;
        } else {
            gameStats.distribution[currentRow] = (gameStats.distribution[currentRow] || 0) + 1;
        }
        
        saveGameStats();
        
        // Mark the game as complete
        todayGameState.played = true;
        todayGameState.gameOver = true;
        todayGameState.won = true;
        saveTodayGameState();
        
        // Show win message
        setTimeout(() => {
            displayGameOver(true);
        }, 1500);
    }
    
    // Handle a game loss
    function gameLost() {
        // This function is no longer needed as we have infinite guesses
        // It's kept for compatibility but should never be called
    }
    
    // Display game over modal
    function displayGameOver(won) {
        document.getElementById('game-over-message').textContent = 
            `${currentRow + 1}回で正解しました！`;
        document.getElementById('solution-word').textContent = solution;
        
        // Update the countdown
        updateCountdown('game-over-countdown');
        
        showModal(modals.gameOver);
    }
    
    // Share results
    function shareResults() {
        const emoji = {
            'correct': '🟩',
            'present': '🟨',
            'absent': '⬛'
        };
        
        let text = `Wordle Clone ${todayGameState.date} ${currentRow + 1} guesses\n\n`;
        
        for (const guess of todayGameState.guesses) {
            text += guess.results.map(result => emoji[result]).join('') + '\n';
        }
        
        // Copy to clipboard
        navigator.clipboard.writeText(text).then(() => {
            showMessage('結果がクリップボードにコピーされました！');
        }).catch(() => {
            showMessage('結果のコピーに失敗しました');
        });
    }

    // Get a tile element by row and column
    function getTileElement(row, col) {
        return document.querySelector(`.tile[data-row="${row}"][data-col="${col}"]`);
    }
    
    // Show a message to the user
    function showMessage(message, duration = 2000) {
        messageContainer.textContent = message;
        messageContainer.classList.add('show');
        
        setTimeout(() => {
            messageContainer.classList.remove('show');
        }, duration);
    }
    
    // Shake a row when the guess is invalid
    function shakeRow(row) {
        const rowElement = board.children[row];
        rowElement.style.animation = 'shake 0.5s';
        
        setTimeout(() => {
            rowElement.style.animation = '';
        }, 500);
    }
    
    // Show a modal
    function showModal(modal) {
        modal.style.display = 'block';
    }
    
    // Hide a modal
    function hideModal(modal) {
        modal.style.display = 'none';
    }
    
    // Load the game state from the previous guesses
    function loadGameState() {
        // Create enough rows for all previous guesses plus one more for the next guess
        for (let r = 0; r <= todayGameState.guesses.length; r++) {
            ensureRowExists(r);
        }
        
        // No extra row needed as ensureRowExists already creates the next row needed
        
        // Load previous guesses
        for (let r = 0; r < todayGameState.guesses.length; r++) {
            const guess = todayGameState.guesses[r];
            const word = guess.word;
            const results = guess.results;
            
            // Fill in the tiles
            for (let c = 0; c < WORD_LENGTH; c++) {
                const tile = getTileElement(r, c);
                tile.textContent = word[c];
                tile.classList.add('filled');
                tile.classList.add(results[c]);
            }
            
            // Update the keyboard
            updateKeyboard(word.split(''), results);
        }
        
        // Set the current row and tile
        currentRow = todayGameState.guesses.length;
        currentTile = 0;
        
        // Always scroll to current row to ensure it's visible
        setTimeout(() => {
            scrollToRow(currentRow);
        }, 300); // Longer delay to make sure everything is rendered
        
        // If the game is over, set the game state
        if (todayGameState.gameOver) {
            gameOver = true;
        }
    }
    
    // Update the statistics display
    function updateStatistics() {
        document.getElementById('played').textContent = gameStats.played;
        document.getElementById('win-percentage').textContent = gameStats.played > 0 ? 
            Math.round((gameStats.wins / gameStats.played) * 100) : 0;
        document.getElementById('current-streak').textContent = gameStats.currentStreak;
        document.getElementById('max-streak').textContent = gameStats.maxStreak;
        
        // Update the guess distribution
        const distributionContainer = document.getElementById('guess-distribution');
        distributionContainer.innerHTML = '';
        
        // Find the max value in distribution
        const maxValue = Math.max(...Object.values(gameStats.distribution));
        
        // Create distribution bars for all recorded guess counts
        const guessNumbers = Object.keys(gameStats.distribution).map(Number).sort((a, b) => a - b);
        for (const i of guessNumbers) {
            const count = gameStats.distribution[i] || 0;
            
            const bar = document.createElement('div');
            bar.classList.add('guess-bar');
            
            const label = document.createElement('div');
            label.classList.add('guess-label');
            label.textContent = i + 1;
            
            const countElement = document.createElement('div');
            countElement.classList.add('guess-count');
            if (count === maxValue && count > 0) {
                countElement.classList.add('max');
            }
            countElement.textContent = count;
            countElement.style.width = count > 0 ? `${(count / maxValue) * 100}%` : '30px';
            
            bar.appendChild(label);
            bar.appendChild(countElement);
            distributionContainer.appendChild(bar);
        }
        
        // Update the countdown
        updateCountdown('countdown');
    }
    
    // Update the countdown to the next day
    function updateCountdown(elementId) {
        const now = new Date();
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        
        const timeLeft = tomorrow - now;
        
        const hours = Math.floor(timeLeft / (1000 * 60 * 60));
        const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((timeLeft % (1000 * 60)) / 1000);
        
        document.getElementById(elementId).textContent = 
            `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        
        if (elementId === 'countdown') {
            setTimeout(() => updateCountdown(elementId), 1000);
        }
    }
    
    // Get game statistics from local storage
    function getGameStats() {
        const stats = localStorage.getItem('wordleStats');
        
        if (stats) {
            return JSON.parse(stats);
        } else {
            // Default statistics with an empty distribution object
            // to handle infinite attempts
            return {
                played: 0,
                wins: 0,
                currentStreak: 0,
                maxStreak: 0,
                distribution: {}
            };
        }
    }
    
    // Save game statistics to local storage
    function saveGameStats() {
        // Don't save stats if we're in test mode
        if (testMode) return;
        
        localStorage.setItem('wordleStats', JSON.stringify(gameStats));
    }
    
    // Get today's game state from local storage
    function getTodayGameState() {
        const state = localStorage.getItem('wordleState');
        
        if (state) {
            const savedState = JSON.parse(state);
            const today = new Date();
            const dateString = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
            
            // Check if the saved state is from today
            if (savedState.date === dateString) {
                return savedState;
            }
        }
        
        // Default game state
        return {
            date: '',
            solution: '',
            played: false,
            gameOver: false,
            won: false,
            guesses: []
        };
    }
    
    // Save today's game state to local storage
    function saveTodayGameState() {
        // Don't save the state if we're in test mode
        if (testMode) return;
        
        localStorage.setItem('wordleState', JSON.stringify(todayGameState));
    }
    
    // Initialize the game when the DOM is loaded
    initializeGame();
});