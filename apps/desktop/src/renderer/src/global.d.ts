import type { ReactorApi } from "../../preload";

declare global {
  interface Window {
    reactor: ReactorApi;
  }
}

export {};
