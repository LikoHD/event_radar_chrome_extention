const { minify } = require('terser');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC_DIR = path.join(__dirname, 'tea_event_radar');
const DIST_DIR = path.join(__dirname, 'dist');
const ZIP_NAME = 'tea_event_radar_dist.zip';

// Terser options — minify only, no obfuscation (Chrome Web Store compliant)
const TERSER_OPTIONS = {
  compress: {
    dead_code: true,
    drop_debugger: true,
    conditionals: true,
    evaluate: true,
    booleans: true,
    loops: true,
    unused: true,
    if_return: true,
    join_vars: true,
    collapse_vars: true,
    reduce_vars: true,
    passes: 2,
  },
  mangle: {
    // Shorten local variable/function names
    reserved: [
      // Chrome APIs and globals that must not be mangled
      'chrome', 'TeaRadar', 'importScripts',
    ],
  },
  format: {
    comments: false,       // Strip all comments
    semicolons: true,
    wrap_iife: true,
  },
};

// Files to exclude from dist
const EXCLUDE = new Set([
  'CLAUDE.md',
  'README.md',
  path.join('images', 'platforms', 'SOURCES.md'),
]);

async function build() {
  // 1. Clean & create dist
  if (fs.existsSync(DIST_DIR)) {
    fs.rmSync(DIST_DIR, { recursive: true });
  }
  fs.mkdirSync(DIST_DIR, { recursive: true });

  // 2. Walk source directory
  const files = walk(SRC_DIR, SRC_DIR);
  let jsCount = 0;
  let copyCount = 0;
  let totalSaved = 0;

  for (const relPath of files) {
    if (EXCLUDE.has(relPath)) continue;

    const srcFile = path.join(SRC_DIR, relPath);
    const destFile = path.join(DIST_DIR, relPath);

    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(destFile), { recursive: true });

    if (relPath.endsWith('.js')) {
      // Minify JS files
      const source = fs.readFileSync(srcFile, 'utf-8');
      const result = await minify(source, TERSER_OPTIONS);

      if (result.code) {
        fs.writeFileSync(destFile, result.code, 'utf-8');
        const saved = source.length - result.code.length;
        totalSaved += saved;
        const pct = ((saved / source.length) * 100).toFixed(1);
        console.log(`  JS  ${relPath}  ${formatSize(source.length)} -> ${formatSize(result.code.length)}  (-${pct}%)`);
        jsCount++;
      } else {
        // Fallback: copy as-is
        fs.copyFileSync(srcFile, destFile);
        copyCount++;
      }
    } else {
      // Copy non-JS files directly
      fs.copyFileSync(srcFile, destFile);
      copyCount++;
    }
  }

  // 3. Create zip
  const zipPath = path.join(__dirname, ZIP_NAME);
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
  execSync(`cd "${DIST_DIR}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });
  const zipSize = fs.statSync(zipPath).size;

  console.log('');
  console.log(`Done! ${jsCount} JS files minified, ${copyCount} files copied.`);
  console.log(`Total size saved: ${formatSize(totalSaved)}`);
  console.log(`Output: dist/`);
  console.log(`ZIP:    ${ZIP_NAME} (${formatSize(zipSize)})`);
}

function walk(dir, base) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.name.startsWith('.')) continue; // skip dotfiles
    if (entry.isDirectory()) {
      results.push(...walk(fullPath, base));
    } else {
      results.push(path.relative(base, fullPath));
    }
  }
  return results;
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + 'B';
  return (bytes / 1024).toFixed(1) + 'KB';
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
