// npm run build:desktop [-- --platform linux,win32,darwin]: packages dist/ + electron/ with @electron/packager.
import { packager } from '@electron/packager';
import { cpSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const pi = args.indexOf('--platform');
const platforms = (pi >= 0 ? args[pi + 1] : 'linux,win32,darwin').split(',');
const stage = join(root, 'dist-electron', 'app');
rmSync(join(root, 'dist-electron'), { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
cpSync(join(root, 'dist'), join(stage, 'dist'), { recursive: true });
cpSync(join(root, 'electron'), join(stage, 'electron'), { recursive: true });
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
writeFileSync(join(stage, 'package.json'), JSON.stringify({
  name: 'dmt-dream-simulator', productName: 'DMT Dream Simulator', version: pkg.version, main: 'electron/main.cjs',
  dependencies: { 'steamworks.js': pkg.dependencies['steamworks.js'] },
}, null, 1));
cpSync(join(root, 'node_modules', 'steamworks.js'), join(stage, 'node_modules', 'steamworks.js'), { recursive: true });

for (const platform of platforms) {
  try {
    const out = await packager({
      dir: stage, out: join(root, 'dist-electron'), platform, arch: 'x64', overwrite: true, asar: { unpack: '**/*.node' },
      electronVersion: JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version,
      name: 'DMT Dream Simulator', appBundleId: 'com.dmt.dreamsimulator', quiet: true, prune: false,
    });
    console.log(`packaged ${platform}: ${out.join(', ')}`);
  } catch (e) {
    console.error(`failed ${platform}: ${e.message}`);
    process.exitCode = 1;
  }
}
