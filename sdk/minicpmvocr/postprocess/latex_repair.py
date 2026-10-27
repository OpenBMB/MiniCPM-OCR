"""LaTeX formula post-processing repairs.

Ported and extended from MinerU (mineru/model/mfr/utils.py), adapted for the
MiniCPM-V-ocr-pip pipeline.  Each function is a pure string → string transform
so it is safe to compose in any order and easy to unit-test.

Public entry point: ``repair_latex_formula(s, label)`` applies the full repair
chain.  Individual helpers are exported so callers can compose selectively.
"""
from __future__ import annotations

import re


_DELIM_TOKEN = (
    r"(?:"
    r"\\(?:lceil|rceil|lfloor|rfloor|backslash"
    r"|uparrow|downarrow|Uparrow|Downarrow)"
    r"|\\[{}|./]"
    r"|[()[\]{}/|]"
    r")?"
)


_LEFT_PATTERN  = re.compile(
    r"(\\left)(?![a-zA-Z])"
    r"(\\(?:lceil|rceil|lfloor|rfloor|backslash"
    r"|uparrow|downarrow|Uparrow|Downarrow"
    r"|langle|rangle)"
    r"|\\[{}|.]"
    r"|[()[\]{}/|.])?"
)
_RIGHT_PATTERN = re.compile(
    r"(\\right)(?![a-zA-Z])"
    r"(\\(?:lceil|rceil|lfloor|rfloor|backslash"
    r"|uparrow|downarrow|Uparrow|Downarrow"
    r"|langle|rangle)"
    r"|\\[{}|.]"
    r"|[()[\]{}/|.])?"
)
_LEFT_COUNT_PATTERN = re.compile(r"\\left(?![a-zA-Z])")
_RIGHT_COUNT_PATTERN = re.compile(r"\\right(?![a-zA-Z])")
_LEFT_RIGHT_REMOVE_PATTERN = re.compile(r"\\left(?![a-zA-Z])\.?|\\right(?![a-zA-Z])\.?")

_ENV_TYPES = [
    "array", "matrix", "pmatrix", "bmatrix", "vmatrix",
    "Bmatrix", "Vmatrix", "cases", "aligned", "gathered",
    "align", "align*",
]
_ENV_BEGIN = {e: re.compile(r"\\begin\{" + re.escape(e) + r"\}") for e in _ENV_TYPES}
_ENV_END   = {e: re.compile(r"\\end\{"   + re.escape(e) + r"\}") for e in _ENV_TYPES}
_ENV_FMT   = {e: re.compile(r"\\begin\{" + re.escape(e) + r"\}\{([^}]*)\}") for e in _ENV_TYPES}

_MATHRING_PATTERN = re.compile(
    r"\\mathring(?!\s*\{)\s*(?P<argument>\\mathrm\s*\{[^{}]*\})"
)
_DUPLICATE_ARRAY_CLOSE = re.compile(r"(\\end\{array\}\s*\\right\.\s*){2,}")
_DUPLICATE_BRACKET_CLOSE = re.compile(r"(\\\]\s*){2,}")
_TRAILING_BACKSLASH = re.compile(r"\\+$")


_VALID_DELIMS = {
    r"(", r")", r"[", r"]", r"{", r"}",
    r"/", r"|", r"\{", r"\}", r"\|", r"\.",
    r"\lceil", r"\rceil", r"\lfloor", r"\rfloor",
    r"\backslash", r"\uparrow", r"\downarrow",
    r"\Uparrow", r"\Downarrow",
}


def _is_escaped(text: str, pos: int) -> bool:
    count = 0
    j = pos - 1
    while j >= 0 and text[j] == "\\":
        count += 1
        j -= 1
    return count % 2 == 1


def _find_group_end(text: str, pos: int, depth: int) -> int:
    """Return index of the ``}`` that closes the brace group at *depth*."""
    current = depth
    i = pos
    while i < len(text):
        if text[i] == "{" and not _is_escaped(text, i):
            current += 1
        elif text[i] == "}" and not _is_escaped(text, i):
            current -= 1
            if current < depth:
                return i
        i += 1
    return -1


def fix_unbalanced_braces(s: str) -> str:
    """Remove unmatched ``{`` / ``}`` characters.

    Walks the string keeping a stack; any ``{`` without a matching ``}`` (and
    vice-versa) is dropped from the output.
    """
    stack: list[int] = []
    unmatched: set[int] = set()
    for i, ch in enumerate(s):
        if ch in "{}" and not _is_escaped(s, i):
            if ch == "{":
                stack.append(i)
            else:
                if stack:
                    stack.pop()
                else:
                    unmatched.add(i)
    unmatched.update(stack)
    return "".join(ch for i, ch in enumerate(s) if i not in unmatched)


