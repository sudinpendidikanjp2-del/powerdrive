# Changelog
# Centralized File Upload & Google Drive Synchronization Application

All notable changes to this project will be documented in this file.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Changed
- Redesigned share-link access control (see `docs/SHARING.md`). Links are now rows in a new `ShareLink` table: the URL carries only an opaque id, and passwords (bcrypt) and email lists are kept on the server.
  - Opening a link returns a 12-hour share session. Revoking or expiring the link ends sessions that are already open.
- Signed-out reads, listings, downloads, thumbnails and uploads now require a share session that covers the target. Signed-in non-admins can read only their own folders, or folders a share session covers.
- Bulk move/copy now requires write access to the target folder.
- Uploads through an EDIT link are recorded under the shared folder's owner. Before this change they failed with a database error.
- Upload and archive session ids are now 128-bit random values.

### Removed
- The per-folder base permission no longer grants public access.
- The `/share-links` endpoints, which returned signed URLs with the password hash embedded.

### Migration
- Run `npm run db:push`. Old `?folderId=&perm=&sig=` links keep working and are exchanged for a share session.

## [1.0.0] - 2026-08-17 (Phase 08: System Hardening, End-to-End Verification & Production Release)

### Added
- Comprehensive system self-test verification covering 6 core modules (Database, Auth, Google Drive, Folders, Local Storage Buffer, and Sync Engine).
- Production-ready security hardening, input validation, and 200MB multipart boundaries.
- Full Indonesian localization for the application.
- Recorded CONF-009 in `docs/CONFIRMATIONS.md`.
- Created `docs/PHASES/PHASE-08.md`.

## [0.7.0] - 2026-08-17 (Phase 07: Full Frontend Application & Component Architecture)

### Added
- Implemented `AuthContext` (`src/context/AuthContext.tsx`) with automatic session persistence, role guards, and instant Administrator/Staff account switching.
- Implemented typed API service client (`src/services/api.ts`) connecting all backend endpoints.
- Implemented `Header` (`src/components/Header.tsx`) with Power Drive branding, live Google Drive status indicators, storage buffer statistics, and user switcher.
- Implemented `Navigation` (`src/components/Navigation.tsx`) with badge counters for active/pending file operations.
- Implemented `UploadView` (`src/components/UploadView.tsx`) with drag-and-drop multi-file staging, 200MB limit validation, target folder selector, and upload progress feedback.
- Implemented `FilesView` (`src/components/FilesView.tsx`) with search, folder/status filter, live sync badges, Google Drive link previews, SHA-256 integrity check modal, and on-demand sync triggers.
- Implemented `FoldersView` (`src/components/FoldersView.tsx`) for managing folder mappings to Google Drive directories.
- Implemented `DriveSettingsView` (`src/components/DriveSettingsView.tsx`) with Google Drive status, target drive toggle, folder tree explorer, sync worker manual trigger, and system self-test runner.
- Implemented `AuditLogsView` (`src/components/AuditLogsView.tsx`) with security and compliance audit trail inspection.
- Implemented main application orchestrator (`src/App.tsx`) with real-time periodic status polling.
- Recorded CONF-008 in `docs/CONFIRMATIONS.md`.
- Created `docs/PHASES/PHASE-07.md`.

## [0.6.0] - 2026-08-17 (Phase 06: Google Drive Sync Engine & Queue Worker)

### Added
- Implemented `SyncEngineService` (`server/services/sync-engine.service.ts`) with background queue loop (5s), exponential backoff retry calculations, direct stream upload pipes, and destination folder resolution.
- Added `uploadFileStream` method to `GoogleDriveService` (`server/services/google-drive.service.ts`) for streaming multipart payloads to Google Drive.
- Bootstrapped `SyncEngineService.startWorker(5000)` in `server.ts`.
- Implemented `SyncController` (`server/controllers/sync.controller.ts`) and mounted `/api/sync` routes (`GET /jobs`, `GET /jobs/:id`, `GET /stats`, `POST /trigger`, `POST /jobs/:id/retry`, `POST /files/:id/sync`).
- Added automated sync test suite `server/tests/sync.test.ts`.
- Recorded CONF-007 in `docs/CONFIRMATIONS.md`.
- Created `docs/PHASES/PHASE-06.md`.

## [0.5.0] - 2026-08-17 (Phase 05: Local Storage & Buffer Management)

### Added
- Implemented date-partitioned storage directory provisioning (`/storage/uploads/YYYY/MM/DD/`) in `StorageService.getPartitionedPath`.
- Implemented SHA-256 cryptographic checksum calculation and on-demand file integrity validation (`StorageService.calculateSha256`, `StorageService.verifyFileIntegrity`).
- Implemented multipart upload processing with 200MB limit via `multer` (`server/middleware/upload.ts`).
- Implemented `StorageService` (`server/services/storage.service.ts`) for file buffer persistence, automated `SyncJob` queuing, read stream downloading, and storage statistics calculation.
- Implemented `StorageController` (`server/controllers/storage.controller.ts`) and mounted `/api/storage` routes (`POST /upload`, `GET /stats`, `GET /files`, `GET /files/:id`, `GET /files/:id/download`, `GET /files/:id/verify`, `DELETE /files/:id`).
- Added automated storage test suite `server/tests/storage.test.ts`.
- Recorded CONF-006 in `docs/CONFIRMATIONS.md`.
- Created `docs/PHASES/PHASE-05.md`.

## [0.4.0] - 2026-08-17 (Phase 04: Folder Management & Google Drive Folder Selection)

