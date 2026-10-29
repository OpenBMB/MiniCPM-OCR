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
    "algorithm",
    "header",
    "footer",
    "footnote",
    "aside_text",
}


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
    content = truncate_repetitive_content(content.strip(), min_count=5000 if label == "table" else 50)

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


def image_render_mode(assembly: dict) -> str:
    'markdown_assembly.image_render: "reference" links the saved crop, "placeholder" emits image_format.'
    mode = str(assembly.get("image_render") or "reference").strip().lower()
    if mode not in IMAGE_RENDER_MODES:
        raise ValueError(
            "markdown_assembly.image_render must be one of %s, got %r"
            % (", ".join(IMAGE_RENDER_MODES), assembly.get("image_render"))
        )
    return mode


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

    def render_image_block(block: dict, content: str) -> str:
        'PaddleOCR-VL plain style: the image reference, then its recognized text when enabled.'
        image_path = block.get("image_path") if image_render == "reference" else ""
        if image_path:
            part = "![image](%s)" % image_path
        elif "{content}" in image_fmt:
            return image_fmt.replace("{content}", content)
        else:
            part = image_fmt
        if show_image_ocr and content:
            part += "\n\n" + content
        return part

    parts = []
    for block in sorted(blocks, key=lambda x: x.get("order", 0)):
        label = block.get("label", "")
        content = block.get("content", "")
        if label in ignore_labels:
            continue
        if not content and label not in ("image", "header_image", "footer_image", "chart", "seal"):
            continue
        if label in title_fmt:
            parts.append(title_fmt[label].format(content=content))
        elif label in formula_fmt:
            if label == "inline_formula" and block.get("inline_formula_mixed", False):
                parts.append(content)
            else:
                parts.append(formula_fmt[label].format(content=content))
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
