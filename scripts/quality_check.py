#!/usr/bin/env python3
"""
Static Analysis (Lint & SAST) Runner for Room-Sim.
Zero external dependencies (uses Python 3.12 stdlib `ast`, `re`, `tokenize`).

Usage:
  python3 scripts/quality_check.py --lint
  python3 scripts/quality_check.py --sast
  python3 scripts/quality_check.py --lint --sast
"""

from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from pathlib import Path
from typing import List, Set

ROOT_DIR = Path(__file__).resolve().parent.parent

PYTHON_FILES = [
    ROOT_DIR / "catalog.py",
    ROOT_DIR / "room_engine.py",
    ROOT_DIR / "mcp_server.py",
    ROOT_DIR / "server.py",
    ROOT_DIR / "scripts" / "quality_check.py",
    ROOT_DIR / "tests" / "test_room_sim.py",
]

CORE_TYPED_MODULES = [
    ROOT_DIR / "catalog.py",
    ROOT_DIR / "room_engine.py",
    ROOT_DIR / "mcp_server.py",
]

JS_FILES = [
    ROOT_DIR / "static" / "app.js",
    ROOT_DIR / "static" / "meshes.js",
]

PRODUCTION_FILES = [
    ROOT_DIR / "catalog.py",
    ROOT_DIR / "room_engine.py",
    ROOT_DIR / "mcp_server.py",
    ROOT_DIR / "server.py",
    ROOT_DIR / "static" / "app.js",
    ROOT_DIR / "static" / "meshes.js",
    ROOT_DIR / "static" / "index.html",
    ROOT_DIR / "README.md",
    ROOT_DIR / "AGENTS.md",
    ROOT_DIR / ".mcp.json",
    ROOT_DIR / "mise.toml",
    ROOT_DIR / "scripts" / "quality_check.py",
    ROOT_DIR / "tests" / "test_room_sim.py",
]

HOME_PATH_RE = re.compile(r"/(?:Users|home)/[A-Za-z0-9_.-]+")


def _collect_dynamic_personal_terms() -> Set[str]:
    """
    Dynamically extracts room IDs, room names, and non-catalog item names
    from gitignored `data/rooms/*.json` so no personal strings are hardcoded in repo files.
    """
    sys.path.insert(0, str(ROOT_DIR))
    import catalog  # noqa: E402

    generic_names = {spec["name"] for spec in catalog.FURNITURE_CATALOG.values()}
    generic_presets = set(catalog.FURNITURE_CATALOG.keys()) | {"sample_room", "custom"}

    terms: Set[str] = {str(Path.home())}
    rooms_dir = ROOT_DIR / "data" / "rooms"
    if not rooms_dir.exists():
        return terms

    for rpath in rooms_dir.glob("*.json"):
        try:
            doc = json.loads(rpath.read_text(encoding="utf-8"))
        except Exception:
            continue
        room_id = str(doc.get("id", rpath.stem)).strip()
        if room_id and room_id not in generic_presets:
            terms.add(room_id)
        room_name = str(doc.get("room", {}).get("name", "")).strip()
        if room_name and room_name != "新規ルーム" and room_name != "サンプルルーム":
            terms.add(room_name)
        for item in doc.get("furniture", []):
            preset = str(item.get("preset", "")).strip()
            if preset and preset not in generic_presets:
                terms.add(preset)
            name = str(item.get("name", "")).strip()
            if name and name not in generic_names and len(name) >= 4:
                terms.add(name)
    return terms


def _collect_used_names(tree: ast.AST) -> Set[str]:
    """Collect all loaded identifier names and string-annotated type names in an AST."""
    used: Set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load):
            used.add(node.id)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            # Support `from __future__ import annotations` stringified type hints
            for token in re.findall(r"[A-Za-z_][A-Za-z0-9_]*", node.value):
                used.add(token)
    return used


