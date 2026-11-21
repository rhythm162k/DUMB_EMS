<div align="center">

# EMS Portfolio Demo

A bilingual employee management system with role-based administration, employee self-service and temporary fictional workspaces.

![React](https://img.shields.io/badge/React-19-149ECA?style=for-the-badge&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-26-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-222222?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Cloudflare Workers & D1](https://img.shields.io/badge/Cloudflare-Workers%20%26%20D1-F38020?style=for-the-badge&logo=cloudflare&logoColor=white)

[Documentation](docs/README.md) · [Architecture](docs/ARCHITECTURE.md) · [Design](docs/DESIGN.md) · [Security](docs/SECURITY.md) · [Operations](docs/OPERATIONS.md)

</div>

---

## Run the demo locally

Install Node.js **26.13.1+ within 26.x** and npm **11.20+ within 11.x**. Choose a fictional persona to explore the employee and administrator workflows. Use **Demo session** to switch personas in the same workspace or reset its sample data.

```sh
npm ci
npm run dev:worker
```

Open **http://127.0.0.1:8787**. For Vite hot reload, also run `npm run dev:web:worker` and open the Vite URL printed in the terminal. Both use the local D1 binding. See [Workers operations](docs/OPERATIONS.md) for configuration, development boundaries and the validation plan.

## Demo workflows

| Workspace             | Capabilities                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Administration        | Employee directory, profiles, departments, employment/account status and administrator assignments  |
| Personal data sheets  | Spouse details, qualifications, training, service and posting history, memberships and publications |
| Employee self-service | Own profile, profile photo, change proposals, leave applications and personal data export           |
| Records & oversight   | Request review, leave records and balances, holidays, CSV/XLSX import/export and audit history      |
| Experience            | Responsive navigation, English/Bangla interface and role-aware dashboards                           |

## Stack & layout

React, Vite, React Router and TanStack Query power the frontend. The reference development stack uses Express, PostgreSQL and Nginx. The Workers preview serves the Vite build as Static Assets and runs a separate Express entry with a local D1 binding. GitHub Actions verifies both paths.

```text
apps/web/       React interface and Nginx configuration
apps/api/       Express API, SQL schema, scripts and integration tests
apps/api/worker/  Workers entry, Wrangler configuration and runtime smoke tests
packages/shared/  Shared package (currently the application name)
docs/           Maintainer documentation
.github/        Verification workflow
compose.yaml    Local PostgreSQL-based reference stack
```

## Demo boundaries

Each workspace starts with 10 fictional employees in three departments and expires after 45 minutes. The server enforces role, department and workspace boundaries. Entry is passwordless by design. The original PostgreSQL application used password verification and persisted employee records. Browser-side spreadsheet processing, bounded imports and photos, and workspace resets are portfolio-specific. Use fictional data throughout.

The demo targets Workers Free. Local workerd checks passed. Hosted CPU and resource limits still require the [controlled staging test](docs/OPERATIONS.md#controlled-cloudflare-free-staging). See [performance and capacity](docs/PERFORMANCE.md) for the measurements.

## Screenshots for a portfolio

Start with a fresh local workspace. Capture the persona picker, administrator overview, employee self-service dashboard and an import preview or request-review screen. Include a Bangla view and use the same viewport for desktop captures. Use browser device mode for a narrow screen. Capture only fictional records, keep the demo label visible, and crop browser controls and developer tools. Add concise alt text when publishing the images.

## Start the PostgreSQL reference stack locally

Requires Node.js **26.13.1+ within 26.x**, npm **11.20+ within 11.x**, and Docker Compose.

```sh
cp .env.example .env
npm ci
```

Edit `.env`: set your database password and a unique session secret generated with `openssl rand -base64 48`. Then run:

```sh
docker compose up -d db
npm run db:setup
npm run db:seed
npm run auth:seed-admin -- 000001 "Local Administrator"
npm run dev
```

Open **http://localhost:5173**. The API runs on port **3000**. Copy the administrator's generated temporary password and change it at first sign-in. Use a new local database and fictional data for this development path.

## Work on the project

```sh
npm run lint
npm run typecheck
npm run build
npm run test:public
npm run test:worker
npm run build:worker
```

The complete `npm test` suite requires a dedicated PostgreSQL test database; see [Testing](docs/TESTING.md). Read [Development](docs/DEVELOPMENT.md) before changing workflows and [Security](docs/SECURITY.md) before changing authentication or data access.

## Maintainer guides

| Guide                                | Purpose                                                |
| ------------------------------------ | ------------------------------------------------------ |
| [Architecture](docs/ARCHITECTURE.md) | Request flow, code ownership and data model            |
| [Design](docs/DESIGN.md)             | Visual system, accessibility and interface conventions |
| [Security](docs/SECURITY.md)         | Implemented controls, open gaps and incident response  |
| [Development](docs/DEVELOPMENT.md)   | Setup, configuration and change workflow               |
| [Operations](docs/OPERATIONS.md)     | Local Workers configuration and release checks         |
| [Testing](docs/TESTING.md)           | Automated checks and manual acceptance                 |
| [Performance](docs/PERFORMANCE.md)   | Local timing, D1 usage and hosted release criteria     |
| [Publication](docs/PUBLICATION.md)   | Source review and clean-history publication            |

Keep credentials, employee exports and personal data out of Git and public issue reports.
