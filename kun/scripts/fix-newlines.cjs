// Fix files without trailing newline
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const dirs = ['src', 'tests'];

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, files);
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

const allFiles = [];
for (const d of dirs) {
  walk(path.join(projectRoot, d), allFiles);
}

let fixed = 0;
for (const file of allFiles) {
  const content = fs.readFileSync(file);
  if (content.length > 0 && content[content.length - 1] !== 0x0A) {
    fs.appendFileSync(file, '\n');
    fixed++;
  }
}
console.log(`Fixed trailing newlines in ${fixed} files`);