from minicpmvocr.pipeline._text import _truncate_repetitive_suffix as f


def test_no_truncation_when_no_loop():
    text = r"a = b + c \end{array}"
    assert f(text) == text


def test_closing_env_preserved_after_qquad_loop():
    text = r"\frac{1}{2}" + r" \qquad" * 18 + r" \end{array}"
    assert r"\end{array}" in f(text)


def test_closing_bracket_preserved_after_loop():
    text = "x = 1" + " abc" * 18 + r" \]"
    assert r"\]" in f(text)


def test_display_dollar_preserved_after_loop():
    text = "E = mc^2" + " foo" * 18 + " $$"
    assert "$$" in f(text)


def test_html_table_close_preserved_after_loop():
    text = "<table><tr><td>x</td></tr>" + " spam" * 18 + " </table>"
    assert "</table>" in f(text)


def test_loop_without_closing_still_truncated():
    text = "hello world " + " abc" * 18
    result = f(text)
    assert len(result) < len(text)
    assert "hello" in result


def test_short_text_untouched():
    assert f("short text") == "short text"
