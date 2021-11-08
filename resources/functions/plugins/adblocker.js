// Libraries
const fetch = require('electron-fetch').default;
const { ElectronBlocker, fullLists } = require('@cliqz/adblocker-electron');
const { writeFileSync, readFileSync } = require('fs'); // used for caching

// Tracking and ads blocker
exports.loadAdBlocker = async (window) => {
  const blocker = await ElectronBlocker.fromLists(
    fetch,
    fullLists,
    {
      enableCompression: true,
    },
    {
      path: 'ad-blocker-engine.bin',
      read: async (...args) => readFileSync(...args),
      write: async (...args) => writeFileSync(...args),
    },
  );

  blocker.enableBlockingInSession(window.webContents.session);
  
  blocker.on('request-blocked', (request) => {
    console.log('blocked', request.tabId, request.url);
  });
  
  blocker.on('request-redirected', (request) => {
    console.log('redirected', request.tabId, request.url);
  });
  
  blocker.on('request-whitelisted', (request) => {
    console.log('whitelisted', request.tabId, request.url);
  });
  
  blocker.on('csp-injected', (request) => {
    console.log('csp', request.url);
  });
  
  blocker.on('script-injected', (script, url) => {
    console.log('script', script.length, url);
  });
  
  blocker.on('style-injected', (style, url) => {
    console.log('style', style.length, url);
  });
};
