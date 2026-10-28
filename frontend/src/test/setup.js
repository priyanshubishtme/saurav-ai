import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
  localStorage.clear();
  window.history.replaceState({}, "", "/");
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-reduce-motion");
});
