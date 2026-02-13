import {
  PuzzleResponse,
  GuessResponse,
  LeaderboardResponse,
  StatsResponse,
  ErrorResponse,
  Clues,
  POPULAR_SUBREDDITS,
} from "../../shared/types/api";

// DOM Elements
const postTitleEl = document.getElementById("post-title") as HTMLHeadingElement;
const postBodyEl = document.getElementById("post-body") as HTMLParagraphElement;
const puzzleNumberEl = document.getElementById("puzzle-number") as HTMLDivElement;
const guessInput = document.getElementById("guess-input") as HTMLInputElement;
const submitButton = document.getElementById("submit-button") as HTMLButtonElement;
const inputContainer = document.getElementById("input-container") as HTMLDivElement;
const autocompleteDropdown = document.getElementById("autocomplete-dropdown") as HTMLDivElement;
const progressTimeline = document.getElementById("progress-timeline") as HTMLDivElement;
const timelineEmpty = document.getElementById("timeline-empty") as HTMLDivElement;
const guessCounterEl = document.getElementById("guess-counter") as HTMLSpanElement;
const cluesSection = document.getElementById("clues-section") as HTMLDivElement;

// Clue labels for display
const clueLabels: Record<keyof Clues, string> = {
  upvoteRatio: "Upvote Ratio",
  topComment: "Top Comment",
  communityStats: "Community Stats",
  sidebarRule: "Sidebar Rule",
};

// Stats elements
const streakValueEl = document.getElementById("streak-value") as HTMLSpanElement;
const totalScoreValueEl = document.getElementById("total-score-value") as HTMLSpanElement;
const gamesPlayedValueEl = document.getElementById("games-played-value") as HTMLSpanElement;

// Modal elements
const resultsModal = document.getElementById("results-modal") as HTMLDivElement;
const modalTitle = document.getElementById("modal-title") as HTMLHeadingElement;
const correctAnswerEl = document.getElementById("correct-answer") as HTMLElement;
const finalScoreEl = document.getElementById("final-score") as HTMLSpanElement;
const guessesUsedEl = document.getElementById("guesses-used") as HTMLSpanElement;
const shareButton = document.getElementById("share-button") as HTMLButtonElement;
const viewLeaderboardButton = document.getElementById("view-leaderboard-button") as HTMLButtonElement;
const closeResultsButton = document.getElementById("close-results-button") as HTMLButtonElement;

const leaderboardModal = document.getElementById("leaderboard-modal") as HTMLDivElement;
const leaderboardBody = document.getElementById("leaderboard-body") as HTMLTableSectionElement;
const userRankDisplay = document.getElementById("user-rank-display") as HTMLDivElement;
const closeLeaderboardButton = document.getElementById("close-leaderboard-button") as HTMLButtonElement;

const noPuzzleOverlay = document.getElementById("no-puzzle-overlay") as HTMLDivElement;

// Game state
let currentPuzzleNumber = 0;
let guesses: string[] = [];
let gameCompleted = false;
let gameWon = false;
let selectedAutocompleteIndex = -1;
let filteredSubreddits: string[] = [];

// Initialize game
async function init() {
  await fetchPuzzle();
  await fetchStats();
  setupEventListeners();
}

// Fetch puzzle from server
async function fetchPuzzle() {
  try {
    const response = await fetch("/api/puzzle");

    if (response.status === 404) {
      showNoPuzzle();
      return;
    }

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as PuzzleResponse | ErrorResponse;

    if (data.type === "error") {
      console.error("Error fetching puzzle:", data.message);
      showNoPuzzle();
      return;
    }

    if (data.type === "puzzle") {
      renderPuzzle(data);
    }
  } catch (error) {
    console.error("Error fetching puzzle:", error);
    showNoPuzzle();
  }
}

// Render puzzle data
function renderPuzzle(data: PuzzleResponse) {
  currentPuzzleNumber = data.puzzleNumber;
  puzzleNumberEl.textContent = `#${data.puzzleNumber}`;
  postTitleEl.textContent = data.postTitle;
  postBodyEl.textContent = data.postBody || "";

  // Restore game state
  guesses = data.gameState.guesses;
  gameCompleted = data.gameState.completed;
  gameWon = data.gameState.won;

  // Update clues and render timeline
  updateRevealedClues(data.revealedClues);
  renderTimeline();

  // Handle completed game
  if (gameCompleted && data.correctSubreddit) {
    inputContainer.classList.add("hidden");
    // Delay to ensure DOM is ready
    setTimeout(() => revealRedactBlock(data.correctSubreddit!), 100);
    showResultsModal(data.correctSubreddit, data.gameState.score, guesses.length, gameWon);
  }
}

