import subprocess
import sys

import pytest


@pytest.mark.parametrize(
    "statement",
    [
        "import minicpmvocr.layouts",
        "import minicpmvocr.prompts",
        "import minicpmvocr.pipeline._text",
    ],
)
def test_lightweight_imports_do_not_load_detectors_or_optional_frameworks(statement):
    code = f"""
import sys
{statement}
unexpected = [name for name in sys.modules if
    name.startswith('minicpmvocr.layouts.ppdoclayout3_') or
    name.split('.')[0] in {{'paddle', 'paddlex', 'torch', 'transformers'}}]
assert not unexpected, unexpected
"""
    result = subprocess.run([sys.executable, "-B", "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


@pytest.mark.parametrize(
    "provider,class_name",
    [
        ("ppdoclayout3_paddlex", "PPDocLayoutV3PaddleXDetector"),
        ("ppdoclayout3_server", "PPDocLayoutV3ServerDetector"),
        ("ppdoclayout3_torch", "PPDocLayoutV3TorchDetector"),
    ],
)
def test_detector_class_exports_still_resolve(provider, class_name):
    from minicpmvocr import layouts

    detector = layouts.resolve_layout_provider_class({"provider": provider})
    assert detector is getattr(layouts, class_name)


def test_custom_detector_registration_still_works(monkeypatch):
    from minicpmvocr import layouts

    class CustomDetector:
        def __init__(self, config):
            self.config = config

    monkeypatch.setitem(layouts.LAYOUT_REGISTRY, "custom", CustomDetector)
    config = {"provider": "custom"}
    assert layouts.resolve_layout_provider_class(config) is CustomDetector
    assert layouts.create_layout_detector(config).config == config


def test_registry_get_resolves_a_lazy_detector():
    from minicpmvocr import layouts

    assert layouts.LAYOUT_REGISTRY.get("ppdoclayout3_paddlex") is layouts.PPDocLayoutV3PaddleXDetector
    fallback = object()
    assert layouts.LAYOUT_REGISTRY.get("unknown", fallback) is fallback
