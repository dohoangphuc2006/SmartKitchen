"""Run Windows acceptance from a fresh extraction and save evidence outside the ZIP."""

import argparse
import ast
import csv
import ctypes
from datetime import datetime
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import HTTPError, URLError
from urllib.request import ProxyHandler, Request, build_opener
from zipfile import ZipFile

from build_windows_release import RELEASE, ROOT, ZIP_NAME, verify


METHODS = ("final", "ml_tfidf", "ml_lsa")
PANTRIES = (["thịt heo xay"], ["trứng"], ["trứng", "cà chua", "hành lá"])
HTTP = build_opener(ProxyHandler({}))
GUARD = r'''
import os
from pathlib import Path
import sys

package = Path(os.environ["SK_VERIFICATION_ROOT"]).resolve()
scratch = Path(os.environ["TEMP"]).resolve()
standard_library = Path(sys.base_prefix).resolve()
base_packages = standard_library / "Lib" / "site-packages"
windows = Path(os.environ["SystemRoot"]).resolve()
trace = open(os.environ["SK_VERIFICATION_TRACE"], "a", encoding="utf-8", buffering=1)
seen = set()

def guard(event, args):
    if event in {"socket.connect", "socket.getaddrinfo"}:
        target = args[1][0] if event == "socket.connect" else args[0]
        if target not in {"127.0.0.1", "::1", "localhost", None}:
            trace.write("BLOCKED " + event + " " + str(target) + "\n")
            raise PermissionError("Runtime network access outside localhost")
    if event != "open" or isinstance(args[0], int):
        return
    file = Path(os.path.abspath(os.fsdecode(args[0])))
    if file.is_relative_to(package):
        rel = file.relative_to(package).as_posix()
        if rel.startswith("app/") and rel not in seen:
            seen.add(rel)
            trace.write("PACKAGE " + rel + "\n")
        return
    if file.is_relative_to(scratch) or file.is_relative_to(windows):
        return
    if file.is_relative_to(standard_library) and not file.is_relative_to(base_packages):
        return
    trace.write("BLOCKED open " + str(file) + "\n")
    raise PermissionError("Runtime file access outside the extracted package")

assert sys.flags.no_user_site
assert Path(sys.prefix).resolve() == package / ".venv"
assert all(Path(p).resolve().is_relative_to(package) or
           (Path(p).resolve().is_relative_to(standard_library) and
            not Path(p).resolve().is_relative_to(base_packages)) for p in sys.path)
sys.addaudithook(guard)
trace.write("ACTIVE\n")
'''


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def execute(args, cwd, env, evidence, label, *, expected=0, timeout=360):
    started = time.monotonic()
    with (evidence / f"{label}.log").open("wb") as log:
        result = subprocess.run(args, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    outcome = {"exit_code": result.returncode, "seconds": round(time.monotonic() - started, 2)}
    write_json(evidence / f"{label}.json", outcome)
    if result.returncode != expected:
        raise RuntimeError(f"{label} returned {result.returncode}, expected {expected}. See {label}.log")
    print(label, outcome, flush=True)
    return outcome


def local_url(port):
    return f"http://127.0.0.1:{port}/"


def request(port, path="", payload=None, *, expected=200, raw=False):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    try:
        response = HTTP.open(Request(local_url(port) + path, data, headers), timeout=45)
    except HTTPError as error:
        response = error
    with response:
        body = response.read()
        if response.code != expected:
            raise RuntimeError(f"{path}: expected HTTP {expected}, got {response.code}: {body[:600]!r}")
    return body if raw else json.loads(body)


def verify_http(package, port, evidence, label):
    health = request(port, "api/health")
    assert health == {"status": "ok", "model_loaded": False, "recommender_loaded": True}, health
    config = request(port, "api/config")
    assert config["ranking_method"] == "final" and config["recipe_first"] and not config["image_detection_available"]
    page = request(port, raw=True).decode()
    assert "<title>Smart Kitchen" in page
    assets = re.findall(r'(?:src|href)="/(static/[^"]+)"', page)
    assert len(assets) == 6
    for asset in assets:
        assert request(port, asset, raw=True) == (package / "app/frontend" / asset.split("/")[1].split("?")[0]).read_bytes()
    catalog = request(port, "api/ingredients/catalog?q=tomato")
    assert "tomato" in json.dumps(catalog).lower()
    display_coverage = request(port, "api/display-catalog")["coverage"]
    assert display_coverage["total_records"] == 13501
    metadata = json.loads((package / "app/models/recipe_ml/recipe_tfidf_lsa_v1.metadata.json").read_text())

    def recommend(ingredients, method=None, **options):
        payload = {"ingredients": ingredients, "top_n": 5, **options}
        if method:
            payload["ranking_method"] = method
        result = request(port, "api/recommend", payload)
        assert result["success"] and result["ranking_method"] == (method or "final"), result
        if method in METHODS[1:]:
            assert result["model_version"] == metadata["model_version"]
            assert result["artifact_sha256"] == metadata["artifact_sha256"]
        return result

    trials = []
    for pantry in PANTRIES:
        for method in METHODS:
            result = recommend(pantry, method, two_tier=True)
            assert result["two_tier"] and result["ingredients"]
            a, b = result["tier_a_recommendations"], result["tier_b_recommendations"]
            assert len(a) < 5 and 0 < len(b) <= 5
            assert all(r["readiness_status"] == "CAN_COOK_NOW" and not r["missing_ingredients"] for r in a)
            assert all(r["readiness_status"] == "NEEDS_ADDITIONAL_INGREDIENTS" for r in b)
            assert any(r["missing_ingredients"] for r in b)
            assert all(r["missing_ingredients"] or r["required_equipment"]
                       or not r["reliable_for_can_cook_now"] or r["match_confidence"] < 0.90 for r in b)
            valid_ids = [[r["recipe_id"] for r in tier] for tier in (a, b)]
            assert not set(valid_ids[0]).intersection(valid_ids[1])
            if pantry == PANTRIES[0]:
                assert valid_ids[0] == []
            if pantry == PANTRIES[-1]:
                assert {2083, 2091}.issubset(valid_ids[0])
            trials.append({"pantry": pantry, "method": method, "tier_a": valid_ids[0], "tier_b": valid_ids[1],
                           "artifact_sha256": result.get("artifact_sha256")})

    baseline = recommend(PANTRIES[-1])
    assert len(baseline["recommendations"]) == 5
    specific = recommend(["đùi gà nguyên xương có da"])
    assert [r["recipe_id"] for r in specific["recommendations"]] == [7085]
    assert specific["recommendations"][0]["missing_ingredients"]
    unknown = request(port, "api/recommend", {"ingredients": ["phieu12"], "two_tier": True})
    assert not unknown["ingredients"] and not unknown["recommendations"] and unknown["unresolved_ingredients"]
    assert unknown["empty_reason"] == "NO_RECOGNIZED_INGREDIENTS"
    request(port, "api/recommend", {"ingredients": []}, expected=422)
    request(port, "api/recipes/99999999", expected=404)

    with (package / "app/processed/recipes_cleaned.csv").open(encoding="utf-8-sig", newline="") as stream:
        originals = {int(row["row_id"]): row for row in csv.DictReader(stream)
                     if row["row_id"] in {"103", "417", "999", "6236"}}
    details = []
    for recipe_id in (417, 999, 6236, 103):
        detail = request(port, f"api/recipes/{recipe_id}")
        original = originals[recipe_id]
        assert detail["language"] == "en" and detail["instruction_steps"]
        assert detail["recipe_name"] == original["recipe_name"]
        assert detail["instructions"] == original["instructions"]
        assert detail["ingredients"] == [s for s in ast.literal_eval(original["ingredients_raw"]) if s.strip()]
        vi = detail["translations"]["vi"]
        if recipe_id == 103:
            assert vi["instructions_review_status"] == "untranslated" and vi["instructions"] is None
        else:
            assert vi["instructions_review_status"] == "auto_unreviewed"
            assert len(vi["instruction_steps"]) == len(detail["instruction_steps"])
        details.append({"id": recipe_id, "english_steps": len(detail["instruction_steps"]),
                        "english_ingredients": len(detail["ingredients"]),
                        "vietnamese_instructions": vi["instructions_review_status"],
                        "vietnamese_ingredients": vi["ingredients_review_status"]})

    outcome = {"http": "PASS", "port": port, "health": health, "static_assets": assets,
               "catalog_coverage": display_coverage, "trials": trials, "details": details,
               "baseline_ids": [r["recipe_id"] for r in baseline["recommendations"]],
               "single_eligible_id": 7085, "unknown_reason": unknown["empty_reason"]}
    write_json(evidence / f"{label}.json", outcome)
    return outcome


def cmd_script(name, port):
    return ["cmd.exe", "/d", "/c", "call", f".\\{name}", str(port)]


def wait_for_server(port, process):
    deadline = time.monotonic() + 100
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"Launcher exited with code {process.returncode} before server startup")
        try:
            if request(port, "api/health")["status"] == "ok":
                return
        except (URLError, OSError):
            time.sleep(0.4)
    raise TimeoutError(f"Server did not start on port {port}")