// Reveal the redact block when game is over
function revealRedactBlock(subreddit: string) {
  const redactBlock = document.querySelector(".redact-block");
  if (redactBlock) {
    redactBlock.textContent = subreddit;
    redactBlock.classList.add("revealed");
  }
}

// Store revealed clues for rendering
let currentRevealedClues: Partial<Clues> = {};

// Render the guesses timeline
function renderTimeline() {
  // Update guess counter
  guessCounterEl.textContent = `${guesses.length}/5 guesses`;

  // Show/hide empty state
  if (guesses.length === 0) {
    timelineEmpty.style.display = "block";
    const existingItems = progressTimeline.querySelectorAll(".timeline-item, .timeline-pending");
    existingItems.forEach(item => item.remove());
    return;
  }

  timelineEmpty.style.display = "none";

  // Build timeline HTML (guesses only, no clues)
  let timelineHTML = "";

  guesses.forEach((guess, index) => {
    const isLastGuess = index === guesses.length - 1;
    const isCorrect = isLastGuess && gameWon;

    timelineHTML += `
      <div class="timeline-item ${isCorrect ? "correct" : "wrong"}">
        <div class="timeline-guess">
          <span class="timeline-number">${index + 1}</span>
          <span class="timeline-subreddit">r/${guess}</span>
          <span class="timeline-result">${isCorrect ? "✓" : "✗"}</span>
        </div>
      </div>
    `;
  });

  // Add pending guess indicator if game not complete
  if (!gameCompleted && guesses.length < 5) {
    timelineHTML += `
      <div class="timeline-pending">
        <span class="timeline-number">${guesses.length + 1}</span>
        <span>Your next guess...</span>
      </div>
    `;
  }

  // Update timeline
  const existingItems = progressTimeline.querySelectorAll(".timeline-item, .timeline-pending");
  existingItems.forEach(item => item.remove());
  timelineEmpty.insertAdjacentHTML("afterend", timelineHTML);

  // Render clues separately
  renderClues();
}

// Render clues below the post content
function renderClues() {
  const clueOrder: (keyof Clues)[] = ["upvoteRatio", "topComment", "communityStats", "sidebarRule"];

  let cluesHTML = "";

  clueOrder.forEach((clueKey) => {
    if (currentRevealedClues[clueKey]) {
      cluesHTML += `
        <div class="clue-item">
          <div class="clue-label">${clueLabels[clueKey]}</div>
          <div class="clue-text">${currentRevealedClues[clueKey]}</div>
        </div>
      `;
    }
  });

  cluesSection.innerHTML = cluesHTML;
}

// Update clues storage (called when we get new clue data)
function updateRevealedClues(revealedClues: Partial<Clues>) {
  currentRevealedClues = revealedClues;
}

// Fetch user stats
async function fetchStats() {
  try {
    const response = await fetch("/api/stats");
    if (!response.ok) return;

    const data = await response.json() as StatsResponse | ErrorResponse;

    if (data.type === "stats") {
      streakValueEl.textContent = data.stats.currentStreak.toString();
      totalScoreValueEl.textContent = data.stats.totalScore.toString();
      gamesPlayedValueEl.textContent = data.stats.gamesPlayed.toString();
    }
  } catch (error) {
    console.error("Error fetching stats:", error);
  }
}

