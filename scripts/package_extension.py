"""Build the downloadable unpacked Chrome extension archive."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
source = root / "chrome-extension"
output = root / "static" / "Katya-Browser-Bridge.zip"
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for path in sorted(source.iterdir()):
        if path.is_file():
            archive.write(path, path.name)
print(output)
