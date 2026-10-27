from pathlib import Path

import pytest
import yaml

import minicpmvocr
from minicpmvocr.config import DEFAULT_CONFIG

REFERENCE = Path(minicpmvocr.__file__).parent / "configs" / "minicpmvocr.yaml"


@pytest.fixture(scope="module")
def reference():


    return yaml.safe_load(REFERENCE.read_text(encoding="utf-8"))


def test_reference_config_exists():
    assert REFERENCE.is_file()


def test_every_section_is_present(reference):
    assert set(reference) == set(DEFAULT_CONFIG)


@pytest.mark.parametrize("section", sorted(DEFAULT_CONFIG))
def test_every_key_is_present(reference, section):
    documented = set(reference[section] or {})
    expected = set(DEFAULT_CONFIG[section])


    expected.discard("skip_vlm_labels")
    missing = expected - documented
    unknown = documented - set(DEFAULT_CONFIG[section])
    assert missing == set(), f"{section}: missing from reference config"
    assert unknown == set(), f"{section}: not a real config key"


def test_reference_config_is_shipped_in_the_wheel():

    pyproject = (Path(minicpmvocr.__file__).parent.parent / "pyproject.toml").read_text(
        encoding="utf-8"
    )
    assert 'minicpmvocr = ["py.typed", "configs/*.yaml"]' in pyproject
