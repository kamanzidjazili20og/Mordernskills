
// Frontend deployment configuration.
//
// The backend must be deployed separately as a Node.js Web Service.
// GitHub Pages and static hosting cannot run the Express backend.

window.MODERN_SKILLS_CONFIG = window.MODERN_SKILLS_CONFIG || (function () {

  // IMPORTANT: Replace this with your actual Render backend URL.
  var DEPLOYED_API_URL = 'https://YOUR-BACKEND-NAME.onrender.com';

  var host = location.hostname;

  var isLocal = location.protocol === 'file:'
    || host === ''
    || host === 'localhost'
    || host === '127.0.0.1';

  var apiUrl = isLocal ? '' : DEPLOYED_API_URL;

  if (!isLocal && !apiUrl) {
    console.warn(
      '[Modern Skills] DEPLOYED_API_URL is empty. '
      + 'Configure your deployed backend URL in config.js.'
    );
  }

  return { API_URL: apiUrl };
})();
