import pytest

from minicpmvocr.postprocess.latex_repair import repair_latex_formula
from minicpmvocr.postprocess.markdown import postprocess_content


@pytest.mark.parametrize(
    "formula",
    [
        r"\frac{a+b}{c}",
        r"\left(\frac{a}{b}\right)",
        r"\left\langle x,y\right\rangle",
        r"\{x\mid x>0\}",
        r"a\leftarrow b\rightarrow c\leftrightarrow d",
        r"\begin{pmatrix}a&b\\c&d\end{pmatrix}",
    ],
)
@pytest.mark.parametrize("label", ["display_formula", "inline_formula"])
def test_valid_formula_is_preserved(formula, label):
    assert repair_latex_formula(formula, label) == formula


@pytest.mark.parametrize(
    "formula,expected",
    [
        (r"x_{1}}", r"x_{1}"),
        (r"{x+1", "x+1"),
        (r"\left(x+1", "(x+1"),
        (r"\begin{matrix}a&b", r"\begin{matrix}a&b \end{matrix}"),
        (r"a&b\end{matrix}", r"\begin{matrix} a&b\end{matrix}"),
        ("x+1\\", "x+1"),
    ],
)
@pytest.mark.parametrize("label", ["display_formula", "inline_formula"])
def test_formula_blocks_are_repaired_during_postprocessing(formula, expected, label):
    assert postprocess_content(formula, "latex", label) == expected


@pytest.mark.parametrize(
    "formula,label",
    [("$$x_{1}}$$", "display_formula"), ("$x_{1}}$", "inline_formula")],
)
def test_outer_math_delimiters_are_removed_before_repair(formula, label):
    assert postprocess_content(formula, "latex", label) == r"x_{1}"


@pytest.mark.parametrize(
    "output_format,label",
    [("text", "text"), ("html", "table"), ("latex", "custom_formula")],
)
def test_other_content_is_not_rewritten(output_format, label):
    content = r"{literal text \leftarrow"
    assert postprocess_content(content, output_format, label) == content


@pytest.mark.parametrize("formula", ["", "   "])
def test_empty_formula_is_preserved(formula):
    assert repair_latex_formula(formula) == formula
