#!/usr/bin/env bash
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo or as root."
  exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_dir="$(cd "$script_dir/../.." && pwd)"
app_dir="/opt/reactor-bot"
state_dir="/var/lib/reactor-bot"

apt-get update
apt-get install -y ca-certificates curl nodejs npm

node_major="$(node -p 'process.versions.node.split(`.`)[0]')"
if (( node_major < 22 )); then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

cd "$repo_dir"
npm ci
npm run build:daemon

if ! id reactor-bot >/dev/null 2>&1; then
  useradd --system --home "$state_dir" --shell /usr/sbin/nologin reactor-bot
fi

install -d -m 0755 "$app_dir"
install -d -o reactor-bot -g reactor-bot -m 0700 "$state_dir"
cp "$repo_dir/apps/daemon/dist/index.js" "$app_dir/index.js"
cp "$repo_dir/apps/daemon/package.json" "$app_dir/package.json"
cp "$repo_dir/apps/daemon/config.example.json" /etc/reactor-bot-config.example.json

cd "$app_dir"
npm install --omit=dev --no-audit --no-fund
chown -R reactor-bot:reactor-bot "$app_dir"

if [[ ! -f /etc/reactor-bot.env ]]; then
  {
    echo "NODE_ENV=production"
    echo "REACTOR_CONFIG_PATH=/etc/reactor-bot/config.json"
    echo "REACTOR_POSITIONS_PATH=/var/lib/reactor-bot/positions.json"
    echo "REACTOR_PRIVATE_KEY=0x"
  } > /etc/reactor-bot.env
  chmod 0600 /etc/reactor-bot.env
fi

if [[ ! -f /etc/reactor-bot/config.json ]]; then
  install -d -m 0755 /etc/reactor-bot
  cp /etc/reactor-bot-config.example.json /etc/reactor-bot/config.json
fi
chown root:reactor-bot /etc/reactor-bot/config.json
chmod 0640 /etc/reactor-bot/config.json

install -m 0644 "$script_dir/reactor-bot.service" /etc/systemd/system/reactor-bot.service
systemctl daemon-reload

echo "REACTOR bot installed."
echo "1. Edit /etc/reactor-bot/config.json and add verified factory and router addresses."
echo "2. For live mode, edit /etc/reactor-bot.env and set a dedicated wallet key."
echo "3. Validate: sudo -u reactor-bot /usr/bin/node /opt/reactor-bot/index.js check-config"
echo "4. Start: systemctl enable --now reactor-bot"
