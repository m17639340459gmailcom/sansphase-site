// File selection and editor.focus() used to scroll two different containers.
// Capture the caret before the native picker opens; restore focus without scrolling.
export function captureImagePosition(editor,panel,win=window){
 return {editor,from:editor.state.selection.from,to:editor.state.selection.to,top:panel.scrollTop,left:panel.scrollLeft,windowX:win.scrollX,windowY:win.scrollY};
}
export function insertImageAtPosition(editor,panel,image,saved,win=window){
 if(!editor||editor.isDestroyed||saved?.editor!==editor)return false;
 const top=saved.top,left=saved.left,x=saved.windowX,y=saved.windowY;
 const end=editor.state.doc.content.size;
 editor.chain().setTextSelection({from:Math.min(saved.from,end),to:Math.min(saved.to,end)}).setImage(image).run();
 const restore=()=>{if(!editor.isDestroyed){editor.view.dom.focus({preventScroll:true});panel.scrollTop=top;panel.scrollLeft=left;win.scrollTo(x,y);}};
 restore();win.requestAnimationFrame(restore);return true;
}