def stop_server(process):
    if process.poll() is not None:
        return "already exited"
    try:
        process.send_signal(signal.CTRL_BREAK_EVENT)
        process.wait(timeout=12)
        return "CTRL_BREAK_EVENT"
    except (OSError, subprocess.TimeoutExpired):
        subprocess.run(["taskkill.exe", "/PID", str(process.pid), "/T", "/F"],
                       capture_output=True, check=True, timeout=20)
        process.wait(timeout=10)
        return "taskkill of verification process tree"


def run_server(package, port, env, evidence, script, label, checks):
    started = time.monotonic()
    with (evidence / f"{label}.log").open("wb") as log:
        process = subprocess.Popen(cmd_script(script, port), cwd=package, env=env,
                                   stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT,
                                   creationflags=subprocess.CREATE_NEW_PROCESS_GROUP)
        try:
            wait_for_server(port, process)
            startup = round(time.monotonic() - started, 2)
            print(f"{label} ready after {startup}s", flush=True)
            return checks()
        finally:
            stopped_by = stop_server(process)
            write_json(evidence / f"{label}.json", {
                "script": script, "port": port, "pid": process.pid,
                "startup_seconds": locals().get("startup"),
                "elapsed_seconds": round(time.monotonic() - started, 2),
                "exit_code": process.returncode, "stopped_by": stopped_by,
            })


