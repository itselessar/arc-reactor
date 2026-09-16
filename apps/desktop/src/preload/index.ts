import { contextBridge, ipcRenderer } from "electron";
import type { PublicState, ReactorConfig, ReactorEvent } from "../main/types";

const api = {
  getState: (): Promise<PublicState> => ipcRenderer.invoke("reactor:get-state"),
  saveConfig: (config: ReactorConfig): Promise<PublicState> => ipcRenderer.invoke("reactor:save-config", config),
  importWallet: (privateKey: string): Promise<string> => ipcRenderer.invoke("reactor:import-wallet", privateKey),
  forgetWallet: (): Promise<void> => ipcRenderer.invoke("reactor:forget-wallet"),
  start: (): Promise<PublicState> => ipcRenderer.invoke("reactor:start"),
  stop: (): Promise<PublicState> => ipcRenderer.invoke("reactor:stop"),
  sell: (token: string): Promise<string> => ipcRenderer.invoke("reactor:sell", token),
  onEvent: (listener: (event: ReactorEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: ReactorEvent) => listener(payload);
    ipcRenderer.on("reactor:event", handler);
    return () => ipcRenderer.removeListener("reactor:event", handler);
  },
  onState: (listener: (state: PublicState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: PublicState) => listener(payload);
    ipcRenderer.on("reactor:state", handler);
    return () => ipcRenderer.removeListener("reactor:state", handler);
  },
};

contextBridge.exposeInMainWorld("reactor", api);

export type ReactorApi = typeof api;
