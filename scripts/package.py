"""Build an install-only ZIP from declared runtime resources, using no dependencies."""
from pathlib import Path
import json
import zipfile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "manifest.json").read_text())
files = {"manifest.json", "popup.html", "popup.css", "popup.js", "README.md", "PRIVACY.md", "REFERENCES.md", "docs/VALIDATION.md"}
files.update(str(p.relative_to(root)) for p in (root / "src").glob("*.js"))
files.update(resource["path"] for resource in manifest["declarative_net_request"]["rule_resources"])
files.update(manifest.get("icons", {}).values())
files.update(manifest["action"].get("default_icon", {}).values())
destination = root / "dist" / f"adblocker-universal-{manifest['version']}.zip"
destination.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in sorted(files):
        source = (root / name).resolve()
        if not source.is_relative_to(root) or not source.is_file():
            raise ValueError(f"Missing or unsafe runtime resource: {name}")
        archive.write(source, Path("adblocker-universal") / name)
with zipfile.ZipFile(destination) as archive:
    assert archive.testzip() is None
    for name in files:
        assert archive.read(str(Path("adblocker-universal") / name)) == (root / name).read_bytes()
print(f"Packaged {len(files)} files: {destination.name}")
