"""Check that PyPI link conversion preserves executable README examples."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from prepare_pypi_readme import render_readme


class PyPIReadmeTests(unittest.TestCase):
    def test_documents_images_and_anchors(self):
        source = '[Guide](./docs/guide.md#usage) <img src="./assets/a.png"> <a href="#start">Go</a>'
        result = render_readme(source, "team/repository")
        self.assertIn("https://github.com/team/repository/blob/main/docs/guide.md#usage", result)
        self.assertIn("https://raw.githubusercontent.com/team/repository/main/assets/a.png", result)
        self.assertIn("https://github.com/team/repository/blob/main/README.md#start", result)

    def test_code_examples_are_not_rewritten(self):
        source = '`[literal](./example)`\n```python\n[code](./example)\n```\n~~~text\n<img src="./example">\n~~~\n'
        self.assertTrue(render_readme(source).endswith(source))

    def test_absolute_and_email_links_are_unchanged(self):
        source = '[Web](https://example.com/a) [Mail](mailto:a@example.com) <img src="https://example.com/a.png">'
        self.assertTrue(render_readme(source).endswith(source))

    def test_markdown_images_spaces_and_release_ref(self):
        result = render_readme('![Image](<./assets/a b.png>) [Guide](./docs/guide.md)', "team/repository", "sdk-v1.0.1")
        self.assertIn("https://raw.githubusercontent.com/team/repository/sdk-v1.0.1/assets/a%20b.png", result)
        self.assertIn("https://github.com/team/repository/blob/sdk-v1.0.1/docs/guide.md", result)


if __name__ == "__main__":
    unittest.main()
