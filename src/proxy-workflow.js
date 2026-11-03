'use strict';
const { t }=require('./localization');
// One user action opens at most one terminal, after the tunnel and environment are ready.
class ProxyWorkflow {
  constructor({proxy,status,findRule,persist,start,open,onError}) {
    Object.assign(this,{proxy,status,findRule,persist,start,open,onError});this.generation=0;this.pending=undefined;
  }
  async select(id,open=true) {
    const generation=++this.generation;const previous=this.proxy.selection;
    this.pending=open?id:undefined;this.preparing=Boolean(id);this.proxy.select(id);
    try {await this.persist(id);} catch(error) {if(generation===this.generation){this.proxy.select(previous);this.pending=undefined;this.preparing=false;}throw error;}
    if(generation!==this.generation)return;
    if(id) {
      const rule=this.findRule(id);
      if(!rule) {this.pending=undefined;return;}
      const state=this.status(id).state;
      if(state==='stopping') {this.pending=undefined;this.preparing=false;throw new Error(t('隧道正在停止，请稍后重试'));}
      if(state!=='running' && state!=='starting') {
        try {await this.start(rule);} catch(error) {if(generation===this.generation){this.pending=undefined;this.preparing=false;}throw error;}
      }
    }
    if(generation===this.generation)this.preparing=false;
  }
  synced() {
    const id=this.pending;if(!id)return;
    if(this.proxy.selection!==id){this.pending=undefined;return;}
    const state=this.status(id).state;
    if(state==='stopped' && this.preparing)return;
    if(['error','stopping','stopped'].includes(state)){this.pending=undefined;return;}
    if(state!=='running' || this.proxy.state.checking)return;
    this.pending=undefined;
    if(this.proxy.state.enabled && this.proxy.state.selectedRuleId===id) {
      try {this.open();}catch(error){this.onError(error);}
    }else this.onError(new Error(this.proxy.state.reason));
  }
  cancel(id) {if(!id || this.pending===id){this.generation++;this.pending=undefined;this.preparing=false;}}
}
module.exports={ProxyWorkflow};