// Submit guess
async function submitGuess() {
  const guess = guessInput.value.trim();

  if (!guess) {
    shakeInput();
    return;
  }

  submitButton.disabled = true;

  try {
    const response = await fetch("/api/guess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ guess }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json() as GuessResponse | ErrorResponse;

    if (data.type === "error") {
      console.error("Error submitting guess:", data.message);
      shakeInput();
      return;
    }

    if (data.type === "guess") {
      handleGuessResponse(data);
    }
  } catch (error) {
    console.error("Error submitting guess:", error);
    shakeInput();
  } finally {
    submitButton.disabled = false;
    guessInput.value = "";
    hideAutocomplete();
  }
}

// Handle guess response
function handleGuessResponse(data: GuessResponse) {
  guesses = data.guesses;
  gameCompleted = data.completed;
  gameWon = data.correct;

  updateRevealedClues(data.revealedClues);
  renderTimeline();

  if (data.completed && data.correctSubreddit) {
    inputContainer.classList.add("hidden");
    revealRedactBlock(data.correctSubreddit);

    // Delay showing modal for dramatic effect
    setTimeout(() => {
      showResultsModal(data.correctSubreddit!, data.score, guesses.length, data.correct);
    }, 500);

    // Refresh stats
    fetchStats();
  }
}

// Show results modal
function showResultsModal(correctAnswer: string, score: number, guessCount: number, won: boolean) {
  modalTitle.textContent = won ? "Solved!" : "Game Over";
  modalTitle.classList.toggle("failed", !won);
  correctAnswerEl.textContent = `r/${correctAnswer}`;
  finalScoreEl.textContent = score.toString();
  guessesUsedEl.textContent = guessCount.toString();

  resultsModal.classList.add("visible");
}

// Hide results modal
function hideResultsModal() {
  resultsModal.classList.remove("visible");
}

// Show leaderboard modal
async function showLeaderboardModal() {
  leaderboardModal.classList.add("visible");
  await fetchLeaderboard();
}

// Hide leaderboard modal
function hideLeaderboardModal() {
  leaderboardModal.classList.remove("visible");
}

// Fetch leaderboard
async function fetchLeaderboard() {
  leaderboardBody.innerHTML = '<tr><td colspan="4" class="loading-row">Loading...</td></tr>';

  try {
    const response = await fetch("/api/leaderboard");
    if (!response.ok) throw new Error("Failed to fetch leaderboard");

    const data = await response.json() as LeaderboardResponse | ErrorResponse;

    if (data.type === "error") {
      leaderboardBody.innerHTML = '<tr><td colspan="4" class="loading-row">Failed to load</td></tr>';
      return;
    }

    if (data.type === "leaderboard") {
      renderLeaderboard(data);
    }
  } catch (error) {
    console.error("Error fetching leaderboard:", error);
    leaderboardBody.innerHTML = '<tr><td colspan="4" class="loading-row">Failed to load</td></tr>';
  }
}

// Render leaderboard
function renderLeaderboard(data: LeaderboardResponse) {
  if (data.entries.length === 0) {
    leaderboardBody.innerHTML = '<tr><td colspan="4" class="loading-row">No entries yet</td></tr>';
    userRankDisplay.textContent = "";
    return;
  }

  leaderboardBody.innerHTML = data.entries.map(entry => {
    const rankClass = entry.rank <= 3 ? `rank-${entry.rank}` : "";
    return `
      <tr>
        <td class="rank-cell ${rankClass}">${entry.rank}</td>
        <td>${entry.username}</td>
        <td>${entry.guessCount}/5</td>
        <td>${entry.score}</td>
      </tr>
    `;
  }).join("");

  if (data.userRank) {
    userRankDisplay.textContent = `Your rank: #${data.userRank}`;
  } else {
    userRankDisplay.textContent = "";
  }
}

// Share results
function shareResults() {
  const emojiGrid = guesses.map((_, index) => {
    if (index === guesses.length - 1 && gameWon) {
      return "🟩";
    }
    return "🟥";
  }).join(" ");

  const emptySlots = Array(5 - guesses.length).fill("⬜").join(" ");
  const grid = guesses.length < 5 ? `${emojiGrid} ${emptySlots}` : emojiGrid;

  const text = `r/edact #${currentPuzzleNumber} - ${gameWon ? guesses.length : "X"}/5\n\n${grid}\n\nPlay at: reddit.com/r/redact`;

  if (navigator.share) {
    navigator.share({ text });
  } else if (navigator.clipboard) {
    navigator.clipboard.writeText(text);
    // Show copied feedback
    const originalText = shareButton.textContent;
    shareButton.textContent = "Copied!";
    setTimeout(() => {
      shareButton.textContent = originalText;
    }, 2000);
  }
}

// Autocomplete functionality
function updateAutocomplete() {
  const query = guessInput.value.trim().toLowerCase();

  if (query.length === 0) {
    hideAutocomplete();
    return;
  }

  filteredSubreddits = POPULAR_SUBREDDITS
    .filter(sub => sub.toLowerCase().includes(query))
    .slice(0, 8);

  if (filteredSubreddits.length === 0) {
    hideAutocomplete();
    return;
  }

  selectedAutocompleteIndex = -1;

  autocompleteDropdown.innerHTML = filteredSubreddits.map((sub, index) => `
    <div class="autocomplete-item" data-index="${index}" data-value="${sub}">
      <span class="prefix">r/</span>${sub}
    </div>
  `).join("");

  autocompleteDropdown.classList.add("visible");
}

function hideAutocomplete() {
  autocompleteDropdown.classList.remove("visible");
  selectedAutocompleteIndex = -1;
  filteredSubreddits = [];
}

function selectAutocompleteItem(value: string) {
  guessInput.value = value;
  hideAutocomplete();
  guessInput.focus();
}

function navigateAutocomplete(direction: "up" | "down") {
  if (filteredSubreddits.length === 0) return;

  const items = autocompleteDropdown.querySelectorAll(".autocomplete-item");

  if (direction === "down") {
    selectedAutocompleteIndex = Math.min(selectedAutocompleteIndex + 1, filteredSubreddits.length - 1);
  } else {
    selectedAutocompleteIndex = Math.max(selectedAutocompleteIndex - 1, -1);
  }

  items.forEach((item, index) => {
    item.classList.toggle("selected", index === selectedAutocompleteIndex);
  });

  if (selectedAutocompleteIndex >= 0) {
    guessInput.value = filteredSubreddits[selectedAutocompleteIndex];
  }
}

// Show no puzzle overlay
function showNoPuzzle() {
  noPuzzleOverlay.classList.add("visible");
}

// Shake input animation
function shakeInput() {
  const wrapper = document.querySelector(".input-wrapper") as HTMLDivElement;
  wrapper.classList.add("shake");
  setTimeout(() => wrapper.classList.remove("shake"), 300);
}

// Event listeners
function setupEventListeners() {
  // Submit guess
  submitButton.addEventListener("click", submitGuess);

  guessInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (selectedAutocompleteIndex >= 0 && filteredSubreddits.length > 0) {
        selectAutocompleteItem(filteredSubreddits[selectedAutocompleteIndex]);
      } else {
        submitGuess();
      }
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      navigateAutocomplete("down");
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      navigateAutocomplete("up");
      e.preventDefault();
    } else if (e.key === "Escape") {
      hideAutocomplete();
    }
  });

  // Autocomplete
  guessInput.addEventListener("input", updateAutocomplete);

  guessInput.addEventListener("blur", () => {
    // Delay to allow click on autocomplete item
    setTimeout(hideAutocomplete, 150);
  });

  autocompleteDropdown.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const item = target.closest(".autocomplete-item") as HTMLDivElement;
    if (item) {
      selectAutocompleteItem(item.dataset.value!);
    }
  });

  // Modals
  closeResultsButton.addEventListener("click", hideResultsModal);
  shareButton.addEventListener("click", shareResults);
  viewLeaderboardButton.addEventListener("click", () => {
    hideResultsModal();
    showLeaderboardModal();
  });

  closeLeaderboardButton.addEventListener("click", hideLeaderboardModal);

  // Close modals on overlay click
  resultsModal.addEventListener("click", (e) => {
    if (e.target === resultsModal) hideResultsModal();
  });

  leaderboardModal.addEventListener("click", (e) => {
    if (e.target === leaderboardModal) hideLeaderboardModal();
  });
}

// Reset game for testing - triple click puzzle number to reset game state
// 5 clicks = refresh puzzle from GitHub + reset game state
let resetClickCount = 0;
let resetClickTimer: number | null = null;

puzzleNumberEl.addEventListener("click", async () => {
  resetClickCount++;

  if (resetClickTimer) {
    clearTimeout(resetClickTimer);
  }

  if (resetClickCount >= 5) {
    // 5 clicks: refresh puzzle from GitHub AND reset game state
    resetClickCount = 0;
    try {
      await fetch("/api/admin/refresh-puzzle", { method: "POST" });
      await fetch("/api/reset", { method: "POST" });
      window.location.reload();
    } catch (error) {
      console.error("Refresh error:", error);
    }
  } else if (resetClickCount >= 3) {
    // 3 clicks: just reset game state
    resetClickCount = 0;
    try {
      const response = await fetch("/api/reset", { method: "POST" });
      if (response.ok) {
        window.location.reload();
      }
    } catch (error) {
      console.error("Reset error:", error);
    }
  } else {
    resetClickTimer = window.setTimeout(() => {
      resetClickCount = 0;
    }, 500);
  }
});

// Start the game
init();
