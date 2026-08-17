#!/bin/sh
set -eu

mkdir -p dist/public

node <<'NODE'
const fs = require('node:fs');

const config = {
  authUrl: process.env.NEXUSS_AUTH_URL || 'https://nexuss-auth.vercel.app',
  projectId: process.env.NEXUSS_AUTH_PROJECT_ID || 'nexuss-agent-v2',
  redirectUri: process.env.NEXUSS_AUTH_REDIRECT_URI || 'https://nexuss-agents.onrender.com/auth/callback',
};

fs.writeFileSync(
  'dist/public/runtime-config.js',
  `window.__NEXUSS_AUTH_CONFIG__ = ${JSON.stringify(config)};\n`,
);
NODE
