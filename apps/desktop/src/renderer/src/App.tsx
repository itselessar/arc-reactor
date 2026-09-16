import { useEffect, useMemo, useState } from "react";
import { Logo } from "./Logo";
import type { PublicState, ReactorConfig, ReactorEvent } from "../../main/types";

const mainnetRpc = "https://rpc.mainnet.arc.io";
const testnetRpc = "https://rpc.testnet.arc.io";

function shortAddress(value: string | null) {
  return value ? `${value.slice(0, 6)}...${value.slice(-4)}` : "NO WALLET";
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export default function App() {
  const [state, setState] = useState<PublicState | null>(null);
  const [draft, setDraft] = useState<ReactorConfig | null>(null);
  const [events, setEvents] = useState<ReactorEvent[]>([]);
  const [privateKey, setPrivateKey] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void window.reactor.getState().then((next) => { setState(next); setDraft(next.config); });
    const offEvent = window.reactor.onEvent((event) => setEvents((old) => [event, ...old].slice(0, 100)));
    const offState = window.reactor.onState((next) => { setState(next); setDraft(next.config); });
    return () => { offEvent(); offState(); };
  }, []);

  const status = useMemo(() => state?.running ? "ARMED" : "STANDBY", [state?.running]);
  if (!state || !draft) return <div className="boot"><Logo /><span>INITIALIZING CORE</span></div>;

  const update = <K extends keyof ReactorConfig>(key: K, value: ReactorConfig[K]) => setDraft((current) => current ? { ...current, [key]: value } : current);

  async function act(fn: () => Promise<unknown>) {
    setBusy(true); setNotice("");
    try { await fn(); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  }

  async function save() {
    if (!draft) return;
    await act(async () => { const next = await window.reactor.saveConfig(draft); setState(next); setNotice("Configuration saved"); });
  }

  async function importWallet() {
    await act(async () => {
      await window.reactor.importWallet(privateKey);
      setPrivateKey("");
      setNotice("Wallet encrypted and stored on this PC");
    });
  }

  async function toggle() {
    if (!draft || !state) return;
    await act(async () => {
      await window.reactor.saveConfig(draft);
      const next = state.running ? await window.reactor.stop() : await window.reactor.start();
      setState(next);
    });
  }

  return (
    <div className="app-shell">
      <aside>
        <Logo />
        <div className={`status-card ${state.running ? "live" : ""}`}>
          <div className="status-line"><span className="status-dot" /><b>{status}</b></div>
          <small>{draft.dryRun ? "DRY RUN" : "LIVE EXECUTION"}</small>
        </div>
        <nav>
          <a className="active" href="#control">CONTROL</a>
          <a href="#execution">EXECUTION</a>
          <a href="#positions">POSITIONS</a>
          <a href="#activity">ACTIVITY</a>
        </nav>
        <div className="network-readout">
          <span>NETWORK</span><b>{draft.network === "mainnet" ? "ARC MAINNET" : "ARC TESTNET"}</b>
          <span>CHAIN ID</span><b>{draft.network === "mainnet" ? "5042" : "5042002"}</b>
          <span>GAS ASSET</span><b>USDC</b>
        </div>
      </aside>

      <main>
        <header>
          <div><p className="eyebrow">LOCAL EXECUTION TERMINAL</p><h1>LIQUIDITY INTERCEPT</h1></div>
          <div className="wallet-badge"><span>WALLET</span><b>{shortAddress(state.walletAddress)}</b></div>
        </header>

        {notice && <div className="notice">{notice}<button onClick={() => setNotice("")}>CLOSE</button></div>}

        <section id="control" className="control-grid">
          <div className="panel reactor-panel">
            <div className="panel-head"><span>01</span><h2>REACTOR CORE</h2><em>{status}</em></div>
            <div className="core-visual">
              <Logo compact />
              <div className="rings"><i /><i /><i /></div>
            </div>
            <div className="mode-row">
              <button className={draft.dryRun ? "selected" : ""} onClick={() => update("dryRun", true)} disabled={state.running}>DRY RUN</button>
              <button className={!draft.dryRun ? "selected danger" : ""} onClick={() => update("dryRun", false)} disabled={state.running}>LIVE MODE</button>
            </div>
            <button className={`arm ${state.running ? "disarm" : ""}`} onClick={toggle} disabled={busy}>
              {state.running ? "DISARM REACTOR" : "ARM REACTOR"}
            </button>
            <p className="safety">Live mode signs transactions locally. Test with Arc Testnet first.</p>
          </div>

          <div className="panel settings-panel">
            <div className="panel-head"><span>02</span><h2>TARGET MATRIX</h2></div>
            <div className="fields two">
              <Field label="NETWORK">
                <select value={draft.network} disabled={state.running} onChange={(e) => {
                  const network = e.target.value as ReactorConfig["network"];
                  setDraft({ ...draft, network, rpcHttp: network === "mainnet" ? mainnetRpc : testnetRpc });
                }}><option value="testnet">Arc Testnet</option><option value="mainnet">Arc Mainnet</option></select>
              </Field>
              <Field label="POLL RATE"><input type="number" value={draft.pollMs} onChange={(e) => update("pollMs", Number(e.target.value))} /></Field>
            </div>
            <Field label="RPC HTTP"><input value={draft.rpcHttp} onChange={(e) => update("rpcHttp", e.target.value)} /></Field>
            <Field label="DEX FACTORY" hint="Uniswap V2 compatible PairCreated factory"><input placeholder="0x..." value={draft.factoryAddress} onChange={(e) => update("factoryAddress", e.target.value)} /></Field>
            <Field label="DEX ROUTER"><input placeholder="0x..." value={draft.routerAddress} onChange={(e) => update("routerAddress", e.target.value)} /></Field>
            <Field label="TARGET TOKEN" hint="Leave empty to intercept every new USDC pair"><input placeholder="Optional 0x..." value={draft.targetTokenAddress} onChange={(e) => update("targetTokenAddress", e.target.value)} /></Field>
            <div className="fields three">
              <Field label="BUY USDC"><input value={draft.amountInUsdc} onChange={(e) => update("amountInUsdc", e.target.value)} /></Field>
              <Field label="MIN LIQUIDITY"><input value={draft.minLiquidityUsdc} onChange={(e) => update("minLiquidityUsdc", e.target.value)} /></Field>
              <Field label="SLIPPAGE %"><input type="number" value={draft.slippagePercent} onChange={(e) => update("slippagePercent", Number(e.target.value))} /></Field>
            </div>
            <div className="auto-sell-block">
              <label className="auto-sell-toggle"><input type="checkbox" checked={draft.autoSellEnabled} onChange={(e) => update("autoSellEnabled", e.target.checked)} /><span>AUTO SELL</span><b>{draft.autoSellEnabled ? "ARMED" : "OFF"}</b></label>
              <div className="fields auto-sell-fields">
                <Field label="SELL AFTER" hint="0 disables the time trigger"><input type="number" min="0" step="1" value={draft.autoSellAfterValue} disabled={!draft.autoSellEnabled} onChange={(e) => update("autoSellAfterValue", Number(e.target.value))} /></Field>
                <Field label="TIME UNIT"><select value={draft.autoSellAfterUnit} disabled={!draft.autoSellEnabled} onChange={(e) => update("autoSellAfterUnit", e.target.value as ReactorConfig["autoSellAfterUnit"])}><option value="minutes">Minutes</option><option value="hours">Hours</option><option value="days">Days</option></select></Field>
                <Field label="SELL AT X" hint="Example: 2 means 2x. 0 disables."><input type="number" min="0" step="0.1" value={draft.autoSellAtMultiple} disabled={!draft.autoSellEnabled} onChange={(e) => update("autoSellAtMultiple", Number(e.target.value))} /></Field>
              </div>
              <p>The first enabled trigger reached sells 100% of the tracked token position.</p>
            </div>
            <button className="secondary" onClick={save} disabled={busy || state.running}>SAVE CONFIGURATION</button>
          </div>
        </section>

        <section className="panel audit-panel">
          <div className="panel-head"><span>03</span><h2>PRE-FLIGHT AUDITS</h2><em>ON-CHAIN CHECKS</em></div>
          <div className="audit-summary">
            <p>REACTOR exposes every check before execution. A failed required check blocks the buy.</p>
            <b>{state.audits.filter((item) => item.status === "pass").length} PASSED</b>
          </div>
          <div className="audit-grid">
            {state.audits.length === 0 ? (
              <div className="audit-empty">ARM IN DRY RUN TO LOAD NETWORK, WALLET, DEX, TOKEN, LIQUIDITY, ROUTE, AND SIMULATION AUDITS</div>
            ) : state.audits.map((audit) => (
              <div className={`audit-item ${audit.status}`} key={audit.key}>
                <i>{audit.status === "pass" ? "✓" : audit.status === "fail" ? "×" : "!"}</i>
                <span>{audit.label}<small title={audit.value}>{audit.value}</small></span>
              </div>
            ))}
          </div>
        </section>

        <section id="execution" className="panel wallet-panel">
          <div className="panel-head"><span>04</span><h2>LOCAL WALLET VAULT</h2><em>{state.walletAddress ? "ENCRYPTED" : "EMPTY"}</em></div>
          <div className="wallet-grid">
            <div><p>The private key is protected with Windows secure storage and never sent to a server.</p><code>{state.walletAddress ?? "Import a dedicated trading wallet"}</code></div>
            <div className="key-entry">
              <input type="password" autoComplete="off" placeholder="0x private key" value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} />
              <button className="secondary" onClick={importWallet} disabled={busy || state.running || !privateKey}>IMPORT</button>
              {state.walletAddress && <button className="text-button" onClick={() => act(() => window.reactor.forgetWallet())} disabled={state.running}>FORGET</button>}
            </div>
          </div>
        </section>

        <section className="lower-grid">
          <div id="positions" className="panel">
            <div className="panel-head"><span>05</span><h2>POSITIONS</h2><em>{state.positions.length}</em></div>
            {state.positions.length === 0 ? <div className="empty">NO OPEN POSITIONS</div> : state.positions.map((position) => (
              <div className="position" key={position.token}><b>{position.symbol}</b><span>{position.amount}</span><span>{position.costUsdc} USDC</span><button onClick={() => act(() => window.reactor.sell(position.token))} disabled={!state.running || draft.dryRun || busy}>SELL 100%</button></div>
            ))}
          </div>
          <div id="activity" className="panel activity">
            <div className="panel-head"><span>06</span><h2>EVENT STREAM</h2><em>LIVE</em></div>
            <div className="event-list">
              {events.length === 0 && <div className="empty">WAITING FOR CORE EVENTS</div>}
              {events.map((event) => <div className={`event ${event.level}`} key={event.id}><time>{new Date(event.at).toLocaleTimeString()}</time><p>{event.message}</p></div>)}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
