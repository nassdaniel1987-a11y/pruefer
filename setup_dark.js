const fs = require('fs');

const lightColors = {
  "background": "#fcf8fd", "on-background": "#1c1b1f", "surface": "#fcf8fd", "surface-dim": "#dcd9dd",
  "surface-bright": "#fcf8fd", "surface-container-lowest": "#ffffff", "surface-container-low": "#f6f2f7",
  "surface-container": "#f0edf1", "surface-container-high": "#ebe7ec", "surface-container-highest": "#e5e1e6",
  "on-surface": "#1c1b1f", "on-surface-variant": "#47464f", "outline": "#787680", "outline-variant": "#c8c5d0",
  "inverse-surface": "#313034", "inverse-on-surface": "#f3eff4", "inverse-primary": "#c3c1f9",
  "primary": "#5a598b", "on-primary": "#ffffff", "primary-container": "#7372a5", "on-primary-container": "#020026",
  "primary-fixed": "#e2dfff", "on-primary-fixed": "#161543", "primary-fixed-dim": "#c3c1f9", "on-primary-fixed-variant": "#424271",
  "secondary": "#5d5c71", "on-secondary": "#ffffff", "secondary-container": "#e0ddf6", "on-secondary-container": "#626076",
  "secondary-fixed": "#e3e0f9", "on-secondary-fixed": "#1a1a2c", "secondary-fixed-dim": "#c6c4dd", "on-secondary-fixed-variant": "#464559",
  "tertiary": "#6e5d1b", "on-tertiary": "#ffffff", "tertiary-container": "#bfaa60", "on-tertiary-container": "#4c3e00",
  "tertiary-fixed": "#f9e191", "on-tertiary-fixed": "#221b00", "tertiary-fixed-dim": "#dcc578", "on-tertiary-fixed-variant": "#554603",
  "error": "#ba1a1a", "on-error": "#ffffff", "error-container": "#ffdad6", "on-error-container": "#93000a", "surface-tint": "#5a598b"
};

const darkColors = {
  "background": "#0f172a", "on-background": "#f8fafc", "surface": "#0f172a", "surface-dim": "#020617",
  "surface-bright": "#1e293b", "surface-container-lowest": "#020617", "surface-container-low": "#0f172a",
  "surface-container": "#1e293b", "surface-container-high": "#334155", "surface-container-highest": "#475569",
  "on-surface": "#f8fafc", "on-surface-variant": "#cbd5e1", "outline": "#94a3b8", "outline-variant": "#475569",
  "inverse-surface": "#f8fafc", "inverse-on-surface": "#0f172a", "inverse-primary": "#4f46e5",
  "primary": "#818cf8", "on-primary": "#1e1b4b", "primary-container": "#3730a3", "on-primary-container": "#e0e7ff",
  "primary-fixed": "#e0e7ff", "on-primary-fixed": "#1e1b4b", "primary-fixed-dim": "#a5b4fc", "on-primary-fixed-variant": "#312e81",
  "secondary": "#94a3b8", "on-secondary": "#0f172a", "secondary-container": "#334155", "on-secondary-container": "#f1f5f9",
  "secondary-fixed": "#f1f5f9", "on-secondary-fixed": "#0f172a", "secondary-fixed-dim": "#94a3b8", "on-secondary-fixed-variant": "#334155",
  "tertiary": "#fcd34d", "on-tertiary": "#422006", "tertiary-container": "#92400e", "on-tertiary-container": "#fef3c7",
  "tertiary-fixed": "#fef3c7", "on-tertiary-fixed": "#451a03", "tertiary-fixed-dim": "#fcd34d", "on-tertiary-fixed-variant": "#b45309",
  "error": "#fca5a5", "on-error": "#450a0a", "error-container": "#991b1b", "on-error-container": "#fee2e2", "surface-tint": "#818cf8"
};

let cssContent = `:root {\n`;
for (const [key, val] of Object.entries(lightColors)) {
  cssContent += `  --color-${key}: ${val};\n`;
}
cssContent += `}\n\n.dark {\n`;
for (const [key, val] of Object.entries(darkColors)) {
  cssContent += `  --color-${key}: ${val};\n`;
}
cssContent += `}\n\n`;

let indexCss = fs.readFileSync('src/style.css', 'utf8');
if (!indexCss.includes('--color-primary')) {
  fs.writeFileSync('src/style.css', cssContent + indexCss);
}

let html = fs.readFileSync('index.html', 'utf8');
const twConfigRegex = /colors: {[^}]+}/s;
let newColorsMapping = 'colors: {\n';
for (const key of Object.keys(lightColors)) {
  newColorsMapping += `            "${key}": "var(--color-${key})",\n`;
}
newColorsMapping += '          }';
html = html.replace(twConfigRegex, newColorsMapping);
fs.writeFileSync('index.html', html);

console.log("Done");
