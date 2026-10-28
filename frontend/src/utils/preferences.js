export const DEFAULT_PREFERENCES = {
  defaultLevel: "AA",
  includeBestPractices: true,
  reducedMotion: false,
};

export function readThemePreference() {
  try {
    return localStorage.getItem("a11ypilot-theme") ?? "dark";
  } catch {
    return "light";
  }
}

export function saveThemePreference(theme) {
  try {
    localStorage.setItem("a11ypilot-theme", theme);
    return true;
  } catch {
    return false;
  }
}

export function savePreferences(preferences) {
  try {
    localStorage.setItem("a11ypilot-preferences", JSON.stringify(preferences));
    return true;
  } catch {
    return false;
  }
}

export function readPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem("a11ypilot-preferences") ?? "null");
    return { ...DEFAULT_PREFERENCES, ...(stored && typeof stored === "object" ? stored : {}) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}
