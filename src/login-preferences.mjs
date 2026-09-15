const accountKey='sansphase-login-account';
export function rememberedAccount(win=window){
 try{return win.localStorage.getItem(accountKey)||'';}catch{return '';}
}
export async function rememberSuccessfulLogin(win,{email,password},name=''){
 try{win.localStorage.setItem(accountKey,email);}catch{}
 if(!win.isSecureContext||!win.PasswordCredential||!win.navigator?.credentials?.store)return;
 try{await win.navigator.credentials.store(new win.PasswordCredential({id:email,password,name}));}catch{}
}
