'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { english, createTranslator, setLanguage, renderLocalizedHtml, resolveLanguage } = require('../src/localization');
const { explainError, explainSystemError, validateRule, probe } = require('../src/core');
test('English is the fallback; Chinese locales select Chinese; interpolation preserves values', () => {
  assert.equal(resolveLanguage('zh-cn'),'zh-CN'); assert.equal(resolveLanguage('en'),'en'); assert.equal(resolveLanguage('de'),'en');
  const en=createTranslator('en'); const zh=createTranslator('zh-cn');
  assert.equal(en('反向端口'),'Reverse Ports'); assert.equal(zh('反向端口'),'反向端口');
  assert.equal(en`反向端口 · ${'My proxy'}：${'Connection refused'}`,'Reverse Ports · My proxy: Connection refused');
  assert.equal(en('本机目标连接失败（{0}），请检查服务和网络。','ECONNREFUSED'),'Local destination connection failed (ECONNREFUSED). Check the service and network.');
});
test('every translated source message and HTML label has an English translation with matching placeholders', () => {
  const keys=new Set();
  for(const file of ['src/core.js','src/extension.js','src/terminal-proxy.js','src/proxy-workflow.js','media/panel.js']) {
    const source=ts.createSourceFile(file,fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    function visit(node) {
      if(ts.isCallExpression(node) && node.expression.getText(source)==='t' && ts.isStringLiteral(node.arguments[0])) keys.add(node.arguments[0].text);
      if(ts.isTaggedTemplateExpression(node) && node.tag.getText(source)==='t') {
        const template=node.template;
        if(ts.isNoSubstitutionTemplateLiteral(template))keys.add(template.text);
        else { const parts=[template.head.text,...template.templateSpans.map(s=>s.literal.text)];keys.add(parts.map((s,i)=>s+(i<parts.length-1?`{${i}}`:'')).join('')); }
      }
      ts.forEachChild(node,visit);
    }
    visit(source);
  }
  const html=fs.readFileSync(path.join(__dirname,'../media/panel.html'),'utf8');
  for(const m of html.matchAll(/\{\{t:([^}]+)\}\}/g))keys.add(m[1]);
  assert(keys.size>80);
  for(const key of keys) {
    assert(Object.hasOwn(english,key),`Missing English translation: ${key}`);
    assert(!/[\u3400-\u9fff]/.test(english[key]),`Chinese leaked into English: ${key}`);
    assert.deepEqual((english[key].match(/\{\d+\}/g)||[]).sort(),(key.match(/\{\d+\}/g)||[]).sort(),`Placeholder mismatch: ${key}`);
  }
});
test('manifest language packs cover all contribution labels', () => {
  const root=path.join(__dirname,'..');
  const manifest=fs.readFileSync(path.join(root,'package.json'),'utf8');
  const en=JSON.parse(fs.readFileSync(path.join(root,'package.nls.json'),'utf8'));
  const zh=JSON.parse(fs.readFileSync(path.join(root,'package.nls.zh-cn.json'),'utf8'));
  for(const m of manifest.matchAll(/%([^%]+)%/g)) { assert(en[m[1]],m[1]); assert(zh[m[1]],m[1]); }
  assert.deepEqual(Object.keys(en).sort(),Object.keys(zh).sort());
  assert(!/[\u3400-\u9fff]/.test(JSON.stringify(en)));
});
test('English errors include recovery advice; timeout retains its language-independent code', async () => {
  setLanguage('en');
  assert.match(explainError('remote port forwarding failed'),/in use or restricted/);
  assert.match(explainSystemError({code:'ENOENT'}),/Install OpenSSH.*PATH/);
  assert.match(explainSystemError({code:'ETIMEDOUT'},'target'),/timed out/);
  assert.throws(()=>validateRule({}),/SSH alias/);
  assert.match(explainSystemError({code:'XYZ'},'target'),/failed \(XYZ\)/);
  // Use an already closed local port so the failure has a real platform error code.
  await assert.rejects(probe('127.0.0.1',1),error=>typeof error.code==='string');
  setLanguage('zh-cn');
});
test('HTML renders English and Chinese safely without untranslated markers', () => {
  const html=fs.readFileSync(path.join(__dirname,'../media/panel.html'),'utf8');
  const en=renderLocalizedHtml(html,'en'); const zh=renderLocalizedHtml(html,'zh-cn');
  assert.match(en,/<html lang="en"/); assert.match(zh,/<html lang="zh-CN"/);
  assert(!/[\u3400-\u9fff]/.test(en)); assert(!en.includes('{{t:'));
  assert(zh.includes('转发地址'));
});
