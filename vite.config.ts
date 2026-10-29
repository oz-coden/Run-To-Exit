import { defineConfig } from 'vite';
export default defineConfig({ base: '/Run-To-Exit/', server: { allowedHosts: ['terminal.local'] }, preview: { allowedHosts: ['terminal.local'] }, build: { target: 'es2022' } });
