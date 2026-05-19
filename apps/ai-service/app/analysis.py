"""Structured analysis for session evaluation and failure classification.

PRD §7.10.7 failure reason taxonomy and §7.12 evaluation harness expect
deterministic, structured outputs rather than free-form text. This module
implements rule-based scoring that the TypeScript control plane can consume
without needing a live LLM. A future LLM-backed analyser can be wired in by
replacing the body of ``analyze_session`` / ``analyze_failure`` while keeping
the public response schema stable.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Iterable


FAILURE_REASONS = (
    "agent_process_error",
    "command_failed",
    "approval_rejected",
    "timeout",
    "model_error",
    "network_error",
    "permission_denied",
    "diff_conflict",
    "unknown",
)


_FAILURE_PATTERNS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("permission_denied", ("permission denied", "eacces", "operation not permitted", "policy denied", "deny rule")),
    ("approval_rejected", ("approval rejected", "approval denied", "user rejected", "rejected by reviewer")),
    ("timeout", ("timeout", "timed out", "deadline exceeded", "etimedout")),
    ("network_error", ("econnrefused", "econnreset", "enotfound", "network", "fetch failed", "socket hang up", "dns")),
    ("missing_file_or_command", ("enoent", "no such file", "command not found", "is not recognized")),
    ("model_error", ("model_error", "rate limit", "rate_limit", "invalid_api_key", "api key", "context length", "tokens exceeded")),
    ("diff_conflict", ("merge conflict", "conflicting changes", "patch does not apply", "rebase failed")),
    ("agent_process_error", ("agent process exited", "exit code", "subprocess failed", "spawn", "killed", "sigterm", "sigkill")),
    ("command_failed", ("non-zero exit", "exit status", "command failed")),
)

_RECOMMENDATIONS: dict[str, str] = {
    "permission_denied": "Re-run with elevated permission mode or add an allow rule for this path.",
    "approval_rejected": "Reviewer rejected the action; revisit the prompt scope or pre-approve the operation.",
    "timeout": "Increase max_runtime or split the task into smaller sessions.",
    "network_error": "Verify outbound connectivity and provider endpoint availability.",
    "missing_file_or_command": "Confirm the executor binary path and project working directory exist.",
    "model_error": "Check the configured provider's API key, quota and model id.",
    "diff_conflict": "Pull/rebase the branch before re-running, or apply patch manually.",
    "agent_process_error": "Inspect the executor stderr; the agent process exited unexpectedly.",
    "command_failed": "Open the failing command in the inspector and re-run with verbose output.",
    "unknown": "Capture the failure transcript and escalate manually.",
}


@dataclass(frozen=True)
class CheckResult:
    name: str
    passed: bool
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {"name": self.name, "passed": self.passed, "detail": self.detail}


def _ensure_str_list(values: Any) -> list[str]:
    if not isinstance(values, list):
        return []
    return [item for item in values if isinstance(item, str) and item.strip()]


def _ensure_command_records(records: Any) -> list[dict[str, Any]]:
    if not isinstance(records, list):
        return []
    out: list[dict[str, Any]] = []
    for entry in records:
        if isinstance(entry, dict):
            out.append(entry)
    return out


def _normalise_paths(paths: Iterable[str]) -> list[str]:
    return [path.strip().replace("\\", "/").lstrip("./") for path in paths if path.strip()]


def analyze_session(
    *,
    session_id: str | None,
    transcript: str,
    expected: dict[str, Any],
    diff_files: list[str] | None = None,
    commands: list[dict[str, Any]] | None = None,
    duration_ms: int | None = None,
) -> dict[str, Any]:
    """Score a session against an expected harness definition.

    The ``expected`` block follows PRD §7.12.2:
        - mustContain: list[str]                # transcript substrings
        - filesShouldChange: list[str]          # diff file globs/paths
        - filesShouldNotChange: list[str]
        - tests: list[str]                      # not executed here
        - maxDurationMs: int (optional)
    """

    transcript_lower = (transcript or "").lower()
    must_contain = _ensure_str_list(expected.get("mustContain"))
    files_should_change = _normalise_paths(_ensure_str_list(expected.get("filesShouldChange")))
    files_should_not_change = _normalise_paths(
        _ensure_str_list(expected.get("filesShouldNotChange")),
    )
    tests_expected = _ensure_str_list(expected.get("tests"))
    max_duration = expected.get("maxDurationMs")

    actual_files = _normalise_paths(diff_files or [])
    command_records = _ensure_command_records(commands or [])
    failed_commands = [
        record for record in command_records
        if isinstance(record.get("exitCode"), int) and record["exitCode"] != 0
    ]

    checks: list[CheckResult] = []
    matched_must = [item for item in must_contain if item.lower() in transcript_lower]
    missing_must = [item for item in must_contain if item not in matched_must]
    if must_contain:
        checks.append(CheckResult(
            name="transcript_contains_required",
            passed=not missing_must,
            detail=f"matched {len(matched_must)}/{len(must_contain)}",
        ))

    if files_should_change:
        missing_changes = [path for path in files_should_change if path not in actual_files]
        checks.append(CheckResult(
            name="expected_files_changed",
            passed=not missing_changes,
            detail=f"missing: {missing_changes}" if missing_changes else "all expected files changed",
        ))

    if files_should_not_change:
        unexpected_changes = [path for path in files_should_not_change if path in actual_files]
        checks.append(CheckResult(
            name="protected_files_untouched",
            passed=not unexpected_changes,
            detail=f"unexpected changes: {unexpected_changes}" if unexpected_changes else "protected files preserved",
        ))

    if tests_expected:
        mentioned_tests = [item for item in tests_expected if item.lower() in transcript_lower]
        checks.append(CheckResult(
            name="tests_referenced",
            passed=len(mentioned_tests) == len(tests_expected),
            detail=f"referenced {len(mentioned_tests)}/{len(tests_expected)} expected tests",
        ))

    if isinstance(max_duration, (int, float)) and duration_ms is not None:
        checks.append(CheckResult(
            name="within_duration_budget",
            passed=duration_ms <= max_duration,
            detail=f"{duration_ms}ms vs budget {int(max_duration)}ms",
        ))

    if command_records:
        checks.append(CheckResult(
            name="commands_succeeded",
            passed=not failed_commands,
            detail=f"{len(failed_commands)}/{len(command_records)} commands failed",
        ))

    passed_checks = sum(1 for check in checks if check.passed)
    score = passed_checks / len(checks) if checks else 0.0
    overall_passed = bool(checks) and passed_checks == len(checks)

    recommendations: list[str] = []
    if missing_must:
        recommendations.append("Refine the prompt so the assistant addresses the missing topics.")
    if files_should_change and not all(path in actual_files for path in files_should_change):
        recommendations.append("Inspect baseline + diff: expected files were not modified.")
    if files_should_not_change and any(path in actual_files for path in files_should_not_change):
        recommendations.append("Tighten prompt scope or add a deny rule to protect listed paths.")
    if failed_commands:
        recommendations.append("Open the failed commands in the inspector to triage.")

    return {
        "sessionId": session_id,
        "score": round(score, 4),
        "passed": overall_passed,
        "checks": [check.to_dict() for check in checks],
        "matched": matched_must,
        "missing": missing_must,
        "filesChanged": actual_files,
        "failedCommandCount": len(failed_commands),
        "recommendations": recommendations,
    }


def _classify_text(text: str) -> list[tuple[str, str]]:
    lowered = text.lower()
    hits: list[tuple[str, str]] = []
    for reason, patterns in _FAILURE_PATTERNS:
        for pattern in patterns:
            if pattern in lowered:
                hits.append((reason, pattern))
                break
    return hits


def _evidence_from_text(text: str, pattern: str, window: int = 80) -> str:
    if not text:
        return ""
    lower = text.lower()
    idx = lower.find(pattern.lower())
    if idx < 0:
        return ""
    start = max(0, idx - window)
    end = min(len(text), idx + len(pattern) + window)
    snippet = text[start:end].strip()
    return re.sub(r"\s+", " ", snippet)


def analyze_failure(
    *,
    session_id: str | None,
    logs: str = "",
    error: str | None = None,
    commands: list[dict[str, Any]] | None = None,
    events: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Classify a failed session into PRD §7.10.7 reasons with evidence.

    The function inspects three sources in priority order: explicit ``error``,
    failed command stderr, and free-form ``logs`` / event payloads. Evidence
    snippets are returned so the control plane can render a "why" tooltip.
    """

    sources: list[tuple[str, str]] = []
    if error:
        sources.append(("error", error))
    for record in _ensure_command_records(commands or []):
        if isinstance(record.get("exitCode"), int) and record["exitCode"] != 0:
            stderr = record.get("stderr") or record.get("stderrPreview") or ""
            stdout = record.get("stdout") or record.get("stdoutPreview") or ""
            command = str(record.get("command") or "")
            combined = "\n".join(part for part in [command, stderr, stdout] if part).strip()
            if combined:
                sources.append(("command", combined))
    if logs:
        sources.append(("logs", logs))
    if events:
        for event in events:
            if isinstance(event, dict):
                event_type = str(event.get("type") or "")
                payload = event.get("payload")
                if isinstance(payload, dict) and (event_type.endswith("failed") or event_type == "error"):
                    text = " ".join(
                        str(value) for value in payload.values()
                        if isinstance(value, (str, int, float))
                    )
                    if text:
                        sources.append((f"event:{event_type}", text))

    classification: dict[str, dict[str, Any]] = {}
    for source_label, text in sources:
        for reason, pattern in _classify_text(text):
            entry = classification.setdefault(reason, {
                "reason": reason,
                "occurrences": 0,
                "sources": [],
                "evidence": [],
            })
            entry["occurrences"] += 1
            if source_label not in entry["sources"]:
                entry["sources"].append(source_label)
            evidence = _evidence_from_text(text, pattern)
            if evidence and len(entry["evidence"]) < 3:
                entry["evidence"].append({"source": source_label, "snippet": evidence})

    if not classification:
        classification["unknown"] = {
            "reason": "unknown",
            "occurrences": 1,
            "sources": [name for name, _ in sources] or ["none"],
            "evidence": [],
        }

    ranked = sorted(
        classification.values(),
        key=lambda entry: (-int(entry["occurrences"]), FAILURE_REASONS.index(entry["reason"])
                           if entry["reason"] in FAILURE_REASONS else len(FAILURE_REASONS)),
    )
    primary = ranked[0]["reason"]
    summary_text = "\n".join(text for _, text in sources)[:1000]

    return {
        "sessionId": session_id,
        "primaryReason": primary,
        "likelyCauses": [entry["reason"] for entry in ranked],
        "classification": ranked,
        "recommendation": _RECOMMENDATIONS.get(primary, _RECOMMENDATIONS["unknown"]),
        "summary": summary_text,
    }


