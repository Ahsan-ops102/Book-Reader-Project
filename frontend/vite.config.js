import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';

// Include lazy reader/editor chunks so an already signed-in tab can reopen offline.
function offlineShell() {
  let outDir;
  return {
    name: 'reading-room-offline-shell',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir; },
    async closeBundle() {
      const assets = (await fs.readdir(`${outDir}/assets`)).map(name => `/assets/${name}`);
      const version = crypto.createHash('sha256').update(assets.join('\n')).digest('hex').slice(0,12);
      let worker = await fs.readFile('public/sw.js','utf8');
      worker = worker.replace('__ASSETS__', JSON.stringify(assets)).replace('__VERSION__', version);
      await fs.writeFile(`${outDir}/sw.js`,worker);
    }
  };
}
export default defineConfig({
  plugins: [react(),offlineShell()],
  server: {port:5173,proxy:{'/api':'http://127.0.0.1:3001'}},
});
