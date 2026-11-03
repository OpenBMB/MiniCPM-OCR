from collections import Counter
import re


DISPLAY_BRACKET_SEP_RE = re.compile(re.escape(r"\]") + r"\s*" + re.escape(r"\["))
EMPTY_BRACKET_MATH_RE = re.compile(r"\\\[\s*\\\]|\\\(\s*\\\)")
DISPLAY_SPAN_RE = re.compile(r"\\\[(.*?)\\\]|\$\$(.*?)\$\$", re.DOTALL)
BEGIN_RE = re.compile(r"\\begin\{")
END_RE = re.compile(r"\\end\{")
INLINE_MATH_RE = re.compile(r"(?<!\\)\$(?!\$)(?:[^$\n]|\\.)+?(?<!\\)\$(?!\$)|\\\([^\n]*?\\\)")

TEXT_BLOCK_LABELS = {
    "text",
    "content",
    "abstract",
    "reference",
    "reference_content",
    "vertical_text",
    "vision_footnote",
    "header",
    "footer",
    "footnote",
    "aside_text",
}

# Blocks kept line for line (code, terminal output): never re-flowed or whitespace-collapsed.
VERBATIM_LABELS = {"algorithm"}


def _strip_spacing_tokens(content: str) -> str:
    content = re.sub(
        r"\\(?:quad|qquad|enspace|thinspace|medspace|thickspace|"
        r"negthinspace|negmedspace|negthickspace)(?![A-Za-z])",
        "",
        content,
    )
    content = re.sub(r"\\[,;:!]", "", content)
    content = re.sub(r"\\ ", "", content)
    content = re.sub(r"\\(?:hspace|vspace)\s*\{[^{}]*\}", "", content)
    return re.sub(r"[\s{}]", "", content.replace("~", ""))


def _repair_display_dollars(markdown: str) -> str:
    tokens = re.split(r"(\$\$)", markdown)
    output: list[str] = []
    in_display = False
    for index, token in enumerate(tokens):
        if token != "$$":
            output.append(token)
            continue
        next_segment = tokens[index + 1] if index + 1 < len(tokens) else ""
        next_is_delimiter = index + 2 < len(tokens) and tokens[index + 2] == "$$"
        has_later_delimiter = any(part == "$$" for part in tokens[index + 2:])
        if not in_display:
            if (not next_segment.strip() and next_is_delimiter) or not has_later_delimiter:
                continue
            output.append(token)
            in_display = True
        else:
            output.append(token)
            in_display = False
    if in_display:
        output.pop()
    return "".join(output)


def repair_display_formula(content: str) -> str:
    'Repair malformed display math without canonicalizing formula content.'
    content = _repair_display_dollars(content)
    content = EMPTY_BRACKET_MATH_RE.sub(" ", content)

    def clean_span(match: re.Match[str]) -> str:
        whole = match.group(0)
        is_bracket = whole.startswith(r"\[")
        body = match.group(1) if is_bracket else match.group(2)
        stripped = body.rstrip()
        trailing_whitespace = body[len(stripped):]
        if re.search(r"(?<!\\)\\$", stripped):
            body = stripped[:-1] + trailing_whitespace
        if body.strip() and not _strip_spacing_tokens(body):
            return " "
        return (r"\[" + body + r"\]") if is_bracket else f"$${body}$$"

    return DISPLAY_SPAN_RE.sub(clean_span, content)


def has_mixed_inline_formula_content(content: str) -> bool:
    'Whether an inline-formula crop also contains ordinary text.'
    stripped = (content or "").strip()
    if not stripped:
        return False
    if INLINE_MATH_RE.fullmatch(stripped):
        return False
    without_formulas = INLINE_MATH_RE.sub("", stripped)
    return bool(without_formulas.strip())


def _is_pipe_table_row(line: str) -> bool:
    stripped = line.strip()
    return (stripped.count("|") >= 2 and stripped.startswith("|")) or (
        stripped.count("|") >= 2 and "---" in stripped
    )


