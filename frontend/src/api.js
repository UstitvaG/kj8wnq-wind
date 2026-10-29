// Base URL for the backend API.
// - In local dev / docker-compose, '/api' is proxied to the backend (see vite.config.js / nginx.conf).
// - In a split deployment (e.g. frontend on Vercel, backend on Heroku/Render),
//   set VITE_API_BASE_URL to the backend's full URL, e.g. https://your-backend.herokuapp.com/api
const BASE = import.meta.env.VITE_API_BASE_URL || '/api'

async function get(path) {
  const res = await fetch(`${BASE}${path}`)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Request to ${path} failed (${res.status}): ${body}`)
  }
  return res.json()
}

export const api = {
  health: () => get('/health'),
  decisionDays: () => get('/decision-days'),
  decisionView: (deliveryDate) => get(`/decision/${deliveryDate}`),
  accuracy: (limitDays) => get(`/accuracy${limitDays ? `?limit_days=${limitDays}` : ''}`),
}
