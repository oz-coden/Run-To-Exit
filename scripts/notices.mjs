import { copyFileSync, writeFileSync, readFileSync } from 'node:fs';
copyFileSync('vendor/simpludify/LICENSE', 'dist/SIMPLUDIFY-LICENSE.txt');
const names = ['pixi.js', '@pixi/colord', '@types/earcut', '@webgpu/types', '@xmldom/xmldom', 'earcut', 'eventemitter3', 'gifuct-js', 'ismobilejs', 'js-binary-schema-parser', 'parse-svg-path', 'tiny-lru'];
const notices = ['Run To Exit uses Simpludify (MIT). See SIMPLUDIFY-LICENSE.txt.'];
for (const name of names) {
 try {
 const pkg = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8'));
 let license = '';
 for (const file of ['LICENSE', 'LICENSE.txt', 'LICENSE.md', 'license', 'LICENSE-MIT', 'LICENSE_MIT']) {
 try { license = readFileSync(`node_modules/${name}/${file}`, 'utf8'); break; } catch {}
 }
 notices.push(`${name}@${pkg.version} (${pkg.license})\n${license}`);
 } catch {}
}
writeFileSync('dist/THIRD-PARTY-NOTICES.txt', notices.join('\n\n---\n\n'));
writeFileSync('dist/.nojekyll', '');
