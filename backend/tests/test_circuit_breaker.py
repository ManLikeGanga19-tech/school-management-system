"""Circuit breaker unit tests.

Behaviour matrix:
  closed → record_failure × N → open → cooldown elapses → half_open
  half_open → record_success → closed
  half_open → record_failure → open (cooldown reset)
"""
from __future__ import annotations

import time

import pytest

from app.core.circuit_breaker import CircuitBreaker


def _new(threshold=3, cooldown=0.05) -> CircuitBreaker:
    return CircuitBreaker(name="test", failure_threshold=threshold, cooldown_s=cooldown)


def test_starts_closed_and_allows():
    cb = _new()
    assert cb.allow() is True
    assert cb.snapshot()["state"] == "closed"


def test_failures_below_threshold_stay_closed():
    cb = _new(threshold=3)
    cb.record_failure()
    cb.record_failure()
    assert cb.allow() is True
    assert cb.snapshot()["state"] == "closed"


def test_trips_open_after_threshold():
    cb = _new(threshold=3, cooldown=10)
    for _ in range(3):
        cb.record_failure()
    assert cb.snapshot()["state"] == "open"
    assert cb.allow() is False


def test_success_in_closed_resets_failure_count():
    cb = _new(threshold=3)
    cb.record_failure()
    cb.record_failure()
    cb.record_success()
    cb.record_failure()
    cb.record_failure()  # only 2 in a row since reset → still closed
    assert cb.snapshot()["state"] == "closed"


def test_cooldown_elapses_flips_to_half_open():
    cb = _new(threshold=1, cooldown=0.01)
    cb.record_failure()
    assert cb.allow() is False
    time.sleep(0.02)
    assert cb.allow() is True
    assert cb.snapshot()["state"] == "half_open"


def test_half_open_success_closes():
    cb = _new(threshold=1, cooldown=0.01)
    cb.record_failure()
    time.sleep(0.02)
    cb.allow()  # transitions to half_open
    cb.record_success()
    assert cb.snapshot()["state"] == "closed"
    assert cb.allow() is True


def test_half_open_failure_reopens_with_fresh_cooldown():
    cb = _new(threshold=1, cooldown=0.05)
    cb.record_failure()
    time.sleep(0.06)
    cb.allow()  # half_open trial in flight
    cb.record_failure()
    snap = cb.snapshot()
    assert snap["state"] == "open"
    # Cooldown reset — full window remaining.
    assert snap["cooldown_remaining_s"] > 0.04


def test_snapshot_shape():
    cb = _new()
    snap = cb.snapshot()
    assert set(snap) == {"name", "state", "failures", "cooldown_remaining_s"}
