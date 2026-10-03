// Credentials for API calls: the login token (localStorage) and, when a share
// link was opened in this tab, a short-lived share session (sessionStorage, so
// it ends with the tab and is not shared with other tabs).

const AUTH_KEY = "auth_token";
const SHARE_KEY = "powerdrive:share-session";

function read(store: Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function getAuthToken() {
  return read(typeof localStorage === "undefined" ? undefined : localStorage, AUTH_KEY);
}

export function getShareSession() {
  return read(typeof sessionStorage === "undefined" ? undefined : sessionStorage, SHARE_KEY);
}

export function setShareSession(token: string | null) {
  try {
    if (token) sessionStorage.setItem(SHARE_KEY, token);
    else sessionStorage.removeItem(SHARE_KEY);
  } catch {
    // Without storage the session only lives in memory for this page load.
  }
}

/** Headers for fetch/XHR requests. */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const share = getShareSession();
  if (share) headers["X-Share-Session"] = share;
  return headers;
}

export function applyXhrCredentials(xhr: XMLHttpRequest) {
  for (const [k, v] of Object.entries(authHeaders())) xhr.setRequestHeader(k, v);
}

/** For URLs used where headers cannot be set (<img src>, <video src>, download links). */
export function withCredentialsQuery(url: string): string {
  const params: string[] = [];
  const token = getAuthToken();
  if (token) params.push(`token=${encodeURIComponent(token)}`);
  const share = getShareSession();
  if (share) params.push(`share_session=${encodeURIComponent(share)}`);
  if (params.length === 0) return url;
  return `${url}${url.includes("?") ? "&" : "?"}${params.join("&")}`;
}
