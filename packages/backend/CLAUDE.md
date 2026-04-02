# Backend Agent — NestJS API

> Scope: packages/backend only. For full project context see /z/nucleus-portal/CLAUDE.md

## Stack
NestJS 10 | Drizzle ORM | PostgreSQL 16 | Redis 7 | JWT | WebSocket | Zod

## Start
```bash
cd /z/nucleus-portal/packages/backend
DATABASE_URL=postgres://nucleus:nucleus_dev@localhost:5432/nucleus \
JWT_SECRET=dev-secret-nucleus-portal-2026 \
PORT=3001 pnpm exec nest start --watch
```

## Module Map
```
src/
├── app.module.ts
├── main.ts
├── auth/              JWT login, refresh, strategy
├── agent-gateway/     WebSocket gateway for Rust agents (Registry, Gateway)
├── devices/           CRUD + registry
├── tunnels/           Proxy service + session management
├── scanner/           PortScanner, HostDiscovery, HealthCheck, ServiceClassifier
├── discovery/         Endpoint discovery
├── audit/             Audit trail
├── logs/              Activity logs
├── orgs/              Multi-tenant orgs
├── settings/          User settings
├── health/            /health endpoint
├── database/          Drizzle module + schema
└── common/
    ├── decorators/    @CurrentUser
    ├── dto/           Zod-backed DTOs for all modules
    ├── filters/       HttpExceptionFilter
    ├── guards/        JwtAuthGuard
    ├── middleware/    RequestLogger
    ├── pipes/         ZodValidationPipe
    └── types/         ApiResponse<T>
```

## Key Conventions
- All DTOs in `src/common/dto/` backed by Zod schemas from `@nucleus/shared`
- Services injected via constructor DI — never use `new Service()`
- Use `ZodValidationPipe` on all controllers, not class-validator
- WebSocket agents authenticate via token in connection handshake
- All responses wrapped in `ApiResponse<T>` type
- Rate limiting via `@nestjs/throttler` on all public endpoints

## Database
- ORM: Drizzle (not TypeORM, not Prisma)
- Schema: `src/database/schema.ts`
- Migrations: `npx drizzle-kit migrate` from this directory
- Connection via PgBouncer (port 6432) in production, direct (5432) in dev

## Testing
```bash
pnpm test              # unit tests (Jest)
pnpm test:e2e          # e2e tests
pnpm test:cov          # coverage report
```

## Lint
```bash
pnpm lint
```
