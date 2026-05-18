"""Deterministic quality check for changelog entries.

A published "What's New" note must be specific, written for school staff
(not engineers), and actually explain how to use the feature. This scorer
gates publishing so vague or unhelpful entries never reach tenants.
"""
from __future__ import annotations

PASS_THRESHOLD = 70

# Wording that signals a vague, low-information entry.
_VAGUE = (
    "various", "bug fixes", "minor changes", "miscellaneous", "misc.",
    "general improvements", "several improvements", "tweaks",
    "under the hood", "and more", "etc.", "some changes",
)

# Cues that the entry tells the reader what to actually do.
_HOWTO = (
    "go to", "head to", "click", "open", "navigate", "you can now",
    "you'll find", "you will find", "find it", "tab", "menu", "page",
    "select", "button", "settings", "dashboard", "from the", "in the",
)

# Developer jargon that doesn't belong in a note for school staff.
_JARGON = (
    "endpoint", "api ", "migration", "backend", "frontend", "refactor",
    "deploy", "commit", "schema", "payload", "database", "null value",
)

_GENERIC_TITLES = {
    "update", "updates", "fix", "fixes", "changes", "new feature",
    "improvement", "improvements", "patch", "release",
}

_COMMIT_PREFIX = (
    "feat:", "feat(", "fix:", "fix(", "chore:", "chore(", "docs:",
    "refactor:", "refactor(", "test:", "build:",
)


def assess_changelog(title: str, body: str) -> dict:
    """Score a changelog entry 0–100 and list what's wrong with it.

    Returns {score, passed, threshold, issues}. `passed` is True when the
    score meets PASS_THRESHOLD — publishing requires it.
    """
    title = (title or "").strip()
    body = (body or "").strip()
    tl = title.lower()
    bl = body.lower()

    issues: list[str] = []
    score = 100

    if len(title) < 6:
        issues.append("Title is too short — name the feature clearly.")
        score -= 15
    elif tl in _GENERIC_TITLES:
        issues.append("Title is too generic — say what the feature actually is.")
        score -= 15

    if len(body) < 120:
        issues.append(
            "Explanation is too brief — describe what changed and what it "
            "means for the school."
        )
        score -= 25

    vague = next((p for p in _VAGUE if p in bl), None)
    if vague:
        issues.append(
            f"Avoid vague wording (“{vague}”) — be specific about what changed."
        )
        score -= 20

    if not any(cue in bl for cue in _HOWTO):
        issues.append(
            "Tell the user how to use it — where to find it or what to click."
        )
        score -= 25

    if any(j in bl for j in _JARGON):
        issues.append(
            "Remove developer jargon — write for school staff, not engineers."
        )
        score -= 15

    if bl.startswith(_COMMIT_PREFIX):
        issues.append(
            "This reads like a commit message — rewrite it as guidance for users."
        )
        score -= 20

    score = max(0, score)
    return {
        "score": score,
        "passed": score >= PASS_THRESHOLD,
        "threshold": PASS_THRESHOLD,
        "issues": issues,
    }