def require_port(port):
    with socket.socket() as sock:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        sock.bind(("127.0.0.1", port))


def verify_windows(browser, port, restart_port):
    if sys.platform != "win32" or platform.machine().lower() != "amd64" or sys.version_info[:2] != (3, 14):
        raise RuntimeError("Run with Windows x64 and CPython 3.14 x64")
    assert port != restart_port
    require_port(port)
    require_port(restart_port)
    archive = RELEASE / ZIP_NAME
    integrity = verify(archive)
    evidence = RELEASE / "evidence" / (
        integrity["sha256"][:12] + "-" + datetime.now().strftime("%Y%m%d-%H%M%S"))
    evidence.mkdir(parents=True)
    scratch = ROOT / ".verification"
    scratch.mkdir(exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="Kiểm thử Windows ", dir=scratch))
    package = work / "Ứng dụng Smart Kitchen"
    print(f"Testing {integrity['sha256']}; evidence: {evidence}", flush=True)
    with ZipFile(archive) as zipped:
        zipped.extractall(package)
    assert not (package / ".venv").exists()
    verify(archive, package)
    temp = work / "Temp"
    temp.mkdir()
    env = {key: value for key, value in os.environ.items()
           if not key.upper().startswith(("PYTHON", "PIP_", "SMART_KITCHEN_", "YOLO_"))}
    env.update(TEMP=str(temp), TMP=str(temp), PYTHONUTF8="1", PYTHONNOUSERSITE="1", PIP_CONFIG_FILE="NUL")
    python = package / ".venv/Scripts/python.exe"
    node = shutil.which("node")
    if not node:
        raise RuntimeError("Node.js is required for the verification harness")
    setup = ["powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ".\\setup_env.ps1"]
    summary = {"zip": integrity, "os": platform.platform(), "machine": platform.machine(),
               "verifier_python": sys.version.split()[0],
               "administrator": bool(ctypes.windll.shell32.IsUserAnAdmin()), "status": "FAIL"}
    try:
        summary["setup"] = execute([*setup, "-Port", str(port)], package, env, evidence, "setup")
        execute([python, "-I", "-m", "pip", "list", "--format", "json"], package, env, evidence, "runtime-dependencies")
        runtime = json.loads((evidence / "runtime-dependencies.log").read_text(encoding="utf-8"))
        assert len(runtime) == 22 and not {"torch", "ultralytics"}.intersection(p["name"].lower() for p in runtime)
        execute([python, "-I", "-VV"], package, env, evidence, "python-version")
        assert "include-system-site-packages = false" in (package / ".venv/pyvenv.cfg").read_text(encoding="utf-8")
        execute([*setup, "-CheckOnly", "-Port", str(port)], package, env, evidence, "check-only")
        for asset, label in (
            ("app/models/recipe_ml/recipe_tfidf_lsa_v1.npz", "missing-model"),
            ("app/processed/recipes_cleaned.csv", "missing-dataset"),
        ):
            original = package / asset
            moved = original.with_suffix(".verification-hold")
            original.rename(moved)
            try:
                execute(cmd_script("Start_Smart_Kitchen.cmd", port), package, env, evidence, label, expected=2)
                assert asset.removeprefix("app/").encode("ascii") in (evidence / f"{label}.log").read_bytes()
            finally:
                moved.rename(original)
        metadata = package / "app/models/recipe_ml/recipe_tfidf_lsa_v1.metadata.json"
        original_metadata = metadata.read_bytes()
        try:
            metadata.write_bytes(original_metadata + b"\n")
            execute([*setup, "-CheckOnly", "-Port", str(port)], package, env, evidence, "tampered-metadata", expected=1)
            assert b"SHA-256" in (evidence / "tampered-metadata.log").read_bytes()
        finally:
            metadata.write_bytes(original_metadata)

        def first_run():
            result = verify_http(package, port, evidence, "http-run1")
            execute(cmd_script("Start_Smart_Kitchen.cmd", port), package, env, evidence, "busy-port", expected=3)
            assert "CỔNG" in (evidence / "busy-port.log").read_text(encoding="utf-8")
            assert request(port, "api/health")["status"] == "ok"
            execute([node, RELEASE / "verify_browser.cjs", browser, local_url(port), work / "Chrome", evidence],
                    package, env, evidence, "browser-run", timeout=200)
            return result

        first = run_server(package, port, env, evidence, "RUN_ME_FIRST.cmd", "server-run1", first_run)
        require_port(port)
        cache = package / "app/processed/recipe_detail_vi_ondemand_cache.json"
        assert cache.is_file()
        cache.unlink()
        guard = package / ".venv/Lib/site-packages/sitecustomize.py"
        guard.write_text(GUARD, encoding="utf-8")
        trace = evidence / "runtime-files.log"
        guard_env = dict(env, SK_VERIFICATION_ROOT=str(package), SK_VERIFICATION_TRACE=str(trace))
        try:
            second = run_server(package, restart_port, guard_env, evidence, "Start_Smart_Kitchen.cmd", "server-run2",
                                lambda: verify_http(package, restart_port, evidence, "http-run2"))
        finally:
            guard.unlink()
        require_port(restart_port)
        access = trace.read_text(encoding="utf-8")
        assert "ACTIVE\n" in access and "BLOCKED " not in access, access[-1200:]
        for file in ("models/recipe_ml/recipe_tfidf_lsa_v1.npz", "processed/recipes_cleaned.csv",
                     "processed/ingredient_details.csv", "processed/recipe_detail_vi_v6_batch.json"):
            assert "PACKAGE app/" + file in access
        assert first["trials"] == second["trials"] and first["baseline_ids"] == second["baseline_ids"]
        assert first["details"] == second["details"]
        summary["restart_determinism"] = "PASS"
        summary["runtime_isolation"] = "PASS (fresh venv, package and base stdlib only; local HTTP)"
        summary["browser"] = "PASS"

        app = package / "app"
        execute([python, "-I", "-X", "utf8", "-m", "pip", "--isolated", "--disable-pip-version-check",
                 "install", "--index-url", "https://pypi.org/simple", "--no-cache-dir", "--only-binary=:all:",
                 "-r", "requirements-dev.txt"], app, env, evidence, "test-dependencies")
        execute([python, "-I", "-m", "pip", "check"], app, env, evidence, "pip-check-after-tests")
        execute([python, "-B", "-s", "-X", "utf8", "-m", "unittest", "discover", "-s", "tests", "-v"],
                app, env, evidence, "python-regression", timeout=720)
        python_log = (evidence / "python-regression.log").read_text(encoding="utf-8")
        parsed = re.search(r"Ran (\d+) tests?", python_log)
        if not parsed:
            raise ValueError("Cannot read Python regression test count")
        summary["python_tests_discovered"] = int(parsed.group(1))
        summary["python_tests_skipped"] = sum(" ... skipped " in line for line in python_log.splitlines())
        for script in sorted((app / "tests").glob("*.cjs")):
            execute([node, script], app, env, evidence, script.stem)
        frontend_report = app / "reports/final/feature_frontend_unit.json"
        assert json.loads(frontend_report.read_text(encoding="utf-8"))["passed"] > 0
        shutil.copyfile(frontend_report, evidence / frontend_report.name)
        verify(archive, package)
        summary.update(status="PASS", tests_javascript=len(list((app / "tests").glob("*.cjs"))),
                       payload_integrity_after_run="PASS", yolo="OUT_OF_SCOPE")
    finally:
        write_json(evidence / "SUMMARY.json", summary)
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    default_browser = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe"
    parser.add_argument("--browser", type=Path, default=default_browser)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--restart-port", type=int, default=8066)
    args = parser.parse_args()
    if not args.browser.is_file():
        parser.error("Provide the Chrome or Edge executable with --browser")
    verify_windows(args.browser.resolve(), args.port, args.restart_port)
