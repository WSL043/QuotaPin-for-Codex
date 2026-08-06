export function createColorStateToolkit() {
  const customHex = /^#[0-9a-f]{6}$/i;

  function rgbFromColor(value) {
    const source = String(value ?? "").trim();
    const hex = source.match(/^#([0-9a-f]{6})$/i);
    if (hex) {
      return {
        r: Number.parseInt(hex[1].slice(0, 2), 16),
        g: Number.parseInt(hex[1].slice(2, 4), 16),
        b: Number.parseInt(hex[1].slice(4, 6), 16),
      };
    }
    const rgb = source.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!rgb) return null;
    return {
      r: Math.max(0, Math.min(255, Number(rgb[1]))),
      g: Math.max(0, Math.min(255, Number(rgb[2]))),
      b: Math.max(0, Math.min(255, Number(rgb[3]))),
    };
  }

  function linear(channel) {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }

  function luminance(color) {
    const rgb = typeof color === "string" ? rgbFromColor(color) : color;
    if (!rgb) return null;
    return 0.2126 * linear(rgb.r) + 0.7152 * linear(rgb.g) + 0.0722 * linear(rgb.b);
  }

  function contrastRatio(foreground, background) {
    const foregroundLuminance = luminance(foreground);
    const backgroundLuminance = luminance(background);
    if (foregroundLuminance === null || backgroundLuminance === null) return 1;
    const lighter = Math.max(foregroundLuminance, backgroundLuminance);
    const darker = Math.min(foregroundLuminance, backgroundLuminance);
    return (lighter + 0.05) / (darker + 0.05);
  }

  function toHex(rgb) {
    const channel = (value) => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0");
    return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
  }

  function surfaceFromTextColor(nativeTextColor) {
    const textLuminance = luminance(nativeTextColor);
    return textLuminance !== null && textLuminance < 0.45 ? "light" : "dark";
  }

  function automaticContrast(color, mode, surface, minimum = 4.5) {
    if (surface !== "light" || customHex.test(String(mode ?? "")) || ["muted", "inherit"].includes(mode)) return color;
    const source = rgbFromColor(color);
    if (!source) return color;
    const background = { r: 255, g: 255, b: 255 };
    if (contrastRatio(source, background) >= minimum) return toHex(source);
    let candidate = { ...source };
    for (let step = 0; step < 24 && contrastRatio(candidate, background) < minimum; step += 1) {
      candidate = { r: candidate.r * 0.88, g: candidate.g * 0.88, b: candidate.b * 0.88 };
    }
    return toHex(candidate);
  }

  return { rgbFromColor, luminance, contrastRatio, surfaceFromTextColor, automaticContrast };
}
