<div align="center">

# Payra Sea Port · EMS

**Employee records. Clear workflows. One workspace.**

Employee management for Payra Sea Port, with administrator tools and employee self-service in English and বাংলা.

![React](https://img.shields.io/badge/React-19-149ECA?style=for-the-badge&logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-222222?style=for-the-badge&logo=express&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?style=for-the-badge&logo=postgresql&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)

[Documentation](docs/README.md) · [Architecture](docs/ARCHITECTURE.md) · [Design](docs/DESIGN.md) · [Security](docs/SECURITY.md) · [Operations](docs/OPERATIONS.md)

</div>

---

## What the app does

| Workspace             | Capabilities                                                                                          |
| --------------------- | ----------------------------------------------------------------------------------------------------- |
| Administration        | Employee directory, profiles, departments, employment/account status and password resets              |
| Personal data sheets  | Spouse details, qualifications, training, service and posting history, memberships and publications   |
| Employee self-service | Own profile, profile photo, change proposals, leave history and personal data export                  |
| Records & oversight   | Change-request review, leave records, holiday configuration, CSV/XLSX import/export and audit history |
| Experience            | Responsive navigation, English/Bangla interface and role-aware dashboards                             |

## Stack & layout

React, Vite, React Router and TanStack Query power the frontend. Express handles the API, PostgreSQL stores records and sessions, and Nginx serves the built web app. GitHub Actions verifies changes and deploys the application to AWS EC2.

```text
apps/web/       React interface and Nginx configuration
apps/api/       Express API, SQL schema, scripts and integration tests
packages/shared/  Shared package (currently the application name)
docs/           Maintainer documentation
.github/        CI and deployment workflow
compose.yaml    Database, API and web services
```

## Start locally

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

Open **http://localhost:5173**. The API runs on port **3000**. Copy the administrator's generated temporary password and change it at first sign-in. These initialization steps are for a new local database; deployed databases have a separate [operations procedure](docs/OPERATIONS.md).

## Work on the project

```sh
npm run lint
npm run typecheck
npm run build
npm run test:public
```

The complete `npm test` suite requires a dedicated PostgreSQL test database; see [Testing](docs/TESTING.md). Read [Development](docs/DEVELOPMENT.md) before changing workflows and [Security](docs/SECURITY.md) before changing authentication or data access.

## Maintainer guides

| Guide                                | Purpose                                                |
| ------------------------------------ | ------------------------------------------------------ |
| [Architecture](docs/ARCHITECTURE.md) | Request flow, code ownership and data model            |
| [Design](docs/DESIGN.md)             | Visual system, accessibility and interface conventions |
| [Security](docs/SECURITY.md)         | Implemented controls, open gaps and incident response  |
| [Development](docs/DEVELOPMENT.md)   | Setup, configuration and change workflow               |
| [Operations](docs/OPERATIONS.md)     | Deployment, persistence, recovery and troubleshooting  |
| [Testing](docs/TESTING.md)           | Automated checks and manual acceptance                 |

Deployment does not imply a security certification. The security guide records known limitations. Keep credentials, employee exports and personal data out of Git and public issue reports.
