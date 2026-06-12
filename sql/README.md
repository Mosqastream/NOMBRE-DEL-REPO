# SQL para Supabase

Ejecuta primero `001_auth_profiles_setup.sql` y luego `002_panel_logic.sql` en el SQL Editor de Supabase.

Que deja listo:

- Registro inmediato con rol `usuario`.
- Tabla `profiles` conectada a `auth.users`.
- Trigger automatico para crear el perfil al registrar una cuenta.
- Politicas base para que cada usuario vea su propio perfil.
- Tablas del panel para cuentas, soporte/chat, productos, ventas y precios especiales.
- Triggers `updated_at` y llaves para asignacion de cuentas y solicitudes.

Antes de probar el registro:

- Verifica que el proyecto use Email auth activo.
- Como el login sera por username, el sistema crea un email interno automaticamente en Supabase.
- Si ya habias ejecutado una version vieja del SQL, vuelve a correr `001_auth_profiles_setup.sql`. Ahora tambien agrega el PIN de 4 digitos y corrige el trigger.

Si luego quieres cambiar un rol manualmente desde Supabase:

```sql
update public.profiles
set role = 'owner'
where username = 'tu_username';
```

Para evitar que varias funciones de Vercel usen la misma sesion de Telegram al mismo tiempo,
ejecuta tambien `010_telegram_flow_lock.sql`. Este archivo crea un candado global con vencimiento
automatico y no expone acceso a usuarios normales.
