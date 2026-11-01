import { useEffect, useState } from 'react';
import Sidebar from './components/Sidebar';
import AccountPage from './pages/AccountPage';
import BudgetPage from './pages/BudgetPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import Welcome from './pages/Welcome';
import { useRoute } from './lib/route';
import { useStore } from './lib/store';

export default function App() {
  const data = useStore((s) => s.data);
  const undo = useStore((s) => s.undo);
  const route = useRoute();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => setMenuOpen(false), [route.join('/')]);

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

  if (!data) return <Welcome />;

  const [page = 'budget', arg] = route;
  let content;
  if (page === 'accounts') content = <AccountPage accountId={arg ?? 'all'} key={arg ?? 'all'} />;
  else if (page === 'reports') content = <ReportsPage />;
  else if (page === 'settings') content = <SettingsPage />;
  else content = <BudgetPage month={arg} />;

  return (
    <div className="app">
      <header className="topbar">
        <button className="icon-btn" aria-label="Menu" onClick={() => setMenuOpen((o) => !o)}>
          ☰
        </button>
        <span className="brand">Tyler Finance</span>
      </header>
      <Sidebar open={menuOpen} current={page} currentArg={arg} onClose={() => setMenuOpen(false)} />
      <main className="main">{content}</main>
    </div>
  );
}