def split_text_block(content: str, *, protect_inline_math: bool = False) -> str:
    'Split ordinary text lines while preserving Markdown and math structures.'
    lines = content.split("\n")
    output: list[str] = []
    in_code = in_dollar = in_bracket = in_html_table = False
    in_inline_dollar = in_inline_paren = False
    env_depth = 0

    def protected() -> bool:
        return (
            in_code
            or in_dollar
            or in_bracket
            or in_html_table
            or in_inline_dollar
            or in_inline_paren
            or env_depth > 0
        )

    for index, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith("```"):
            output.append(line)
            in_code = not in_code
            continue
        if in_code:
            output.append(line)
            continue

        if "<table" in stripped.lower():
            in_html_table = True
        if in_html_table:
            output.append(line)
            if "</table>" in stripped.lower():
                in_html_table = False
            continue

        if _is_pipe_table_row(line):
            output.append(line)
            next_is_pipe_row = index + 1 < len(lines) and _is_pipe_table_row(lines[index + 1])
            if not next_is_pipe_row and output[-1].strip():
                output.append("")
            continue

        display_dollar_count = len(re.findall(r"(?<!\\)\$\$", line))
        bracket_opens = r"\[" in line and r"\]" not in line.split(r"\[", 1)[1]
        inline_dollar_count = len(re.findall(r"(?<!\\)(?<!\$)\$(?!\$)", line))
        inline_paren_opens = r"\(" in line and r"\)" not in line.split(r"\(", 1)[1]

        if protected():
            output.append(line)
            if in_dollar and display_dollar_count % 2:
                in_dollar = False
            if in_bracket and r"\]" in line:
                in_bracket = False
            if in_inline_dollar and inline_dollar_count % 2:
                in_inline_dollar = False
            if in_inline_paren and r"\)" in line:
                in_inline_paren = False
            env_depth = max(0, env_depth + len(BEGIN_RE.findall(line)) - len(END_RE.findall(line)))
            continue

        net_env = len(BEGIN_RE.findall(line)) - len(END_RE.findall(line))
        if display_dollar_count % 2 or bracket_opens or net_env > 0:
            output.append(line)
            in_dollar = display_dollar_count % 2 == 1
            in_bracket = bracket_opens
            env_depth = max(0, env_depth + net_env)
            continue
        if protect_inline_math and (inline_dollar_count % 2 or inline_paren_opens):
            output.append(line)
            in_inline_dollar = inline_dollar_count % 2 == 1
            in_inline_paren = inline_paren_opens
            continue

        if stripped:
            if output and output[-1].strip():
                output.append("")
            output.extend((stripped, ""))

    return re.sub(r"\n{3,}", "\n\n", "\n".join(output)).strip("\n")


