import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');
const assetsDir = path.join(distDir, 'assets');
const faviconPath = path.join(srcDir, 'favicon.ico');
const kuromojiDir = path.join(root, 'node_modules', 'kuromoji');
const kuromojiDistScriptPath = path.join(kuromojiDir, 'dist', 'kuromoji.js');
const kuromojiBuildScriptPath = path.join(kuromojiDir, 'build', 'kuromoji.js');
const kuromojiDictPath = path.join(kuromojiDir, 'dict');

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch (error) {
    return false;
  }
}

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(assetsDir, { recursive: true });

const htmlPath = path.join(srcDir, 'index.html');
const html = await fs.readFile(htmlPath, 'utf8');
const stampedHtml = html.replace('@@BUILD_TIMESTAMP@@', new Date().toISOString());
await fs.writeFile(path.join(distDir, 'index.html'), stampedHtml);

if (await pathExists(faviconPath)) {
  await fs.copyFile(faviconPath, path.join(distDir, 'favicon.ico'));
}

await fs.copyFile(path.join(srcDir, 'app.js'), path.join(assetsDir, 'app.js'));
await fs.copyFile(path.join(srcDir, 'styles.css'), path.join(assetsDir, 'app.css'));

const kuromojiScriptPath = (await pathExists(kuromojiDistScriptPath))
  ? kuromojiDistScriptPath
  : kuromojiBuildScriptPath;

if (await pathExists(kuromojiScriptPath) && await pathExists(kuromojiDictPath)) {
  await fs.copyFile(kuromojiScriptPath, path.join(assetsDir, 'kuromoji.js'));
  await fs.cp(kuromojiDictPath, path.join(assetsDir, 'kuromoji-dict'), {
    recursive: true
  });
  console.log('Kuromoji assets copied.');
} else {
  console.log('Kuromoji assets not found. Install `kuromoji` to enable tokenizer.');
}

console.log('Build complete.');
