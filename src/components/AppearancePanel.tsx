import { THEMES, resolvedMode, useThemePrefs, type Mode } from '../lib/theme';

const MODES: { value: Mode; label: string }[] = [
  { value: 'system', label: 'Automatic' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

/** Settings card: color theme and light/dark mode (saved on this device). */
export default function AppearancePanel() {
  const [prefs, setPrefs] = useThemePrefs();
  const mode = resolvedMode(prefs.mode);
  return (
    <section className="card">
      <h3>Appearance</h3>
      <div className="segmented" role="group" aria-label="Light or dark">
        {MODES.map((m) => (
          <button key={m.value} className={prefs.mode === m.value ? 'active' : ''} onClick={() => setPrefs({ ...prefs, mode: m.value })}>
            {m.label}
          </button>
        ))}
      </div>
      <div className="theme-grid" role="radiogroup" aria-label="Color theme">
        {THEMES.map((t) => {
          const a = t[mode];
          return (
            <button
              key={t.id}
              role="radio"
              aria-checked={prefs.theme === t.id}
              className={`theme-swatch ${prefs.theme === t.id ? 'active' : ''}`}
              onClick={() => setPrefs({ ...prefs, theme: t.id })}
            >
              <span className="chip" aria-hidden>
                <span style={{ background: a.navBg }} />
                <span style={{ background: a.navActive }} />
                <span style={{ background: a.primary }} />
              </span>
              {t.name}
            </button>
          );
        })}
      </div>
      <p className="hint">Saved on this device. "Automatic" follows your phone's light/dark setting.</p>
    </section>
  );
}
