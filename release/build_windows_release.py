"""Build the local Windows release with experimental image/webcam support."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile


ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / "release"
ZIP_NAME = "Smart_Kitchen_Final_Windows.zip"
MANIFEST = "release/SHA256_MANIFEST.json"
TOP_LEVEL = {
    ".gitattributes", ".gitignore", "README.md", "START_HERE.md", "setup_env.ps1",
    "Start_Smart_Kitchen.cmd", "RUN_ME_FIRST.cmd", "release/VERSION.txt",
    "app/run_app.py", "app/requirements-recipe.txt", "app/requirements-dev.txt",
    "app/requirements-vision.txt", "release/build_windows_release.py", "release/verify_vision.cjs",
    "train.py", "app.py", "requirements.txt", "data_checked.yaml", "models/best.pt",
}
APP_FILES = {
    "backend": {".py"}, "config": {".json", ".yaml"}, "core": {".py"},
    "frontend": {".html", ".css", ".js"}, "mapping": {".json", ".csv"},
    "processed": {".csv", ".json", ".md"}, "src": {".py"},
    "tests": {".py", ".cjs"}, "translations": {".json"},
}
PINNED = {
    "app/models/best.pt",
    "app/data/recipes_raw/SOURCE.json",
    "app/models/recipe_ml/recipe_tfidf_lsa_v1.npz",
    "app/models/recipe_ml/recipe_tfidf_lsa_v1.metadata.json",
}
OMIT = {"app/processed/recipe_detail_vi_ondemand_cache.json", "data/favorites.json"}


def digest(stream):
    return hashlib.file_digest(stream, "sha256").hexdigest()


def sha256(path):
    with path.open("rb") as stream:
        return digest(stream)


def payload_paths():
    paths = TOP_LEVEL | PINNED
    for folder, suffixes in APP_FILES.items():
        directory = ROOT / "app" / folder
        paths.update(
            file.relative_to(ROOT).as_posix()
            for file in directory.rglob("*")
            if file.is_file() and file.suffix in suffixes
            and not any(part.startswith(".") or part == "__pycache__"
                        for part in file.relative_to(directory).parts)
        )
    paths.update(file.relative_to(ROOT).as_posix() for file in (ROOT / "docs").glob("*.md"))
    # Preserve member1's CV pipeline, prototype, and submitted evaluation evidence.
    for folder, suffixes in {
        "cv": {".py"}, "core": {".py"}, "data": {".json"},
        "reports": {".json", ".csv", ".yaml", ".md", ".txt", ".png", ".jpg"},
    }.items():
        paths.update(file.relative_to(ROOT).as_posix() for file in (ROOT / folder).rglob("*")
                     if file.is_file() and file.suffix in suffixes
                     and "__pycache__" not in file.parts)
    return sorted(paths - OMIT)


def verify(archive, extracted=None):
    checksum_path = archive.with_suffix(".zip.sha256")
    checksum = sha256(archive)
    if checksum_path.read_text(encoding="ascii").strip() != f"{checksum}  {archive.name}":
        raise ValueError("ZIP SHA-256 mismatch")

    with ZipFile(archive) as zipped:
        files = zipped.infolist()
        names = [file.filename for file in files]
        if len(names) != len({name.casefold() for name in names}) or any(
            PurePosixPath(name).is_absolute() or ".." in PurePosixPath(name).parts
            or ":" in name or "\\" in name for name in names
        ):
            raise ValueError("ZIP contains duplicate or unsafe paths")
        manifest_bytes = zipped.read(MANIFEST)
        manifest = json.loads(manifest_bytes)
        entries = manifest["files"]
        if (set(names) != {MANIFEST, *(entry["path"] for entry in entries)}
                or not entries or len(entries) != manifest["file_count"] or len(names) != len(entries) + 1
                or sum(entry["bytes"] for entry in entries) != manifest["total_bytes"]):
            raise ValueError("ZIP does not match manifest inventory")
        if "app/models/best.pt" not in names or "app/requirements-vision.txt" not in names:
            raise ValueError("Experimental vision ZIP is missing its model or dependencies")
        model_config = json.loads(zipped.read("app/config/runtime_model.json"))
        with zipped.open("app/" + model_config["model_path"]) as model:
            if digest(model) != model_config["sha256"]:
                raise ValueError("YOLO checkpoint differs from runtime model configuration")
        for entry in entries:
            path = entry["path"]
            with zipped.open(path) as stream:
                if zipped.getinfo(path).file_size != entry["bytes"] or digest(stream) != entry["sha256"]:
                    raise ValueError(f"ZIP integrity failure: {path}")
            if extracted:
                file = extracted / path
                if file.stat().st_size != entry["bytes"] or sha256(file) != entry["sha256"]:
                    raise ValueError(f"Extracted payload differs: {path}")
        if extracted and (extracted / MANIFEST).read_bytes() != manifest_bytes:
            raise ValueError("Extracted manifest differs from ZIP")
    return {"sha256": checksum, "zip_bytes": archive.stat().st_size,
            "files": len(names), "extracted_bytes": sum(file.file_size for file in files)}


def build():
    entries = []
    for relative in payload_paths():
        file = ROOT / relative
        if file.is_symlink() or not file.resolve().is_relative_to(ROOT):
            raise ValueError(f"External file: {relative}")
        entries.append({"path": relative, "bytes": file.stat().st_size, "sha256": sha256(file)})

    manifest = {
        "version": "2026-11-24-members-integration",
        "source_release": "SMART_KITCHEN_FINAL_HANDOFF_20261116_V6",
        "scope": "Integrated recipe/vision app plus member1 CV tools and evidence; excludes the manifest itself",
        "file_count": len(entries),
        "total_bytes": sum(entry["bytes"] for entry in entries),
        "files": entries,
    }
    (ROOT / MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    archive = RELEASE / ZIP_NAME
    temporary = archive.with_suffix(".zip.tmp")
    with ZipFile(temporary, "w", compression=ZIP_DEFLATED, compresslevel=6) as zipped:
        for relative in sorted([MANIFEST, *(entry["path"] for entry in entries)]):
            zipped.write(ROOT / relative, relative)
    temporary.replace(archive)
    archive.with_suffix(".zip.sha256").write_text(
        f"{sha256(archive)}  {archive.name}\n", encoding="ascii",
    )
    return verify(archive)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify", action="store_true", help="Verify the existing release without rebuilding")
    parser.add_argument("--extracted", type=Path, help="Also verify an unpacked copy against the existing release")
    options = parser.parse_args()
    if options.verify or options.extracted:
        result = verify(RELEASE / ZIP_NAME, options.extracted)
    else:
        result = build()
    print(json.dumps(result, indent=2))
