import express from "express";
import {
  InitResponse,
  PuzzleResponse,
  GuessResponse,
  LeaderboardResponse,
  StatsResponse,
  SetPuzzleRequest,
  SetPuzzleResponse,
  ErrorResponse,
  Puzzle,
  GameState,
  UserStats,
  Clues,
} from "../shared/types/api";
import {
  createServer,
  context,
  getServerPort,
  reddit,
  redis,
} from "@devvit/web/server";
import { createPost } from "./core/post";

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());

const router = express.Router();

// Helper functions
function getTodayDate(): string {
  return new Date().toISOString().split("T")[0];
}

function getScoreForGuesses(guessCount: number, won: boolean): number {
  if (!won) return 0;
  const scores = [5, 4, 3, 2, 1];
  return scores[guessCount - 1] || 0;
}

function getRevealedClues(clues: Clues, guessCount: number): Partial<Clues> {
  const revealed: Partial<Clues> = {};
  if (guessCount >= 1) revealed.upvoteRatio = clues.upvoteRatio;
  if (guessCount >= 2) revealed.topComment = clues.topComment;
  if (guessCount >= 3) revealed.communityStats = clues.communityStats;
  if (guessCount >= 4) revealed.sidebarRule = clues.sidebarRule;
  return revealed;
}

async function incrementPuzzleNumber(): Promise<number> {
  return await redis.incrBy("puzzle:number", 1);
}

// Fetch today's puzzle from GitHub (always fresh, no Redis cache)
async function fetchTodaysPuzzle(): Promise<Puzzle | null> {
  const today = getTodayDate();
  const url = `https://raw.githubusercontent.com/themaanas/r-edact/main/puzzles/${today}.json`;

  try {
    console.log(`Fetching puzzle from: ${url}`);
    const response = await fetch(url);
    if (response.ok) {
      const puzzle = await response.json() as Puzzle;
      // Assign puzzle number if not present
      if (!puzzle.puzzleNumber) {
        puzzle.puzzleNumber = await incrementPuzzleNumber();
      }
      return puzzle;
    }
    console.log(`No puzzle found for ${today}`);
  } catch (error) {
    console.log("Failed to fetch puzzle:", error);
  }
  return null;
}

// GET /api/init - Initialize game session
router.get<object, InitResponse | ErrorResponse>("/api/init", async (_req, res): Promise<void> => {
  const { postId } = context;

  if (!postId) {
    res.status(400).json({ type: "error", message: "postId is required" });
    return;
  }

  try {
    const username = await reddit.getCurrentUsername();
    res.json({
      type: "init",
      postId,
      username: username ?? "anonymous",
    });
  } catch (error) {
    console.error("Init error:", error);
    res.status(500).json({ type: "error", message: "Failed to initialize" });
  }
});

// GET /api/puzzle - Get today's puzzle from GitHub + game state from Redis
router.get<object, PuzzleResponse | ErrorResponse>("/api/puzzle", async (_req, res): Promise<void> => {
  try {
    const userId = context.userId;
    if (!userId) {
      res.status(401).json({ type: "error", message: "User not authenticated" });
      return;
    }

    // Fetch puzzle from GitHub (always fresh)
    const puzzle = await fetchTodaysPuzzle();
    if (!puzzle) {
      res.status(404).json({ type: "error", message: "No puzzle available for today" });
      return;
    }

    // Get or create game state from Redis
    const today = getTodayDate();
    const gameStateKey = `user:${userId}:game:${today}`;
    let gameStateData = await redis.get(gameStateKey);
    let gameState: GameState;

    if (gameStateData) {
      gameState = JSON.parse(gameStateData);
    } else {
      gameState = {
        guesses: [],
        completed: false,
        won: false,
        score: 0,
      };
      await redis.set(gameStateKey, JSON.stringify(gameState));
    }

    const response: PuzzleResponse = {
      type: "puzzle",
      postTitle: puzzle.postTitle,
      postBody: puzzle.postBody || "",
      puzzleNumber: puzzle.puzzleNumber,
      revealedClues: getRevealedClues(puzzle.clues, gameState.guesses.length),
      gameState,
    };

    // Include correct answer if game is completed
    if (gameState.completed) {
      response.correctSubreddit = puzzle.correctSubreddit;
    }

    res.json(response);
  } catch (error) {
    console.error("Puzzle error:", error);
    res.status(500).json({ type: "error", message: "Failed to get puzzle" });
  }
});

