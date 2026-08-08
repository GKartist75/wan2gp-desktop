#!/usr/bin/env python3
"""
build-deb-local.py — Assemble a .deb package from electron-builder's linux-unpacked
output on hosts that can't run fpm (Windows without WSL/Docker).

Why this exists:
  - electron-builder's AppImage/deb targets need POSIX tooling (fpm, real symlinks)
    that Windows hosts can't provide, so `npx electron-builder --linux` fails with
    EPERM (symlink) / ENOENT (fpm). CI (ubuntu runner) handles the real packaging.
  - This script produces an equivalent, installable .deb by assembling the ar/tar
    members directly from dist/linux-unpacked — the exact binary electron-builder
    produced. It mirrors the layout electron-builder's own fpm run would create:
      /opt/Wan2GP Desktop Launcher/   (app files)
      /usr/bin/wan2gp-desktop         (symlink)
      /usr/share/applications/wan2gp-desktop.desktop
      /usr/share/icons/hicolor/1024x1024/apps/wan2gp-desktop.png
      /etc/apparmor.d/wan2gp-desktop  (from resources/apparmor-profile)

Usage:
  python3 scripts/build-deb-local.py [version]
  (version defaults to package.json version)

Output: dist/Wan2GP-Desktop-Launcher-<version>-linux-x86_64.deb
"""
import gzip
import hashlib
import io
import json
import os
import struct
import sys
import tarfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNPACKED = os.path.join(REPO, 'dist', 'linux-unpacked')
APP_DIR = '/opt/Wan2GP Desktop Launcher'
PKG = 'wan2gp-desktop'
BIN_NAME = 'wan2gp-desktop'
ARCH = 'amd64'

with open(os.path.join(REPO, 'package.json'), encoding='utf-8') as f:
    PKG_JSON = json.load(f)
VERSION = sys.argv[1] if len(sys.argv) > 1 else PKG_JSON['version']
DESC = PKG_JSON.get('description', 'Wan2GP desktop launcher')
HOMEPAGE = PKG_JSON.get('homepage', 'https://github.com/GKartist75/wan2gp-desktop')
MAINTAINER = 'GKartist75 <GKartist75@users.noreply.github.com>'


