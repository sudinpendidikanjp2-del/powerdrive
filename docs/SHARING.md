# Sharing and access control

## Who can see what

| Visitor | Folders | Files |
|---|---|---|
| Admin | Everything | Everything |
| Signed-in user | Folders they own, plus everything nested inside | Files they uploaded, and files in folders they can read |
| Anyone holding a share session | The shared folder and its whole subtree (VIEW: read, EDIT: read + upload) | The shared file, or files inside the shared folder |
| Signed out, no session | Nothing (401) | Nothing (401) |

A signed-in user who opens a share link gets both: their own folders plus the shared subtree.
Rules live in `server/services/access.service.ts`. Routes use the guards in
`server/middleware/access.ts`. A denied request gets 401 when the visitor is signed out and 403 when signed in.

Files uploaded through an EDIT link are recorded under the owner of the shared folder, because the visitor has no account.

## Share links

Owners and admins create links in the Share dialog. A link is a row in the `ShareLink` table:

- `permission`: VIEW or EDIT (file links are always VIEW)
- `passwordHash`: bcrypt hash, optional
- `allowedEmails`: optional list. The visitor has to type an address on the list. The address is **not** verified by email.
- `expiresAt`: optional
- `revokedAt`: set when the link is revoked

The URL carries only an opaque random id: `/?s=<id>`. Passwords and email lists never appear in the URL.

### Opening a link

1. `GET /api/shares/:id/gate` returns `{ requiresPassword, requiresEmail, itemType }`.
2. `POST /api/shares/:id/open` with `{ password?, email? }`. The server checks the credentials and returns
   `{ session, expiresIn, permission, itemType, folder?, file? }`.
   After 10 failed attempts per link and IP address within 15 minutes, further attempts get 429.
3. The client keeps the session in `sessionStorage`, so it lasts for the tab only.
   It sends the session as the `X-Share-Session` header, or as `?share_session=` on download and thumbnail URLs.

A session is a JWT signed with a key derived from `SESSION_SECRET` (set it in production; the built-in default is for development only). It is valid for 12 hours.
The link row is checked again on every request, so revoking or expiring a link cuts off sessions that are already open.

### Managing links (signed in, owner or admin)

- `GET /api/shares?itemType=FOLDER|FILE&itemId=...`: list active links
- `POST /api/shares` with `{ itemType, itemId, permission, password?, allowedEmails?, expiresInDays? }`: create a link (201)
- `DELETE /api/shares/:id`: revoke a link

## Migrating from the old links

Older links looked like `/?folderId=…&perm=VIEW&sig=…` and sometimes also carried `pwdHash` and `emails` in the URL.

- **Old links still open.** `POST /api/folders/verify-share-token` checks the HMAC signature (and the password and email in the URL, if present) and returns a share session with the same scope. The client handles this automatically.
- Old links cannot be revoked one by one, and their password protection is weak because the hash is in the URL. To retire them all, rotate `JWT_SECRET` (only these old links use it; sign-in is unaffected). Then re-share from the Share dialog.
- The per-folder "base permission" setting no longer grants access. Without a link, only the owner and admins can open an item.
- Schema: run `npm run db:push` to create the `ShareLink` table. No existing data changes.
