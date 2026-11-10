#!/usr/bin/env python3
"""Build release archives for every skill in skills/.

Writes to the output directory:
  <skill>.zip           one folder per skill, the layout claude.ai and most agents expect
  agent-skills.tar.gz   every skill under skills/, for unpacking into a project
  SHA256SUMS            checksums for all of the above

Asset names carry no version so `releases/latest/download/<name>` always works.
Only files tracked by Git are packaged, with fixed timestamps, so builds are reproducible.
"""
import argparse
import gzip
import hashlib
import io
from pathlib import Path
import subprocess
import sys
import tarfile
import zipfile

EPOCH = (1980, 1, 1, 0, 0, 0)


def tracked_files(root):
    out = subprocess.run(["git", "ls-files", "-z", "skills"], cwd=root, check=True, capture_output=True).stdout
    return sorted(p for p in out.decode().split("\0") if p)


def build_zip(root, skill, files, dest):
    with zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as archive:
        for rel in files:
            path = root / rel
            info = zipfile.ZipInfo(str(Path(rel).relative_to("skills")), EPOCH)
            info.external_attr = ((0o755 if path.stat().st_mode & 0o111 else 0o644) | 0o100000) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())


def build_tarball(root, files, dest):
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.PAX_FORMAT) as archive:
        for rel in files:
            path = root / rel
            info = tarfile.TarInfo(rel)
            data = path.read_bytes()
            info.size, info.mtime = len(data), 0
            info.mode = 0o755 if path.stat().st_mode & 0o111 else 0o644
            archive.addfile(info, io.BytesIO(data))
    with open(dest, "wb") as handle, gzip.GzipFile(fileobj=handle, mode="wb", mtime=0, filename="") as gz:
        gz.write(raw.getvalue())


def package(root, out):
    root, out = Path(root).resolve(), Path(out)
    out.mkdir(parents=True, exist_ok=True)
    files = tracked_files(root)
    skills = sorted({Path(f).parts[1] for f in files if len(Path(f).parts) > 2})
    built = []
    for skill in skills:
        dest = out / f"{skill}.zip"
        build_zip(root, skill, [f for f in files if Path(f).parts[1] == skill], dest)
        built.append(dest)
    tarball = out / "agent-skills.tar.gz"
    build_tarball(root, files, tarball)
    built.append(tarball)
    sums = "".join(f"{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.name}\n" for p in built)
    (out / "SHA256SUMS").write_text(sums)
    return built


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--out", type=Path, default=Path("dist"))
    args = parser.parse_args()
    for path in package(args.root, args.out):
        print(path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
