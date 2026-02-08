import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');
const assetsDir = path.join(distDir, 'assets');

await fs.rm(distDir, { recursive: true, force: true });
await fs.mkdir(assetsDir, { recursive: true });

const htmlPath = path.join(srcDir, 'index.html');
const html = await fs.readFile(htmlPath, 'utf8');
const stampedHtml = html.replace('@@BUILD_TIMESTAMP@@', new Date().toISOString());
await fs.writeFile(path.join(distDir, 'index.html'), stampedHtml);

await fs.copyFile(path.join(srcDir, 'app.js'), path.join(assetsDir, 'app.js'));
await fs.copyFile(path.join(srcDir, 'styles.css'), path.join(assetsDir, 'app.css'));

console.log('Build complete.');
