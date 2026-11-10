import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import app from './app.js';

// Adaptador local de la misma API que Vercel ejecuta como función serverless.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(distDir, 'index.html')));
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, '0.0.0.0', () => console.log(`Punto · Vercel API local + Supabase en http://0.0.0.0:${port}`));
