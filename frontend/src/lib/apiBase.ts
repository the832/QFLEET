/**
 * Where the backend lives. Empty (default) = same origin: local dev (Vite proxy) and the single-container deploy.
 * Set VITE_API_URL at build time when the frontend is hosted separately, e.g. on Vercel:
 *   VITE_API_URL=https://qfleet-backend.up.railway.app
 */
const raw = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").trim().replace(/\/+$/, "");
// "qfleet.up.railway.app" without a scheme would be treated as a path on the frontend's own site: add https://
export const API_BASE = raw && !/^https?:\/\//i.test(raw) ? `https://${raw}` : raw;

export const apiUrl = (path: string) => `${API_BASE}${path}`;
