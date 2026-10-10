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
import stat
import subprocess
import tempfile
import time

DAY = 86400
RECEIPT_ROOT = Path('/var/log/sansphase-maintenance')
PROFILES = {
    'main': {'base': 'opt/sansphase', 'backup': 'var/backups/sansphase',
             'provider': 'payload',
             'required': {'content.db', 'settings.json', 'migration-complete.json'}},
    'community': {'base': 'opt/sansphase-community', 'backup': 'var/backups/sansphase-community',
                  'provider': 'sansphase-community',
                  'required': {'content.db', 'community-host.db', 'settings.json'}},
}


def profile_settings(profile):
    if profile not in PROFILES:
        raise ValueError('Unknown maintenance profile')
    return PROFILES[profile]


def safe_name(value):
    return isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.-]+', value) is not None and value not in {'.', '..'}


def timestamp(value):
    if not isinstance(value, str):
        raise ValueError('Missing backup creation time')
    parsed = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError('Backup creation time must include a timezone')
    return parsed.timestamp()


def json_object(pairs):
    result = {}
    for name, value in pairs:
        if name in result:
            raise ValueError('Duplicate JSON key')
        result[name] = value
    return result


def read_json(path):
    path = Path(path)
    entry = path.lstat()
    if not stat.S_ISREG(entry.st_mode) or path.resolve(strict=True) != path.absolute():
        raise ValueError('Unsafe JSON file')
    if entry.st_size > 16 * 1024 ** 2:
        raise ValueError('Oversized maintenance manifest')
    return json.loads(path.read_text(), object_pairs_hook=json_object)


def read_backup_identity(path, profile='main'):
    settings = profile_settings(profile)
    manifest = read_json(Path(path) / 'backup-manifest.json')
    if not isinstance(manifest, dict) or manifest.get('provider') != settings['provider']:
        raise ValueError('Unknown backup provider')
    if profile == 'community' and (type(manifest.get('version')) is not int or manifest['version'] != 1):
        raise ValueError('Unknown community backup version')
    if profile == 'main' and manifest.get('profileWorkflow') not in {None, 'durable-v1'}:
        raise ValueError('Unknown profile workflow backup version')
    timestamp(manifest.get('createdAt'))
    return manifest


def read_backup_manifest(path, profile='main'):
    settings = profile_settings(profile)
    manifest = read_backup_identity(path, profile)
    files = manifest.get('files')
    if not isinstance(files, list) or not files:
        raise ValueError('Unknown backup file list')
    names = set()
    for item in files:
        if not isinstance(item, dict):
            raise ValueError('Unknown backup entry')
        name = item.get('path')
        if (not isinstance(name, str) or not name or '\\' in name or ':' in name
            or any(ord(char) < 32 or ord(char) == 127 for char in name)
            or any(part in {'', '.', '..'} for part in name.split('/'))
            or name in names or name == 'backup-manifest.json'):
            raise ValueError('Unsafe or duplicate backup path')
        if not isinstance(item.get('sha256'), str) or re.fullmatch(r'[0-9a-f]{64}', item['sha256']) is None:
            raise ValueError('Unknown backup checksum')
        size = item.get('bytes')
        if (profile == 'community' or 'bytes' in item) and (type(size) is not int or size < 0):
            raise ValueError('Invalid backup file size')
        names.add(name)
    if not settings['required'] <= names:
        raise ValueError('Incomplete backup manifest')
    if profile == 'main' and manifest.get('profileWorkflow') == 'durable-v1' and 'reader-workflow.db' not in names:
        raise ValueError('Incomplete durable reader workflow backup')
    return manifest


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def plain_tree(path):
    if path.is_symlink() or not path.is_dir() or path.resolve() != path.absolute():
        raise ValueError('Unsafe candidate directory')
    if os.path.ismount(path):
        raise ValueError('Candidate is a mount')
    # Dependency links are expected inside old release node_modules; rmtree
    # unlinks them without traversing. The directory itself must never be a link.
    for base, directories, _ in os.walk(path, followlinks=False):
        for name in directories:
            child = Path(base) / name
            if not child.is_symlink() and os.path.ismount(child):
                raise ValueError('Candidate contains a mount')


