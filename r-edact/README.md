# r/edact

A daily subreddit guessing game for Reddit, built with Devvit.

## How to Play

1. You're shown a Reddit post with the subreddit name hidden
2. Guess which subreddit the post came from
3. You have **5 guesses** to find the correct answer
4. Each wrong guess reveals a clue to help you narrow it down

### Clues (revealed after wrong guesses)

1. **Upvote Ratio** - How well-received was this post?
2. **Top Comment** - What did the community say?
3. **Community Stats** - How big and old is this subreddit?
4. **Sidebar Rule** - A distinctive rule from the subreddit

### Scoring

- 1st guess correct: **5 points**
- 2nd guess correct: **4 points**
- 3rd guess correct: **3 points**
- 4th guess correct: **2 points**
- 5th guess correct: **1 point**
- Failed: **0 points**

## Features

- **Daily Puzzles** - New puzzle every day
- **Leaderboard** - Compete with other players
- **Streak Tracking** - Keep your winning streak alive
- **Share Results** - Wordle-style emoji grid to share with friends
- **Autocomplete** - Search from 700+ popular subreddits

## Tech Stack

- **Devvit** - Reddit's Developer Platform
- **TypeScript** - Client and server code
- **Express** - Server-side routing
- **Redis** - Persistent storage for puzzles, game state, and leaderboards
- **Vite** - Build tooling

## Project Structure

```
r-edact/
├── src/
│   ├── client/           # Frontend
│   │   ├── game.html     # Main game page
│   │   └── game/
│   │       ├── game.ts   # Game logic
│   │       └── game.css  # Styling
│   ├── server/           # Backend
│   │   ├── index.ts      # API endpoints
│   │   └── core/
│   │       └── post.ts   # Post creation
│   └── shared/
│       └── types/
│           └── api.ts    # Shared types
├── devvit.yaml           # Devvit configuration
└── package.json
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/puzzle` | GET | Get today's puzzle |
| `/api/guess` | POST | Submit a guess |
| `/api/leaderboard` | GET | Get daily leaderboard |
| `/api/stats` | GET | Get user stats |
| `/api/admin/set-puzzle` | POST | Set today's puzzle (admin) |

## Development

### Prerequisites

- Node.js 22+
- npm
- Devvit CLI (`npm install -g devvit`)

### Setup

```bash
cd r-edact
npm install
```

### Run locally

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Deploy

```bash
npm run deploy
```

## Puzzle Generation

Puzzles are generated using a Python script that:
1. Fetches interesting Reddit posts via AI-powered search
2. Redacts subreddit-identifying information
3. Collects clue data (upvote ratio, top comment, community stats, rules)
4. Outputs a JSON payload ready for the API

```bash
cd ..
pip install -r requirements.txt
python reddit_post_guess.py
```

This creates a `puzzle.json` file that can be POSTed to `/api/admin/set-puzzle`.

## Commands

- `npm run dev`: Starts a development server where you can develop your application live on Reddit
- `npm run build`: Builds your client and server projects
- `npm run deploy`: Uploads a new version of your app
- `npm run launch`: Publishes your app for review
- `npm run login`: Logs your CLI into Reddit
- `npm run check`: Type checks, lints, and prettifies your app

## License

MIT