// POST /api/guess - Submit a guess
router.post<object, GuessResponse | ErrorResponse, { guess: string }>("/api/guess", async (req, res): Promise<void> => {
  try {
    const userId = context.userId;
    if (!userId) {
      res.status(401).json({ type: "error", message: "User not authenticated" });
      return;
    }

    const { guess } = req.body;
    if (!guess || typeof guess !== "string") {
      res.status(400).json({ type: "error", message: "Invalid guess" });
      return;
    }

    const today = getTodayDate();
    const gameStateKey = `user:${userId}:game:${today}`;
    const statsKey = `user:${userId}:stats`;
    const leaderboardKey = `leaderboard:${today}`;

    // Get puzzle from GitHub
    const puzzle = await fetchTodaysPuzzle();
    if (!puzzle) {
      res.status(404).json({ type: "error", message: "No puzzle available" });
      return;
    }

    // Get game state
    let gameStateData = await redis.get(gameStateKey);
    let gameState: GameState = gameStateData
      ? JSON.parse(gameStateData)
      : { guesses: [], completed: false, won: false, score: 0 };

    // Check if already completed
    if (gameState.completed) {
      res.status(400).json({ type: "error", message: "Game already completed" });
      return;
    }

    // Check if max guesses reached
    if (gameState.guesses.length >= 5) {
      res.status(400).json({ type: "error", message: "No guesses remaining" });
      return;
    }

    // Normalize guess (remove r/ prefix if present, lowercase compare)
    const normalizedGuess = guess.replace(/^r\//, "").toLowerCase();
    const normalizedAnswer = puzzle.correctSubreddit.toLowerCase();
    const correct = normalizedGuess === normalizedAnswer;

    // Add guess
    gameState.guesses.push(guess.replace(/^r\//, ""));

    // Check if game is over
    const isLastGuess = gameState.guesses.length >= 5;
    if (correct || isLastGuess) {
      gameState.completed = true;
      gameState.won = correct;
      gameState.score = getScoreForGuesses(gameState.guesses.length, correct);
      gameState.completedAt = Date.now();

      // Update user stats
      let statsData = await redis.get(statsKey);
      let stats: UserStats = statsData
        ? JSON.parse(statsData)
        : { totalScore: 0, gamesPlayed: 0, currentStreak: 0, longestStreak: 0, lastWinDate: "" };

      stats.totalScore += gameState.score;
      stats.gamesPlayed += 1;

      // Update streak (only for wins)
      if (correct) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayStr = yesterday.toISOString().split("T")[0];

        if (stats.lastWinDate === yesterdayStr) {
          stats.currentStreak += 1;
        } else if (stats.lastWinDate !== today) {
          stats.currentStreak = 1;
        }

        if (stats.currentStreak > stats.longestStreak) {
          stats.longestStreak = stats.currentStreak;
        }

        stats.lastWinDate = today;
      } else {
        // Lost - reset streak
        stats.currentStreak = 0;
      }

      await redis.set(statsKey, JSON.stringify(stats));

      // Add to leaderboard (only if won)
      if (correct) {
        const username = await reddit.getCurrentUsername();
        // Score format: score * 1000000 - completedAt for tiebreaker (higher score, earlier time = better)
        const leaderboardScore = gameState.score * 1000000 + (1000000 - (Date.now() % 1000000));
        await redis.zAdd(leaderboardKey, {
          member: JSON.stringify({ userId, username: username || "anonymous", guessCount: gameState.guesses.length }),
          score: leaderboardScore,
        });
      }
    }

    // Save game state
    await redis.set(gameStateKey, JSON.stringify(gameState));

    const response: GuessResponse = {
      type: "guess",
      correct,
      guesses: gameState.guesses,
      revealedClues: getRevealedClues(puzzle.clues, gameState.guesses.length),
      score: gameState.score,
      completed: gameState.completed,
    };

    if (gameState.completed) {
      response.correctSubreddit = puzzle.correctSubreddit;
    }

    res.json(response);
  } catch (error) {
    console.error("Guess error:", error);
    res.status(500).json({ type: "error", message: "Failed to process guess" });
  }
});

// GET /api/leaderboard - Get daily leaderboard
router.get<object, LeaderboardResponse | ErrorResponse>("/api/leaderboard", async (_req, res): Promise<void> => {
  try {
    const userId = context.userId;
    const today = getTodayDate();
    const leaderboardKey = `leaderboard:${today}`;

    // Get top 20 entries (sorted by score descending)
    const entries = await redis.zRange(leaderboardKey, 0, 19, { reverse: true, by: "rank" });

    const leaderboardEntries = entries.map((entry, index) => {
      const data = JSON.parse(entry.member);
      const score = Math.floor(entry.score / 1000000);
      return {
        username: data.username,
        score,
        rank: index + 1,
        guessCount: data.guessCount,
      };
    });

    // Find user's rank if they're on the leaderboard
    let userRank: number | undefined;
    if (userId) {
      const allEntries = await redis.zRange(leaderboardKey, 0, -1, { reverse: true, by: "rank" });
      const userIndex = allEntries.findIndex((entry) => {
        const data = JSON.parse(entry.member);
        return data.userId === userId;
      });
      if (userIndex !== -1) {
        userRank = userIndex + 1;
      }
    }

    res.json({
      type: "leaderboard",
      entries: leaderboardEntries,
      userRank,
    });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({ type: "error", message: "Failed to get leaderboard" });
  }
});

// GET /api/stats - Get user stats
router.get<object, StatsResponse | ErrorResponse>("/api/stats", async (_req, res): Promise<void> => {
  try {
    const userId = context.userId;
    if (!userId) {
      res.status(401).json({ type: "error", message: "User not authenticated" });
      return;
    }

    const statsKey = `user:${userId}:stats`;
    const statsData = await redis.get(statsKey);

    const stats: UserStats = statsData
      ? JSON.parse(statsData)
      : { totalScore: 0, gamesPlayed: 0, currentStreak: 0, longestStreak: 0, lastPlayedDate: "" };

    res.json({
      type: "stats",
      stats,
    });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ type: "error", message: "Failed to get stats" });
  }
});

