# Punto · Control de asistencias

Aplicación mobile-first con **React + Vite**, preparada para desplegarse en **Vercel** y usar **Supabase PostgreSQL + Storage** como servicios de datos.

## Arquitectura

```text
Celular / navegador
        │
        ▼
React + Vite (sitio estático en Vercel)
        │ HTTPS /api/*
        ▼
Función serverless de Vercel: api/index.js
        │ (vercel.json reescribe /api/* → /api)
        │ SUPABASE_SERVICE_ROLE_KEY (solo servidor)
        ├──────────────► Supabase PostgreSQL
        │                  usuarios, horarios y asistencias
        └──────────────► Supabase Storage
                           fotos privadas + URLs firmadas
```

- **Frontend:** `src/`, compilado a `dist/` con Vite.
- **API:** `server/app.js`, compartida entre desarrollo local y Vercel.
- **Handler serverless:** `api/index.js`. El `rewrite` de `vercel.json` envía todo `/api/*` a esa única función y Express recibe la URL original.
- **Base de datos:** tablas `public.users` y `public.attendance`.
- **Fotos:** bucket privado `attendance-photos`; no se guardan en Vercel ni en PostgreSQL.
- **Autenticación:** JWT propio emitido por la API, con cookie httpOnly, Authorization y encabezado alternativo. Contraseñas cifradas con bcrypt.
- **Seguridad:** RLS y permisos públicos revocados. La clave `SERVICE_ROLE` nunca usa el prefijo `VITE_` ni llega al navegador.

## Acceso inicial

- **Usuario:** `Velcco`
- **Contraseña:** `Velcco2026@`
- **Rol:** SuperAdmin

## 1. Configurar Supabase

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor** y ejecuta todo `supabase/schema.sql`.
3. Copia `.env.example` a `.env` y completa:

```env
SUPABASE_URL=https://tu-proyecto.supabase.co
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
SUPABASE_BUCKET=attendance-photos
JWT_SECRET=un-secreto-aleatorio-de-al-menos-32-caracteres
PORT=3001
```

4. Crea el SuperAdmin y confirma el bucket:

```bash
npm install
npm run setup:supabase
```

> La clave `service_role` es privada. No la uses en React, no la publiques y no la reemplaces por una variable `VITE_*`.

## 2. Desarrollo local

```bash
npm run dev
```

- Frontend Vite: `http://localhost:5173`
- API local idéntica a la función de Vercel: `http://localhost:3001`

Para probar todo mediante el emulador de Vercel:

```bash
npx vercel dev
```

## 3. Desplegar en Vercel

1. Sube el proyecto a GitHub, GitLab o Bitbucket.
2. Importa el repositorio en Vercel.
3. Vercel detectará Vite mediante `vercel.json`:
   - Build: `npm run build`
   - Salida: `dist`
   - API: `api/index.js` (todas las rutas `/api/*` llegan por el `rewrite`)
4. En **Project → Settings → Environment Variables**, agrega:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `SUPABASE_BUCKET=attendance-photos`
   - `JWT_SECRET`
5. Despliega:

```bash
npx vercel --prod
```

No subas `.env` al repositorio. Configura las variables por separado para Production, Preview y Development según corresponda.

## Funcionalidades

- Acceso seguro mediante JWT y contraseñas cifradas.
- Panel con presentes, entradas, salidas y actividad reciente.
- Alta, edición, activación y desactivación de colaboradores.
- Horario individual de ingreso y salida para cada trabajador.
- Marcación con cámara en vivo o galería y GPS de alta precisión.
- Fotos JPG optimizadas y coordenadas numéricas `double precision`.
- URLs firmadas temporales para proteger las evidencias.
- Cálculo y almacenamiento de tardanza, salida anticipada y tiempo extra.
- Reportes por mes, día o rango de fechas, con resumen por persona y detalle diario.
- Exportación de marcaciones y reportes a CSV compatible con Excel.
- Diseño responsive y animaciones con soporte para `prefers-reduced-motion`.

## Cálculo de jornada

- **Tardanza:** minutos entre la hora programada de ingreso y la primera entrada.
- **Tiempo extra:** minutos entre la hora programada de salida y la salida registrada.
- **Salida anticipada:** minutos entre la salida registrada y el horario programado.
- **Tiempo trabajado:** diferencia entre la primera entrada y la última salida del mismo día.
- Cada marcación conserva una copia del horario vigente para proteger el historial.
- Zona horaria de reportes: `America/Lima`.

## Plazo para marcar la salida

- La salida debe marcarse hasta **5 minutos después del horario de salida**: con horario 17:00, el plazo máximo es **17:05**.
- Vencido el plazo, la jornada queda como **"sin marcar"** y la API rechaza la salida (la foto ni siquiera se sube al almacenamiento).
- Los reportes también marcan **"sin marcar"** a todo colaborador activo que no registró nada en un día con horario asignado; no se generan ausencias anteriores a su alta.
- Los días con la misma hora de entrada y salida se consideran días de descanso y no generan ausencias.
- En las jornadas nocturnas (p. ej. 22:00 → 06:00) el plazo vence a las 06:05 del día siguiente.
- Si la entrada se marcó con el plazo ya vencido, la salida dispone de sus propios 5 minutos desde esa marcación para no dejar la jornada sin cerrar.
- Una jornada abierta que venció ya no cuenta como "presente" y se lista en el panel del SuperAdmin como *salida sin marcar*.
- La regla vive en `shared/schedule.js` y la usan la API y el frontend, de modo que los plazos se muestran igual en el celular y en los reportes.

## Límites y permisos

- Fotografías: máximo **4 MB**, compatible con el límite de solicitudes de Vercel.
- Las capturas de cámara se reducen antes de enviarse.
- La cámara y la geolocalización requieren HTTPS o `localhost`.
- El GPS se captura solo durante la marcación; no hay rastreo en segundo plano.

## API principal

- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/dashboard`
- `GET /api/users` *(SuperAdmin)*
- `POST /api/users` *(SuperAdmin)*
- `PATCH /api/users/:id` *(SuperAdmin)*
- `GET /api/attendance`
- `GET /api/attendance/status`
- `POST /api/attendance`
- `GET /api/reports?month=YYYY-MM` o `?from=YYYY-MM-DD&to=YYYY-MM-DD` *(SuperAdmin)*
- `GET /api/reports/export` *(SuperAdmin)*
- `GET /api/export` *(SuperAdmin)*

## Respaldo anterior

El archivo SQLite anterior, si existe en `server/data/punto.db`, se conserva únicamente como respaldo local. **Ya no forma parte de la arquitectura activa ni se incluye en el despliegue.**

### Actualización: horarios por día

Para una instalación existente, ejecuta `supabase/migrations/20261111_weekly_schedule.sql` en el SQL Editor de Supabase antes de desplegar la aplicación. Los usuarios existentes mantienen su horario anterior para todos los días; el SuperAdmin puede modificar cada día desde Mi equipo. Cada marcación conserva el horario aplicado, por lo que los reportes anteriores no cambian. Los horarios se interpretan en America/Lima.
