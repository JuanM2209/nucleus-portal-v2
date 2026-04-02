# Frontend Agent — Next.js Portal

> Scope: packages/frontend only. For full project context see /z/nucleus-portal/CLAUDE.md

## Stack
Next.js 14 (App Router) | React 18 | TypeScript | Tailwind CSS | TanStack Query | Zustand

## Start
```bash
cd /z/nucleus-portal/packages/frontend
pnpm dev    # http://localhost:3000
```

## Env (packages/frontend/.env.local)
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api     # dev
NEXT_PUBLIC_WS_URL=ws://localhost:3001            # dev
# Production uses https://api.datadesng.com/api
```

## Directory Map
```
src/
├── app/
│   ├── (auth)/login/          Login page
│   └── (portal)/              Protected layout
│       ├── dashboard/         Main dashboard
│       ├── devices/           Device list + [id] detail
│       ├── tunnels/           Active tunnels
│       ├── audit/             Audit logs
│       ├── logs/              Activity logs
│       ├── sessions/          User sessions
│       ├── admin/             Admin panel
│       ├── settings/          User preferences
│       └── health/            Health monitoring
├── components/
│   ├── device/                adapter-scan-card, health-panel, scan-results-panel, service-row, status-badge
│   ├── layout/                sidebar
│   └── ui/                    badge, card, empty-state, error-boundary, page-header, skeleton
├── hooks/                     use-admin, use-dashboard, use-device, use-logs, use-scanner, use-sessions, use-settings
├── lib/
│   ├── api.ts                 API client (fetch wrapper)
│   ├── cn.ts                  clsx + tailwind-merge
│   ├── format.ts              date/size formatters
│   └── clipboard.ts           clipboard utilities
└── stores/
    ├── auth-store.ts          Zustand auth state (token, user)
    ├── sidebar-store.ts       Sidebar collapsed state
    └── theme-store.ts         Dark/light theme
```

## Key Conventions
- App Router only — no `pages/` directory
- Data fetching: TanStack Query (`useQuery`, `useMutation`) via custom hooks in `hooks/`
- State: Zustand for global UI state (auth, sidebar, theme)
- Styling: Tailwind + `cn()` helper + `class-variance-authority` for variants
- Icons: Lucide React only
- No direct `fetch` in components — always use hooks or `lib/api.ts`
- Path alias: `@/*` → `src/*`

## Testing
```bash
pnpm test              # Jest + React Testing Library
pnpm test:e2e          # Playwright
```

## Build
```bash
pnpm build             # Next.js production build (.next/)
pnpm lint
```
