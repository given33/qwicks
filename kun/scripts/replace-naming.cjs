// One-shot naming replacement script for compat-model-client.ts
const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');
const file = path.join(projectRoot, 'src', 'adapters', 'model', 'compat-model-client.ts.new');
let text = fs.readFileSync(file, 'utf8');

// Replace project naming references only - leave MiniMax (vendor name) intact
const replacements = [
  // log prefixes
  ['[kun:model]', '[teamflow-agent:model]'],
  // generic kun identifier references in strings
  ['"kun"', '"teamflow-agent"'],
  ["'kun'", "'teamflow-agent'"],
  // /kun/ paths
  ['/kun/', '/teamflow-agent/'],
];

for (const [from, to] of replacements) {
  text = text.split(from).join(to);
}

const target = path.join(projectRoot, 'src', 'adapters', 'model', 'compat-model-client.ts');
fs.writeFileSync(target, text, 'utf8');
fs.unlinkSync(file);
console.log('Replacements complete. Output:', target);
console.log('Lines:', text.split('\n').length);