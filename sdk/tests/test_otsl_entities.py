from minicpmvocr.postprocess.otsl import convert_otsl_to_html


def test_raw_special_chars_escaped_once():
    out = convert_otsl_to_html("<fcel>A & B<fcel>it's<nl>")
    assert "A &amp; B" in out
    assert "it&#x27;s" in out


def test_model_emitted_entities_not_double_escaped():
    out = convert_otsl_to_html("<fcel>Children &amp; Families<fcel>it&#x27;s<nl>")
    assert "&amp;amp;" not in out
    assert "&amp;#x27;" not in out
    assert "Children &amp; Families" in out
    assert "it&#x27;s" in out


def test_html_escaped_otsl_tags_convert():
    raw = "&lt;fcel&gt;A&lt;fcel&gt;B&lt;nl&gt;&lt;fcel&gt;C&lt;fcel&gt;D&lt;nl&gt;"
    assert convert_otsl_to_html(raw) == (
        "<table><tr><td>A</td><td>B</td></tr>"
        "<tr><td>C</td><td>D</td></tr></table>"
    )
