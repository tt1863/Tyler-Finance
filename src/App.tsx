import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import { ChooseBudgetModal } from './components/SyncPanel';
import { maybeAutoSync } from './lib/bank/api';
import { pendingOAuth } from './lib/bank/plaidLink';
import { startSync, useSync } from './lib/sync/cloud';
import AccountPage from './pages/AccountPage';
import BudgetPage from './pages/BudgetPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import Welcome from './pages/Welcome';
import { today } from './lib/dates';
import { PREVIEW } from './lib/preview';
import { go, useRoute } from './lib/route';
import { processDue } from './lib/scheduled';
import { useStore } from './lib/store';

export default function App() {
  const data = useStore((s) => s.data);
  const undo = useStore((s) => s.undo);
  const route = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [route.join('/')]);

  // Coming back from a bank's own sign-in page (Chase and other OAuth banks):
  // linking finishes on the Settings screen, so go there.
  useEffect(() => {
    if (pendingOAuth() && route[0] !== 'settings') go('settings');
  }, []);

  useEffect(() => {
    void startSync();
  }, []);

  // Check linked banks for new transactions when the app opens or comes back
  // to the foreground (at most every 30 minutes).
  const syncStatus = useSync((s) => s.status);
  useEffect(() => {
    if (syncStatus === 'synced') maybeAutoSync();
    const onVisible = () => document.visibilityState === 'visible' && maybeAutoSync();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [syncStatus]);

  // Enter scheduled transactions that have come due, on open and whenever the
  // app comes back to the foreground (e.g. reopened from the home screen).
  useEffect(() => {
    const run = () => {
      const current = useStore.getState().data;
      if (current && processDue(current, today()).entered > 0) {
        useStore.getState().update((d) => processDue(d, today()).data);
      }
    };
    run();
    const onVisible = () => document.visibilityState === 'visible' && run();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [!!data]);

  // Ctrl/Cmd+Z undoes the last change (except while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo]);

  const banner = PREVIEW ? (
    <div className="preview-banner">
      🧪 Preview: <b>{PREVIEW}</b> — test copy with its own data. Your real budget isn't affected.
    </div>
  ) : null;

  if (!data)
    return (
      <>
        {banner}
        <Welcome />
        <ChooseBudgetModal />
      </>
    );

  const [page = 'budget', arg] = route;
  let content;
  if (page === 'accounts') content = <AccountPage accountId={arg ?? 'all'} key={arg ?? 'all'} />;
  else if (page === 'reports') content = <ReportsPage />;
  else if (page === 'settings') content = <SettingsPage />;
  else content = <BudgetPage month={arg} />;

  return (
    <div className={`app ${PREVIEW ? 'has-banner' : ''}`}>
      {banner}
      <header className="topbar">
        <button className="icon-btn" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
          ☰
        </button>
        <span className="brand">Tyler Finance</span>
        <a href="#/settings" className="icon-btn topbar-settings" aria-label="Settings & Data" title="Settings & Data">
          ⚙️
        </a>
      </header>
      <Sidebar open={menuOpen} current={page} currentArg={arg} onClose={() => setMenuOpen(false)} />
      <main className="main">{content}</main>
      <ChooseBudgetModal />
    </div>
  );
}
