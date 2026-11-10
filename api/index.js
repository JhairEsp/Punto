import app from '../server/app.js';

// Única función serverless de la API. vercel.json reescribe /api/* hacia /api,
// y Express recibe la URL original (p. ej. /api/auth/me), igual que en desarrollo local.
// No renombrar a api/[...route].js: fuera de Next.js, Vercel trata ese nombre como UN solo
// segmento dinámico, así que /api/health funciona pero /api/auth/me responde 404.
export default app;
