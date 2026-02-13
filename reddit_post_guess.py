import json
import os
from typing import Any, Dict, Optional
from openai import OpenAI

DEFAULT_MODEL = "gpt-5"
DEFAULT_OUTPUT_PATH = "reddit_posts.jsonl"
REMOVE_KEYS = {"created_utc", "selection_reason", "full_prompt"}
PROMPT_TEMPLATE = """You are fetching a single Reddit post for a guessing game.
Use your browsing or retrieval tool to access Reddit and choose a real, verifiable post.
Do not invent titles, text, scores, or URLs.

Requirements:
- Source: public Reddit text/self-post.
- Minimum karma: the post must have at least 1,000 score (upvotes minus downvotes), either positive or negative.
- The post should be interesting for a guessing game (engaging, surprising, or thought-provoking).
- Safety: must be SFW/appropriate; do not choose NSFW or explicit sexual/graphic content.
- Subreddit choice: any subreddit is allowed, including r/AskReddit, r/AmItheAsshole, r/TIFU, r/ELI5,
  r/LifeProTips, r/UnpopularOpinion, r/TodayILearned, r/Showerthoughts, r/NoStupidQuestions.
  Just make sure the post is not super obvious that it is from a specific subreddit.
- If the title or top comment includes tags like "AITA", "TIFU", "ELI5", "LPT", "TIL", "YSK", redact those tags.
- Do not avoid posts that include flair tags; just do not return the flair tag text.
- Do not select posts about the subreddit itself or other meta posts.

Redaction rules:
- Produce redacted_title and redacted_selftext where any direct or indirect hints to the subreddit are
  replaced with "[REDACTED]".
- Redact subreddit name and variants, abbreviations, hashtags, URLs, usernames, location names,
  brand names, and unique jargon if they would make the subreddit obvious.
- Keep the text readable; do not over-redact.
- Provide redaction_notes as a list of brief hints about what was removed without revealing the subreddit.
- Provide extra_redactions as a list of specific text spans you chose to redact in addition to the redacted fields.

Clue data (fetch these for game hints):
- upvote_ratio: The post's upvote percentage (e.g., 0.94 for 94% upvoted)
- top_comment: The text of the highest-voted comment on the post (first 200 chars max). Skip any comments that are "[removed]" or "[deleted]" and get the next top comment instead.
- subreddit_subscribers: Number of subscribers to the subreddit (e.g., 19200000)
- subreddit_created_year: Year the subreddit was founded (e.g., 2012)
- subreddit_rule: One interesting/distinctive rule from the subreddit sidebar (e.g., "Rule 2: Posts must be about you")

Return JSON only with these keys:
subreddit, title, selftext, redacted_title, redacted_selftext, score, num_comments,
post_id, permalink, source_url, redaction_notes, extra_redactions,
upvote_ratio, top_comment, subreddit_subscribers, subreddit_created_year, subreddit_rule

Return one post only.
"""


def build_prompt(
) -> str:
    return PROMPT_TEMPLATE


def _load_env(dotenv_path: str = ".env") -> None:
    try:
        with open(dotenv_path, "r", encoding="utf-8") as handle:
            for raw_line in handle:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                value = value.strip().strip("'").strip('"')
                if key:
                    os.environ.setdefault(key, value)
    except FileNotFoundError:
        return

    if "OPENAI_API_KEY" not in os.environ:
        alias = os.environ.get("GPT_KEY")
        if alias:
            os.environ["OPENAI_API_KEY"] = alias


def _extract_json(text: str) -> Dict[str, Any]:
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end <= start:
        raise ValueError("Model response did not contain a JSON object.")
    return json.loads(text[start : end + 1])


def _response_text(response: Any) -> str:
    if getattr(response, "output_text", None):
        return response.output_text
    parts = []
    for item in getattr(response, "output", []) or []:
        for content in getattr(item, "content", []) or []:
            text = getattr(content, "text", None)
            if text:
                parts.append(text)
    return "".join(parts)


def _clean_post(post: Dict[str, Any]) -> Dict[str, Any]:
    return {key: value for key, value in post.items() if key not in REMOVE_KEYS}


def _format_subscribers(count: int) -> str:
    """Format subscriber count as human-readable string."""
    if count >= 1_000_000:
        value = f"{count / 1_000_000:.1f}".rstrip("0").rstrip(".")
        return f"{value}M"
    if count >= 1_000:
        value = f"{count / 1_000:.1f}".rstrip("0").rstrip(".")
        return f"{value}K"
    return str(count)


INVALID_COMMENTS = {"[removed]", "[deleted]", ""}


