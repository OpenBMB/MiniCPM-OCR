import ast
import importlib
from pathlib import Path

import pytest

import minicpmvocr

REPO_ROOT = Path(minicpmvocr.__file__).parent.parent
WEBUI_DIR = REPO_ROOT / "webui"


OPTIONAL_DEPS = ("cv2", "paddle", "torch", "fitz", "bs4", "transformers", "shapely")


def test_version_is_single_sourced():

    from minicpmvocr._version import __version__ as version_module_value

    assert minicpmvocr.__version__ == version_module_value

    pyproject = (REPO_ROOT / "pyproject.toml").read_text(encoding="utf-8")
    assert 'dynamic = ["version"]' in pyproject
    assert 'attr = "minicpmvocr._version.__version__"' in pyproject

    project_table = pyproject.split("[project]", 1)[1].split("\n[", 1)[0]
    assert "\nversion =" not in project_table


@pytest.mark.parametrize("name", sorted(n for n in minicpmvocr.__all__ if n != "__version__"))
def test_every_exported_name_resolves(name):
    try:
        assert getattr(minicpmvocr, name) is not None
    except ImportError as exc:
        if not any(dep in str(exc) for dep in OPTIONAL_DEPS):
            raise
        pytest.skip(f"optional extra missing: {exc}")


def test_exports_map_matches_all():
    assert set(minicpmvocr.__all__) == {"__version__", *minicpmvocr._EXPORTS}


def test_unknown_attribute_raises_attribute_error():

    with pytest.raises(AttributeError):
        minicpmvocr.no_such_name


def test_import_does_not_pull_heavy_optional_deps():

    import subprocess
    import sys

    code = (
        "import sys, minicpmvocr; "
        "print(','.join(m for m in ('torch','paddle','cv2','fitz') if m in sys.modules))"
    )
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True,
                         cwd=str(REPO_ROOT))
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "", f"eagerly imported: {out.stdout.strip()}"


def _minicpmvocr_imports(path: Path):

    tree = ast.parse(path.read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("minicpmvocr"):
            for alias in node.names:
                yield node.module, alias.name
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name.startswith("minicpmvocr"):
                    yield alias.name, ""


@pytest.mark.parametrize(
    "path",
    sorted(WEBUI_DIR.glob("*.py")) if WEBUI_DIR.is_dir() else [],
    ids=lambda p: p.name,
)
def test_webui_uses_only_public_symbols(path):

    offenders = [
        f"{module}.{name}"
        for module, name in _minicpmvocr_imports(path)
        if name.startswith("_")
        or any(part.startswith("_") for part in module.split("."))
    ]
    assert offenders == []
