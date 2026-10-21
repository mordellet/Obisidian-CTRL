const P = Element.prototype;
P.empty = function(){ this.innerHTML=''; };
P.addClass = function(...c){ this.classList.add(...c.flatMap(x=>x.split(' ').filter(Boolean))); };
P.removeClass = function(...c){ this.classList.remove(...c); };
P.toggleClass = function(c,v){ this.classList.toggle(c,v); };
P.setText = function(t){ this.textContent=t; };
P.createEl = function(tag,o={}){ const e=document.createElement(tag); if(o.cls) e.className=o.cls; if(o.text!==undefined) e.textContent=o.text; if(o.type) e.type=o.type; if(o.placeholder) e.placeholder=o.placeholder; if(o.attr) for(const k in o.attr) e.setAttribute(k,o.attr[k]); this.appendChild(e); return e; };
P.createDiv = function(o={}){ return this.createEl('div',o); };
P.createSpan = function(o={}){ return this.createEl('span',o); };
class ItemView { constructor(leaf){ this.leaf=leaf; this.contentEl=document.createElement('div'); document.body.appendChild(this.contentEl); this.app={workspace:{openLinkText(){}}}; } }
module.exports = { ItemView, Notice: class{}, Plugin: class{}, debounce: f=>f, PluginSettingTab: class{}, Setting: class{} };