def format_clues_for_game(post: Dict[str, Any]) -> Dict[str, str]:
    """Format raw post data into game clue strings."""
    ratio = post.get("upvote_ratio", 0)
    upvote_ratio = f"{int(ratio * 100)}% upvoted" if ratio else "Unknown"

    top_comment = post.get("top_comment", "")
    # Check if comment is invalid/removed
    if top_comment.strip().lower() in {s.lower() for s in INVALID_COMMENTS}:
        top_comment = ""
    if len(top_comment) > 200:
        top_comment = top_comment[:197] + "..."
    top_comment = f'"{top_comment}"' if top_comment else "No valid comments"

    subscribers = post.get("subreddit_subscribers", 0)
    year = post.get("subreddit_created_year", "")
    if subscribers and year:
        community_stats = f"{_format_subscribers(subscribers)} members, founded {year}"
    elif subscribers:
        community_stats = f"{_format_subscribers(subscribers)} members"
    else:
        community_stats = "Unknown"

    sidebar_rule = post.get("subreddit_rule", "No specific rules")

    return {
        "upvoteRatio": upvote_ratio,
        "topComment": top_comment,
        "communityStats": community_stats,
        "sidebarRule": sidebar_rule,
    }


def _is_nsfw(text: str) -> bool:
    if not text:
        return False
    lowered = text.lower()
    return any(
        token in lowered
        for token in (
            "nsfw",
            "porn",
            "sex ",
            "sexual",
            "explicit",
            "nude",
            "nudity",
            "rape",
            "gore",
            "blood",
            "violence",
            "fuck",
            "dick",
            "pussy"
        )
    )


def _ensure_sfw(post: Dict[str, Any]) -> None:
    title = str(post.get("title", ""))
    body = str(post.get("selftext", ""))
    if _is_nsfw(title) or _is_nsfw(body):
        raise ValueError("Post appears to be NSFW. Please retry to fetch a SFW post.")


def _ensure_min_karma(post: Dict[str, Any], min_karma: int = 1000) -> None:
    score = post.get("score", 0)
    if abs(score) < min_karma:
        raise ValueError(f"Post has {score} karma, need at least {min_karma}. Please retry.")


def _append_post(post: Dict[str, Any], path: str = DEFAULT_OUTPUT_PATH) -> None:
    with open(path, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(post, ensure_ascii=False))
        handle.write("\n")


MAX_BODY_LENGTH = 500


def _truncate_body(text: str, max_length: int = MAX_BODY_LENGTH) -> str:
    """Truncate post body to max length, ending at a word boundary."""
    if not text or len(text) <= max_length:
        return text
    # Find last space before max_length to avoid cutting mid-word
    truncated = text[:max_length]
    last_space = truncated.rfind(" ")
    if last_space > max_length * 0.7:  # Only use space if it's not too far back
        truncated = truncated[:last_space]
    return truncated.rstrip() + "..."


def format_puzzle_for_api(post: Dict[str, Any], date: Optional[str] = None) -> Dict[str, Any]:
    """Format post data into the puzzle API payload format."""
    from datetime import datetime

    clues = format_clues_for_game(post)

    post_body = post.get("redacted_selftext", post.get("selftext", ""))
    post_body = _truncate_body(post_body)

    puzzle = {
        "postTitle": post.get("redacted_title", post.get("title", "")),
        "postBody": post_body,
        "correctSubreddit": post.get("subreddit", ""),
        "clues": clues,
        "date": date or datetime.now().strftime("%Y-%m-%d"),
    }
    return puzzle


def save_puzzle_json(puzzle: Dict[str, Any], path: str = "puzzle.json") -> None:
    """Save puzzle payload to a JSON file."""
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(puzzle, handle, indent=2, ensure_ascii=False)
    print(f"Puzzle saved to {path}")


def get_interesting_reddit_post(
    client: Optional[Any] = None,
    model: str = DEFAULT_MODEL,
) -> Dict[str, Any]:
    prompt = build_prompt()

    if client is None:
        _load_env()
        client = OpenAI()

    response = client.responses.create(
        model=model,
        tools=[{"type": "web_search"}],
        input=prompt,
    )
    text = _response_text(response)
    if not text:
        raise ValueError("Model response was empty.")
    cleaned = _clean_post(_extract_json(text))
    _ensure_sfw(cleaned)
    _ensure_min_karma(cleaned)
    return cleaned


def main() -> None:
    post = get_interesting_reddit_post()
    _append_post(post)

    # Format puzzle for API
    puzzle = format_puzzle_for_api(post)

    # Save to puzzle.json for easy upload
    save_puzzle_json(puzzle)

    # Print raw post data
    print("--- Raw Post Data ---")
    print(json.dumps(post, indent=2))

    # Print puzzle payload ready for API
    print("\n--- Puzzle Payload (POST to /api/admin/set-puzzle) ---")
    print(json.dumps(puzzle, indent=2))


if __name__ == "__main__":
    main()