def run_lint() -> List[str]:
    errors: List[str] = []

    # 1. Python AST syntax, unused imports, duplicate dict keys
    for py_path in PYTHON_FILES:
        rel = py_path.relative_to(ROOT_DIR)
        if not py_path.exists():
            errors.append(f"[LINT] Missing file: {rel}")
            continue

        source = py_path.read_text(encoding="utf-8")
        try:
            tree = ast.parse(source, filename=str(rel))
        except SyntaxError as exc:
            errors.append(f"[LINT] SyntaxError in {rel}:{exc.lineno}: {exc.msg}")
            continue

        used_names = _collect_used_names(tree)

        # Check explicit re-exports in __all__
        dunder_all: Set[str] = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id == "__all__":
                        if isinstance(node.value, (ast.List, ast.Tuple)):
                            for elt in node.value.elts:
                                if isinstance(elt, ast.Constant) and isinstance(elt.value, str):
                                    dunder_all.add(elt.value)

        # Check unused imports (only top-level imports that are not re-exported)
        for node in tree.body:
            if isinstance(node, ast.Import):
                for alias in node.names:
                    bound = alias.asname or alias.name.split(".")[0]
                    if bound not in used_names and bound not in dunder_all:
                        errors.append(
                            f"[LINT] {rel}:{node.lineno}: Unused import '{bound}'"
                        )
            elif isinstance(node, ast.ImportFrom):
                if node.module == "__future__":
                    continue
                for alias in node.names:
                    bound = alias.asname or alias.name
                    if bound not in used_names and bound not in dunder_all:
                        # In room_engine.py / mcp_server.py we intentionally re-export catalog symbols for backwards compatibility
                        if node.module == "catalog":
                            continue
                        errors.append(
                            f"[LINT] {rel}:{node.lineno}: Unused import '{bound}' from '{node.module}'"
                        )

        # Check duplicate literal keys in dicts
        for node in ast.walk(tree):
            if isinstance(node, ast.Dict):
                seen_keys: Set[object] = set()
                for key_node in node.keys:
                    if isinstance(key_node, ast.Constant):
                        k = key_node.value
                        if k in seen_keys:
                            errors.append(
                                f"[LINT] {rel}:{key_node.lineno}: Duplicate dict key {k!r}"
                            )
                        seen_keys.add(k)

    # 2. Check return type annotations on public functions in core modules
    for py_path in CORE_TYPED_MODULES:
        rel = py_path.relative_to(ROOT_DIR)
        tree = ast.parse(py_path.read_text(encoding="utf-8"), filename=str(rel))
        for node in tree.body:
            if isinstance(node, ast.FunctionDef) and not node.name.startswith("_"):
                if node.returns is None:
                    errors.append(
                        f"[LINT] {rel}:{node.lineno}: Public function '{node.name}' is missing a return type annotation"
                    )

    # 3. Check parity between catalog.FURNITURE_CATALOG, TYPE_THEME_PALETTE_MAP, and static/meshes.js
    sys.path.insert(0, str(ROOT_DIR))
    import catalog  # noqa: E402

    meshes_src = (ROOT_DIR / "static" / "meshes.js").read_text(encoding="utf-8")
    for cat_key, spec in catalog.FURNITURE_CATALOG.items():
        item_type = spec["type"]
        if f'"{item_type}"' not in meshes_src and f"'{item_type}'" not in meshes_src:
            errors.append(
                f"[LINT] Catalog item '{cat_key}' (type='{item_type}') has no 3D mesh builder in static/meshes.js"
            )
        if item_type not in catalog.TYPE_THEME_PALETTE_MAP:
            errors.append(
                f"[LINT] Catalog item '{cat_key}' (type='{item_type}') is missing from catalog.TYPE_THEME_PALETTE_MAP"
            )

    # 4. Check JS ES Module imports/exports alignment between app.js and meshes.js
    app_src = (ROOT_DIR / "static" / "app.js").read_text(encoding="utf-8")
    exported_funcs = set(
        re.findall(r"export\s+function\s+([A-Za-z0-9_]+)", meshes_src)
    )
    import_match = re.search(
        r"import\s*\{([^}]+)\}\s*from\s*['\"]\./meshes\.js['\"]", app_src
    )
    if not import_match:
        errors.append("[LINT] static/app.js is missing ES module import from './meshes.js'")
    else:
        imported_funcs = {
            tok.strip()
            for tok in import_match.group(1).split(",")
            if tok.strip()
        }
        missing_exports = imported_funcs - exported_funcs
        if missing_exports:
            errors.append(
                f"[LINT] static/app.js imports non-exported symbol(s) from meshes.js: {sorted(missing_exports)}"
            )

    return errors


