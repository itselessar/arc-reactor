import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_CONFIG } from "./config";
import type { Position, ReactorConfig } from "./types";

interface StoredData {
  config: ReactorConfig;
  encryptedPrivateKey?: string;
  walletAddress?: string;
  positions?: Position[];
}

export class ReactorStore {
  private readonly filePath = path.join(app.getPath("userData"), "reactor.json");
  private data: StoredData = { config: DEFAULT_CONFIG };

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const loaded = JSON.parse(raw) as Partial<StoredData>;
      this.data = {
        ...loaded,
        config: { ...DEFAULT_CONFIG, ...(loaded.config ?? {}) },
      };
    } catch {
      this.data = { config: DEFAULT_CONFIG };
    }
  }

  get config(): ReactorConfig {
    return this.data.config;
  }

  get walletAddress(): string | null {
    return this.data.walletAddress ?? null;
  }

  get hasKey(): boolean {
    return Boolean(this.data.encryptedPrivateKey);
  }

  get positions(): Position[] {
    return this.data.positions ?? [];
  }

  async saveConfig(config: ReactorConfig): Promise<void> {
    this.data.config = config;
    await this.persist();
  }

  async savePositions(positions: Position[]): Promise<void> {
    this.data.positions = positions;
    await this.persist();
  }

  async savePrivateKey(privateKey: string, walletAddress: string): Promise<void> {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Operating system key encryption is unavailable");
    }
    this.data.encryptedPrivateKey = safeStorage.encryptString(privateKey).toString("base64");
    this.data.walletAddress = walletAddress;
    await this.persist();
  }

  decryptPrivateKey(): `0x${string}` {
    if (!this.data.encryptedPrivateKey || !safeStorage.isEncryptionAvailable()) {
      throw new Error("No protected private key is available");
    }
    return safeStorage.decryptString(Buffer.from(this.data.encryptedPrivateKey, "base64")) as `0x${string}`;
  }

  async forgetWallet(): Promise<void> {
    delete this.data.encryptedPrivateKey;
    delete this.data.walletAddress;
    await this.persist();
  }

  private async persist(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    await rename(temporary, this.filePath);
  }
}
