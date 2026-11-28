/**
 * Where the backend lives. Empty (default) = same origin: local dev (Vite proxy) and the single-container deploy.
 * Set VITE_API_URL at build time when the frontend is hosted separately, e.g. on Vercel:
 *   VITE_API_URL=https://qfleet-backend.up.railway.app
 */
export const API_BASE = ((import.meta.env.VITE_API_URL as string | undefined) ?? "").trim().replace(/\/+$/, "");

export const apiUrl = (path: string) => `${API_BASE}${path}`;