def truncate_repetitive_content(content: str, min_count: int = 50) -> str:
    if not content or len(content) < min_count:
        return content
    stripped = content.strip()
    if not stripped:
        return content

    if "\n" not in stripped and len(stripped) > 100:
        for unit_len in range(8, len(stripped) // 5 + 1):
            unit = stripped[-unit_len:]
            count = 0
            pos = len(stripped) - unit_len
            while pos >= 0 and stripped[pos:pos + unit_len] == unit:
                count += 1
                pos -= unit_len
            if count >= 5:
                start_index = len(stripped) - (count * unit_len)
                prefix = stripped[:start_index]
                if len(unit) * count > len(stripped) * 0.5:
                    return prefix

    if "\n" not in stripped and len(stripped) > 10:
        for unit_len in range(1, len(stripped) // 2 + 1):
            unit = stripped[:unit_len]
            if unit * (len(stripped) // unit_len) == stripped[:unit_len * (len(stripped) // unit_len)]:
                count = len(stripped) // unit_len
                if count >= 10:
                    return unit
                break

    lines = [line.strip() for line in stripped.split("\n") if line.strip()]
    if len(lines) >= 10:
        most_common, count = Counter(lines).most_common(1)[0]
        if count >= 10 and count / len(lines) >= 0.8:
            return most_common
    return content


def postprocess_content(content: str, output_format: str, label: str = "") -> str:
    if content is None:
        return ""
    content = content.strip("\n") if label in VERBATIM_LABELS else content.strip()
    content = truncate_repetitive_content(content, min_count=5000 if label == "table" else 50)

    if output_format == "latex":
        if label == "display_formula":
            content = repair_display_formula(content)
        for left, right in (("$$", "$$"), ("$", "$"), ("\\(", "\\)"), ("\\[", "\\]")):
            if content.startswith(left) and content.endswith(right):
                content = content[len(left): len(content) - len(right)].strip()


        if label == "display_formula":
            content = DISPLAY_BRACKET_SEP_RE.sub("$$   $$", content)
            content = content.replace("\\[", "").replace("\\]", "")

        if label in ("display_formula", "inline_formula"):
            from .latex_repair import repair_latex_formula
            content = repair_latex_formula(content, label=label)
    elif output_format == "html":
        if content.startswith("```html"):
            content = content[7:]
        if content.startswith("```"):
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
        content = content.strip()


        if label == "table":
            open_count = content.count("<table")
            close_count = content.count("</table>")
            if open_count > close_count:
                content = content + ("</table>" * (open_count - close_count))
    return content


IMAGE_RENDER_MODES = ("reference", "placeholder")


# Title / section-heading / formula-number formatting ported from PaddleX
# common/result/converter/markdown_format_funcs.py (Apache-2.0), as PaddleOCR-VL renders Markdown.
_TITLE_NUMBERING = (
    r"(?:" + r"[1-9][0-9]*(?:\.[1-9][0-9]*)*[\.、]?|" + r"[\(\（](?:[1-9][0-9]*|["
    r"一二三四五六七八九十百千万亿零壹贰叁肆伍陆柒捌玖拾]+)[\)\）]|" + r"["
    r"一二三四五六七八九十百千万亿零壹贰叁肆伍陆柒捌玖拾]+"
    r"[、\.]?|" + r"(?:I|II|III|IV|V|VI|VII|VIII|IX|X)(?:\.|\s)" + r")"
)
TITLE_RE = re.compile(r"^\s*(" + _TITLE_NUMBERING + r")(\s*)(.*)$")

# label -> (first-line templates, heading format, splitter), as PaddleOCR-VL's abstract/reference handlers.
FIRST_LINE_HEADINGS = {
    "abstract": (("摘要", "abstract"), "## {line}\n", " "),
    "reference": (("参考文献", "references"), "## {line}", "\n"),
}


def _collapse_soft_newlines(text: str) -> str:
    return text.replace("-\n", "").replace("\n", " ")


def format_numbered_title(content: str) -> str:
    'Paragraph title whose depth follows its numbering: "2" -> ##, "2.1" -> ###, unnumbered -> ##.'
    title = content
    numbering = ""
    match = TITLE_RE.match(title)
    if match:
        numbering = match.group(1).strip()
        title = numbering + " " + match.group(3).lstrip()
    title = title.rstrip(".").rstrip()
    # Only the dots of the leading numbering set the depth. PaddleX counts every dot in the title, which pushes
    # "Vol. 17", "Dr. B. K. B. College" or "2023.01.30" down to #### and below.
    level = numbering.count(".") + 1
    return _collapse_soft_newlines("#%s %s" % ("#" * level, title))


def format_first_line(content: str, label: str) -> str:
    'Turn the first non-empty line into a heading when it is just "Abstract" / "References" (or 摘要 / 参考文献).'
    templates, heading, splitter = FIRST_LINE_HEADINGS[label]
    lines = content.split(splitter)
    for index, line in enumerate(lines):
        if line.strip() == "":
            continue
        if line.lower() in templates:
            lines[index] = heading.format(line=line)
        break
    return splitter.join(lines)


def merge_formula_and_number(formula: str, number: str) -> str:
    return "%s \\tag*{%s}" % (formula.replace("$$", ""), number)


TABLE_FIGURE_MODES = ("separate", "inline")


def table_figures_inline(assembly: dict) -> bool:
    'markdown.table_figures: "inline" puts a figure found inside a table into its cell (PaddleOCR-VL); "separate" leaves the cell empty and keeps the figure as its own block.'
    mode = str(assembly.get("table_figures") or "inline").strip().lower()
    if mode not in TABLE_FIGURE_MODES:
        raise ValueError(
            "markdown.table_figures must be one of %s, got %r"
            % (", ".join(TABLE_FIGURE_MODES), assembly.get("table_figures"))
        )
    return mode == "inline"


def markdown_url(path: str) -> str:
    'Image paths carry page names, which may hold spaces, parentheses or "%"; percent-encode those for the link target.'
    return path.replace("%", "%25").replace(" ", "%20").replace("(", "%28").replace(")", "%29")


def image_render_mode(assembly: dict) -> str:
    'markdown.image_render: "reference" links the saved crop, "placeholder" emits image_format.'
    mode = str(assembly.get("image_render") or "reference").strip().lower()
    if mode not in IMAGE_RENDER_MODES:
        raise ValueError(
            "markdown.image_render must be one of %s, got %r"
            % (", ".join(IMAGE_RENDER_MODES), assembly.get("image_render"))
        )
    return mode


# Defaults of the config `markdown:` section, i.e. the prompt map's markdown_assembly.
DEFAULT_MARKDOWN = {
    "ignore_labels": ["number", "footnote", "header", "header_image", "footer", "footer_image", "aside_text"],
    "title_format": {"doc_title": "# {content}", "paragraph_title": "## {content}", "figure_title": "*{content}*"},
    # PaddleOCR-VL Markdown: "numbered" derives the paragraph-title depth from its numbering
    # ("template" uses title_format); first_line_headings turns a leading "Abstract" / "References"
    # line into a heading; formula numbers are dropped unless show_formula_number folds them in as \tag*{}.
    "title_style": "numbered",
    "first_line_headings": True,
    "show_formula_number": False,
    # Figures painted as [F<n>] tokens inside a table: "inline" puts the <img> in the cell (PaddleOCR-VL);
    # "separate" empties the cell and keeps the figure as its own image (OmniDocBench leaves such cells empty).
    "table_figures": "inline",
    "formula_format": {"display_formula": "$$\n{content}\n$$", "inline_formula": "${content}$"},
    "table_format": "{content}",
    "image_format": "![image]()",
    "image_render": "reference",
    "image_show_ocr_content": None,
    "chart_format": "{content}",
    "seal_format": "{content}",
}
TITLE_STYLES = ("numbered", "template")


def validate_markdown(assembly: dict) -> None:
    'Reject unknown modes up front instead of on the first page.'
    image_render_mode(assembly)
    table_figures_inline(assembly)
    style = str(assembly.get("title_style") or "template").strip().lower()
    if style not in TITLE_STYLES:
        raise ValueError("markdown.title_style must be one of %s, got %r" % (", ".join(TITLE_STYLES), assembly.get("title_style")))
    if not isinstance(assembly.get("ignore_labels", []), (list, tuple, set)):
        raise ValueError("markdown.ignore_labels must be a list of label names, got %r" % (assembly.get("ignore_labels"),))


def assemble_markdown(blocks: list, prompt_cfg: dict) -> str:
    assembly = prompt_cfg.get("markdown_assembly", {})
    ignore_labels = set(assembly.get("ignore_labels", []))
    title_fmt = assembly.get("title_format", {})
    formula_fmt = assembly.get("formula_format", {})
    table_fmt = assembly.get("table_format", "{content}")
    image_fmt = assembly.get("image_format", "![image]()")
    chart_fmt = assembly.get("chart_format", "{content}")
    seal_fmt = assembly.get("seal_format", "{content}")
    image_render = image_render_mode(assembly)
    # None (default): show whatever text an image block was recognized with; False hides it.
    show_image_ocr = assembly.get("image_show_ocr_content") is not False
    # "numbered": PaddleOCR-VL titles (paragraph depth from numbering, newlines folded); "template": title_format.
    numbered_titles = str(assembly.get("title_style") or "template").strip().lower() == "numbered"
    first_line_headings = bool(assembly.get("first_line_headings", False))
    # PaddleOCR-VL drops formula numbers unless asked to fold them into the formula as \tag*{}.
    show_formula_number = bool(assembly.get("show_formula_number", False))
    figures_inline = table_figures_inline(assembly)

    def render_image_block(block: dict, content: str) -> str:
        'PaddleOCR-VL plain style: the image reference, then its recognized text when enabled.'
        image_path = block.get("image_path") if image_render == "reference" else ""
        if image_path:
            part = "![image](%s)" % markdown_url(image_path)
        elif "{content}" in image_fmt:
            return image_fmt.replace("{content}", content)
        else:
            part = image_fmt
        if show_image_ocr and content:
            part += "\n\n" + content
        return part

    parts = []
    ordered = sorted(blocks, key=lambda x: x.get("order", 0))
    for index, block in enumerate(ordered):
        label = block.get("label", "")
        content = block.get("content", "")
        if label in ignore_labels or (figures_inline and block.get("in_table")):
            continue
        if label == "formula_number":
            continue
        if not content and label not in ("image", "header_image", "footer_image", "chart", "seal"):
            continue
        if numbered_titles and label == "doc_title":
            parts.append(_collapse_soft_newlines("# " + content))
        elif numbered_titles and label == "paragraph_title":
            parts.append(format_numbered_title(content))
        elif label in title_fmt:
            parts.append(title_fmt[label].format(content=content))
        elif label in formula_fmt:
            if label == "inline_formula" and block.get("inline_formula_mixed", False):
                parts.append(content)
            else:
                next_block = ordered[index + 1] if index + 1 < len(ordered) else {}
                if show_formula_number and label == "display_formula" and next_block.get("label") == "formula_number":
                    content = merge_formula_and_number(content, (next_block.get("content") or "").replace("$", "").strip())
                parts.append(formula_fmt[label].format(content=content))
        elif first_line_headings and label in FIRST_LINE_HEADINGS:
            parts.append(format_first_line(content, label))
        elif label == "table":
            parts.append(table_fmt.format(content=content))
        elif label in ("image", "header_image", "footer_image"):
            parts.append(render_image_block(block, content))
        elif label == "chart":
            parts.append(chart_fmt.format(content=content) if content else render_image_block(block, content))
        elif label == "seal":
            parts.append(seal_fmt.format(content=content) if content else render_image_block(block, content))
        else:
            parts.append(content)
    return "\n\n".join(part for part in parts if part)