// POST /api/admin/set-puzzle - Manually set today's puzzle
router.post<object, SetPuzzleResponse | ErrorResponse, SetPuzzleRequest>("/api/admin/set-puzzle", async (req, res): Promise<void> => {
  try {
    const { postTitle, postBody, correctSubreddit, clues, date } = req.body;

    if (!postTitle || !correctSubreddit || !clues) {
      res.status(400).json({ type: "error", message: "Missing required fields" });
      return;
    }

    const puzzleDate = date || getTodayDate();
    const puzzleKey = `puzzle:${puzzleDate}`;

    // Check if puzzle already exists for this date
    const existing = await redis.get(puzzleKey);
    let puzzleNumber: number;

    if (existing) {
      // Update existing puzzle, keep puzzle number
      const existingPuzzle: Puzzle = JSON.parse(existing);
      puzzleNumber = existingPuzzle.puzzleNumber;
    } else {
      // New puzzle, increment number
      puzzleNumber = await incrementPuzzleNumber();
    }

    const puzzle: Puzzle = {
      postTitle,
      postBody,
      correctSubreddit,
      clues,
      puzzleNumber,
    };

    await redis.set(puzzleKey, JSON.stringify(puzzle));

    res.json({
      type: "setPuzzle",
      success: true,
      date: puzzleDate,
      puzzleNumber,
    });
  } catch (error) {
    console.error("Set puzzle error:", error);
    res.status(500).json({ type: "error", message: "Failed to set puzzle" });
  }
});

// POST /api/reset - Reset game state for testing
router.post<object, { success: boolean } | ErrorResponse>("/api/reset", async (_req, res): Promise<void> => {
  try {
    const userId = context.userId;
    if (!userId) {
      res.status(401).json({ type: "error", message: "User not authenticated" });
      return;
    }

    const today = getTodayDate();
    const gameStateKey = `user:${userId}:game:${today}`;

    await redis.del(gameStateKey);

    res.json({ success: true });
  } catch (error) {
    console.error("Reset error:", error);
    res.status(500).json({ type: "error", message: "Failed to reset" });
  }
});

// Keep existing post creation endpoints
router.post("/internal/on-app-install", async (_req, res): Promise<void> => {
  try {
    const post = await createPost();
    res.json({
      status: "success",
      message: `Post created in subreddit ${context.subredditName} with id ${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({ status: "error", message: "Failed to create post" });
  }
});

router.post("/internal/menu/post-create", async (_req, res): Promise<void> => {
  try {
    const post = await createPost();
    res.json({
      navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${post.id}`,
    });
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    res.status(400).json({ status: "error", message: "Failed to create post" });
  }
});

app.use(router);

const server = createServer(app);
server.on("error", (err) => console.error(`server error; ${err.stack}`));
server.listen(getServerPort());
