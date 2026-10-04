/*! Rendra IDE v1.7.1 | MIT | © 2026 Bruno Magalhaes | brunomagalhaes.me */
// Runs the session scan off the Electron main thread. The first scan parses every JSONL file
// (several seconds); doing it on the main thread froze terminals, file I/O and IPC meanwhile.
// The worker stays alive so the parser's in-memory file cache makes later scans fast.

const { parentPort } = require('worker_threads');
const { scan } = require('./scanner');
const { setCacheFile, setAliasesFile } = require('./claude-parser');

let cacheSet = false;
parentPort.on('message', async ({ id, settings }) => {
  try {
    // persisted parse cache: next launches only re-read changed session files
    if (!cacheSet && settings?.cacheFile) { setCacheFile(settings.cacheFile); cacheSet = true; }
    // the user's price table (Preços page), re-read before every scan so a save applies at once
    if (settings?.pricingFile) require('./pricer').setPricingFile(settings.pricingFile);
    if (settings?.aliasesFile) setAliasesFile(settings.aliasesFile); // personal: lives in user data
    parentPort.postMessage({ id, data: await scan(settings) });
  } catch (e) {
    parentPort.postMessage({ id, error: e.message });
  }
});