def _fix_left_right_pairs(s: str) -> str:
    """Move ``\\right`` tokens that are in a different brace group from their
    matching ``\\left`` to sit just before the group's closing ``}``."""
    brace_stack: list[int] = []
    left_stack: list[tuple[int, int, str]] = []
    adjustments: list[tuple[int, int, int]] = []

    i = 0
    while i < len(s):
        if i > 0 and _is_escaped(s, i):
            i += 1
            continue

        if s[i: i + 5] == "\\left" and i + 5 < len(s) and not s[i + 5].isalpha():
            delim = s[i + 5] if i + 5 < len(s) else ""
            left_stack.append((i, len(brace_stack), delim))
            i += 6
            continue

        if s[i: i + 6] == "\\right" and i + 6 < len(s) and not s[i + 6].isalpha():
            if left_stack:
                left_pos, left_depth, _ = left_stack.pop()
                if left_depth != len(brace_stack):
                    target = _find_group_end(s, left_pos, left_depth)
                    if target != -1:
                        adjustments.append((i, i + 7, target))
            i += 7
            continue

        if s[i] == "{" and not _is_escaped(s, i):
            brace_stack.append(i)
        elif s[i] == "}" and not _is_escaped(s, i):
            if brace_stack:
                brace_stack.pop()
        i += 1

    if not adjustments:
        return s

    result = list(s)
    for start, end, target in sorted(adjustments, reverse=True, key=lambda x: x[0]):
        right_part = result[start:end]
        del result[start:end]
        result.insert(target, "".join(right_part))
    return "".join(result)


def fix_latex_left_right(s: str, *, fix_delimiter: bool = True) -> str:
    """Balance ``\\left`` / ``\\right`` pairs.

    Strategy
    --------
    1. If *fix_delimiter* is True, ensure each ``\\left`` / ``\\right`` is
       followed by a recognised delimiter; append ``\\.`` when it is not.
    2. Count bare ``\\left`` and ``\\right`` (excluding ``\\leftarrow`` etc.).
    3. If counts differ → safest option: strip all ``\\left`` / ``\\right``.
    4. If counts match  → check they are in the same brace group; move any
       that are not.
    """
    def _fix_delim(match: re.Match) -> str:
        cmd = match.group(1)
        delim = match.group(2)
        if not delim:

            return cmd + "."

        return match.group(0)

    if fix_delimiter:
        s = _LEFT_PATTERN.sub(_fix_delim, s)
        s = _RIGHT_PATTERN.sub(_fix_delim, s)

    left_count  = len(_LEFT_COUNT_PATTERN.findall(s))
    right_count = len(_RIGHT_COUNT_PATTERN.findall(s))

    if left_count == right_count:
        return _fix_left_right_pairs(s)

    return _LEFT_RIGHT_REMOVE_PATTERN.sub("", s)


def fix_latex_environments(s: str) -> str:
    """Ensure every ``\\begin{env}`` has a matching ``\\end{env}`` and vice-versa.

    When *end* outnumbers *begin*, missing ``\\begin`` tags are prepended.
    When *begin* outnumbers *end*, missing ``\\end`` tags are appended.
    """
    for env in _ENV_TYPES:
        begin_count = len(_ENV_BEGIN[env].findall(s))
        end_count   = len(_ENV_END[env].findall(s))
        if begin_count == end_count:
            continue
        if end_count > begin_count:
            fmt_match = _ENV_FMT[env].search(s)
            default_fmt = "{c}" if env == "array" else ""
            fmt_str = "{" + fmt_match.group(1) + "}" if fmt_match else default_fmt
            missing = end_count - begin_count
            s = (r"\begin{" + env + "}" + fmt_str + " ") * missing + s
        else:
            missing = begin_count - end_count
            s = s + (" \\end{" + env + "}") * missing
    return s


def fix_mathring_font_arguments(s: str) -> str:
    """Wrap bare ``\\mathrm{...}`` arguments of ``\\mathring`` in braces."""
    return _MATHRING_PATTERN.sub(
        lambda m: "\\mathring{" + m.group("argument") + "}", s
    )


def remove_duplicate_closures(s: str) -> str:
    """Remove runs of repeated ``\\end{array} \\right.`` or ``\\]``."""
    s = _DUPLICATE_ARRAY_CLOSE.sub(r"\\end{array} \\right.", s)
    s = _DUPLICATE_BRACKET_CLOSE.sub(r"\\]", s)
    return s


def remove_trailing_backslashes(s: str) -> str:
    """Strip trailing lone backslashes that would break compilation."""
    return _TRAILING_BACKSLASH.sub("", s).rstrip()


def repair_latex_formula(s: str, label: str = "") -> str:
    """Apply the full LaTeX repair chain.

    Safe to call on *any* formula string; returns the input unchanged when
    nothing is detected as broken.

    Parameters
    ----------
    s:
        Raw LaTeX string (no outer ``$`` / ``$$`` / ``\\[`` delimiters).
    label:
        Block label such as ``"display_formula"`` or ``"inline_formula"``.
        Currently used only for future label-specific paths; all repairs run
        regardless of label.
    """
    if not s or not s.strip():
        return s


    s = fix_unbalanced_braces(s)


    is_display = label in ("display_formula", "")
    s = fix_latex_left_right(s, fix_delimiter=is_display)


    s = fix_latex_environments(s)


    s = remove_duplicate_closures(s)


    s = remove_trailing_backslashes(s)

    return s
