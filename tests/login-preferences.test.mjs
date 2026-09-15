import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberedAccount,rememberSuccessfulLogin} from '../src/login-preferences.mjs';
test('remembering a successful login stores only the account locally and delegates the password to the browser',async()=>{
 const saved=new Map(),credentials=[];
 const win={localStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)},isSecureContext:true,
  PasswordCredential:class{constructor(value){Object.assign(this,value)}},navigator:{credentials:{store:async value=>credentials.push(value)}}};
 await rememberSuccessfulLogin(win,{email:'person@example.test',password:'example-test-password'},'测试昵称');
 assert.equal(rememberedAccount(win),'person@example.test');
 assert(!JSON.stringify([...saved]).includes('example-test-password'));
 assert.equal(credentials[0].id,'person@example.test');assert.equal(credentials[0].name,'测试昵称');
 await rememberSuccessfulLogin({get localStorage(){throw Error('blocked')}},{email:'a@example.test',password:'sample'});
 assert.equal(rememberedAccount({get localStorage(){throw Error('blocked')}}),'');
});
