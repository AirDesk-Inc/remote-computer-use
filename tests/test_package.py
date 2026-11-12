"""Distribution checks that require neither AirDesk nor third-party packages."""

from pathlib import Path
import re
import struct
import unittest
from urllib.parse import unquote, urlsplit
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/remote-computer-use"


class PackageTests(unittest.TestCase):
    def test_local_markdown_links_resolve(self):
        for document in ROOT.rglob("*.md"):
            parts = document.relative_to(ROOT).parts
            if "node_modules" in parts:
                continue
            # A language overlay replaces files inside the installed skill, so its
            # links resolve from the matching place in the canonical skill.
            installed = SKILL.joinpath(*parts[2:]) if parts[0] == "locales" else document
            skill_root = SKILL if parts[0] == "locales" or document.is_relative_to(SKILL) else None
            text = document.read_text(encoding="utf-8")
            for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", text):
                parsed = urlsplit(target)
                if parsed.scheme or parsed.netloc or not parsed.path:
                    continue
                with self.subTest(document=str(document.relative_to(ROOT)), target=target):
                    resolved = (installed.parent / unquote(parsed.path)).resolve()
                    self.assertTrue(resolved.is_relative_to(ROOT))
                    self.assertTrue(resolved.is_file())
                    if skill_root:
                        self.assertTrue(resolved.is_relative_to(skill_root), "Copied skill must remain self-contained")

    def test_language_overlays_keep_the_skill_identity(self):
        for lang in ("ko", "ja"):
            overlay = ROOT / "locales" / lang
            for path in overlay.rglob("*"):
                if path.is_file():
                    with self.subTest(path=str(path.relative_to(ROOT))):
                        self.assertTrue((SKILL / path.relative_to(overlay)).is_file(), "Overlay must translate an existing file")
            text = (overlay / "SKILL.md").read_text(encoding="utf-8")
            self.assertTrue(text.startswith("---\nname: remote-computer-use\n"))
            english = (SKILL / "SKILL.md").read_text(encoding="utf-8")
            version = re.search(r'version: "([^"]+)"', english).group(1)
            self.assertIn(f'version: "{version}"', text)
            self.assertIn(f"language: {lang}", text)
            # Tool names, codes and the online endpoint are never translated.
            for token in ("remote_connect", "remote_status", "remote_desktop_skills_get", "WINDOW_REQUIRED",
                          "https://mcp.airdesk.co.kr/mcp", "references/online.md"):
                self.assertIn(token, text)
            online = (overlay / "references/online.md").read_text(encoding="utf-8")
            codes = set(re.findall(r"`([A-Z][A-Z_]{5,})`", (SKILL / "references/online.md").read_text(encoding="utf-8")))
            self.assertEqual(codes, set(re.findall(r"`([A-Z][A-Z_]{5,})`", online)))

    def test_portable_skill_includes_license_and_brand_notice(self):
        self.assertEqual((ROOT / "LICENSE").read_bytes(), (SKILL / "LICENSE.txt").read_bytes())
        self.assertTrue((SKILL / "assets/NOTICE.md").is_file())
        text = (SKILL / "SKILL.md").read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\nname: remote-computer-use\n"))
        self.assertIn("AI remote computer use (MCP) is ON", " ".join(text.split()))
        self.assertIn("controller's incoming shell setting and can remain off", " ".join(text.split()))
        self.assertIn("Confirm target access approval before `remote_connect`", " ".join(text.split()))
        self.assertIn("The target's MCP switch governs its own use as a controller.", " ".join(text.split()))
        self.assertIn("the target account's current AI terms", text)
        self.assertIn("target_ai_remote_access_terms_required", text)
        self.assertIn("`targetRemoteTerminal` when shell work is needed", text)

    def test_svg_assets_are_self_contained(self):
        for asset in [*(SKILL / "assets").glob("*.svg"), *(ROOT / 'docs/assets').glob('*.svg')]:
            tree = ET.parse(asset)
            for node in tree.iter():
                with self.subTest(asset=asset.name):
                    self.assertNotIn(node.tag.split("}")[-1].lower(), ("script", "foreignobject", "image"))
                    for key, value in node.attrib.items():
                        self.assertFalse(key.lower().startswith("on"))
                        if key.endswith("href"):
                            self.assertTrue(value.startswith("#"))
                        self.assertNotRegex(value, r"url\(['\"]?https?://")

    def test_cover_is_expected_png(self):
        image = (ROOT / "docs/assets/remote-computer-use.png").read_bytes()
        self.assertEqual(image[:8], b"\x89PNG\r\n\x1a\n")
        self.assertEqual(struct.unpack(">II", image[16:24]), (1200, 630))
        self.assertLess(len(image), 1024 * 1024)

    def test_current_cover_uses_conditional_shell_requirement(self):
        cover = ROOT / 'docs/assets/remote-computer-use.svg'
        tree = ET.parse(cover)
        text = ' '.join(tree.getroot().itertext())
        self.assertIn('Shell only: Remote Terminal + terms', text)
        labels = [node.text for node in tree.iter() if node.tag.endswith('}text')]
        self.assertEqual(labels.count('AI remote computer use (MCP) ON'), 1)
        self.assertEqual(tree.getroot().attrib['viewBox'], '0 0 1200 630')
        for readme in ['README.md', 'README.ko.md']:
            self.assertIn('src="docs/assets/remote-computer-use.svg"', (ROOT / readme).read_text(encoding='utf-8'))


if __name__ == "__main__":
    unittest.main()