def evaluate_prompt_versions(
    *,
    runs: list[dict[str, Any]],
) -> dict[str, Any]:
    """Aggregate evaluation runs by prompt version for §7.13 prompt eval.

    Each run is expected to carry: promptVersion (str), score (float in [0,1]),
    durationMs (int|None), commandFailureRate (float|None), passed (bool).
    """

    grouped: dict[str, dict[str, Any]] = {}
    for run in runs:
        if not isinstance(run, dict):
            continue
        version = str(run.get("promptVersion") or run.get("prompt_version") or "default")
        bucket = grouped.setdefault(version, {
            "promptVersion": version,
            "runCount": 0,
            "passedCount": 0,
            "scoreSum": 0.0,
            "durationSum": 0,
            "durationSamples": 0,
            "commandFailureRateSum": 0.0,
            "commandFailureSamples": 0,
        })
        bucket["runCount"] += 1
        if bool(run.get("passed")):
            bucket["passedCount"] += 1
        score = run.get("score")
        if isinstance(score, (int, float)):
            bucket["scoreSum"] += float(score)
        duration = run.get("durationMs")
        if isinstance(duration, (int, float)):
            bucket["durationSum"] += int(duration)
            bucket["durationSamples"] += 1
        command_failure = run.get("commandFailureRate")
        if isinstance(command_failure, (int, float)):
            bucket["commandFailureRateSum"] += float(command_failure)
            bucket["commandFailureSamples"] += 1

    summary = []
    for bucket in grouped.values():
        run_count = bucket["runCount"] or 1
        summary.append({
            "promptVersion": bucket["promptVersion"],
            "runCount": bucket["runCount"],
            "passRate": round(bucket["passedCount"] / run_count, 4),
            "averageScore": round(bucket["scoreSum"] / run_count, 4),
            "averageDurationMs": (
                int(bucket["durationSum"] / bucket["durationSamples"])
                if bucket["durationSamples"] else None
            ),
            "averageCommandFailureRate": (
                round(bucket["commandFailureRateSum"] / bucket["commandFailureSamples"], 4)
                if bucket["commandFailureSamples"] else None
            ),
        })
    summary.sort(key=lambda item: (-item["averageScore"], item["promptVersion"]))
    return {"versions": summary}