### Added
- Implemented Google Drive hierarchical folder discovery and tree generation in `GoogleDriveService.getFolderTree`.
- Implemented recursive path provisioning (`GoogleDriveService.resolveOrCreatePath`) to auto-create and resolve nested directory structures (e.g. `2026/Pendataan/KJP`).
- Implemented duplicate folder protection ensuring existing directories are reused without duplicates.
- Implemented `FolderService` (`server/services/folder.service.ts`) for application folder CRUD mapped with system-managed Google Drive IDs.
- Implemented `FolderController` (`server/controllers/folder.controller.ts`) and mounted `/api/folders` routes (`GET /`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`, `GET /tree/google`, `POST /google/create`, `POST /google/resolve-path`).
- Added automated folder verification suite in `server/tests/folder.test.ts`.
- Recorded CONF-005 in `docs/CONFIRMATIONS.md`.
- Created `docs/PHASES/PHASE-04.md`.

## [0.3.0] - 2026-08-17 (Phase 03: Google Authentication & Drive Connection)

### Added
- Configured Google Workspace OAuth 2.0 with `https://www.googleapis.com/auth/drive` scope.
- Installed `firebase` SDK and created client authentication bridge `src/lib/firebase.ts` and `src/lib/google-auth.ts`.
- Implemented `GoogleDriveService` (`server/services/google-drive.service.ts`) for Google Drive connection management, personal `My Drive` handling, and Shared Drive discovery.
- Implemented `GoogleController` (`server/controllers/google.controller.ts`) and mounted `/api/google` routes (`/status`, `/drives`, `/connect`, `/disconnect`, `/select-drive`).
- Implemented automated test module `server/tests/google.test.ts`.
- Recorded CONF-004 in `docs/CONFIRMATIONS.md`.
- Created `docs/PHASES/PHASE-03.md`.

## [0.2.0] - 2026-08-17 (Phase 02: Authentication & Authorization)

### Added
- Implemented JWT authentication and session token verification in `server/middleware/auth.ts` with `requireAuth` and `requireAdmin` RBAC guards.
- Implemented `AuthService` in `server/services/auth.service.ts` supporting bcrypt credential verification, user creation, role updates, and user listing.
- Implemented `AuditService` in `server/services/audit.service.ts` for immutable activity logging of auth and administrative actions.
- Implemented `AuthController` (`POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`).
- Implemented `AdminController` (`GET /api/admin/users`, `POST /api/admin/users`, `PUT /api/admin/users/:id`, `GET /api/admin/logs`, `GET /api/admin/stats`).
- Configured Express server entry point in `server.ts` with Vite middleware in development and static SPA serving in production.
- Updated `package.json` with `dev: "tsx server.ts"`, `build: "vite build && esbuild server.ts ..."`, `start: "node dist/server.cjs"`.
- Implemented automated verification suite in `server/tests/auth.test.ts`.
- Created `docs/PHASES/PHASE-02.md`.

## [0.1.0] - 2026-08-17 (Phase 01: Database & Prisma)

### Added
- Created `prisma/schema.prisma` defining models for `User`, `Folder`, `File`, `SyncJob`, `GoogleDriveConnection`, `ActivityLog`, and `SystemSetting`.
- Created `server/types/index.ts` declaring all server-side TypeScript interfaces and domain enums.
- Created `server/db/index.ts` implementing ACID-compliant relational data service layer with model operations, indexes, relations, and bootstrap seed engine.
- Created `server/db/test-db.ts` for automated schema and seed validation.
- Recorded user confirmation CONF-002: Default file size 200MB and Personal Google Drive (`MY_DRIVE`) preference.
- Installed required packages: `@prisma/client`, `prisma`, `bcryptjs`, `cookie-parser`, `jsonwebtoken`, `multer`, `googleapis`, `@tanstack/react-query`, `clsx`, `tailwind-merge`.
- Created `docs/PHASES/PHASE-01.md`.

## [0.0.1] - 2026-08-17 (Phase 00: Project Initialization & Architecture)

### Added
- Created complete documentation infrastructure under `/docs/`:
  - `docs/PRD.md`: Full Product Requirements Document with core principles, roles, and acceptance criteria.
  - `docs/ARCHITECTURE.md`: Complete system architecture, component boundaries, and directory layout.
  - `docs/DATABASE.md`: PostgreSQL schema specification and Prisma ORM models.
  - `docs/AUTHENTICATION.md`: Dual-layer user auth and Google Drive connection architecture.
  - `docs/GOOGLE_DRIVE.md`: Discovery, tree building, and recursive automatic folder management.
  - `docs/STORAGE.md`: Local buffer storage partitioning and retention policies.
  - `docs/UPLOAD.md`: Streaming upload protocol and multi-layer validation matrix.
  - `docs/SYNC.md`: Lifecycle state machine, server sync worker, and idempotency strategy.
  - `docs/SECURITY.md`: Threat matrix, cryptographic validation, and audit controls.
  - `docs/API.md`: Comprehensive REST API endpoint definitions.
  - `docs/TESTING.md`: Test matrix covering all functional areas.
  - `docs/DEPLOYMENT.md`: Container runtime specifications and environment configurations.
  - `docs/TROUBLESHOOTING.md`: Operational resolutions for rate limits, token expiry, and disk space.
  - `docs/DECISIONS.md`: Initial Architecture Decision Records (ADR-001 through ADR-005).
  - `docs/CONFIRMATIONS.md`: User confirmation ledger (CONF-001).
  - `docs/PHASES/PHASE-00.md`: Formal Phase 00 execution report.
- Updated `metadata.json` with formal project name and capability tags.
