#!/usr/bin/env node
/**
 * Copies the built plugin into the local Kibana plugins directory.
 * Usage: node scripts/install-plugin.js [--kibana-home /path/to/kibana]
 */
const fs = require('fs');
const path = require('path');
const {execSync} = require('child_process');

const args = process.argv.slice(2);
const kibanaHomeIdx = args.indexOf('--kibana-home');
const kibanaHome =
    kibanaHomeIdx >= 0
        ? args[kibanaHomeIdx + 1]
        : process.env.KIBANA_HOME;

if (!kibanaHome) {
    console.error(
        'Error: set KIBANA_HOME or pass --kibana-home /path/to/kibana'
    );
    process.exit(1);
}

const PLUGIN_ID = 'rum-session-replay';
const dest = path.join(kibanaHome, 'plugins', PLUGIN_ID);
const src = path.resolve(__dirname, '..');

console.log(`Installing plugin to: ${dest}`);

// Create plugins dir if absent
fs.mkdirSync(path.join(kibanaHome, 'plugins'), {recursive: true});

// Remove old version
fs.rmSync(dest, {recursive: true, force: true});
fs.mkdirSync(dest, {recursive: true});

// Files to copy
const filesToCopy = [
    'kibana.json',
    'target/public/kibana.js',
    'target/server/index.js',
    'target/server/plugin.js',
    'target/server/routes',
];

for (const file of filesToCopy) {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    if (!fs.existsSync(srcPath)) {
        console.warn(`  Warning: ${file} not found — run npm run build first`);
        continue;
    }
    fs.mkdirSync(path.dirname(destPath), {recursive: true});
    if (fs.statSync(srcPath).isDirectory()) {
        execSync(`cp -r "${srcPath}" "${path.dirname(destPath)}"`);
    } else {
        fs.copyFileSync(srcPath, destPath);
    }
    console.log(`  ✓ ${file}`);
}

// Copy common (needed at runtime by server)
const commonSrc = path.join(src, 'target/server');
if (fs.existsSync(commonSrc)) {
    console.log('  ✓ server bundle (including common)');
}

console.log('\nDone. Restart Kibana to load the plugin.');
console.log(`Access at: http://localhost:5601/app/rumSessionReplay`);
