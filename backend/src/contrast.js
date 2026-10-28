import colorNames from "color-name";

function parseChannel(value) {
  const trimmed = value.trim();
  if (trimmed.endsWith("%")) {
    const percentage = Number(trimmed.slice(0, -1));
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) return null;
    return Math.round((percentage / 100) * 255);
  }
  const channel = Number(trimmed);
  return Number.isFinite(channel) && channel >= 0 && channel <= 255 ? Math.round(channel) : null;
}

function parseAlpha(value) {
  if (value === undefined) return 1;
  const trimmed = value.trim();
  const alpha = trimmed.endsWith("%") ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed);
  return Number.isFinite(alpha) && alpha >= 0 && alpha <= 1 ? alpha : null;
}

export function parseCssColor(value) {
  if (typeof value !== "string") return null;
  const color = value.trim().toLowerCase();
  if (color === "transparent" || color === "currentcolor" || color.includes("var(") || color.includes("gradient(")) return null;

  if (Object.hasOwn(colorNames, color)) return { red: colorNames[color][0], green: colorNames[color][1], blue: colorNames[color][2], alpha: 1 };

  const hex = color.match(/^#([a-f\d]{3,8})$/i)?.[1];
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const digits = hex.length < 5
      ? [...hex].map((digit) => `${digit}${digit}`).join("")
      : hex;
    const hasAlpha = digits.length === 8;
    const values = digits.match(/.{2}/g).map((part) => Number.parseInt(part, 16));
    return {
      red: values[0],
      green: values[1],
      blue: values[2],
      alpha: hasAlpha ? values[3] / 255 : 1,
    };
  }

  const rgb = color.match(/^rgba?\(\s*(.+)\s*\)$/);
  if (!rgb) return null;

  const contents = rgb[1].replace(/\s*\/\s*/, ",").replace(/\s*,\s*/g, ",");
  const parts = contents.includes(",")
    ? contents.split(",").map((part) => part.trim())
    : contents.split(/\s+/);
  if (parts.length !== 3 && parts.length !== 4) return null;
  const channels = parts.slice(0, 3).map(parseChannel);
  const alpha = parseAlpha(parts[3]);
  if (channels.some((channel) => channel === null) || alpha === null) return null;
  return { red: channels[0], green: channels[1], blue: channels[2], alpha };
}

function linearize(channel) {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color) {
  const parsed = typeof color === "string" ? parseCssColor(color) : color;
  if (!parsed || parsed.alpha !== 1) return null;
  return (0.2126 * linearize(parsed.red))
    + (0.7152 * linearize(parsed.green))
    + (0.0722 * linearize(parsed.blue));
}

export function calculateContrast(foreground, background, fontSizePx = 16, isBold = false) {
  const foregroundColor = parseCssColor(foreground);
  const backgroundColor = parseCssColor(background);
  const reviewReasons = [];

  if (!foregroundColor) reviewReasons.push("Foreground color format is unsupported or context-dependent.");
  if (!backgroundColor) reviewReasons.push("Background color format is unsupported or context-dependent.");
  if (foregroundColor && foregroundColor.alpha !== 1) reviewReasons.push("Transparent foreground needs compositing against its actual background.");
  if (backgroundColor && backgroundColor.alpha !== 1) reviewReasons.push("Transparent background needs compositing against the rendered canvas.");

  if (reviewReasons.length) {
    return { status: "needs_review", ratio: null, requiredRatio: null, passes: null, reason: reviewReasons.join(" ") };
  }

  const foregroundLuminance = relativeLuminance(foregroundColor);
  const backgroundLuminance = relativeLuminance(backgroundColor);
  const ratio = (Math.max(foregroundLuminance, backgroundLuminance) + 0.05)
    / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
  const largeText = fontSizePx >= 24 || (fontSizePx >= 18.66 && isBold);
  const requiredRatio = largeText ? 3 : 4.5;

  return {
    status: ratio >= requiredRatio ? "pass" : "fail",
    ratio: Number(ratio.toFixed(2)),
    requiredRatio,
    passes: ratio >= requiredRatio,
    reason: largeText ? "Large text threshold." : "Normal text threshold.",
  };
}
