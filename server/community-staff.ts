import type { DatabaseSync } from 'node:sqlite';
import type { CommunityAuthor, Transaction } from './community-db.ts';
import { fail, same, parseJson } from './community-db.ts';
import { communityBoards } from '../src/community.mjs';
import { communityStaffCapabilities, communityStaffCanAppointRole, communityStaffRank } from '../src/community-staff.ts';
import type { CommunityStaffPermission, CommunityStaffRole, CommunityStaffState } from '../src/community-staff.ts';
const boards=communityBoards.map(board=>board.id);
const permissions=communityStaffCapabilities.map(cap=>cap.id);
// Retain the actual legacy authorities, not every newly introduced capability.
export const communityLegacyStaffPermissions: CommunityStaffPermission[] = permissions.filter(cap=>!['staff.appoint','feature.decide','profile.signature.advise','profile.signature.decide','profile.nickname.advise','profile.nickname.decide','profile.background.advise','profile.background.decide'].includes(cap));
type Row={member_kind:'reader';member_id:string;role:Exclude<CommunityStaffRole,'owner'>;boards:string;permissions:string;delegable:string;parent_kind:CommunityAuthor['kind'];parent_id:string|null;legacy_origin:number;legacy_live:number;revoked_at:string|null};
export type CommunityStaffInput={role:Exclude<CommunityStaffRole,'owner'>;boards:string[];permissions:CommunityStaffPermission[];delegable:CommunityStaffPermission[]};
const array=<T extends string>(value:unknown,known:readonly T[]):value is T[]=>Array.isArray(value)&&value.every(item=>typeof item==='string'&&known.includes(item as T))&&new Set(value).size===value.length;
export function createCommunityStaff(db:DatabaseSync,tx:Transaction){
  let ownerId='owner';
  const row=db.prepare('SELECT * FROM community_staff WHERE member_kind=? AND member_id=?');
  const clearLegacy=db.prepare('UPDATE community_members SET steward=0 WHERE member_kind=? AND member_id=?');
  const save=db.prepare(`INSERT INTO community_staff(member_kind,member_id,role,boards,permissions,delegable,parent_kind,parent_id,legacy_origin,created_at,updated_at)
    VALUES('reader',?,?,?,?,?,?,?,?,?,?) ON CONFLICT(member_kind,member_id) DO UPDATE SET role=excluded.role,boards=excluded.boards,permissions=excluded.permissions,delegable=excluded.delegable,parent_kind=excluded.parent_kind,parent_id=excluded.parent_id,revoked_at=NULL,updated_at=excluded.updated_at`);
  const owner=():CommunityAuthor=>({kind:'owner',id:ownerId});
  const stored=(member:CommunityAuthor)=>row.get(member.kind,member.id) as Row|undefined;
  function descendants(target:CommunityAuthor){const found:CommunityAuthor[]=[];const seen=new Set([`${target.kind}:${target.id}`]);let pending=[target];while(pending.length){const parent=pending.shift()!;for(const value of db.prepare('SELECT member_kind,member_id FROM community_staff WHERE parent_kind=? AND parent_id=? AND revoked_at IS NULL').all(parent.kind,parent.id) as Array<{member_kind:'reader';member_id:string}>){const key=`${value.member_kind}:${value.member_id}`;if(seen.has(key))continue;seen.add(key);const member:CommunityAuthor={kind:value.member_kind,id:value.member_id};found.push(member);pending.push(member);}}return found;}
  const revokeRows=(targets:CommunityAuthor[],now:string)=>{for(const member of targets){db.prepare('UPDATE community_staff SET revoked_at=?,updated_at=? WHERE member_kind=? AND member_id=?').run(now,now,member.kind,member.id);clearLegacy.run(member.kind,member.id);}};
  function state(member:CommunityAuthor,seen=new Set<string>()):CommunityStaffState|null{
    if(same(member,owner()))return {role:'owner',boards:[...boards],permissions:[...permissions],delegable:[...permissions],parent:null};
    if(member.kind!=='reader'||seen.has(member.id)||seen.size>=16)return null;
    const value=stored(member);if(!value||value.revoked_at||!['general','moderator','assistant'].includes(value.role))return null;
    const scope=parseJson<unknown>(value.boards,null),caps=parseJson<unknown>(value.permissions,null),delegable=parseJson<unknown>(value.delegable,null);
    if(!array(scope,boards)||!scope.length||!array(caps,permissions)||!array(delegable,permissions)||delegable.some(cap=>!caps.includes(cap)))return null;
    const parent:CommunityAuthor=value.parent_kind==='owner'&&value.legacy_origin&&value.parent_id===null?owner():{kind:value.parent_kind,id:value.parent_id||''};
    const ancestry=new Set(seen);ancestry.add(member.id);const upstream=state(parent,ancestry);
    if(!upstream||!communityStaffCanAppointRole(upstream.role,value.role))return null;
    // The fixed owner can directly appoint any reader staff role, including
    // legacy moderators. Reader descendants retain adjacent role delegation.
    let legacyScope:string[]|null=null;
    if(value.legacy_live){const old=db.prepare('SELECT steward,steward_boards FROM community_members WHERE member_kind=? AND member_id=?').get(member.kind,member.id) as {steward:number;steward_boards:string|null}|undefined;if(!old?.steward)return null;const oldScope=old.steward_boards===null?boards:parseJson<unknown>(old.steward_boards,null);if(!array(oldScope,boards)||!oldScope.length)return null;legacyScope=oldScope;}
    const currentBoards=boards.filter(board=>scope.includes(board)&&upstream.boards.includes(board)&&(!legacyScope||legacyScope.includes(board)));
    if(!currentBoards.length)return null;
    const currentCaps=permissions.filter(cap=>caps.includes(cap)&&upstream.delegable.includes(cap));
    return {role:value.role,boards:currentBoards,permissions:currentCaps,delegable:currentCaps.filter(cap=>delegable.includes(cap)),parent};
  }
  function can(member:CommunityAuthor,cap:CommunityStaffPermission,board?:string){const current=state(member);if(!current||!current.permissions.includes(cap))return false;const definition=communityStaffCapabilities.find(item=>item.id===cap);return definition?.scope==='global'||Boolean(board&&current.boards.includes(board));}
  function ancestor(actor:CommunityAuthor,target:CommunityAuthor){const seen=new Set<string>();let cursor=target;while(!seen.has(`${cursor.kind}:${cursor.id}`)&&seen.size<16){seen.add(`${cursor.kind}:${cursor.id}`);const current=state(cursor);if(!current?.parent)return false;if(same(current.parent,actor))return true;cursor=current.parent;}return false;}
  const protect=(actor:CommunityAuthor,target:CommunityAuthor)=>{if(same(actor,target))throw fail('不能对自己这样做。',403);const a=state(actor),b=state(target),raw=stored(target);const targetRole=b?.role ?? (raw&&!raw.revoked_at?raw.role:null);if(!a||target.kind==='owner'||targetRole&&communityStaffRank(targetRole)<=communityStaffRank(a.role))throw fail('不能操作同级或上级管理人员。',403);};
  function appoint(actor:CommunityAuthor,target:CommunityAuthor,input:CommunityStaffInput,now=new Date().toISOString()){
    return tx(()=>{protect(actor,target);const current=state(actor)!;if(!can(actor,'staff.appoint')||current.role==='assistant')throw fail('没有任命权限。',403);
      const previous=stored(target);
      if(!communityStaffCanAppointRole(current.role,input.role))throw fail(current.role==='owner'?'只能任命总版主、版主或协管。':'只能任命下一级职务。',403);
      if(previous&&!previous.revoked_at&&!(current.role==='owner'||previous.parent_kind===actor.kind&&previous.parent_id===actor.id))throw fail('不能修改其他管理者任命的人员。',403);
      if(!array(input.boards,boards)||!input.boards.length||input.boards.some(board=>!current.boards.includes(board)))throw fail('只能配置自己管理的有效板块。',403);
      if(!array(input.permissions,permissions)||!array(input.delegable,permissions)||input.permissions.some(cap=>!current.delegable.includes(cap))||input.delegable.some(cap=>!input.permissions.includes(cap)))throw fail('不能授予或委派自己没有的权限。',403);
      if(previous&&(previous.role!==input.role||previous.parent_kind!==actor.kind||previous.parent_id!==actor.id&&!(previous.legacy_origin&&previous.parent_id===null&&actor.kind==='owner')))revokeRows(descendants(target),now);
      save.run(target.id,input.role,JSON.stringify(input.boards),JSON.stringify(input.permissions),JSON.stringify(input.delegable),actor.kind,actor.id,previous?.legacy_origin||0,now,now);
      db.prepare('UPDATE community_staff SET legacy_live=0 WHERE member_kind=? AND member_id=?').run(target.kind,target.id);
      clearLegacy.run(target.kind,target.id);return state(target);
    });
  }
  return {bindOwner(id:string){if(!id)throw Error('Staff authority requires the fixed owner.');ownerId=id;},state,can,ancestor,protect,stored,
    ancestors(member:CommunityAuthor){const found:CommunityAuthor[]=[];const seen=new Set<string>();let current=state(member);while(current?.parent){const key=`${current.parent.kind}:${current.parent.id}`;if(seen.has(key))return [];seen.add(key);found.push(current.parent);current=state(current.parent);}return found;},
    canAppoint(actor:CommunityAuthor,target:CommunityAuthor){try{protect(actor,target);const a=state(actor),b=stored(target);return Boolean(a&&a.role!=='assistant'&&can(actor,'staff.appoint')&&(!b||b.revoked_at||a.role==='owner'||b.parent_kind===actor.kind&&b.parent_id===actor.id));}catch{return false;}},
    appoint,
    revoke(actor:CommunityAuthor,target:CommunityAuthor,now=new Date().toISOString()){return tx(()=>{protect(actor,target);if(!can(actor,'staff.appoint'))throw fail('没有撤销职务权限。',403);const value=stored(target);if(!value)return [];if(!same(actor,owner())&&!(value.parent_kind===actor.kind&&value.parent_id===actor.id))throw fail('只能撤销自己任命的下一级。',403);const revoked=[target,...descendants(target)];revokeRows(revoked,now);return revoked;});},
    legacy(member:CommunityAuthor,on:boolean,scope:readonly string[],now=new Date().toISOString()){
      if(on){save.run(member.id,'moderator',JSON.stringify(scope),JSON.stringify(communityLegacyStaffPermissions),'[]','owner',null,1,now,now);db.prepare('UPDATE community_staff SET legacy_live=1,legacy_origin=1 WHERE member_kind=? AND member_id=?').run(member.kind,member.id);}
      else revokeRows([member,...descendants(member)],now);
    },
    roster:()=> (db.prepare("SELECT member_kind,member_id FROM community_staff WHERE revoked_at IS NULL").all() as Array<{member_kind:'reader';member_id:string}>).map(row=>({kind:row.member_kind,id:row.member_id})),
  };
}
