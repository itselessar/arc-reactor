# REACTOR

REACTOR is an open source, self-hosted liquidity sniper for Circle's Arc chain. It runs on a Windows PC or an Ubuntu 24.04 VPS. Wallet signing happens on the operator's machine.

This repository contains only the sniper bot:

- Windows desktop application
- Ubuntu 24.04 headless VPS daemon and installer
- Timed and price-multiple automatic selling
- Source code, tests, and GitHub Actions builds

## Important warning

Sniping newly created tokens is extremely risky. Checks can identify configuration mistakes and some obvious failures, but they cannot prove that a token is safe, sellable, or free of malicious logic. Use a dedicated wallet and only funds you can afford to lose.

## Network support

| Setting | Arc Mainnet | Arc Testnet |
| --- | --- | --- |
| Chain ID | `5042` | `5042002` |
| RPC | `https://rpc.mainnet.arc.io` | `https://rpc.testnet.arc.io` |
| Explorer | `https://explorer.arc.io` | `https://explorer.testnet.arc.io` |
| Gas asset | USDC | USDC |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000` | Same |

REACTOR does not hard-code an unverified exchange. Operators must supply verified Uniswap V2 compatible factory and router addresses.

## Pre-flight checks

A failed required check blocks the buy.

1. Arc RPC chain ID
2. Execution wallet address
3. Configured USDC buy amount
4. Auto-sell plan
5. DEX factory bytecode
6. DEX router bytecode
7. Token name and symbol
8. Token contract bytecode and address
9. Nonzero readable total supply
10. Factory pair authenticity
11. Minimum USDC liquidity
12. Forward buy quote
13. Reverse sell quote
14. Wallet USDC balance
15. Final transaction simulation

These are deterministic pre-flight checks, not an independent smart contract audit. A successful quote or simulation does not guarantee that a malicious token can be sold later.

## Automatic selling

REACTOR supports two independent auto-sell triggers:

- Time after purchase, configured in minutes, hours, or days
- Price multiple, such as `2x`, `5x`, or `10x`

Both triggers can be enabled together. The first trigger reached sells the tracked token balance. Positions and purchase timestamps are persisted so monitoring can resume after a restart. The application or service must remain running and armed.

## Windows

### Downloaded installer

Download the Windows installer from the repository Releases page.

The application stores an imported private key with Electron `safeStorage`. On Windows this uses operating-system protected storage. Use a dedicated trading wallet.

### Run from source

Requirements:

- Windows 10 or 11
- Node.js 22.12 or newer
- Git

```powershell
git clone https://github.com/itselessar/arc-reactor.git
cd arc-reactor
npm ci
npm run dev
```

Build Windows installer files:

```powershell
npm run build:win
```

Build output is written to `apps/desktop/release`.

## Ubuntu 24.04 VPS

Clone the repository and run the installer:

```bash
git clone https://github.com/itselessar/arc-reactor.git
cd arc-reactor
sudo bash deploy/ubuntu-bot/install.sh
```

The installer creates:

- Application: `/opt/reactor-bot`
- Configuration: `/etc/reactor-bot/config.json`
- Private environment file: `/etc/reactor-bot.env`
- Persistent positions: `/var/lib/reactor-bot/positions.json`
- Service: `reactor-bot.service`

Configure and validate before starting:

```bash
sudo nano /etc/reactor-bot/config.json
sudo nano /etc/reactor-bot.env
sudo -u reactor-bot /usr/bin/node /opt/reactor-bot/index.js check-config
sudo systemctl enable --now reactor-bot
```

Follow logs:

```bash
sudo journalctl -u reactor-bot -f
```

The example configuration starts in dry-run mode. Live mode requires a dedicated wallet private key in `/etc/reactor-bot.env` and `"dryRun": false` in the bot configuration. The environment file is root-readable only.

## Bot configuration

```json
{
  "network": "mainnet",
  "rpcHttp": "https://rpc.mainnet.arc.io",
  "factoryAddress": "0xVERIFIED_FACTORY",
  "routerAddress": "0xVERIFIED_ROUTER",
  "quoteTokenAddress": "0x3600000000000000000000000000000000000000",
  "targetTokenAddress": "",
  "amountInUsdc": "5",
  "minLiquidityUsdc": "1000",
  "slippagePercent": 20,
  "maxFeeGwei": 30,
  "priorityFeeGwei": 1,
  "pollMs": 250,
  "dryRun": true,
  "autoSellEnabled": true,
  "autoSellAfterValue": 60,
  "autoSellAfterUnit": "minutes",
  "autoSellAtMultiple": 2
}
```

Set `autoSellAfterValue` to `0` to disable the timer. Set `autoSellAtMultiple` to `0` to disable the multiple trigger.

## Development

```bash
npm ci
npm test
npm run build
npm run build:daemon
```

Contributions must keep exchange-specific behavior behind explicit configuration. Do not add telemetry, remote key storage, hidden routing, or hidden transaction logic.

## License

MIT