def installed_size_kb():
    total = 0
    for root, dirs, files in os.walk(UNPACKED):
        for f in files:
            total += os.path.getsize(os.path.join(root, f))
    return max(1, total // 1024)


def tar_add(tf, arcname, data=None, mode=0o644, type_=tarfile.REGTYPE, linkname=''):
    """Add an in-memory file or a symlink to a tar archive."""
    info = tarfile.TarInfo(arcname)
    if type_ == tarfile.SYMTYPE:
        info.type = type_
        info.linkname = linkname
        info.mode = 0o777
        tf.addfile(info)
        return
    info.size = len(data)
    info.mode = mode
    tf.addfile(info, io.BytesIO(data))


def tar_add_dir(tf, arcname, mode=0o755):
    """Add an explicit directory entry (dpkg requires dir members, not just files)."""
    if not arcname.endswith('/'):
        arcname += '/'
    info = tarfile.TarInfo(arcname)
    info.type = tarfile.DIRTYPE
    info.mode = mode
    tf.addfile(info)


def add_path_with_parents(tf, path):
    """Add directory entries for every component of an absolute target path."""
    parts = [p for p in path.split('/') if p]
    acc = ''
    for p in parts:
        acc += '/' + p
        tar_add_dir(tf, acc)


def build_data_tar():
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w', format=tarfile.GNU_FORMAT) as tf:
        # Explicit root directories (parents of everything below)
        for d in ['/opt', '/usr', '/usr/bin', '/usr/share', '/etc', '/etc/apparmor.d']:
            add_path_with_parents(tf, d)
        # App dir: files from linux-unpacked plus explicit dir entries
        for root, dirs, files in os.walk(UNPACKED):
            rel = os.path.relpath(root, UNPACKED)
            target_dir = APP_DIR if rel == '.' else f'{APP_DIR}/{rel}'
            add_path_with_parents(tf, target_dir)
            for f in files:
                src = os.path.join(root, f)
                arc = f'{target_dir}/{f}'
                with open(src, 'rb') as fh:
                    data = fh.read()
                mode = 0o755 if os.access(src, os.X_OK) else 0o644
                # chrome-sandbox must be setuid root for the Chromium sandbox to work
                if f == 'chrome-sandbox':
                    mode = 0o4755
                tar_add(tf, arc, data, mode=mode)
        # /usr/bin symlink
        tar_add(tf, '/usr/bin/wan2gp-desktop', type_=tarfile.SYMTYPE,
                linkname=f'{APP_DIR}/{BIN_NAME}')
        # .desktop entry
        desktop = (
            '[Desktop Entry]\n'
            f'Name={PKG_JSON.get("productName", "Wan2GP Desktop Launcher")}\n'
            f'Exec={APP_DIR}/{BIN_NAME} %U\n'
            'Terminal=false\n'
            'Type=Application\n'
            'Icon=wan2gp-desktop\n'
            'StartupWMClass=wan2gp-desktop\n'
            'Categories=Development;\n'
            f'Comment={DESC}\n'
        )
        tar_add(tf, '/usr/share/applications/wan2gp-desktop.desktop', desktop.encode(), mode=0o644)
        # Icon (1024x1024, AppImage/desktop standard)
        icon_src = os.path.join(REPO, 'resources', 'icon-1024.png')
        if os.path.exists(icon_src):
            with open(icon_src, 'rb') as fh:
                add_path_with_parents(tf, '/usr/share/icons/hicolor/1024x1024/apps')
                tar_add_dir(tf, '/usr/share/icons/hicolor/1024x1024/apps')
                tar_add(tf, '/usr/share/icons/hicolor/1024x1024/apps/wan2gp-desktop.png',
                        fh.read(), mode=0o644)
        # AppArmor profile (matches what electron-builder ships)
        aa_src = os.path.join(UNPACKED, 'resources', 'apparmor-profile')
        if os.path.exists(aa_src):
            with open(aa_src, 'rb') as fh:
                tar_add(tf, '/etc/apparmor.d/wan2gp-desktop', fh.read(), mode=0o644)
    return buf.getvalue()


def md5sums_of_data(data_tar_bytes):
    """Re-walk the data tar to compute md5s (dpkg wants md5sums relative to /)."""
    sums = {}
    with tarfile.open(fileobj=io.BytesIO(data_tar_bytes), mode='r') as tf:
        for m in tf.getmembers():
            if not m.isfile() or not m.name.startswith('/'):
                continue
            f = tf.extractfile(m)
            if f is not None:
                sums[m.name.lstrip('/')] = hashlib.md5(f.read()).hexdigest()
    return sums


def build_control_tar(md5sums):
    control = (
        f'Package: {PKG}\n'
        f'Version: {VERSION}\n'
        f'Architecture: {ARCH}\n'
        f'Maintainer: {MAINTAINER}\n'
        f'Installed-Size: {installed_size_kb()}\n'
        'Section: development\n'
        'Priority: optional\n'
        f'Homepage: {HOMEPAGE}\n'
        f'Description: {DESC}\n'
    )
    sums_text = ''.join(f'{h}  {p}\n' for p, h in sorted(md5sums.items()))
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w', format=tarfile.GNU_FORMAT) as tf:
        tar_add(tf, './control', control.encode(), mode=0o644)
        tar_add(tf, './md5sums', sums_text.encode(), mode=0o644)
    return buf.getvalue()


def gzip_bytes(data):
    return gzip.compress(data, mtime=0)


def ar_member(name, data):
    """One member of the ar (Unix archive) container, padded to even length."""
    header = struct.pack(
        '16s12s6s6s8s10s2s',
        name.encode()[:16].ljust(16),
        b'0'.ljust(12), b'0'.ljust(6), b'0'.ljust(6),
        b'100644'.ljust(8),
        str(len(data)).encode().ljust(10),
        b'`\n',
    )
    out = header + data
    if len(data) % 2 == 1:
        out += b'\n'
    return out


def build_deb():
    if not os.path.isdir(UNPACKED):
        sys.exit(f'ERROR: {UNPACKED} not found — run "npx electron-builder --linux dir" first')
    data_raw = build_data_tar()
    md5sums = md5sums_of_data(data_raw)
    control_raw = build_control_tar(md5sums)
    deb = b'!<arch>\n'
    deb += ar_member('debian-binary', b'2.0\n')
    deb += ar_member('control.tar.gz', gzip_bytes(control_raw))
    deb += ar_member('data.tar.gz', gzip_bytes(data_raw))
    out = os.path.join(REPO, 'dist', f'Wan2GP-Desktop-Launcher-{VERSION}-linux-x86_64.deb')
    with open(out, 'wb') as f:
        f.write(deb)
    print(f'[OK] {out} ({len(deb) / 1e6:.1f} MB)')
    print(f'     data members: {len(md5sums)} files, {installed_size_kb()} KB installed')
    return out


if __name__ == '__main__':
    build_deb()