def run_sast() -> List[str]:
    errors: List[str] = []

    # 1. Dangerous Python AST calls (eval, exec, shell=True, os.system, pickle)
    dangerous_builtins = {"eval", "exec", "compile"}
    for py_path in PYTHON_FILES:
        rel = py_path.relative_to(ROOT_DIR)
        tree = ast.parse(py_path.read_text(encoding="utf-8"), filename=str(rel))
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                if isinstance(node.func, ast.Name) and node.func.id in dangerous_builtins:
                    errors.append(
                        f"[SAST] {rel}:{node.lineno}: Dangerous builtin call '{node.func.id}()'"
                    )
                elif isinstance(node.func, ast.Attribute):
                    attr = node.func.attr
                    if isinstance(node.func.value, ast.Name):
                        mod = node.func.value.id
                        if (mod, attr) in {("os", "system"), ("os", "popen"), ("pickle", "loads"), ("pickle", "load")}:
                            errors.append(
                                f"[SAST] {rel}:{node.lineno}: Dangerous call '{mod}.{attr}()'"
                            )
                        if mod == "subprocess":
                            for kw in node.keywords:
                                if (
                                    kw.arg == "shell"
                                    and isinstance(kw.value, ast.Constant)
                                    and kw.value.value is True
                                ):
                                    errors.append(
                                        f"[SAST] {rel}:{node.lineno}: subprocess call with shell=True is forbidden"
                                    )

    # 2. Personal data & local path separation guard (AGENTS.md Rule 1)
    dynamic_personal_terms = _collect_dynamic_personal_terms()
    for prod_path in PRODUCTION_FILES:
        rel = prod_path.relative_to(ROOT_DIR)
        content = prod_path.read_text(encoding="utf-8")
        for term in dynamic_personal_terms:
            if term and term in content:
                errors.append(
                    f"[SAST] {rel}: Personal room/item data '{term}' from data/rooms/ leaked into tracked file"
                )
        match = HOME_PATH_RE.search(content)
        if match:
            errors.append(
                f"[SAST] {rel}: Local user path '{match.group(0)}' leaked into tracked file"
            )

    # 3. Path traversal protection verification on room_engine._sanitize_room_id
    sys.path.insert(0, str(ROOT_DIR))
    import room_engine  # noqa: E402

    traversal_payloads = [
        "../../../etc/passwd",
        "..\\..\\windows\\win.ini",
        "/absolute/path",
        "",
        "...",
    ]
    for payload in traversal_payloads:
        sanitized = room_engine._sanitize_room_id(payload)
        if ".." in sanitized or "/" in sanitized or "\\" in sanitized or not sanitized:
            errors.append(
                f"[SAST] room_engine._sanitize_room_id({payload!r}) returned unsafe room_id {sanitized!r}"
            )

    # 4. Network binding check in server.py (must bind to loopback by default, not 0.0.0.0)
    server_src = (ROOT_DIR / "server.py").read_text(encoding="utf-8")
    if "0.0.0.0" in server_src:
        errors.append("[SAST] server.py binds to 0.0.0.0 instead of loopback (127.0.0.1)")

    # 5. Frontend DOM XSS check: forbid template interpolation inside innerHTML
    for js_path in JS_FILES:
        rel = js_path.relative_to(ROOT_DIR)
        js_src = js_path.read_text(encoding="utf-8")
        for idx, line in enumerate(js_src.splitlines(), start=1):
            if ".innerHTML" in line and "${" in line:
                errors.append(
                    f"[SAST] {rel}:{idx}: Avoid template interpolation in innerHTML; use createElement + textContent"
                )

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Run Lint and SAST checks for Room-Sim")
    parser.add_argument("--lint", action="store_true", help="Run static lint checks")
    parser.add_argument("--sast", action="store_true", help="Run SAST security & data-hygiene checks")
    args = parser.parse_args()

    if not args.lint and not args.sast:
        args.lint = True
        args.sast = True

    all_errors: List[str] = []

    if args.lint:
        lint_errors = run_lint()
        all_errors.extend(lint_errors)
        if not lint_errors:
            print("✓ Lint checks passed (Python AST, type annotations, catalog↔mesh parity, ES modules)")

    if args.sast:
        sast_errors = run_sast()
        all_errors.extend(sast_errors)
        if not sast_errors:
            print("✓ SAST checks passed (no dangerous sinks, path traversal guard, personal data isolation, XSS checks)")

    if all_errors:
        for err in all_errors:
            print(err, file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())
