/* ============================================================================
   MARQUEE — Electron main process, step 1 spike.

   All this shell does at this stage is open marquee.html in a real window,
   the way double-clicking it does but without a browser wrapped around it.
   No custom schemes yet (that's step 2), no Mains spawning yet (that's
   later if we want it). Batteries mode is unchanged and this file is not
   loaded on that path.
   ============================================================================ */

'use strict';

var electron = require('electron');
var path     = require('path');

var app           = electron.app;
var BrowserWindow = electron.BrowserWindow;

function createWindow() {
  var win = new BrowserWindow({
    width: 1280,
    height: 860,
    title: 'Marquee',
    autoHideMenuBar: true,
    backgroundColor: '#111',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'marquee.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', function () {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
