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
- Exportación de reportes a Excel (.xlsx) con formato profesional y de marcaciones a CSV.
- Diseño responsive y animaciones con soporte para `prefers-reduced-motion`.

## Cálculo de jornada

- **Tardanza:** minutos entre la hora programada de ingreso y la primera entrada.
- **Tiempo extra:** minutos entre la hora programada de salida y la salida registrada.
- **Salida anticipada:** minutos entre la salida registrada y el horario programado.
- **Tiempo trabajado:** diferencia entre entrada y salida de la jornada, descontando el almuerzo registrado (ver reglas actualizadas abajo).
- Cada marcación conserva una copia del horario vigente para proteger el historial.
- Zona horaria de reportes: `America/Lima`.

## Plazo para marcar la salida

- La salida debe marcarse hasta **5 minutos después del horario de salida**: con horario 17:00, el plazo máximo es **17:05**.
- Vencido el plazo, la jornada queda como **"sin marcar"** y la API rechaza la salida (la foto ni siquiera se sube al almacenamiento).
- Los reportes también marcan **"sin marcar"** a todo colaborador activo que no registró nada en un día con horario asignado; no se generan ausencias anteriores a su alta.
- Los días con la misma hora de entrada y salida se consideran días de descanso y no generan ausencias.
- En las jornadas nocturnas (p. ej. 22:00 → 06:00) el plazo vence a las 06:05 del día siguiente.
- Para entradas históricas o regularizadas que se marcaron con el plazo ya vencido, la salida dispone de sus propios 5 minutos desde esa marcación para no dejar la jornada sin cerrar.
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

### Actualización: Excel, entradas únicas y almuerzo (17/11/2026)

**Antes de desplegar esta versión en una instalación existente**, ejecuta
`supabase/migrations/20261117_attendance_lunch.sql` en el SQL Editor del proyecto.
Para instalaciones nuevas, `supabase/schema.sql` ya incluye estas reglas.
La migración conserva los registros anteriores, agrega `work_day` para jornadas
nocturnas y protege las nuevas marcaciones con un trigger que bloquea por usuario:
dos solicitudes simultáneas no pueden registrar dos entradas de la misma jornada.
Despliega API y frontend juntos después de aplicar la migración.

- **Reportes (solo SuperAdmin):** fechas Desde / Hasta visibles por defecto,
  inclusivas en hora de Lima; también hay selección mensual y por colaborador.
  Rango máximo: 366 días. Los días futuros no generan ausencias.
- **Excel `.xlsx`:** tres hojas (Resumen, Equipo y Detalle diario), portada de
  marca, encabezados y bandas de color, filtros, paneles inmovilizados, totales,
  duraciones numéricas en `h:mm`, estados destacados y configuración de impresión.
  `/api/reports/export` ahora devuelve XLSX. `/api/export` conserva el CSV de registros.
- **Entrada:** solo una por jornada, incluso después de registrar salida. Se admite
  hasta exactamente una hora después del horario individual del día. Una vez
  vencido el plazo, se deshabilita y aparece **Sin marcar**, sin fabricar una
  marcación ni evidencia. El cálculo es automático al consultar estado/reportes;
  no depende de que la persona abra la aplicación ni de un cron.
- **Almuerzo:** botón propio con inicio y fin, ambos con foto y GPS. Se inicia desde
  las 12:00 y antes de las 13:00. Empezar a las 12:40 solo deja 20 minutos. El fin
  se habilita a las 13:00; si lo olvidan, sigue pendiente y acepta el retorno real
  después, registrando la demora. No se cierra automáticamente ni se inventa la
  hora de retorno. Se permite cerrar jornada con almuerzo sin finalizar para no
  impedir la salida dentro de su plazo de 5 minutos, pero queda señalado en el reporte.
  Una vez vencida la salida se cierra la jornada y ya no admite más marcaciones.
- **Tiempo trabajado:** entrada–salida menos el descanso registrado. Si falta el
  fin del almuerzo, se descuenta provisionalmente desde su inicio hasta la salida;
  revisar esa incidencia antes de usar el reporte para liquidaciones. Los registros
  antiguos sin almuerzo conservan su cálculo anterior.
- **Alcance de ausencias:** los días con entrada igual a salida son descansos y no generan ausencias.
  Como no hay calendario de feriados ni historial de activación, las jornadas sin registros se calculan con el equipo
  activo y el horario semanal actual, desde la creación de la cuenta. Las personas
  inactivas conservan sus días con marcaciones. No se asumen feriados ni descansos distintos de los horarios entrada = salida.
- Las reglas usan **America/Lima** y el reloj del servidor, no el del celular.
  La API valida todos los plazos antes de subir la evidencia; el trigger refuerza
  la entrada única, su plazo de una hora y las reglas de almuerzo.
- Se conserva la regla de salida de la PR #3: máximo 5 minutos desde la salida
  programada (incluidos turnos nocturnos). El estado está disponible en inicio,
  Mi equipo, reportes y Excel. No admite una segunda entrada en la misma jornada;
  la entrada de la siguiente jornada vuelve a estar disponible en su plazo normal.
- La integración de ambas PR no requiere SQL adicional sobre la migración
  `20261117_attendance_lunch.sql` ya aplicada al proyecto Punto.

Verificación local: `npm test` y `npm run build`.
