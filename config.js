// Frontend deployment configuration.
//
// API_URL must point at the running Node backend (the Express server in
// /backend). GitHub Pages serves only static files, so it cannot run the
// backend — deploy that to a host such as Render, then paste its URL here.
//
//   Local (backend on this machine):   API_URL: ''  (same origin works)
//   GitHub Pages frontend:             API_URL: 'https://your-api.onrender.com'
window.MODERN_SKILLS_CONFIG = window.MODERN_SKILLS_CONFIG || {
  API_URL: ''
};
