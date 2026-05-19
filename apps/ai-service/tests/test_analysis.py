from app.analysis import analyze_failure, analyze_session, evaluate_prompt_versions


def test_analyze_session_passes_all_checks() -> None:
    result = analyze_session(
        session_id="s1",
        transcript="Updated LoginService and added LoginServiceTest cases.",
        expected={
            "mustContain": ["LoginService"],
            "filesShouldChange": ["src/LoginService.java", "src/LoginServiceTest.java"],
            "filesShouldNotChange": ["pom.xml"],
            "tests": ["LoginServiceTest"],
            "maxDurationMs": 60000,
        },
        diff_files=["src/LoginService.java", "src/LoginServiceTest.java"],
        commands=[{"command": "mvn test", "exitCode": 0}],
        duration_ms=42000,
    )
    assert result["passed"] is True
    assert result["score"] == 1.0
    assert not result["missing"]
    assert result["failedCommandCount"] == 0


def test_analyze_session_flags_protected_file_change() -> None:
    result = analyze_session(
        session_id="s2",
        transcript="rewrote pom.xml",
        expected={
            "filesShouldChange": ["src/Foo.java"],
            "filesShouldNotChange": ["pom.xml"],
        },
        diff_files=["src/Foo.java", "pom.xml"],
    )
    assert result["passed"] is False
    by_name = {check["name"]: check for check in result["checks"]}
    assert by_name["protected_files_untouched"]["passed"] is False
    assert any("scope" in tip or "deny" in tip for tip in result["recommendations"])


def test_analyze_failure_classifies_permission_denied() -> None:
    result = analyze_failure(
        session_id="s3",
        logs="rm -rf protected: Operation not permitted",
        commands=[{"command": "rm -rf protected", "exitCode": 1, "stderr": "Permission denied"}],
    )
    assert result["primaryReason"] == "permission_denied"
    assert "permission_denied" in result["likelyCauses"]
    assert any(item["reason"] == "permission_denied" and item["evidence"] for item in result["classification"])


def test_analyze_failure_falls_back_to_unknown() -> None:
    result = analyze_failure(session_id="s4", logs="surprise", error=None, commands=[])
    assert result["primaryReason"] == "unknown"
    assert result["likelyCauses"] == ["unknown"]


def test_evaluate_prompt_versions_aggregates_runs() -> None:
    summary = evaluate_prompt_versions(runs=[
        {"promptVersion": "v1", "score": 0.5, "passed": False, "durationMs": 1000},
        {"promptVersion": "v1", "score": 0.7, "passed": True, "durationMs": 2000, "commandFailureRate": 0.1},
        {"promptVersion": "v2", "score": 1.0, "passed": True, "durationMs": 1500, "commandFailureRate": 0.0},
    ])
    versions = {entry["promptVersion"]: entry for entry in summary["versions"]}
    assert versions["v2"]["passRate"] == 1.0
    assert versions["v1"]["runCount"] == 2
    assert versions["v1"]["averageDurationMs"] == 1500
    assert versions["v1"]["averageCommandFailureRate"] == 0.1
    assert summary["versions"][0]["promptVersion"] == "v2"
