"""Lightweight async circuit breaker for soft dependencies like Redis.

States:
  closed     — normal operation; calls pass through.
  open       — backend recently failed; calls short-circuit (return None/raise)
               without touching the backend. A timer auto-flips to half_open.
  half_open  — one trial call is allowed through. Success → closed.
               Failure → back to open with the cooldown reset.

The whole point: when Redis is down, we must NOT wait for a 250ms (or worse,
5s) socket timeout on every request. The breaker remembers the failure for
`cooldown_s` and returns immediately for that window, so the request-path
overhead drops to a single dict lookup.

Used by session_cache so that the auth-check path stays fast even when
Render's Key Value instance is suspended. Surface state via `snapshot()`
for /healthz.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class CircuitBreaker:
    """Single-counter breaker — sufficient for the "soft cache" pattern.
    Not thread-locked: occasional double-trips are harmless (we trip *to*
    a safe state) and avoiding the lock keeps the hot path branch-free."""

    name: str
    failure_threshold: int = 3
    cooldown_s: float = 30.0

    _failures: int = 0
    _state: str = "closed"           # closed | open | half_open
    _opened_at: float = 0.0
    _last_warned_state: str = ""

    def allow(self) -> bool:
        """True if the caller should attempt the protected call."""
        if self._state == "closed":
            return True
        if self._state == "open":
            if (time.monotonic() - self._opened_at) >= self.cooldown_s:
                # Cooldown elapsed — let one trial through.
                self._state = "half_open"
                self._log_state_change()
                return True
            return False
        # half_open: one in-flight trial allowed; subsequent callers wait.
        # We don't track concurrency here — a small race in which two trial
        # calls land at once is acceptable; both will resolve the state.
        return True

    def record_success(self) -> None:
        if self._state != "closed" or self._failures:
            self._failures = 0
            self._state = "closed"
            self._log_state_change()

    def record_failure(self) -> None:
        self._failures += 1
        if self._state == "half_open":
            # The trial call failed — reopen with cooldown reset.
            self._state = "open"
            self._opened_at = time.monotonic()
            self._log_state_change()
            return
        if self._failures >= self.failure_threshold and self._state == "closed":
            self._state = "open"
            self._opened_at = time.monotonic()
            self._log_state_change()

    def snapshot(self) -> dict[str, object]:
        return {
            "name": self.name,
            "state": self._state,
            "failures": self._failures,
            "cooldown_remaining_s": max(
                0.0,
                self.cooldown_s - (time.monotonic() - self._opened_at),
            )
            if self._state == "open"
            else 0.0,
        }

    def _log_state_change(self) -> None:
        # De-dupe noisy logs: only emit when state truly transitions.
        if self._state == self._last_warned_state:
            return
        self._last_warned_state = self._state
        if self._state == "open":
            logger.warning(
                "Circuit breaker '%s' OPEN after %d failures — "
                "calls short-circuit for %.0fs.",
                self.name, self._failures, self.cooldown_s,
            )
        elif self._state == "half_open":
            logger.info(
                "Circuit breaker '%s' HALF_OPEN — one trial call allowed.",
                self.name,
            )
        else:  # closed
            logger.info("Circuit breaker '%s' CLOSED — backend healthy.", self.name)
