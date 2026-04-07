const fs = require('fs');
let code = fs.readFileSync('c:/Prüfer/src/App.jsx', 'utf8');
code = code.replace(/<div \`className=/g, '<div className={`');
code = code.replace(/group-hover:text-primary'\`}>/g, "group-hover:text-primary'`}>");
code = code.replace(/group-hover:border-primary-fixed z-10'}\`}>/g, "group-hover:border-primary-fixed z-10'`}>");
fs.writeFileSync('c:/Prüfer/src/App.jsx', code, 'utf8');
console.log("Fixed backticks");
