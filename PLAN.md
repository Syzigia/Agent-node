# Plan de API — Mastra + Custom Routes

## Arquitectura

```
┌─────────────────────────────────────────────────────┐
│                  Vercel (un solo deploy)             │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │              Mastra Server (Hono)              │  │
│  │                                                │  │
│  │  server.auth = MastraAuthClerk                 │  │
│  │  ↓ protege todas las rutas automáticamente     │  │
│  │                                                │  │
│  │  ┌──────────────────────┐ ┌─────────────────┐ │  │
│  │  │  Built-in endpoints  │ │ Custom routes   │ │  │
│  │  │  /api/agents/*       │ │ /projects/*     │ │  │
│  │  │  /api/workflows/*    │ │ /chats/*        │ │  │
│  │  └──────────────────────┘ └─────────────────┘ │  │
│  └───────────────────────────────────────────────┘  │
│                                                     │
│  Storage: Turso (LibSQL)  │  Files: Cloudflare R2   │
└─────────────────────────────────────────────────────┘
         ▲
         │ Bearer token (Clerk JWT)
         │
┌────────┴────────┐
│  Next.js (otro  │
│  repo/deploy)   │
│  @mastra/client │
│  + @clerk/nextjs│
└─────────────────┘
```

## Autenticación

- **Provider**: `MastraAuthClerk` de `@mastra/auth-clerk`
- **Configuración**: en `server.auth` del constructor de Mastra
- **Comportamiento**: todas las rutas built-in y custom requieren auth por defecto
- **Acceso al user**: `c.get('requestContext').get('user')` → retorna `ClerkUser`
- **userId**: `user.id` de Clerk (se usa como `user_id` en la DB)

**Variables de entorno necesarias**:
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

## Base de datos (Drizzle + Turso)

### Schema

**projects**
| Campo      | Tipo | Notas                              |
|------------|------|------------------------------------|
| id         | TEXT | PK, generado (nanoid/uuid)         |
| user_id    | TEXT | NOT NULL, viene de Clerk           |
| name       | TEXT | NOT NULL                           |
| s3_prefix  | TEXT | NOT NULL, `users/{userId}/{id}`    |
| created_at | TEXT | DEFAULT datetime('now')            |
| updated_at | TEXT | DEFAULT datetime('now')            |

**chats**
| Campo      | Tipo | Notas                              |
|------------|------|------------------------------------|
| id         | TEXT | PK, generado                       |
| project_id | TEXT | FK → projects.id, ON DELETE CASCADE |
| title      | TEXT | NOT NULL                           |
| thread_id  | TEXT | UNIQUE, liga con Mastra Memory     |
| created_at | TEXT | DEFAULT datetime('now')            |
| updated_at | TEXT | DEFAULT datetime('now')            |

No hay tabla `users` — Clerk maneja eso.

## Rutas de API

### Rutas built-in de Mastra (automáticas, no hay que crear)

| Método | Ruta                                    | Descripción                    |
|--------|-----------------------------------------|--------------------------------|
| GET    | `/api/agents`                           | Lista agentes registrados      |
| POST   | `/api/agents/:agentId/generate`         | Generar respuesta (sync)       |
| POST   | `/api/agents/:agentId/stream`           | Generar respuesta (streaming)  |
| GET    | `/api/workflows`                        | Lista workflows registrados    |
| POST   | `/api/workflows/:workflowId/start`      | Iniciar workflow               |
| POST   | `/api/workflows/:workflowId/resume`     | Reanudar workflow suspendido   |

> Estas rutas ya aceptan `threadId` y `resourceId` en el body para separar
> memoria por chat y por proyecto.

### Custom routes (las creamos con `registerApiRoute`)

#### Projects

| Método | Ruta                     | Body / Params              | Descripción                      |
|--------|--------------------------|----------------------------|----------------------------------|
| GET    | `/projects`              | —                          | Lista proyectos del user actual  |
| POST   | `/projects`              | `{ name }`                | Crea proyecto + s3_prefix        |
| GET    | `/projects/:projectId`   | —                          | Detalle de un proyecto           |
| DELETE | `/projects/:projectId`   | —                          | Elimina proyecto (y sus chats)   |

**Lógica de POST /projects**:
1. Obtener `userId` del Clerk JWT
2. Generar `id` (nanoid)
3. Calcular `s3_prefix` = `users/{userId}/{id}`
4. Insertar en DB con Drizzle
5. Retornar proyecto creado

#### Chats

| Método | Ruta                                  | Body / Params       | Descripción                       |
|--------|---------------------------------------|---------------------|-----------------------------------|
| GET    | `/projects/:projectId/chats`          | —                   | Lista chats de un proyecto        |
| POST   | `/projects/:projectId/chats`          | `{ title? }`        | Crea chat + genera threadId       |
| GET    | `/projects/:projectId/chats/:chatId`  | —                   | Detalle de un chat                |
| PATCH  | `/projects/:projectId/chats/:chatId`  | `{ title }`         | Actualiza título del chat         |
| DELETE | `/projects/:projectId/chats/:chatId`  | —                   | Elimina chat                      |

**Lógica de POST /projects/:projectId/chats**:
1. Verificar que el proyecto pertenece al user actual
2. Generar `id` y `threadId` (nanoid)
3. Insertar en DB
4. Retornar chat con `threadId`

### Cómo el frontend habla con el agente

El frontend NO necesita una ruta custom para chatear. Usa las built-in de Mastra:

```
POST /api/agents/photosAgent/stream
Authorization: Bearer <clerk-token>
Content-Type: application/json

{
  "messages": [{ "role": "user", "content": "Analiza mis fotos" }],
  "threadId": "thread_abc123",        ← del chat
  "resourceId": "project_xyz789"      ← del proyecto (working memory)
}
```

La memoria (historial + working memory) se separa automáticamente por `threadId` y `resourceId`.

El workspace del agente (S3) se resuelve dinámicamente: el agente usa el `s3_prefix` del proyecto para leer/escribir archivos.

### Nota sobre workspace dinámico

Las tools del agente actualmente usan `s3Filesystem` global. Para multi-tenancy, las tools necesitan recibir el `s3_prefix` del proyecto. Opciones:

1. **Request context**: Pasar el `projectId` via middleware, la tool lo lee del context y crea un workspace dinámico con `createProjectWorkspace(prefix)`
2. **Working memory**: El agente ya tiene el proyecto en su working memory y lo pasa a las tools

Esto se implementa después — primero la base (auth + DB + rutas).

## Implementación paso a paso

### 1. Instalar dependencias
```bash
bun add drizzle-orm
bun add -D drizzle-kit
```

### 2. Crear schema Drizzle
`src/mastra/db/schema.ts` — define tablas `projects` y `chats`

### 3. Crear cliente Drizzle
`src/mastra/db/index.ts` — reemplaza el raw SQL actual con Drizzle client + queries

### 4. Configurar drizzle.config.ts
Para migraciones con Turso

### 5. Ejecutar migración
```bash
bunx drizzle-kit push
```

### 6. Configurar auth en Mastra
Agregar `server.auth` con `MastraAuthClerk` en `src/mastra/index.ts`

### 7. Crear custom routes
`src/mastra/server/routes.ts` — todas las rutas de projects y chats

### 8. Registrar routes en Mastra
Agregar `server.apiRoutes` en `src/mastra/index.ts`

### 9. Probar con mastra dev
```bash
bun run dev
# Swagger UI en http://localhost:4111/swagger-ui
```

### 10. Deploy a Vercel
```bash
bun add @mastra/deployer-vercel
```
Configurar deployer en Mastra
