import ast
import builtins
import pkgutil
from pathlib import Path

import pytest

import minicpmvocr

PACKAGE_DIR = Path(minicpmvocr.__file__).parent
REPO_ROOT = PACKAGE_DIR.parent


def _module_files():
    return sorted(p for p in PACKAGE_DIR.rglob("*.py") if "__pycache__" not in p.parts)


def _undefined_names(tree: ast.AST) -> set:

    defined = set(dir(builtins)) | {"__file__", "__name__", "__doc__"}
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                defined.add(alias.asname or alias.name.split(".")[0])
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            defined.add(node.name)
        elif isinstance(node, ast.Name) and isinstance(node.ctx, ast.Store):
            defined.add(node.id)
        elif isinstance(node, ast.arg):
            defined.add(node.arg)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            defined.add(node.name)
        elif isinstance(node, ast.Global):
            defined.update(node.names)
    used = {
        node.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load)
    }
    return used - defined


@pytest.mark.parametrize("path", _module_files(), ids=lambda p: p.name)
def test_no_undefined_names(path):
    assert _undefined_names(ast.parse(path.read_text(encoding="utf-8"))) == set()


_REEXPORT_MODULES = {"__init__.py"}


def _unused_imports(source: str) -> set:

    tree = ast.parse(source)
    imported = {}
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            for alias in node.names:
                if alias.name == "*":
                    continue
                imported[alias.asname or alias.name.split(".")[0]] = True
    mentioned = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    mentioned |= {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}


    return {
        name
        for name in imported
        if name != "annotations"
        and name not in mentioned
        and source.count(name) <= 1
    }


@pytest.mark.parametrize("path", _module_files(), ids=lambda p: p.name)
def test_no_unused_imports(path):
    if path.name in _REEXPORT_MODULES:
        pytest.skip("re-export surface")
    assert _unused_imports(path.read_text(encoding="utf-8")) == set()


def test_every_module_imports_cleanly():

    failed = {}
    for info in pkgutil.walk_packages([str(PACKAGE_DIR)], prefix="minicpmvocr."):
        try:
            __import__(info.name)
        except ImportError as exc:

            failed[info.name] = str(exc)
    hard = {
        name: err
        for name, err in failed.items()
        if not any(
            dep in err
            for dep in ("fitz", "paddle", "bs4", "torch", "transformers", "cv2", "shapely")
        )
    }
    assert hard == {}
