import { useState } from 'react';
import { SignInForm } from '../components/SyncPanel';
import { demoData } from '../lib/demo';
import { syncConfigured } from '../lib/sync/cloud';
import { emptyData, starterData } from '../lib/ops';
import { go } from '../lib/route';
import { useStore } from '../lib/store';

export default function Welcome() {
  const replace = useStore((s) => s.replace);
  const [signingIn, setSigningIn] = useState(false);
  const start = (data: ReturnType<typeof emptyData>) => {
    replace(data);
    go('budget');
  };
  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="logo">✉️</div>
        <h1>Tyler Finance</h1>
        <p className="lead">Give every dollar a job.</p>
        <ol className="rules">
          <li>
            <b>Assign every dollar.</b> Put the money you have into categories until Ready to Assign is zero.
          </li>
          <li>
            <b>Plan for irregular costs.</b> Set aside a little each month for big, once-a-year expenses.
          </li>
          <li>
            <b>Adjust when life happens.</b> Overspent? Move money from another category.
          </li>
          <li>
            <b>Build a buffer.</b> Work toward spending last month's income this month.
          </li>
        </ol>
        <div className="welcome-actions">
          <button className="btn primary big" onClick={() => start(starterData())}>
            Start my budget
          </button>
          <button className="btn big" onClick={() => start(demoData())}>
            Explore with sample data
          </button>
          <button className="link-btn small" onClick={() => start(emptyData())}>
            Start completely blank
          </button>
          <button
            className="link-btn small"
            onClick={() => {
              replace(emptyData());
              go('settings/ynab');
            }}
          >
            Coming from YNAB? Import your YNAB export
          </button>
        </div>
        {syncConfigured &&
          (signingIn ? (
            <div className="card welcome-signin">
              <h3>Sign in to get your budget</h3>
              <SignInForm />
            </div>
          ) : (
            <button className="btn big welcome-sync" onClick={() => setSigningIn(true)}>
              ☁️ I already have a budget — sign in
            </button>
          ))}
        <p className="muted small">
          {syncConfigured
            ? 'Your budget is saved on this device. Sign in any time to sync it across your devices.'
            : 'Your data stays in this browser. Nothing is sent anywhere.'}
        </p>
      </div>
    </div>
  );
}
