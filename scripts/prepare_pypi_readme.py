"""Generate the SDK's PyPI description from the repository README.

README.md remains the source of truth. The generated file is included in the
sdist so building a wheel from a standalone source distribution also works.
"""

import argparse
import posixpath
import re
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit, urlunsplit


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPOSITORY = "OpenBMB/MiniCPM-OCR"
HTML_URL = re.compile(r"(?P<prefix>\b(?:src|href)\s*=\s*)(?P<quote>[\"'])(?P<url>.*?)(?P=quote)")
MARKDOWN_URL = re.compile(r"(?P<prefix>!?\[[^\]\n]*\]\()(?P<url><[^>\n]+>|[^\s)]+)")


def render_readme(source, repository=DEFAULT_REPOSITORY, ref="main"):
    """Rewrite repository links without changing code examples or prose."""
    github = f"https://github.com/{repository}/blob/{quote(ref, safe='')}"
    raw = f"https://raw.githubusercontent.com/{repository}/{quote(ref, safe='')}"

    def absolute_url(url, image=False):
        parts = urlsplit(url)
        if parts.scheme or parts.netloc:
            return url
        if not parts.path:
            # PyPI sanitizes HTML anchors; use the original README's anchors.
            return f"{github}/README.md{url}"
        path = posixpath.normpath(unquote(parts.path))
        path = quote(path, safe="/@-._~")
        base = raw if image or path.startswith("assets/") else github
        return urlunsplit(("https", urlsplit(base).netloc, f"{urlsplit(base).path}/{path}", parts.query, parts.fragment))

    def html_url(match):
        url = absolute_url(match["url"], image=match["prefix"].lstrip().startswith("src"))
        return f'{match["prefix"]}{match["quote"]}{url}{match["quote"]}'

    def markdown_url(match):
        url = match["url"]
        angle = url.startswith("<")
        url = absolute_url(url[1:-1] if angle else url, image=match["prefix"].startswith("!"))
        return match["prefix"] + (f"<{url}>" if angle else url)

    lines = []
    fence = None
    for line in source.splitlines(keepends=True):
        marker = re.match(r"^\s{0,3}(`{3,}|~{3,})", line)
        if marker:
            run = marker[1]
            if fence is None:
                fence = run
            elif run[0] == fence[0] and len(run) >= len(fence):
                fence = None
            lines.append(line)
        elif fence is not None:
            lines.append(line)
        else:
            # Split around inline code so paths in commands remain executable.
            pieces = re.split(r"(`+[^`]*`+)", line)
            for index in range(0, len(pieces), 2):
                pieces[index] = MARKDOWN_URL.sub(markdown_url, HTML_URL.sub(html_url, pieces[index]))
            lines.append("".join(pieces))
    return "<!-- Generated from the repository README.md; do not edit manually. -->\n\n" + "".join(lines)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", default=DEFAULT_REPOSITORY, help="GitHub owner/repository")
    parser.add_argument("--ref", default="main", help="GitHub branch, tag or commit used by links")
    parser.add_argument("--check", action="store_true", help="Fail if the generated description is stale")
    args = parser.parse_args()
    destination = ROOT / "sdk" / "README.pypi.md"
    description = render_readme((ROOT / "README.md").read_text(encoding="utf-8"), args.repository, args.ref)
    if args.check:
        if not destination.is_file() or destination.read_text(encoding="utf-8") != description:
            parser.exit(1, "PyPI README is stale; run python scripts/prepare_pypi_readme.py\n")
    else:
        destination.write_text(description, encoding="utf-8")
        print(f"Generated {destination.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
