# Punto · Control de asistencias

Aplicación mobile-first creada con **React + Vite**, **Express** y **SQLite**. Registra entradas y salidas con evidencia fotográfica, coordenadas GPS, precisión y fecha/hora.

## Acceso inicial

- **Usuario:** `Velcco`
- **Contraseña:** `Velcco2026@`
- **Rol:** SuperAdmin

La cuenta se crea automáticamente al iniciar el servidor por primera vez. Las contraseñas se guardan con bcrypt, nunca en texto plano.

## Ejecutar en desarrollo

```bash
npm install
npm run dev
```

- Aplicación: `http://localhost:5173`
- API: `http://localhost:3001`

## Producción

```bash
npm run build
JWT_SECRET="un-secreto-largo-y-aleatorio" npm start
```

El servidor Express sirve tanto la API como la aplicación compilada en el puerto `3001`.

## Funcionalidades

- Acceso seguro mediante JWT y contraseñas cifradas.
- Panel con presentes, entradas, salidas y actividad reciente.
- Alta, edición, activación y desactivación de colaboradores.
- Asignación de nombre, usuario, contraseña y puesto.
- Marcación de entrada/salida con cámara en vivo o foto de galería.
- Captura GPS de alta precisión bajo demanda; no hay rastreo en segundo plano.
- Validación para alternar entradas y salidas.
- Historial filtrado por fecha, colaborador y tipo de marcación.
- Horario individual de ingreso y salida para cada trabajador.
- Cálculo y almacenamiento de tardanza, salida anticipada y tiempo extra por marcación.
- Reportes de SuperAdmin por mes, día o rango de fechas, con resumen por persona y detalle diario.
- Detalle de foto y enlace de coordenadas en Google Maps.
- Exportación de marcaciones y reportes a CSV compatible con Excel.
- Diseño responsive con navegación móvil inferior y panel lateral en escritorio.
- Animaciones basadas principalmente en `transform` y `opacity`, con soporte para `prefers-reduced-motion`.

## Datos y almacenamiento

- Base SQLite: `server/data/punto.db`
- Fotografías: `server/uploads/`
- Zona horaria de reportes: `America/Lima`
- Tamaño máximo de fotografía: 8 MB
- Las capturas de cámara se optimizan y guardan como archivos binarios JPG.
- Latitud, longitud y precisión se almacenan como valores numéricos en SQLite.
- Cada marcación conserva una copia del horario vigente para proteger los cálculos históricos.

### Cálculo de jornada

- **Tardanza:** minutos entre la hora programada de ingreso y la primera entrada.
- **Tiempo extra:** minutos entre la hora programada de salida y la salida registrada.
- **Salida anticipada:** minutos entre la salida registrada y el horario programado.
- **Tiempo trabajado:** diferencia entre la primera entrada y la última salida del mismo día.

> La cámara y la geolocalización del navegador requieren un contexto seguro: HTTPS o `localhost`. Al probar desde un celular, abre la aplicación mediante su dirección HTTPS y acepta ambos permisos.

## API principal

- `POST /api/auth/login`
- `GET /api/auth/me`
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
