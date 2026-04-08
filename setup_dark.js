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
  "background": "#141218", "on-background": "#e5e1e6", "surface": "#141218", "surface-dim": "#141218",
  "surface-bright": "#3a383f", "surface-container-lowest": "#0f0d13", "surface-container-low": "#1c1b1f",
  "surface-container": "#211f26", "surface-container-high": "#2b2930", "surface-container-highest": "#36343b",
  "on-surface": "#e5e1e6", "on-surface-variant": "#c8c5d0", "outline": "#938f99", "outline-variant": "#47464f",
  "inverse-surface": "#e5e1e6", "inverse-on-surface": "#313034", "inverse-primary": "#5a598b",
  "primary": "#c3c1f9", "on-primary": "#2c2b59", "primary-container": "#424271", "on-primary-container": "#e2dfff",
  "primary-fixed": "#e2dfff", "on-primary-fixed": "#161543", "primary-fixed-dim": "#c3c1f9", "on-primary-fixed-variant": "#424271",
  "secondary": "#c6c4dd", "on-secondary": "#2f2e41", "secondary-container": "#454559", "on-secondary-container": "#e0ddf6",
  "secondary-fixed": "#e3e0f9", "on-secondary-fixed": "#1a1a2c", "secondary-fixed-dim": "#c6c4dd", "on-secondary-fixed-variant": "#464559",
  "tertiary": "#dcc578", "on-tertiary": "#3c3000", "tertiary-container": "#544600", "on-tertiary-container": "#f9e191",
  "tertiary-fixed": "#f9e191", "on-tertiary-fixed": "#221b00", "tertiary-fixed-dim": "#dcc578", "on-tertiary-fixed-variant": "#554603",
  "error": "#ffb4ab", "on-error": "#690005", "error-container": "#93000a", "on-error-container": "#ffdad6", "surface-tint": "#c3c1f9"
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
