"""Tests for the deterministic changelog quality scorer."""
from __future__ import annotations

from app.api.v1.changelog.quality import PASS_THRESHOLD, assess_changelog

# A well-written entry: clear title, plain language, tells the user where to go.
_GOOD_TITLE = "Bulk fee reminders"
_GOOD_BODY = (
    "You can now send a fee reminder to every parent with an outstanding "
    "balance at once. Go to the Finance page, open the Reminders tab and "
    "click Send to all. Parents receive an SMS with the amount due."
)


def test_good_entry_passes():
    result = assess_changelog(_GOOD_TITLE, _GOOD_BODY)
    assert result["passed"] is True
    assert result["score"] >= PASS_THRESHOLD
    assert result["issues"] == []


def test_result_shape():
    result = assess_changelog(_GOOD_TITLE, _GOOD_BODY)
    assert set(result) == {"score", "passed", "threshold", "issues"}
    assert result["threshold"] == PASS_THRESHOLD


def test_vague_wording_flagged():
    body = _GOOD_BODY + " This release also includes various bug fixes."
    result = assess_changelog(_GOOD_TITLE, body)
    assert any("vague" in i.lower() for i in result["issues"])
    assert result["score"] < 100


def test_missing_howto_flagged():
    # Long enough, specific, but never tells the user what to do.
    body = (
        "Fee reminders are sent automatically to parents with an outstanding "
        "balance. The reminder includes the amount owed and the due date for "
        "the current term so families always know where they stand."
    )
    result = assess_changelog(_GOOD_TITLE, body)
    assert any("how to use it" in i.lower() for i in result["issues"])


def test_short_body_flagged():
    result = assess_changelog(_GOOD_TITLE, "Go to the Finance page to send reminders.")
    assert any("too brief" in i.lower() for i in result["issues"])


def test_multiple_issues_fail_publish():
    # Generic title + short, vague body with no how-to → well below the bar.
    result = assess_changelog("Update", "Various minor changes.")
    assert result["passed"] is False
    assert result["score"] < PASS_THRESHOLD


def test_generic_title_flagged():
    result = assess_changelog("Update", _GOOD_BODY)
    assert any("generic" in i.lower() for i in result["issues"])


def test_short_title_flagged():
    result = assess_changelog("Fee", _GOOD_BODY)
    assert any("too short" in i.lower() for i in result["issues"])


def test_developer_jargon_flagged():
    body = (
        "We added a new endpoint and ran a database migration so reminders "
        "now load faster. Go to the Finance page to try it out and click "
        "Send to all when you are ready."
    )
    result = assess_changelog(_GOOD_TITLE, body)
    assert any("jargon" in i.lower() for i in result["issues"])


def test_commit_message_body_flagged():
    body = (
        "feat: add bulk fee reminder dispatch from the finance page so admins "
        "can notify every parent with an outstanding balance in one click."
    )
    result = assess_changelog(_GOOD_TITLE, body)
    assert any("commit message" in i.lower() for i in result["issues"])


def test_empty_entry_fails():
    result = assess_changelog("", "")
    assert result["passed"] is False
    assert result["score"] < PASS_THRESHOLD


def test_score_never_negative():
    result = assess_changelog("fix", "feat: various bug fixes and tweaks etc.")
    assert result["score"] >= 0
