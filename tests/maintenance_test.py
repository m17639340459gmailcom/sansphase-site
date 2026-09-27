import importlib.util
from contextlib import closing
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest

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

    def test_valid_explicit_candidate_deletes_only_that_directory(self):
        path=self.root/'check';path.mkdir();live=self.root/'payload';live.mkdir();(live/'avatar').write_text('keep')
        st=path.stat();plan={'candidates':[{'path':str(path),'device':st.st_dev,'inode':st.st_ino}]}
        m.apply_plan(plan,plan,[])
        self.assertEqual((live/'avatar').read_text(),'keep')

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


if __name__=='__main__':unittest.main()
