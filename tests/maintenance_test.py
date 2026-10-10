import importlib.util
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('maintenance', Path(__file__).resolve().parents[1] / 'deploy/maintenance.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class MaintenanceTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def backup(self, name, days):
        parent = self.root / 'backups'
        path = parent / name
        path.mkdir(parents=True)
        with closing(sqlite3.connect(path / 'content.db')) as db:
            db.execute('CREATE TABLE readers (id TEXT, vip_until TEXT, avatar TEXT)')
            db.execute("INSERT INTO readers VALUES ('test', '2099-01-01', 'avatar')")
            db.commit()
        (path / 'settings.json').write_text('{}')
        (path / 'migration-complete.json').write_text('{}')
        files = [{'path':f.name,'sha256':m.digest(f)} for f in path.iterdir()]
        (path / 'backup-manifest.json').write_text(json.dumps({'provider':'payload','createdAt':m.dt.datetime.fromtimestamp(2000000000-days*m.DAY,m.dt.timezone.utc).isoformat(),'files':files}))
        return path

    def test_backups_keep_latest_three_and_fourteen_days(self):
        paths = [self.backup('payload-'+str(i),days) for i,days in enumerate([0,1,2,10,15,20])]
        self.assertEqual(set(m.backup_candidates(self.root/'backups',2000000000)),set(paths[4:]))

    def test_no_pruning_with_fewer_than_three_backups(self):
        self.backup('payload-old',100)
        self.assertEqual(m.backup_candidates(self.root/'backups',2000000000),[])

    def test_corrupt_retained_backup_blocks_all_pruning(self):
        paths = [self.backup('payload-'+str(i),i*20) for i in range(4)]
        (paths[0]/'settings.json').write_text('damaged')
        with self.assertRaises(ValueError):m.backup_candidates(self.root/'backups',2000000000)
        self.assertTrue(all(p.exists() for p in paths))

    def test_unknown_timestamp_is_preserved(self):
        path=self.backup('payload-manual',40)
        data=json.loads((path/'backup-manifest.json').read_text());data.pop('createdAt')
        (path/'backup-manifest.json').write_text(json.dumps(data))
        self.assertEqual(m.backup_candidates(self.root/'backups',2000000000),[])

    def test_unknown_provider_and_incomplete_old_backup_are_preserved(self):
        for i in range(3):self.backup('payload-'+str(i),i)
        unknown=self.backup('payload-unknown',40)
        data=json.loads((unknown/'backup-manifest.json').read_text());data['provider']='future-format'
        (unknown/'backup-manifest.json').write_text(json.dumps(data))
        incomplete=self.backup('payload-incomplete',40);(incomplete/'content.db').unlink()
        self.assertEqual(m.backup_candidates(self.root/'backups',2000000000),[])

    def test_unknown_extra_file_in_old_backup_is_preserved(self):
        for i in range(3):self.backup('payload-'+str(i),i)
        old=self.backup('payload-old',40);(old/'keep-unknown.txt').write_text('unknown')
        self.assertEqual(m.backup_candidates(self.root/'backups',2000000000),[])

    def test_naive_timestamp_is_not_interpreted_using_server_timezone(self):
        for i in range(3):self.backup('payload-'+str(i),i)
        old=self.backup('payload-naive',40)
        data=json.loads((old/'backup-manifest.json').read_text());data['createdAt']='2020-01-01T00:00:00'
        (old/'backup-manifest.json').write_text(json.dumps(data))
        self.assertEqual(m.backup_candidates(self.root/'backups',2000000000),[])

    def test_declared_durable_reader_workflow_must_not_be_missing(self):
        for i in range(3):self.backup('payload-'+str(i),i)
        old=self.backup('pre-release-manual-backup',40)
        data=json.loads((old/'backup-manifest.json').read_text());data['profileWorkflow']='durable-v1'
        (old/'backup-manifest.json').write_text(json.dumps(data))
        self.assertEqual(m.backup_candidates(self.root/'backups',2000000000),[])

    def test_recent_recognized_backup_with_incomplete_manifest_stops_rotation(self):
        paths=[self.backup('payload-'+str(i),i*20) for i in range(4)]
        value=json.loads((paths[0]/'backup-manifest.json').read_text());value['files']=value['files'][:-1]
        (paths[0]/'backup-manifest.json').write_text(json.dumps(value))
        with self.assertRaises(ValueError):m.backup_candidates(self.root/'backups',2000000000)
        self.assertTrue(all(p.exists() for p in paths))

    def test_parent_symlink_and_candidate_mount_are_refused(self):
        path=self.root/'mount';path.mkdir()
        with mock.patch.object(m.os.path,'ismount',side_effect=lambda p:Path(p)==path):
            with self.assertRaises(ValueError):m.plain_tree(path)

    def test_changed_candidate_inode_refuses_deletion(self):
        path=self.root/'check';path.mkdir();st=path.stat()
        plan={'candidates':[{'path':str(path),'device':st.st_dev,'inode':st.st_ino+1}]}
        with self.assertRaises(ValueError):m.apply_plan(plan,plan,[])
        self.assertTrue(path.exists())

    def test_unsafe_deletion_platform_is_refused(self):
        path=self.root/'check';path.mkdir();st=path.stat()
        plan={'candidates':[{'path':str(path),'device':st.st_dev,'inode':st.st_ino}]}
        with mock.patch.object(m.shutil.rmtree,'avoids_symlink_attacks',False):
            with self.assertRaises(ValueError):m.apply_plan(plan,plan,[])
        self.assertTrue(path.exists())

    def test_changed_plan_refuses_deletion(self):
        path=self.root/'test';path.mkdir()
        st=path.stat();item={'path':str(path),'kind':'checks','device':st.st_dev,'inode':st.st_ino}
        with self.assertRaises(ValueError):m.apply_plan({'candidates':[]},{'candidates':[item]},[])
        self.assertTrue(path.exists())

    def test_active_reference_refuses_deletion(self):
        path=self.root/'test';path.mkdir();st=path.stat()
        plan={'candidates':[{'path':str(path),'device':st.st_dev,'inode':st.st_ino}]}
        with self.assertRaises(ValueError):m.apply_plan(plan,plan,[str(path/'content.db')])
        self.assertTrue(path.exists())

    @unittest.skipUnless(getattr(m.shutil.rmtree,'avoids_symlink_attacks',False),'requires mature Linux FD-based rmtree')
    def test_valid_explicit_candidate_deletes_only_that_directory(self):
        path=self.root/'check';path.mkdir();live=self.root/'payload';live.mkdir();(live/'avatar').write_text('keep')
        st=path.stat();plan={'candidates':[{'path':str(path),'device':st.st_dev,'inode':st.st_ino}]}
        m.apply_plan(plan,plan,[])
        self.assertEqual((live/'avatar').read_text(),'keep')

    @unittest.skipUnless(getattr(m.shutil.rmtree,'avoids_symlink_attacks',False),'requires mature Linux FD-based rmtree')
    def test_deletion_passes_basename_and_bound_parent_fd_to_library(self):
        path=self.root/'check';path.mkdir();st=path.stat();parent=path.parent.stat()
        plan={'candidates':[{'path':str(path),'device':st.st_dev,'inode':st.st_ino,
          'parentDevice':parent.st_dev,'parentInode':parent.st_ino}]}
        real=m.shutil.rmtree;calls=[]
        def remove(name,*,dir_fd):
            self.assertEqual(name,'check');self.assertEqual(os.fstat(dir_fd).st_ino,parent.st_ino)
            calls.append(name);return real(name,dir_fd=dir_fd)
        remove.avoids_symlink_attacks=True
        with mock.patch.object(m.shutil,'rmtree',remove):m.apply_plan(plan,plan,[])
        self.assertEqual(calls,['check']);self.assertFalse(path.exists())

    @unittest.skipUnless(getattr(m.shutil.rmtree,'avoids_symlink_attacks',False),'requires mature Linux FD-based rmtree')
    def test_second_fd_identity_check_detects_replacement_before_library_delete(self):
        path=self.root/'check';path.mkdir();st=path.stat();parent=path.parent.stat()
        plan={'candidates':[{'path':str(path),'device':st.st_dev,'inode':st.st_ino,
          'parentDevice':parent.st_dev,'parentInode':parent.st_ino}]}
        real=m.os.open;swapped=False
        def opening(name,flags,*args,**kwargs):
            nonlocal swapped
            if Path(name)==path.parent and not swapped:
                swapped=True;path.rename(self.root/'original');path.mkdir();(path/'keep').write_text('new')
            return real(name,flags,*args,**kwargs)
        with mock.patch.object(m.os,'open',opening):
            with self.assertRaises(ValueError):m.apply_plan(plan,plan,[])
        self.assertEqual((path/'keep').read_text(),'new');self.assertTrue((self.root/'original').exists())

    @unittest.skipUnless(getattr(m.shutil.rmtree,'avoids_symlink_attacks',False),'requires mature Linux FD-based rmtree')
    def test_parent_inode_change_refuses_deletion_even_when_candidate_inode_matches(self):
        parent=self.root/'owner';parent.mkdir();path=parent/'check';path.mkdir();st=path.stat();owner=parent.stat()
        plan={'candidates':[{'path':str(path),'device':st.st_dev,'inode':st.st_ino,
          'parentDevice':owner.st_dev,'parentInode':owner.st_ino}]}
        original=self.root/'old-owner';parent.rename(original);parent.mkdir();(original/'check').rename(path)
        with self.assertRaises(ValueError):m.apply_plan(plan,plan,[])
        self.assertTrue(path.exists())

    @unittest.skipUnless(getattr(m.shutil.rmtree,'avoids_symlink_attacks',False),'requires mature Linux FD-based rmtree')
    def test_nested_library_symlink_never_follows_live_data(self):
        path=self.root/'check';path.mkdir();data=self.root/'data';data.mkdir();(data/'avatar').write_text('keep')
        (path/'linked-data').symlink_to(data,target_is_directory=True);st=path.stat()
        plan={'candidates':[{'path':str(path),'device':st.st_dev,'inode':st.st_ino}]}
        m.apply_plan(plan,plan,[])
        self.assertFalse(path.exists());self.assertEqual((data/'avatar').read_text(),'keep')

    @unittest.skipUnless(getattr(m.shutil.rmtree,'avoids_symlink_attacks',False),'requires mature Linux FD-based rmtree')
    def test_progress_callback_is_called_after_every_successful_removal(self):
        candidates=[]
        for name in ['first','second']:
            path=self.root/name;path.mkdir();entry=path.stat()
            candidates.append({'path':str(path),'device':entry.st_dev,'inode':entry.st_ino})
        plan={'candidates':candidates};events=[]
        def record(item):
            self.assertFalse(Path(item['path']).exists());events.append(item['path'])
        self.assertEqual(m.apply_plan(plan,plan,[],on_removed=record),candidates)
        self.assertEqual(events,[item['path'] for item in candidates])

    @unittest.skipUnless(getattr(m.shutil.rmtree,'avoids_symlink_attacks',False),'requires mature Linux FD-based rmtree')
    def test_failed_progress_callback_stops_before_next_directory(self):
        candidates=[]
        for name in ['first','second']:
            path=self.root/name;path.mkdir();entry=path.stat()
            candidates.append({'path':str(path),'device':entry.st_dev,'inode':entry.st_ino})
        plan={'candidates':candidates}
        with self.assertRaises(OSError):m.apply_plan(plan,plan,[],on_removed=lambda item:(_ for _ in ()).throw(OSError('fixture disk-full')))
        self.assertFalse((self.root/'first').exists());self.assertTrue((self.root/'second').exists())

    @unittest.skipUnless(getattr(m.shutil.rmtree,'avoids_symlink_attacks',False),'requires mature Linux FD-based rmtree')
    def test_partial_progress_is_durable_when_a_later_candidate_changes(self):
        candidates=[]
        for name in ['first','second']:
            path=self.root/name;path.mkdir();entry=path.stat()
            candidates.append({'path':str(path),'device':entry.st_dev,'inode':entry.st_ino})
        receipt=self.root/'receipt.json';state={'status':'in-progress','removed':[]}
        plan={'candidates':candidates};uid=os.getuid()
        os.chmod(self.root,0o700)
        m.atomic_json(receipt,state,trusted_uid=uid)
        def record(item):
            state['removed'].append(item['path']);m.atomic_json(receipt,state,trusted_uid=uid)
            if len(state['removed'])==1:
                (self.root/'second').rename(self.root/'changed-second');(self.root/'second').mkdir()
        with self.assertRaises(ValueError):m.apply_plan(plan,plan,[],on_removed=record)
        saved=json.loads(receipt.read_text())
        self.assertEqual(saved['removed'],[str(self.root/'first')]);self.assertTrue((self.root/'second').exists())

    def test_atomic_progress_write_uses_replace_and_preserves_previous_receipt_on_failure(self):
        root=self.root/'private';root.mkdir();receipt=root/'receipt.json';receipt.write_text('{"status":"in-progress"}')
        previous=receipt.read_text()
        with mock.patch.object(m,'private_directory'),mock.patch.object(m,'private_output'),mock.patch.object(m.os,'replace',side_effect=OSError('fixture write failure')):
            with self.assertRaises(OSError):m.atomic_json(receipt,{'status':'complete'})
        self.assertEqual(receipt.read_text(),previous);self.assertEqual(list(root.iterdir()),[receipt])

    @unittest.skipIf(os.name == 'nt', 'Linux production symlink and process layout')
    def test_planner_protects_current_rollback_live_data_and_linked_release(self):
        parent=self.root/'opt/sansphase/releases';parent.mkdir(parents=True)
        for name,stamp in [('current',30),('rollback',20),('linked-old',10),('unused-old',5)]:
            path=parent/name;path.mkdir();os.utime(path,(stamp,stamp))
        (self.root/'opt/sansphase/current').symlink_to(parent/'current',target_is_directory=True)
        (parent/'rollback'/'dependency').symlink_to(parent/'linked-old',target_is_directory=True)
        os.utime(parent/'rollback',(20,20))
        live=self.root/'var/lib/sansphase/payload';live.mkdir(parents=True)
        check=live.parent/'demo-check-old';check.mkdir()
        linked=live.parent/'unsafe-check-link';linked.symlink_to(live,target_is_directory=True)
        with self.assertRaises(ValueError):m.plan(self.root,categories=('checks',))
        linked.unlink()
        result=m.plan(self.root,categories=('releases','checks'))
        names={Path(p['path']).name for p in result['candidates']}
        self.assertEqual(names,{'unused-old','demo-check-old'})
        self.assertNotIn(str(live),str(result['candidates']))


class CommunityMaintenanceTests(unittest.TestCase):
    now=2000000000

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.parent=self.root/'backups';self.parent.mkdir()
        self.receipt_root=self.root/'receipts';self.receipt_root.mkdir(mode=0o700)
        self.validator=mock.patch.object(m,'verify_community_backup',self.official_verify)
        self.validator.start();self.addCleanup(self.validator.stop)
        self.verified=[]

    def official_verify(self,path):
        self.verified.append(Path(path).name)

    def backup(self,name,days):
        path=self.parent/name;path.mkdir()
        for filename,table in [('content.db','community_topics'),('community-host.db','community_host_sessions')]:
            with closing(sqlite3.connect(path/filename)) as db:
                db.execute(f'CREATE TABLE {table} (id TEXT)');db.commit()
        (path/'settings.json').write_text('{}')
        files=[{'path':f.name,'bytes':f.stat().st_size,'sha256':m.digest(f)} for f in path.iterdir()]
        (path/'backup-manifest.json').write_text(json.dumps({'provider':'sansphase-community','version':1,
          'createdAt':m.dt.datetime.fromtimestamp(self.now-days*m.DAY,m.dt.timezone.utc).isoformat(),'files':files}))
        return path

    def receipt(self,paths):
        path=self.receipt_root/'community-offsite.json'
        data={'schema':'sansphase-verified-offsite-v1','profile':'community',
          'verifiedAt':'2026-10-10T00:00:00Z',
          'backups':[{'name':p.name,'manifestSha256':m.digest(p/'backup-manifest.json'),'archiveSha256':'a'*64} for p in paths]}
        path.write_text(json.dumps(data));os.chmod(path,0o600)
        return path

    def anchors(self,receipt):
        # Windows lacks Unix directory privacy bits. Emulate only this test
        # fixture's root/receipt metadata; real Linux permission tests run too.
        original=Path.lstat
        def fixture_permissions(path):
            result=original(path)
            if os.name=='nt' and path in {self.receipt_root,receipt}:
                values=list(result);values[0]=result.st_mode & ~0o077
                return os.stat_result(values)
            return result
        with mock.patch.object(Path,'lstat',fixture_permissions):
            return m.read_offsite_anchors(receipt,self.parent,receipt_root=self.receipt_root,
              trusted_uid=os.getuid() if hasattr(os,'getuid') else 0)

    def test_community_uses_latest_three_plus_fourteen_days(self):
        names=['experience-release-20261010','shop-card-art-width-release-20261010','vip-frame-release-20261010',
          'board-backup-before-upgrade','profile-backup-before-upgrade','community-scheduled-old']
        paths=[self.backup(name,days) for name,days in zip(names,[0,1,2,10,15,20])]
        self.assertEqual(set(m.backup_candidates(self.parent,self.now,profile='community')),set(paths[4:]))
        self.assertEqual(set(self.verified),{p.name for p in paths})

    def test_wrong_provider_version_missing_host_db_and_corrupt_old_backup_are_kept(self):
        for i in range(3):self.backup('community-'+str(i),i)
        unknown=self.backup('community-future',40)
        value=json.loads((unknown/'backup-manifest.json').read_text());value['version']=99
        (unknown/'backup-manifest.json').write_text(json.dumps(value))
        missing=self.backup('community-missing-host',40);(missing/'community-host.db').unlink()
        corrupt=self.backup('community-corrupt',40);(corrupt/'settings.json').write_text('bad')
        main=self.backup('community-main-provider',40)
        value=json.loads((main/'backup-manifest.json').read_text());value['provider']='payload'
        (main/'backup-manifest.json').write_text(json.dumps(value))
        self.assertEqual(m.backup_candidates(self.parent,self.now,profile='community'),[])

    def test_bad_recent_backup_blocks_rotation_before_any_deletion(self):
        paths=[self.backup('community-'+str(i),i*20) for i in range(4)]
        (paths[0]/'settings.json').write_text('changed')
        with self.assertRaises(ValueError):m.backup_candidates(self.parent,self.now,profile='community')
        self.assertTrue(all(p.exists() for p in paths))

    def test_recognized_recent_missing_required_path_or_checksum_never_falls_back(self):
        paths=[self.backup('community-'+str(i),i*20) for i in range(4)]
        original=json.loads((paths[0]/'backup-manifest.json').read_text())
        for broken in ['required','checksum','files']:
            value=json.loads(json.dumps(original))
            if broken=='required':value['files']=[f for f in value['files'] if f['path']!='community-host.db']
            elif broken=='checksum':value['files'][0].pop('sha256')
            else:value['files']=[]
            (paths[0]/'backup-manifest.json').write_text(json.dumps(value))
            with self.assertRaises(ValueError):m.backup_candidates(self.parent,self.now,profile='community')
            self.assertTrue(all(p.exists() for p in paths))

    def test_future_dated_known_backups_are_preserved(self):
        paths=[self.backup('community-'+str(i),days) for i,days in enumerate([-5,0,1,2,30])]
        self.assertEqual(m.backup_candidates(self.parent,self.now,profile='community'),[paths[-1]])
        self.assertTrue(paths[0].exists())

    def test_oversized_manifest_remains_unknown_and_preserved(self):
        paths=[self.backup('community-'+str(i),i) for i in range(3)]
        unknown=self.backup('oversized',40)
        (unknown/'backup-manifest.json').write_text(' '*(16*1024**2+1))
        self.assertEqual(m.backup_candidates(self.parent,self.now,profile='community'),[])
        self.assertTrue(unknown.exists());self.assertTrue(all(p.exists() for p in paths))

    def test_invalid_sqlite_with_matching_hash_is_kept_when_old(self):
        for i in range(3):self.backup('community-'+str(i),i)
        bad=self.backup('community-damaged-db',30);(bad/'community-host.db').write_text('not sqlite')
        value=json.loads((bad/'backup-manifest.json').read_text())
        for item in value['files']:
            file=bad/item['path'];item.update(bytes=file.stat().st_size,sha256=m.digest(file))
        (bad/'backup-manifest.json').write_text(json.dumps(value))
        self.assertEqual(m.backup_candidates(self.parent,self.now,profile='community'),[])

    def test_offsite_anchors_stay_protected_after_daily_latest_three_changes(self):
        anchors=[self.backup(name,40+i) for i,name in enumerate(['experience-release-20261010',
          'shop-card-art-width-release-20261010','vip-frame-release-20261010'])]
        receipt=self.receipt(anchors);checked=self.anchors(receipt)
        recent=[self.backup('community-new-'+str(i),i) for i in range(3)]
        expired=self.backup('community-expired',20)
        self.assertEqual(m.backup_candidates(self.parent,self.now,profile='community',anchors=checked),[expired])
        self.assertTrue(all(p.exists() for p in anchors+recent))

    def test_offsite_wrong_digest_missing_anchor_duplicate_and_path_escape_refused(self):
        paths=[self.backup('community-anchor-'+str(i),40+i) for i in range(3)]
        receipt=self.receipt(paths);original=json.loads(receipt.read_text())
        for field,value in [('name','../outside'),('manifestSha256','b'*64),('name','community-absent')]:
            changed=json.loads(json.dumps(original));changed['backups'][0][field]=value
            receipt.write_text(json.dumps(changed))
            with self.assertRaises(ValueError):self.anchors(receipt)
        changed=json.loads(json.dumps(original));changed['backups'][1]=changed['backups'][0]
        receipt.write_text(json.dumps(changed))
        with self.assertRaises(ValueError):self.anchors(receipt)

    def test_writable_receipt_and_wrong_profile_refused(self):
        paths=[self.backup('community-anchor-'+str(i),40+i) for i in range(3)]
        receipt=self.receipt(paths);data=json.loads(receipt.read_text());data['profile']='main'
        receipt.write_text(json.dumps(data))
        with self.assertRaises(ValueError):self.anchors(receipt)
        receipt=self.receipt(paths);os.chmod(receipt,0o666)
        if os.name!='nt':
            with self.assertRaises(ValueError):self.anchors(receipt)

    def test_offsite_receipt_outside_private_root_and_untrusted_owner_refused(self):
        paths=[self.backup('community-anchor-'+str(i),40+i) for i in range(3)]
        receipt=self.receipt(paths);outside=self.root/'outside.json';outside.write_text(receipt.read_text());os.chmod(outside,0o600)
        with self.assertRaises(ValueError):self.anchors(outside)
        with self.assertRaises(ValueError):m.read_offsite_anchors(receipt,self.parent,receipt_root=self.receipt_root,trusted_uid=-1)

    @unittest.skipIf(os.name=='nt','real Linux symlink protection')
    def test_receipt_backup_anchor_and_backup_parent_symlinks_refused(self):
        paths=[self.backup('community-anchor-'+str(i),40+i) for i in range(3)]
        receipt=self.receipt(paths);link=self.receipt_root/'linked.json';link.symlink_to(receipt)
        with self.assertRaises(ValueError):self.anchors(link)
        original=self.parent/'original';paths[0].rename(original);paths[0].symlink_to(original,target_is_directory=True)
        with self.assertRaises(ValueError):self.anchors(receipt)
        parent_link=self.root/'linked-backups';parent_link.symlink_to(self.parent,target_is_directory=True)
        with self.assertRaises(ValueError):m.backup_candidates(parent_link,self.now,profile='community')

    def test_offsite_anchor_with_failed_official_validation_stops(self):
        paths=[self.backup('community-anchor-'+str(i),40+i) for i in range(3)]
        receipt=self.receipt(paths)
        with mock.patch.object(m,'verify_community_backup',side_effect=ValueError('fixture validator failed')):
            with self.assertRaises(ValueError):self.anchors(receipt)

    def test_official_validator_runs_existing_cli_and_never_exposes_stdout_or_stderr(self):
        path=self.backup('community-verified',0)
        result=mock.Mock(returncode=0,stdout=json.dumps({'directory':str(path),'files':3}),stderr='')
        with mock.patch.object(m.subprocess,'run',return_value=result) as run:
            self.validator.stop()
            try:m.verify_community_backup(path)
            finally:self.validator.start()
        command=run.call_args.args[0]
        self.assertEqual(command[0],'/usr/bin/node');self.assertEqual(command[-2:],['--verify',str(path)])
        self.assertTrue(command[1].endswith('/scripts/backup-community.mjs'))
        self.assertTrue(run.call_args.kwargs['capture_output'])
        result=mock.Mock(returncode=1,stdout='PRIVATE CONFIG',stderr='PRIVATE SECRET')
        with mock.patch.object(m.subprocess,'run',return_value=result):
            self.validator.stop()
            try:
                with self.assertRaises(ValueError) as error:m.verify_community_backup(path)
                self.assertNotIn('PRIVATE',str(error.exception))
            finally:self.validator.start()

    def test_community_planner_refuses_nonbackup_categories(self):
        with self.assertRaises(ValueError):m.plan(self.root,categories=('releases',),profile='community')

    @unittest.skipIf(os.name=='nt','real Linux current symlink layout')
    def test_community_plan_binds_only_fixed_backup_parent_and_keeps_data(self):
        releases=self.root/'opt/sansphase-community/releases';releases.mkdir(parents=True)
        current=releases/'current';current.mkdir();rollback=releases/'rollback';rollback.mkdir()
        (releases.parent/'current').symlink_to(current,target_is_directory=True)
        for i in range(3):self.backup('community-'+str(i),i)
        expired=self.backup('manual-old',40)
        backup_root=self.root/'var/backups/sansphase-community';backup_root.parent.mkdir(parents=True)
        self.parent.rename(backup_root)
        data=self.root/'var/lib/sansphase-community/data';data.mkdir(parents=True);(data/'avatar').write_text('keep')
        result=m.plan(self.root,now=self.now,profile='community')
        self.assertEqual([p['path'] for p in result['candidates']],[str(backup_root/expired.name)])
        self.assertEqual(result['profile'],'community');self.assertEqual((data/'avatar').read_text(),'keep')

    def test_automatic_community_rotation_requires_private_offsite_receipt(self):
        with mock.patch.object(m.os,'geteuid',return_value=0,create=True),mock.patch('sys.argv',
          ['maintenance.py','--profile','community','--rotate-backups','--plan','/var/log/sansphase-maintenance/community-rotation.json']):
            with self.assertRaises(SystemExit) as error:m.main()
        self.assertIn('offsite',str(error.exception).lower())


if __name__=='__main__':unittest.main()
