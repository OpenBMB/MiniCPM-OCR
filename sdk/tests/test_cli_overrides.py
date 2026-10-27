import pytest

from minicpmvocr.cli import _build_engine_overrides, _build_parser, parse_override_value


@pytest.mark.parametrize(
    "raw,expected",
    [

        ("off", "off"),
        ("on", "on"),
        ("yes", "yes"),
        ("no", "no"),
        ("Off", "Off"),

        ("true", True),
        ("false", False),
        ("True", True),
        ("FALSE", False),

        ("001", "001"),
        ("0755", "0755"),

        ("2026-10-18", "2026-10-18"),

        ("v1.6", "v1.6"),
        ("minicpm-ocr-1.0", "minicpm-ocr-1.0"),

        ("42", 42),
        ("-7", -7),
        ("3.5", 3.5),
        ("null", None),
        ("0x1f", 31),
    ],
)
def test_override_scalar_typing(raw, expected):
    assert parse_override_value(raw) == expected
    assert type(parse_override_value(raw)) is type(expected)


def test_structured_overrides_still_parse():

    assert parse_override_value("[http://a:1,http://b:2]") == ["http://a:1", "http://b:2"]
    assert parse_override_value("{image: 4}") == {"image": 4}


def test_importing_the_cli_does_not_change_global_yaml():

    import yaml

    import minicpmvocr.cli  # noqa: F401

    assert yaml.safe_load("interp: 2")["interp"] == 2
    assert yaml.safe_load("flag: off")["flag"] is False
    assert yaml.safe_load("d: 2026-10-18")["d"].year == 2026
    assert yaml.safe_load("n: 001")["n"] == 1


def test_run_tag_off_is_a_string_end_to_end():

    args = _build_parser().parse_args(
        ["run", "--config", "x.yaml", "--set", "run.run_tag=off",
         "--set", "layout.use_seal_recognition=true"]
    )
    overrides = _build_engine_overrides(args)
    assert overrides["run"]["run_tag"] == "off"
    assert overrides["layout"]["use_seal_recognition"] is True
