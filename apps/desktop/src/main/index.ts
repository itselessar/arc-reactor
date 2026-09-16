import { app, BrowserWindow, ipcMain, session, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { validateConfig } from "./config";
import { SniperEngine } from "./sniper";
import { ReactorStore } from "./store";
import type { AuditItem, PublicState, ReactorEvent, Position } from "./types";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const store = new ReactorStore();
let mainWindow: BrowserWindow | null = null;
let engine: SniperEngine | null = null;
let positions: Position[] = [];
let audits: AuditItem[] = [];

function publicState(): PublicState {
  return {
    running: Boolean(engine),
    walletAddress: store.walletAddress,
    config: store.config,
    positions,
    audits,
  };
}

function sendEvent(event: ReactorEvent): void {
  mainWindow?.webContents.send("reactor:event", event);
}

function sendState(): void {
  mainWindow?.webContents.send("reactor:state", publicState());
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: "#06090b",
    title: "REACTOR",
    webPreferences: {
      preload: path.join(currentDir, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (new URL(url).protocol === "https:") void shell.openExternal(url);
    } catch {
      // Reject malformed external URLs.
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowedDevelopmentUrl = process.env.ELECTRON_RENDERER_URL;
    if (allowedDevelopmentUrl && url.startsWith(allowedDevelopmentUrl)) return;
    if (url.startsWith("file://")) return;
    event.preventDefault();
  });
  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await mainWindow.loadFile(path.join(currentDir, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  await store.load();
  positions = store.positions;
  ipcMain.handle("reactor:get-state", () => publicState());
  ipcMain.handle("reactor:save-config", async (_event, raw: unknown) => {
    if (engine) throw new Error("Disarm REACTOR before changing configuration");
    const config = validateConfig(raw);
    await store.saveConfig(config);
    sendState();
    return publicState();
  });
  ipcMain.handle("reactor:import-wallet", async (_event, input: unknown) => {
    if (typeof input !== "string") throw new Error("Invalid private key");
    const privateKey = input.trim() as `0x${string}`;
    if (!/^0x[a-fA-F0-9]{64}$/.test(privateKey)) throw new Error("Invalid private key");
    const account = privateKeyToAccount(privateKey);
    await store.savePrivateKey(privateKey, getAddress(account.address));
    sendState();
    return account.address;
  });
  ipcMain.handle("reactor:forget-wallet", async () => {
    if (engine) throw new Error("Disarm REACTOR before removing the wallet");
    await store.forgetWallet();
    sendState();
  });
  ipcMain.handle("reactor:start", async () => {
    if (engine) return publicState();
    const config = validateConfig(store.config);
    const privateKey = config.dryRun ? undefined : store.decryptPrivateKey();
    audits = [];
    const nextEngine = new SniperEngine(config, privateKey, store.walletAddress, positions);
    nextEngine.on("event", sendEvent);
    nextEngine.on("position", (position: Position) => {
      positions = [position, ...positions.filter((item) => item.token.toLowerCase() !== position.token.toLowerCase())];
      void store.savePositions(positions);
      sendState();
    });
    nextEngine.on("audit", (audit: AuditItem) => {
      audits = [audit, ...audits.filter((item) => item.key !== audit.key)];
      sendState();
    });
    nextEngine.on("position-closed", (token: string) => {
      positions = positions.filter((position) => position.token.toLowerCase() !== token.toLowerCase());
      void store.savePositions(positions);
      sendState();
    });
    await nextEngine.start();
    engine = nextEngine;
    sendState();
    return publicState();
  });
  ipcMain.handle("reactor:stop", () => {
    engine?.stop();
    engine = null;
    sendState();
    return publicState();
  });
  ipcMain.handle("reactor:sell", async (_event, token: unknown) => {
    if (!engine) throw new Error("Arm REACTOR before selling");
    if (typeof token !== "string") throw new Error("Invalid token address");
    return engine.sell(token);
  });
  await createWindow();
});

app.on("window-all-closed", () => {
  engine?.stop();
  if (process.platform !== "darwin") app.quit();
});