def verify_community_backup(path):
    """Use the existing community validator, including both DB roles and images.

    Captured verifier output is private and is never forwarded to logs/errors.
    """
    command = ['/usr/bin/node', '/opt/sansphase-community/current/scripts/backup-community.mjs', '--verify', str(path)]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=1800)
    except subprocess.TimeoutExpired:
        raise ValueError('Community backup verifier timed out') from None
    except OSError:
        raise ValueError('Community backup verifier is unavailable') from None
    if result.returncode != 0:
        raise ValueError(f'Community backup verifier failed (exit {result.returncode})')
    try:
        summary = json.loads(result.stdout)
    except json.JSONDecodeError:
        raise ValueError('Community backup verifier returned invalid JSON') from None
    if not isinstance(summary, dict) or summary.get('directory') != str(path) or summary.get('files') != len(read_backup_manifest(path, 'community')['files']):
        raise ValueError('Community backup verifier returned an invalid summary')


def verify_backup(path, profile='main'):
    path = Path(path)
    plain_tree(path)
    manifest = read_backup_manifest(path, profile)
    seen = set()
    expected_directories = {'uploads'}
    for item in manifest['files']:
        file = path / item['path']
        entry = file.lstat()
        if not stat.S_ISREG(entry.st_mode) or file.resolve(strict=True) != file.absolute() or entry.st_nlink != 1:
            raise ValueError('Unsafe backup file')
        if 'bytes' in item and entry.st_size != item['bytes']:
            raise ValueError('Backup size mismatch')
        if digest(file) != item['sha256']:
            raise ValueError('Backup checksum mismatch')
        seen.add(item['path'])
        expected_directories.update(parent.as_posix() for parent in Path(item['path']).parents if parent != Path('.'))
        if file.suffix == '.db':
            with closing(sqlite3.connect(file.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
                if db.execute('PRAGMA integrity_check').fetchall() != [('ok',)] or db.execute('PRAGMA foreign_key_check').fetchall():
                    raise ValueError('Invalid backup database')
    actual_files = set()
    for base, directories, files in os.walk(path, followlinks=False):
        for name in directories:
            directory = Path(base) / name
            if directory.is_symlink() or directory.relative_to(path).as_posix() not in expected_directories:
                raise ValueError('Unknown directory in backup')
        actual_files.update((Path(base) / name).relative_to(path).as_posix() for name in files)
    if actual_files != seen | {'backup-manifest.json'}:
        raise ValueError('Unknown file in backup')
    if profile == 'community':
        verify_community_backup(path)
    return manifest


def backup_time(path, profile='main'):
    # Classification is deliberately weaker than validation: a recognizable
    # newest/14-day backup may be incomplete, and must stop pruning rather than
    # silently fall back to three older copies.
    manifest = read_backup_identity(path, profile)
    stamp = manifest.get('createdAt')
    # Unknown creation times are preserved, never guessed from names or mtimes.
    return timestamp(stamp)


def backup_candidates(parent, now, profile='main', anchors=()):
    profile_settings(profile)
    parent = Path(parent)
    if parent.is_symlink() or (parent.exists() and parent.resolve(strict=True) != parent.absolute()):
        raise ValueError('Unsafe backup parent')
    known = []
    # Manual, pre-release and scheduled backups have different names. The
    # fixed parent and verified manifest define purpose, never a guessed prefix.
    for path in parent.iterdir() if parent.exists() else ():
        if not safe_name(path.name) or path.is_symlink() or not path.is_dir():
            continue
        try:
            stamp = backup_time(path, profile)
            if stamp is not None:
                known.append((stamp, path))
        except (ValueError, KeyError, OSError, TypeError):
            continue
    known.sort(reverse=True)
    keep = {p for _, p in known[:3]}
    keep.update(p for stamp, p in known if now - stamp < 14 * DAY)
    if len(known) < 3:
        return []
    for anchor in anchors:
        path = Path(anchor['path'])
        if profile != 'community' or path.parent != parent or digest(path / 'backup-manifest.json') != anchor['manifestSha256']:
            raise ValueError('Offsite anchor changed')
        keep.add(path)
    # A failed backup stops pruning entirely. Do not silently fall back to fewer.
    for path in sorted(keep):
        verify_backup(path, profile)
    candidates = []
    for _, path in known:
        if path in keep:
            continue
        try:
            verify_backup(path, profile)
        except (ValueError, KeyError, OSError, TypeError, sqlite3.Error):
            # Old unreadable, incomplete, changed or unclassified copies stay.
            continue
        candidates.append(path)
    return candidates


def private_directory(path, trusted_uid=0):
    path = Path(path)
    entry = path.lstat()
    if not stat.S_ISDIR(entry.st_mode) or path.resolve(strict=True) != path.absolute() or entry.st_uid != trusted_uid or entry.st_mode & 0o077:
        raise ValueError('Maintenance directory must be private root storage')


def private_output(path, trusted_uid=0):
    if path.exists() or path.is_symlink():
        entry = path.lstat()
        if not stat.S_ISREG(entry.st_mode) or entry.st_uid != trusted_uid or entry.st_mode & 0o077 or entry.st_nlink != 1:
            raise ValueError('Maintenance output must remain private root storage')


def atomic_json(path, value, trusted_uid=0):
    """Persist progress using the standard private-temp-file/replace pattern."""
    path = Path(path)
    private_directory(path.parent, trusted_uid)
    private_output(path, trusted_uid)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=path.parent,
                prefix='.' + path.name + '.', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        private_output(path, trusted_uid)
        os.replace(temporary, path)
        temporary = None
        if os.name == 'posix':
            parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:os.fsync(parent_fd)
            finally:os.close(parent_fd)
    finally:
        if temporary is not None:
            temporary.unlink()


def read_offsite_anchors(receipt_path, backup_parent, receipt_root=RECEIPT_ROOT, trusted_uid=0):
    """Root attestation of already verified offsite copies, not an upload job.

    Its three immutable snapshots remain extra protected anchors as newer daily
    backups arrive. The archive hash is bound to the operator's verified receipt;
    this host does not pretend to have contacted the offsite archive.
    """
    receipt_path, receipt_root, backup_parent = map(Path, (receipt_path, receipt_root, backup_parent))
    private_directory(receipt_root, trusted_uid)
    entry = receipt_path.lstat()
    if (receipt_path.parent != receipt_root or receipt_path.resolve(strict=True) != receipt_path.absolute()
        or not stat.S_ISREG(entry.st_mode) or entry.st_uid != trusted_uid or entry.st_mode & 0o077 or entry.st_nlink != 1):
        raise ValueError('Offsite receipt must be private root storage')
    receipt = read_json(receipt_path)
    if not isinstance(receipt, dict) or receipt.get('schema') != 'sansphase-verified-offsite-v1' or receipt.get('profile') != 'community':
        raise ValueError('Unknown offsite receipt')
    timestamp(receipt.get('verifiedAt'))
    entries = receipt.get('backups')
    if not isinstance(entries, list) or len(entries) != 3:
        raise ValueError('Exactly three verified offsite anchors are required')
    names, anchors = set(), []
    for item in entries:
        if not isinstance(item, dict) or not safe_name(item.get('name')) or item['name'] in names:
            raise ValueError('Unsafe or duplicate offsite anchor')
        names.add(item['name'])
        for field in ['manifestSha256', 'archiveSha256']:
            if not isinstance(item.get(field), str) or re.fullmatch(r'[0-9a-f]{64}', item[field]) is None:
                raise ValueError('Invalid offsite anchor checksum')
        path = backup_parent / item['name']
        plain_tree(path)
        if digest(path / 'backup-manifest.json') != item['manifestSha256']:
            raise ValueError('Offsite anchor manifest changed')
        verify_backup(path, 'community')
        anchors.append({'path': str(path), 'manifestSha256': item['manifestSha256'], 'archiveSha256': item['archiveSha256']})
    return anchors


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
    for base in ['/etc/systemd/system', '/etc/nginx', '/etc/sansphase', '/etc/sansphase-community']:
        for path in Path(base).rglob('*'):
            if path.is_file():
                refs.append(path.read_text(errors='replace'))
    return refs


def referenced(path, refs):
    name = str(path)
    # Match a complete directory prefix, not names such as vip-days/vip-days2.
    return any(re.search(re.escape(name) + r'(?:[/\\]|[\s\x00"\x27;]|$)', ref) for ref in refs)


def plan(root=Path('/'), now=None, categories=('backups',), refs=(), profile='main', anchors=()):
    settings = profile_settings(profile)
    if profile == 'community' and categories != ('backups',):
        raise ValueError('Community maintenance only rotates backups')
    now = time.time() if now is None else now
    root = root.resolve()
    release_root = root / settings['base'] / 'releases'
    current_link = root / settings['base'] / 'current'
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
        parent = path.parent.stat()
        candidates.append({'path':str(path), 'kind':kind, 'device':st.st_dev, 'inode':st.st_ino,
                           'parentDevice':parent.st_dev, 'parentInode':parent.st_ino,
                           **({'manifestSha256':digest(path/'backup-manifest.json')} if kind == 'backups' else {})})
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
        for path in backup_candidates(root / settings['backup'], now, profile, anchors):
            add(path, 'backups')
    return {'profile':profile, 'current':str(current), 'protectedReleases':sorted(map(str,protected)),
            'offsiteAnchors':list(anchors), 'candidates':candidates}


def apply_plan(reviewed, fresh, refs, on_removed=None):
    if reviewed != fresh:
        raise ValueError('Plan changed; review a new dry-run first')
    removed = []
    # Check the whole reviewed set before the first deletion, then check each
    # candidate again relative to an open parent FD just before mature rmtree.
    for item in fresh['candidates']:
        path = Path(item['path'])
        plain_tree(path)
        st = path.stat()
        if (st.st_dev, st.st_ino) != (item['device'], item['inode']) or referenced(path, refs):
            raise ValueError('Candidate identity or references changed')
    if fresh['candidates'] and not getattr(shutil.rmtree, 'avoids_symlink_attacks', False):
        raise ValueError('Platform lacks mature FD-based recursive deletion')
    for item in fresh['candidates']:
        path = Path(item['path'])
        plain_tree(path)
        if item.get('kind') == 'backups':
            if digest(path/'backup-manifest.json') != item['manifestSha256']:
                raise ValueError('Candidate backup manifest changed')
            verify_backup(path, fresh.get('profile', 'main'))
        parent_fd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            parent = os.fstat(parent_fd)
            if (parent.st_dev, parent.st_ino) != (item.get('parentDevice', parent.st_dev), item.get('parentInode', parent.st_ino)):
                raise ValueError('Candidate parent identity changed')
            entry = os.stat(path.name, dir_fd=parent_fd, follow_symlinks=False)
            if not stat.S_ISDIR(entry.st_mode) or (entry.st_dev, entry.st_ino) != (item['device'], item['inode']) or referenced(path, refs):
                raise ValueError('Candidate FD identity or references changed')
            shutil.rmtree(path.name, dir_fd=parent_fd)
        finally:
            os.close(parent_fd)
        removed.append(item)
        if on_removed is not None:
            # A failed durable progress write must stop before the next item.
            on_removed(item)
    return removed


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--profile', choices=tuple(PROFILES), default='main')
    parser.add_argument('--categories', default='backups')
    parser.add_argument('--plan', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--rotate-backups', action='store_true')
    parser.add_argument('--offsite-receipt')
    args = parser.parse_args()
    if getattr(os, 'geteuid', lambda: -1)() != 0:
        raise SystemExit('Run as root to inspect all process references')
    categories = tuple(args.categories.split(','))
    if not set(categories) <= {'backups','releases','publication','stages','checks'}:
        raise SystemExit('Unknown cleanup category')
    if args.rotate_backups and categories != ('backups',):
        raise SystemExit('Automatic mode only rotates backups')
    if args.profile == 'community' and categories != ('backups',):
        raise SystemExit('Community maintenance only rotates backups')
    if args.profile == 'community' and (args.apply or args.rotate_backups) and not args.offsite_receipt:
        raise SystemExit('Community deletion requires a verified offsite receipt')
    if args.profile == 'main' and args.offsite_receipt:
        raise SystemExit('Offsite anchor receipt is only supported by the community profile')
    if os.name != 'posix':
        raise SystemExit('Production maintenance requires Linux FD protection')
    import fcntl
    # Never allow receipt/log writes into public or live data directories.
    output = Path(args.plan)
    receipt_root = RECEIPT_ROOT
    receipt_root.mkdir(mode=0o700, exist_ok=True)
    private_directory(receipt_root)
    if output.parent != receipt_root or output.is_symlink():
        raise SystemExit('Receipt must be inside the private maintenance log directory')
    if args.offsite_receipt and output == Path(args.offsite_receipt):
        raise SystemExit('Rotation plan must not overwrite the offsite receipt')
    for target in [output, output.with_suffix('.receipt.json')]:
        private_output(target)
    os.umask(0o077)
    lock_fd = os.open('/run/lock/sansphase-maintenance.lock', os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    lock_stat = os.fstat(lock_fd)
    if not stat.S_ISREG(lock_stat.st_mode) or lock_stat.st_uid != 0 or lock_stat.st_nlink != 1 or lock_stat.st_mode & 0o077:
        os.close(lock_fd)
        raise SystemExit('Unsafe maintenance lock')
    with os.fdopen(lock_fd,'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        refs = live_references()
        anchors = read_offsite_anchors(args.offsite_receipt, Path('/')/PROFILES[args.profile]['backup']) if args.offsite_receipt else ()
        fresh = plan(categories=categories, refs=refs, profile=args.profile, anchors=anchors)
        if args.rotate_backups:
            # Generated only after verifying all retained backups.
            atomic_json(output, fresh)
        if args.apply or args.rotate_backups:
            reviewed = read_json(output)
            at = dt.datetime.now(dt.timezone.utc).isoformat()
            result = {'status':'in-progress', 'stage':'before-apply', 'profile':args.profile,
                      'removed':[], 'protectedReleases':fresh['protectedReleases'], 'at':at, 'updatedAt':at}
            receipt = output.with_suffix('.receipt.json')
            atomic_json(receipt, result)
            def record_removed(item):
                result['removed'].append(item)
                result.update(stage='deleting', updatedAt=dt.datetime.now(dt.timezone.utc).isoformat())
                atomic_json(receipt, result)
            try:
                removed = apply_plan(reviewed, fresh, live_references(), on_removed=record_removed)
                result.update(status='complete', stage='complete', updatedAt=dt.datetime.now(dt.timezone.utc).isoformat())
                atomic_json(receipt, result)
            except BaseException as error:
                result.update(status='stopped', stage='stopped', errorCategory=type(error).__name__,
                              updatedAt=dt.datetime.now(dt.timezone.utc).isoformat())
                atomic_json(receipt, result)
                raise
            print(json.dumps({'removedDirectories':len(removed)}))
        else:
            atomic_json(output, fresh)
            print(json.dumps(fresh, indent=2))


if __name__ == '__main__':
    main()
