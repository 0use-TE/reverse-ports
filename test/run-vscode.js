'use strict';
const path = require('node:path');
const { runTests } = require('@vscode/test-electron');
runTests({
  ...(process.env.TEST_VSCODE_VERSION ? { version: process.env.TEST_VSCODE_VERSION } : {
    vscodeExecutablePath: process.env.VSCODE_EXE || path.join(process.env.LOCALAPPDATA,'Programs','Microsoft VS Code','Code.exe')
  }),
  extensionDevelopmentPath: path.resolve(__dirname,'..'),
  extensionTestsPath: path.resolve(__dirname,'extension-host.js'),
  launchArgs: ['--locale',process.env.TEST_VSCODE_LOCALE || 'en','--skip-welcome','--skip-release-notes','--disable-workspace-trust',
    '--user-data-dir',path.resolve(__dirname,'../test-results/profile'),
    '--extensions-dir',path.resolve(__dirname,'../test-results/extensions')]
}).catch(error => { console.error(error); process.exitCode=1; });
