#!/usr/bin/env node

/**
 * Raw ReAct MCP Build Script
 * Compiles TypeScript and bundles for distribution
 */

import { build } from 'esbuild';
import { readdir, mkdir, copyFile, unlink, readFile, writeFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ROOT_DIR = process.cwd();
const SRC_DIR = join(ROOT_DIR, 'src');
const DIST_DIR = join(ROOT_DIR, 'dist');
const PACKAGE_ALIASES = {
  '@barok/core': join(ROOT_DIR, 'packages/core/src/index.ts'),
  '@barok/engine': join(ROOT_DIR, 'packages/engine/src/index.ts'),
  '@barok/adapter-node': join(ROOT_DIR, 'packages/adapter-node/src/index.ts'),
};

async function ensureDir(path: string) {
  try {
    await mkdir(path, { recursive: true });
  } catch {
    // ignore
  }
}

async function clean() {
  try {
    await unlink(join(DIST_DIR, 'package.json'));
    console.log('🧹 Cleaned dist/');
  } catch {
    // ignore
  }
}

async function copyStaticFiles() {
  console.log('📦 Copying static files...');

  // Copy package.json (modified for dist)
  const pkg = JSON.parse(
    await readFile(join(ROOT_DIR, 'package.json'), 'utf-8')
  );
  // Remove dev-only fields for production
  delete pkg.devDependencies;
  delete pkg.scripts;
  delete pkg.engines;
  delete pkg.workspaces;
  delete pkg.dependencies?.['@barok/core'];
  delete pkg.dependencies?.['@barok/engine'];
  delete pkg.dependencies?.['@barok/adapter-node'];
  await writeFile(
    join(DIST_DIR, 'package.json'),
    JSON.stringify(pkg, null, 2)
  );

  // Copy README
  await copyFile(join(ROOT_DIR, 'README.md'), join(DIST_DIR, 'README.md'));
}

async function runBuild() {
  console.log('🔨 Building Raw ReAct MCP...\n');

  await ensureDir(DIST_DIR);
  await clean();

  // Bundle with esbuild
  console.log('📦 Bundling TypeScript...');
  // Build cli.ts
  await build({
    entryPoints: [join(SRC_DIR, 'cli.ts')],
    alias: PACKAGE_ALIASES,
    bundle: true,
    outdir: DIST_DIR,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    target: 'node22',
    sourcemap: true,
    logLevel: 'info',
  });

  // Build server.ts
  await build({
    entryPoints: [join(ROOT_DIR, 'server.ts')],
    alias: PACKAGE_ALIASES,
    bundle: true,
    outdir: DIST_DIR,
    format: 'esm',
    platform: 'node',
    packages: 'external',
    target: 'node22',
    sourcemap: true,
    logLevel: 'info',
  });

  // Also build the MCP server entry point
  await build({
    entryPoints: [join(SRC_DIR, 'mcp/server.ts')],
    alias: PACKAGE_ALIASES,
    bundle: true,
    outfile: join(DIST_DIR, 'mcp-server.js'),
    format: 'esm',
    platform: 'node',
    packages: 'external',
    target: 'node22',
    sourcemap: true,
    logLevel: 'warning',
  });

  console.log('\n✅ Build complete!');
  console.log('📁 Output: dist/');
  console.log('\nTo run:');
  console.log('  npm start -- mcp        # Start MCP server');
  console.log('  npm start -- react "task description"  # ReAct loop\n');
}

runBuild().catch((err) => {
  console.error('❌ Build failed:', err);
  process.exit(1);
});
