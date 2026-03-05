# Dark mode toggle – Lovable spec

Add a **dark mode toggle in the header** so the user can switch between light and dark themes. Persist the choice (e.g. in `localStorage`) and apply it on load.

---

## Copy this into Lovable

```
Add a dark mode toggle to the header.

1. **Header**: In the main app header (or navbar), add a toggle control: icon button or switch labeled "Dark mode" / "Light mode", or use a sun/moon icon. Place it on the right side of the header (e.g. next to user menu or logo).

2. **Behavior**:
   - Clicking the toggle switches the app between light and dark theme.
   - Store the user's choice in localStorage (e.g. key "theme", value "light" or "dark").
   - On initial load, read localStorage; if no value, default to "light" (or use system preference: prefers-color-scheme: dark).

3. **Theming**:
   - Use CSS variables for colors so one toggle can change the whole app. Example:
     - Light: --bg: #fff; --text: #111; --surface: #f5f5f5; --border: #e0e0e0;
     - Dark: --bg: #1a1a1a; --text: #e5e5e5; --surface: #2d2d2d; --border: #404040;
   - Add a class to the root element (e.g. <html> or #root): "theme-light" or "theme-dark", and define .theme-dark { ... } overrides for all the variables.
   - Apply the class based on the current theme state (from localStorage or React state).

4. **Optional**: Respect system preference on first visit: use window.matchMedia('(prefers-color-scheme: dark)').matches to set initial theme if nothing is in localStorage.
```

---

## Implementation notes (for your frontend)

### 1. Root CSS variables (global styles)

```css
:root, .theme-light {
  --bg: #ffffff;
  --text: #111111;
  --text-muted: #666666;
  --surface: #f5f5f5;
  --border: #e0e0e0;
  --primary: #2563eb;
  --header-bg: #ffffff;
}

.theme-dark {
  --bg: #1a1a1a;
  --text: #e5e5e5;
  --text-muted: #a3a3a3;
  --surface: #2d2d2d;
  --border: #404040;
  --primary: #3b82f6;
  --header-bg: #1a1a1a;
}

body {
  background-color: var(--bg);
  color: var(--text);
}
```

### 2. Toggle in header (React example)

```jsx
// Theme: 'light' | 'dark'
const [theme, setTheme] = useState(() => 
  localStorage.getItem('theme') || 
  (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
);

useEffect(() => {
  document.documentElement.classList.remove('theme-light', 'theme-dark');
  document.documentElement.classList.add(`theme-${theme}`);
  localStorage.setItem('theme', theme);
}, [theme]);

const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');

// In header JSX:
<button onClick={toggleTheme} aria-label="Toggle dark mode">
  {theme === 'light' ? '🌙' : '☀️'}
</button>
```

### 3. Alternative: data attribute

Instead of classes, you can use `data-theme="light"` or `data-theme="dark"` on the root and style with `[data-theme="dark"] { ... }`.

---

Use the same pattern in your Lovable project: add the toggle to the header component, theme state (and localStorage), and the CSS variable overrides for `.theme-dark`.
