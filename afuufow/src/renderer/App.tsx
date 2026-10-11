import { useEffect, useState } from 'react';
import { AuthModal } from './components/AuthModal';
import { Agent } from './pages/Agent';
import { DeviceToggles } from './components/Controls';
import { Toasts } from './components/ui';
import { useL, useT } from './i18n';
import { History } from './pages/History';
import { Home } from './pages/Home';
import { Integrations } from './pages/Integrations';
import { Memory } from './pages/Memory';
import { Permissions } from './pages/Permissions';
import { Privacy } from './pages/Privacy';
import { Settings } from './pages/Settings';
import { Setup } from './pages/Setup';
import { Troubleshoot } from './pages/Troubleshoot';
import { Visitors } from './pages/Visitors';
import { call, patchSettings, startStore, useUi } from './store';

const PAGES = [
  ['home', '🏠', 'nav.home'], ['history', '🕘', 'nav.history'], ['memory', '🧠', 'nav.memory'], ['visitors', '👁', 'nav.visitors'],
  ['agent', '🛠', 'nav.agent'], ['integrations', '🔌', 'nav.integrations'], ['permissions', '🛡', 'nav.permissions'], ['privacy', '🔒', 'nav.privacy'], ['setup', '🧭', 'nav.setup'], ['help', '🩺', 'nav.help'], ['settings', '⚙', 'nav.settings'],
] as const;

export function App() {
  const snap = useUi((s) => s.snap);
  const t = useT();
  const L = useL();
  const [page, setPage] = useState<string>('home');
  useEffect(() => {
    void startStore();
  }, []);
  useEffect(() => {
    if (snap && !snap.settings.setupComplete) setPage('setup');
  }, [snap?.settings.setupComplete]);
  useEffect(() => {
    if (!snap) return;
    const theme = snap.settings.general.theme;
    const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.lang = snap.settings.general.uiLanguage;
  }, [snap?.settings.general.theme, snap?.settings.general.uiLanguage]);
  if (!snap) return <div style={{ padding: 30 }}>Afuufow…</div>;
  const setupDone = snap.settings.setupComplete;
  return (
    <div className="app">
      <nav className="side" aria-label="Main">
        <div className="brand"><div className="logo">A</div> Afuufow</div>
        {PAGES.map(([id, icon, key]) => (
          <button key={id} className={`nav ${page === id ? 'active' : ''}`} onClick={() => setPage(id)} disabled={!setupDone && id !== 'setup' && id !== 'help' && id !== 'privacy'}>
            <span>{icon}</span> {t(key)} {id === 'visitors' && snap.pendingVisitors > 0 && <span className="badge">{snap.pendingVisitors}</span>}
          </button>
        ))}
        <div className="spacer" />
        <div className="small muted" style={{ padding: '6px 10px' }}>{t('quit.note')}</div>
        <button className="nav" onClick={() => void call('app.quit')}>⏻ {t('quit')}</button>
        <div className="small muted" style={{ padding: '6px 10px' }}>v{snap.version}</div>
      </nav>
      <div className="main">
        <div className="top">
          <span className="pill"><span className={`dot ${snap.state === 'error' ? 'err' : snap.state === 'sleeping' ? 'ok' : snap.state === 'paused' ? '' : 'warn live'}`} /> {t('state.' + snap.state)}</span>
          <DeviceToggles />
          <span className="spacer" />
          {snap.loadErrors.length > 0 && <span className="pill" title={snap.loadErrors.join('\n')}>⚠ {snap.loadErrors.length}</span>}
          <button className="btn sm ghost" onClick={() => void patchSettings({ general: { theme: snap.settings.general.theme === 'dark' ? 'light' : 'dark' } })} title={t('theme')}>{snap.settings.general.theme === 'dark' ? '☀' : '🌙'}</button>
          <button className="btn sm ghost" onClick={() => void patchSettings({ general: { uiLanguage: snap.settings.general.uiLanguage === 'so' ? 'en' : 'so' } })} title={t('language')}>{snap.settings.general.uiLanguage === 'so' ? 'EN' : 'SO'}</button>
        </div>
        <div className={page === 'home' ? 'page fit' : 'page'}>
          {page === 'home' && <Home />}
          {page === 'history' && <History />}
          {page === 'memory' && <Memory />}
          {page === 'visitors' && <Visitors />}
          {page === 'agent' && <Agent />}
          {page === 'integrations' && <Integrations />}
          {page === 'permissions' && <Permissions />}
          {page === 'privacy' && <Privacy />}
          {page === 'setup' && <Setup onDone={() => setPage('home')} />}
          {page === 'help' && <Troubleshoot />}
          {page === 'settings' && <Settings />}
        </div>
      </div>
      <Toasts />
      <AuthModal />
      <span style={{ display: 'none' }}>{L('', '')}</span>
    </div>
  );
}
