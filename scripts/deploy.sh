#!/usr/bin/env bash
# Redeploys the API and the public pages to the DigitalOcean droplet.
#
#   scripts/deploy.sh
#
# Needs the deploy key (~/.ssh/vocalock_deploy). The droplet's one-time setup
# (Node, Postgres, nginx, TLS, systemd, firewall) is described in README.md
# under "Hosting"; this script only ships code and restarts the service.
# Production config lives in /opt/vocalock/server/.env on the droplet and is
# never touched here.
set -euo pipefail

HOST=root@143.110.190.26
SSH="ssh -i $HOME/.ssh/vocalock_deploy -o BatchMode=yes"
cd "$(dirname "$0")/.."

rsync -az --delete -e "$SSH" \
  --include='src/***' --include='certs/***' \
  --include='package.json' --include='package-lock.json' --include='tsconfig.json' \
  --exclude='*' server/ "$HOST:/opt/vocalock/server/"
rsync -az --delete -e "$SSH" db/migrations "$HOST:/opt/vocalock/db/"
rsync -az --delete -e "$SSH" docs/privacy.html docs/terms.html docs/refund.html docs/delete-account.html docs/icon-512.png "$HOST:/opt/vocalock/site/"

$SSH "$HOST" 'set -e
chown -R vocalock:vocalock /opt/vocalock/server /opt/vocalock/db
chmod -R o+rX /opt/vocalock/site
cd /opt/vocalock/server
sudo -u vocalock npm ci --no-audit --no-fund --loglevel=error
sudo -u vocalock npm run build --silent
sudo -u vocalock node --env-file=.env dist/migrate.js
systemctl restart vocalock-api
sleep 2
systemctl is-active vocalock-api'

curl -fsS https://vocalock.indidino.com/api/health && echo "  deployed"
