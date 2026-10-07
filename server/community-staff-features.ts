import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { fail } from './community-db.ts';
import type { CommunityAuthor, Transaction } from './community-db.ts';
import type { createCommunityStaff } from './community-staff.ts';
type Row={id:string;topic_id:string;board:string;by_kind:'reader';by_id:string;reason:string;status:'pending'|'approved'|'rejected';created_at:string};
export function createCommunityFeatureRecommendations(db:DatabaseSync,tx:Transaction,staff:ReturnType<typeof createCommunityStaff>){
  const rows=db.prepare('SELECT * FROM community_feature_recommendations WHERE status=\'pending\' ORDER BY created_at,rowid');
  const one=db.prepare('SELECT * FROM community_feature_recommendations WHERE id=?');
  const topic=(id:string)=>db.prepare('SELECT board,pending,deleted_at,hidden_at FROM community_topics WHERE id=?').get(id) as {board:string;pending:number;deleted_at:string|null;hidden_at:string|null}|undefined;
  const by=(row:Row):CommunityAuthor=>({kind:row.by_kind,id:row.by_id});
  const canDecide=(actor:CommunityAuthor,row:Row)=>{const t=topic(row.topic_id);return Boolean(t&&!t.deleted_at&&!t.pending&&!t.hidden_at&&t.board===row.board&&staff.state(actor)?.role!=='assistant'&&staff.can(actor,'feature.decide',t.board)&&staff.ancestor(actor,by(row))&&staff.can(by(row),'feature.recommend',t.board));};
  return {
    get(id:string){const row=one.get(id) as Row|undefined;return row?{id:row.id,board:row.board,by:by(row)}:null;},
    pending(actor:CommunityAuthor){return (rows.all() as Row[]).filter(row=>canDecide(actor,row)).map(row=>({id:row.id,topicId:row.topic_id,board:row.board,by:by(row),reason:row.reason,createdAt:row.created_at}));},
    recommend(actor:CommunityAuthor,id:string,reason:string,now=new Date().toISOString()){return tx(()=>{const t=topic(id);if(actor.kind!=='reader'||!t||t.deleted_at||t.pending||t.hidden_at||!staff.can(actor,'feature.recommend',t.board))throw fail('没有推荐这个帖子的权限。',403);const existing=db.prepare("SELECT id FROM community_feature_recommendations WHERE topic_id=? AND by_kind=? AND by_id=? AND status='pending'").get(id,actor.kind,actor.id) as {id:string}|undefined;if(existing)return existing.id;const ref=randomUUID();db.prepare("INSERT INTO community_feature_recommendations(id,topic_id,board,by_kind,by_id,reason,created_at)VALUES(?,?,?,'reader',?,?,?)").run(ref,id,t.board,actor.id,reason,now);return ref;});},
    decide(actor:CommunityAuthor,id:string,approve:boolean,reason:string,feature:(topicId:string)=>void,now=new Date().toISOString()){return tx(()=>{const row=one.get(id) as Row|undefined;if(!row)throw fail('精选推荐不存在。',404);if(!canDecide(actor,row))throw fail('只有所属版主或有权限的上级能审批这条精选推荐。',403);if(!approve&&!reason.trim())throw fail('驳回精选推荐必须说明理由。');if(row.status!=='pending'){if(row.status===(approve?'approved':'rejected'))return row.topic_id;throw fail('这条精选推荐已经处理。',409);}if(approve)feature(row.topic_id);db.prepare('UPDATE community_feature_recommendations SET status=?,decided_kind=?,decided_id=?,decision_reason=?,decided_at=? WHERE id=? AND status=\'pending\'').run(approve?'approved':'rejected',actor.kind,actor.id,reason,now,id);return row.topic_id;});},
  };
}
