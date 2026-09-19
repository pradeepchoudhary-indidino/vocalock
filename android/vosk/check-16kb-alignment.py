#!/usr/bin/env python3
"""Verify every 64-bit native library in an APK/AAB loads on a 16 KB page device.

    ./check-16kb-alignment.py app/build/outputs/apk/release/app-release.apk

Two things have to hold, and checking only the first is the usual mistake:

  1. Each PT_LOAD segment declares p_align >= 16384.
  2. p_offset is congruent to p_vaddr modulo 16384 — this is what the dynamic
     loader actually needs in order to mmap the segment. A library can satisfy
     (1) and still fail (2).

Parses the ELF directly rather than shelling out, because macOS awk has no
strtonum and a parsing slip here reports "ok" for a broken library.
"""
import struct
import sys
import zipfile

PAGE = 16384
# 16 KB pages are a 64-bit concern; 32-bit ABIs are exempt.
ABIS_TO_CHECK = {"arm64-v8a", "x86_64"}
PT_LOAD = 1


def load_segments(blob: bytes):
    """Yield (offset, vaddr, align) for each PT_LOAD of a 64-bit little-endian ELF."""
    if blob[:4] != b"\x7fELF":
        raise ValueError("not an ELF file")
    if blob[4] != 2:
        raise ValueError("not 64-bit")
    if blob[5] != 1:
        raise ValueError("not little-endian")

    e_phoff, = struct.unpack_from("<Q", blob, 0x20)
    e_phentsize, e_phnum = struct.unpack_from("<HH", blob, 0x36)

    for i in range(e_phnum):
        base = e_phoff + i * e_phentsize
        p_type, = struct.unpack_from("<I", blob, base)
        if p_type != PT_LOAD:
            continue
        p_offset, p_vaddr = struct.unpack_from("<QQ", blob, base + 0x08)
        p_align, = struct.unpack_from("<Q", blob, base + 0x30)
        yield p_offset, p_vaddr, p_align


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: check-16kb-alignment.py <apk|aab>", file=sys.stderr)
        return 2

    archive = sys.argv[1]
    failures = 0
    checked = 0

    with zipfile.ZipFile(archive) as zf:
        for name in sorted(zf.namelist()):
            parts = name.split("/")
            if len(parts) < 3 or parts[-3] != "lib" and not name.startswith("lib/"):
                pass
            if not name.endswith(".so"):
                continue
            abi = name.split("/")[-2]
            if abi not in ABIS_TO_CHECK:
                continue

            checked += 1
            problems = []
            try:
                segments = list(load_segments(zf.read(name)))
            except ValueError as exc:
                print(f"FAIL  {abi}/{name.split('/')[-1]}: {exc}")
                failures += 1
                continue

            if not segments:
                problems.append("no PT_LOAD segments")
            for offset, vaddr, align in segments:
                if align < PAGE:
                    problems.append(f"p_align={align} (<{PAGE})")
                if offset % PAGE != vaddr % PAGE:
                    problems.append(
                        f"offset 0x{offset:x} not congruent to vaddr 0x{vaddr:x} mod {PAGE}"
                    )

            short = f"{abi}/{name.split('/')[-1]}"
            if problems:
                print(f"FAIL  {short}: " + "; ".join(problems))
                failures += 1
            else:
                print(f"ok    {short}  ({len(segments)} LOAD segments)")

    if checked == 0:
        print("no 64-bit native libraries found — nothing to check")
        return 0
    print()
    if failures:
        print(f"{failures}/{checked} NOT 16 KB compatible — Play will reject this "
              "and it will fail on 16 KB devices.")
        return 1
    print(f"All {checked} 64-bit libraries are 16 KB compatible.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
