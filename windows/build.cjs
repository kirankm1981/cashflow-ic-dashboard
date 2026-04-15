require('dotenv').config();
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

async function build() {
  const distDir = path.resolve(projectRoot, 'dist');
  if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

  console.log('Building frontend with Vite...');
  const viteBin = path.join(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite');
  if (!fs.existsSync(viteBin)) {
    console.error('ERROR: Vite not found at ' + viteBin);
    console.error('Run "npm install" first to install all dependencies.');
    process.exit(1);
  }
  execSync(`"${viteBin}" build`, { cwd: projectRoot, stdio: 'inherit', shell: true });
  console.log('Frontend build complete.');

  console.log('Building server bundle...');
  await esbuild.build({
    entryPoints: [path.resolve(projectRoot, 'server/index.ts')],
    outfile: path.resolve(projectRoot, 'dist/index.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: true,
    external: [
      'pg-native',
      'bufferutil',
      'utf-8-validate',
      'lightningcss',
      '@babel/preset-typescript',
      'esbuild',
    ],
    define: {
      'import.meta.dirname': '__dirname',
    },
    loader: {
      '.ts': 'ts',
    },
  });
  console.log('Server build complete: dist/index.cjs');

  await esbuild.build({
    entryPoints: [path.resolve(projectRoot, 'server/file-worker.ts')],
    outfile: path.resolve(projectRoot, 'dist/file-worker.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    sourcemap: true,
    external: ['pg-native', 'bufferutil', 'utf-8-validate'],
    loader: { '.ts': 'ts' },
  });
  console.log('Worker build complete: dist/file-worker.cjs');

  const runtimeFiles = ['parse-gl-child.cjs', 'streaming-xlsx-parser.cjs'];
  for (const file of runtimeFiles) {
    const src = path.resolve(projectRoot, 'server', file);
    const dst = path.resolve(distDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      console.log('Copied runtime file: dist/' + file);
    }
  }

  try {
    const hash = execSync('git rev-parse HEAD', { cwd: projectRoot, encoding: 'utf-8' }).trim();
    fs.writeFileSync(path.resolve(projectRoot, 'dist/.build-hash'), hash);
    console.log('Build hash: ' + hash);
  } catch {
    fs.writeFileSync(path.resolve(projectRoot, 'dist/.build-hash'), new Date().toISOString());
  }

  console.log('Full production build done!');
}

build().catch(function(err) {
  console.error('Build failed:', err);
  process.exit(1);
});
