import { app, BrowserWindow, globalShortcut, session } from 'electron';
import * as path from 'node:path';
import { registerIpc } from './ipc';
import { Logger } from './logger';
import { Runtime } from './runtime';
import { WindowManager, quitting } from './windows';

// Test/portable override of the data folder (the installer never sets this).
if (process.env.AFUUFOW_USER_DATA) app.setPath('userData', process.env.AFUUFOW_USER_DATA);

const startedInBackground = process.argv.includes('--background');

// A second launch just brings the first one forward.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.setAppUserModelId('com.afuufow.assistant');
app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer');

const log = new Logger(path.join(app.getPath('userData'), 'logs'));
const windows = new WindowManager();
let runtime: Runtime | null = null;
let crashCount = 0;

async function boot() {
  runtime = new Runtime(app.getPath('userData'), log, windows, startedInBackground);
  windows.attach(runtime);
  registerIpc(runtime, log);
  windows.createTray();
  try {
    await runtime.init();
  } catch (e) {
    log.error('runtime init failed', e);
    windows.ensureWindow();
    windows.showMainWindow();
    windows.send('notice', { level: 'error', so: 'Afuufow si buuxda uma bilaaban; eeg Troubleshooting.', en: 'Afuufow did not start completely; see Troubleshooting. ' + (e as Error).message });
  }
  registerShortcuts();
  const s = runtime.settings.get();
  // hidden start (login) only after setup has been completed; first run always shows the wizard
  if (!(startedInBackground && s.setupComplete && s.general.startHidden)) windows.showMainWindow();
  else windows.ensureWindow();
  windows.updateTray();
}

function registerShortcuts() {
  if (!runtime) return;
  const g = runtime.settings.get().general;
  globalShortcut.unregisterAll();
  const reg = (accel: string, fn: () => void, what: string) => {
    try {
      if (!globalShortcut.register(accel, fn)) log.warn(`could not register ${what} shortcut ${accel} (in use by another program)`);
    } catch (e) {
      log.warn(`invalid ${what} shortcut ${accel}: ${(e as Error).message}`);
    }
  };
  reg(g.pushToTalkShortcut, () => runtime!.pttToggle(), 'push-to-talk');
  reg(g.stopShortcut, () => runtime!.stopEverything(), 'stop');
  reg(g.showWindowShortcut, () => windows.showMainWindow(), 'show-window');
  runtime.settings.onChange((n, p) => {
    if (n.general.pushToTalkShortcut !== p.general.pushToTalkShortcut || n.general.stopShortcut !== p.general.stopShortcut || n.general.showWindowShortcut !== p.general.showWindowShortcut) registerShortcuts();
  });
}

app.on('second-instance', () => windows.showMainWindow());

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _p, cb) => cb(false));
  await boot();
});

// Keep running in the tray when every window is closed.
app.on('window-all-closed', () => undefined);

app.on('before-quit', () => {
  quitting.value = true;
  (globalThis as { __afuQuitting?: boolean }).__afuQuitting = true;
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('quit', () => void runtime?.shutdown());

// ---- crash recovery: log, tell the owner, and relaunch (with a limit to avoid loops)
function fatal(kind: string, e: unknown) {
  log.error(kind, e);
  crashCount++;
  windows.send('notice', { level: 'error', so: 'Cilad lama filaan ayaa dhacday; Afuufow way sii shaqeynaysaa.', en: `Unexpected error (${kind}); Afuufow keeps running.` });
  if (crashCount >= 5 && !quitting.value) {
    log.error('too many unexpected errors; relaunching');
    app.relaunch({ args: process.argv.slice(1) });
    app.exit(1);
  }
}
process.on('uncaughtException', (e) => fatal('uncaughtException', e));
process.on('unhandledRejection', (e) => fatal('unhandledRejection', e));
app.on('child-process-gone', (_e, d) => log.warn(`child process gone: ${d.type} ${d.reason}`));
app.on('render-process-gone', (_e, wc, d) => log.warn(`renderer gone: ${wc.getURL()} ${d.reason}`));
void BrowserWindow;
