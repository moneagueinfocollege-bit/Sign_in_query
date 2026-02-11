const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const isDev = process.argv.includes('--dev');
const { checkAndUpdateForcedSignOuts } = require('./firebase-config');

// Auto-update from GitHub (only when packaged, not in dev)
let autoUpdater;
if (!isDev && app.isPackaged) {
  try {
    autoUpdater = require('electron-updater').autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;

    autoUpdater.on('update-available', (info) => {
      console.log('Update available:', info.version);
    });

    autoUpdater.on('update-downloaded', (info) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        dialog.showMessageBox(win, {
          type: 'info',
          title: 'Update ready',
          message: `Version ${info.version} has been downloaded. Restart the app to install the update.`,
          buttons: ['Restart now', 'Later']
        }).then(({ response }) => {
          if (response === 0) autoUpdater.quitAndInstall(false, true);
        });
      }
    });

    autoUpdater.on('error', (err) => {
      console.error('Auto-update error:', err.message);
    });
  } catch (e) {
    console.warn('electron-updater not available:', e.message);
  }
}

if (isDev) {
  require('electron-reload')(__dirname, {
    electron: path.join(__dirname, 'node_modules', '.bin', 'electron')
  });
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false
    }
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    console.error('Failed to load:', errorDescription);
  });

  mainWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    console.error('Preload error:', preloadPath, error);
  });
}

app.whenReady().then(async () => {
  createWindow();

  // Check for app updates from GitHub (packaged app only)
  if (autoUpdater) {
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 3000);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000); // Every 4 hours
  }

  // Run initial check for forced sign-outs
  await checkAndUpdateForcedSignOuts();

  // Set up periodic check every 15 minutes
  setInterval(async () => {
    await checkAndUpdateForcedSignOuts();
  }, 15 * 60 * 1000); // Check every 15 minutes
});

// Allow renderer to request a manual update check (no-op when not packaged)
ipcMain.handle('check-for-updates', () => autoUpdater ? autoUpdater.checkForUpdates().catch(() => {}) : Promise.resolve());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
}); 