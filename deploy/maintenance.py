"""Bounded storage maintenance. Dry-run by default; never opens live DB for writing.

Automatic mode only rotates verified backups. Other categories require a reviewed
plan and an explicit apply invocation after deployment verification.
"""
import argparse
from contextlib import closing
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import time

DAY = 86400


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def plain_tree(path):
    if path.is_symlink() or not path.is_dir() or path.resolve() != path.absolute():
        raise ValueError('Unsafe candidate directory')
    # Dependency links are expected inside old release node_modules; rmtree
    # unlinks them without traversing. The directory itself must never be a link.
    for base, directories, _ in os.walk(path, followlinks=False):
        for name in directories:
            child = Path(base) / name
            if not child.is_symlink() and os.path.ismount(child):
                raise ValueError('Candidate contains a mount')


def verify_backup(path):
    manifest = json.loads((path / 'backup-manifest.json').read_text())
    if manifest.get('provider') != 'payload' or not manifest.get('files'):
        raise ValueError('Unknown backup')
    seen = set()
    for item in manifest['files']:
        file = path / item['path']
        if file.is_symlink() or not file.resolve().is_relative_to(path.resolve()):
            raise ValueError('Unsafe backup file')
        if digest(file) != item['sha256']:
            raise ValueError('Backup checksum mismatch')
        seen.add(item['path'])
    if not {'content.db', 'settings.json', 'migration-complete.json'} <= seen:
        raise ValueError('Incomplete backup')
    with closing(sqlite3.connect(f'file:{(path / "content.db").as_posix()}?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise ValueError('Invalid backup database')
    return manifest


def backup_time(path):
    manifest = json.loads((path / 'backup-manifest.json').read_text())
    stamp = manifest.get('createdAt')
    # Unknown creation times are preserved, never guessed from names or mtimes.
    return dt.datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp() if stamp else None


def backup_candidates(parent, now):
    known = []
    for path in parent.glob('payload-*'):
        if path.is_symlink() or not path.is_dir():
            continue
        try:
            stamp = backup_time(path)
            if stamp is not None:
                known.append((stamp, path))
        except (ValueError, KeyError, OSError):
            continue
    known.sort(reverse=True)
    keep = {p for _, p in known[:3]}
    keep.update(p for stamp, p in known if now - stamp < 14 * DAY)
    if len(keep) < 3:
        return []
    # A failed backup stops pruning entirely. Do not silently fall back to fewer.
    for path in sorted(keep):
        verify_backup(path)
    return [p for _, p in known if p not in keep]


def live_references():
    """Root-only production inspection; an unreadable process causes a stop."""
    refs = []
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit():
            continue
        try:
            for name in ['cwd', 'exe']:
                try:
                    refs.append(os.readlink(proc / name))
                except FileNotFoundError:
                    pass
            for fd in (proc / 'fd').iterdir():
                try:
                    refs.append(os.readlink(fd))
                except FileNotFoundError:
                    pass
            refs.append((proc / 'cmdline').read_bytes().decode(errors='replace').replace('\0', ' '))
            refs.append((proc / 'maps').read_text(errors='replace'))
        except (FileNotFoundError, ProcessLookupError):
            pass
    for base in ['/etc/systemd/system', '/etc/nginx', '/etc/sansphase']:
        for path in Path(base).rglob('*'):
            if path.is_file():
                refs.append(path.read_text(errors='replace'))
    return refs


def referenced(path, refs):
    name = str(path)
    # Match a complete directory prefix, not names such as vip-days/vip-days2.
    return any(re.search(re.escape(name) + r'(?:[/\\]|[\s\x00"\x27;]|$)', ref) for ref in refs)


def plan(root=Path('/'), now=None, categories=('backups',), refs=()):
    now = time.time() if now is None else now
    root = root.resolve()
    release_root = root / 'opt/sansphase/releases'
    current_link = root / 'opt/sansphase/current'
    if not current_link.is_symlink():
        raise ValueError('Missing current release pointer')
    current = current_link.resolve(strict=True)
    if current.parent != release_root:
        raise ValueError('Current release outside release root')
    releases = sorted([p for p in release_root.iterdir() if p.is_dir() and not p.is_symlink()],
                      key=lambda p: p.stat().st_mtime, reverse=True)
    protected = {current}
    protected.update([p for p in releases if p != current][:1])
    refs = list(refs)
    for release in protected:
        for base, directories, files in os.walk(release, followlinks=False):
            for name in directories + files:
                link = Path(base) / name
                if link.is_symlink():
                    refs.append(str(link.resolve()))
    candidates = []
    def add(path, kind):
        if kind not in categories or path in protected or referenced(path, refs):
            return
        plain_tree(path)
        st = path.stat()
        candidates.append({'path':str(path), 'kind':kind, 'device':st.st_dev, 'inode':st.st_ino})
    if 'releases' in categories:
        for path in releases:
            if re.fullmatch(r'[A-Za-z0-9_.-]+', path.name):
                add(path, 'releases')
    if 'publication' in categories:
        for release in sorted(protected):
            base = release / '.local/publication'
            if base.is_symlink():
                raise ValueError('Unsafe publication parent')
            snapshots = sorted([p for p in base.glob('sansphase-site-*') if p.is_dir()],
                               key=lambda p:p.stat().st_mtime, reverse=True)
            # Keep the latest preparation in each retained release.
            for path in snapshots[1:]:
                add(path, 'publication')
    if 'stages' in categories:
        for path in (root / 'home/ubuntu').glob('sansphase-stage-*'):
            if path.is_dir():
                add(path, 'stages')
    if 'checks' in categories:
        for path in (root / 'var/lib/sansphase').glob('*-check-*'):
            if path.is_dir():
                add(path, 'checks')
    if 'backups' in categories:
        for path in backup_candidates(root / 'var/backups/sansphase', now):
            add(path, 'backups')
    return {'current':str(current), 'protectedReleases':sorted(map(str,protected)), 'candidates':candidates}


def apply_plan(reviewed, fresh, refs):
    if reviewed != fresh:
        raise ValueError('Plan changed; review a new dry-run first')
    removed = []
    for item in fresh['candidates']:
        path = Path(item['path'])
        plain_tree(path)
        st = path.stat()
        if (st.st_dev, st.st_ino) != (item['device'], item['inode']) or referenced(path, refs):
            raise ValueError('Candidate identity or references changed')
        shutil.rmtree(path)
        removed.append(item)
    return removed


def main():
    import fcntl
    parser = argparse.ArgumentParser()
    parser.add_argument('--categories', default='backups')
    parser.add_argument('--plan', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--rotate-backups', action='store_true')
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise SystemExit('Run as root to inspect all process references')
    categories = tuple(args.categories.split(','))
    if not set(categories) <= {'backups','releases','publication','stages','checks'}:
        raise SystemExit('Unknown cleanup category')
    if args.rotate_backups and categories != ('backups',):
        raise SystemExit('Automatic mode only rotates backups')
    # Never allow receipt/log writes into public or live data directories.
    output = Path(args.plan)
    receipt_root = Path('/var/log/sansphase-maintenance')
    receipt_root.mkdir(mode=0o700, exist_ok=True)
    if output.parent.resolve() != receipt_root.resolve() or output.is_symlink():
        raise SystemExit('Receipt must be inside the private maintenance log directory')
    os.umask(0o077)
    with open('/run/lock/sansphase-maintenance.lock','w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        refs = live_references()
        fresh = plan(categories=categories, refs=refs)
        if args.rotate_backups:
            # Generated only after verifying all retained backups.
            output.write_text(json.dumps(fresh, indent=2))
        if args.apply or args.rotate_backups:
            reviewed = json.loads(output.read_text())
            removed = apply_plan(reviewed, fresh, live_references())
            result = {'removed':removed, 'protectedReleases':fresh['protectedReleases'], 'at':dt.datetime.now(dt.timezone.utc).isoformat()}
            output.with_suffix('.receipt.json').write_text(json.dumps(result, indent=2))
            print(json.dumps({'removedDirectories':len(removed)}))
        else:
            output.write_text(json.dumps(fresh, indent=2))
            print(json.dumps(fresh, indent=2))


if __name__ == '__main__':
    main()
