// Frontend deployment configuration.
//
// API_URL must point at the running Node backend (the Express server in
// /backend). GitHub Pages serves only static files, so it cannot run the
// backend — deploy that to a host such as Render, then paste its URL into
// DEPLOYED_API_URL below.
//
// The choice is automatic:
//   localhost / 127.0.0.1 / file://  ->  '' (same origin), so `npm start`
//        keeps serving the site and the API from a single port.
//   anywhere else (GitHub Pages)     ->  DEPLOYED_API_URL.
//
//   Local (backend on this machine):   nothing to change.
//   GitHub Pages frontend:             set DEPLOYED_API_URL to
//                                      'https://your-api.onrender.com'
window.MODERN_SKILLS_CONFIG = window.MODERN_SKILLS_CONFIG || (function () {
  // <-- paste the public URL of the deployed backend here (no trailing slash)
  var DEPLOYED_API_URL = '';

  var host = location.hostname;
  var isLocal = location.protocol === 'file:'
    || host === ''
    || host === 'localhost'
    || host === '127.0.0.1';

  var apiUrl = isLocal ? '' : DEPLOYED_API_URL;

  if (!isLocal && !apiUrl) {
    console.warn(
      '[Modern Skills] DEPLOYED_API_URL in config.js is empty, so this page will '
      + 'call ' + location.origin + '/api — that only works when the page is served '
      + 'by the Node backend itself. On GitHub Pages, paste your deployed backend URL '
      + 'into DEPLOYED_API_URL in config.js.'
    );
  }

  return { API_URL: apiUrl };
})();
