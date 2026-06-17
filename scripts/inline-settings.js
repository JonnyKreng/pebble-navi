const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'src', 'pkjs', 'settings.html');
const dest = path.join(__dirname, '..', 'src', 'pkjs', 'settings-template.ts');

const html = fs.readFileSync(src, 'utf8');
const escaped = html.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const ts = 'export const SETTINGS_HTML = `' + escaped + '`;\n';
fs.writeFileSync(dest, ts);
