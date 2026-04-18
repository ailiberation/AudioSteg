import { useState, useRef, useEffect } from "react";

/* ════════════════════════════════════════════════════════
   STEGANOGRAPHY ENGINE
   LSB encoding into channel-0 PCM audio samples
   ════════════════════════════════════════════════════════ */

function f32ToI16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    const s = Math.max(-1, Math.min(1, f32[i]));
    out[i] = s < 0 ? Math.round(s * 32768) : Math.round(s * 32767);
  }
  return out;
}

function stegEncode(audioBuffer, message) {
  const msgU8 = new TextEncoder().encode(message);
  const nc = audioBuffer.numberOfChannels;
  const sr = audioBuffer.sampleRate;
  const nf = audioBuffer.length;
  const ch0 = f32ToI16(audioBuffer.getChannelData(0));
  const bitsNeeded = (4 + msgU8.length) * 8;

  if (bitsNeeded > ch0.length) {
    const maxB = Math.floor(ch0.length / 8) - 4;
    throw new Error(
      `PAYLOAD TOO LARGE: ${msgU8.length.toLocaleString()} bytes requested, ` +
      `${maxB.toLocaleString()} bytes available. Use a longer carrier or compress your message.`
    );
  }

  // Write 32-bit length header
  let idx = 0;
  for (let i = 31; i >= 0; i--) {
    ch0[idx] = (ch0[idx] & ~1) | ((msgU8.length >> i) & 1);
    idx++;
  }
  // Write payload bits
  for (const byte of msgU8) {
    for (let i = 7; i >= 0; i--) {
      ch0[idx] = (ch0[idx] & ~1) | ((byte >> i) & 1);
      idx++;
    }
  }

  // Build WAV
  const ds = nf * nc * 2;
  const wavBuf = new ArrayBuffer(44 + ds);
  const v = new DataView(wavBuf);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + ds, true);
  ws(8, "WAVE"); ws(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, nc, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nc * 2, true); v.setUint16(32, nc * 2, true);
  v.setUint16(34, 16, true); ws(36, "data"); v.setUint32(40, ds, true);

  const channels = [ch0];
  for (let c = 1; c < nc; c++) channels.push(f32ToI16(audioBuffer.getChannelData(c)));

  let off = 44;
  for (let i = 0; i < nf; i++) {
    for (let c = 0; c < nc; c++) { v.setInt16(off, channels[c][i], true); off += 2; }
  }
  return wavBuf;
}

function stegDecode(audioBuffer) {
  const ch0 = f32ToI16(audioBuffer.getChannelData(0));
  let len = 0;
  for (let i = 0; i < 32; i++) len = (len << 1) | (ch0[i] & 1);

  if (len <= 0 || len > 50_000_000 || (len + 4) * 8 > ch0.length)
    throw new Error("NO PAYLOAD DETECTED — file may not be encoded, or is corrupted.");

  const bytes = new Uint8Array(len);
  let idx = 32;
  for (let b = 0; b < len; b++) {
    let byte = 0;
    for (let i = 7; i >= 0; i--) byte |= (ch0[idx++] & 1) << i;
    bytes[b] = byte;
  }
  return new TextDecoder().decode(bytes);
}

function capacityBytes(buf) {
  return Math.floor(buf.getChannelData(0).length / 8) - 4;
}

/* ════════════════════════════════════════════════════════
   DESIGN TOKENS & STYLES
   ════════════════════════════════════════════════════════ */

const amber = "#f59e0b";
const amberDim = "#92400e";
const green = "#34d399";
const red = "#f87171";
const bg = "#050505";
const surface = "#0c0c0c";
const elevated = "#141414";
const border = "#242424";
const text = "#e8e2d4";
const muted = "#555";

const mono = "'Courier New', 'Courier', 'Lucida Console', monospace";

const globalCSS = `
  * { box-sizing: border-box; }
  ::selection { background: ${amberDim}; color: ${amber}; }

  @keyframes blink { 0%,49%{opacity:1} 50%,100%{opacity:0} }
  @keyframes scanline {
    0% { transform: translateY(-100%); }
    100% { transform: translateY(100vh); }
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(12px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse-border {
    0%,100% { border-color: ${amber}44; }
    50%      { border-color: ${amber}; }
  }
  @keyframes shimmer {
    0% { background-position: -200% center; }
    100% { background-position: 200% center; }
  }

  textarea:focus, input:focus { outline: none; }
  textarea { resize: vertical; }
  button { cursor: pointer; }
  details summary::-webkit-details-marker { display: none; }
  details summary { list-style: none; }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${border}; border-radius: 2px; }

  .file-drop.drag {
    border-color: ${amber} !important;
    background: ${amber}08 !important;
  }
  .tab-btn:hover { color: ${amber}aa !important; }
  .ghost-btn:hover { color: ${amber} !important; border-color: ${amber}44 !important; }
  .encode-btn:not(:disabled):hover { filter: brightness(1.15); }
`;

/* ════════════════════════════════════════════════════════
   SUB-COMPONENTS
   ════════════════════════════════════════════════════════ */

function Scanlines() {
  return (
    <div style={{
      position: "fixed", inset: 0, pointerEvents: "none", zIndex: 9999,
      background: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 4px)",
    }} />
  );
}

function StatusBar({ type, msg, onClear }) {
  if (!msg) return null;
  const pal = { error: red, success: green, info: amber };
  const icons = { error: "✕ ERROR", success: "✓ OK", info: "→ INFO" };
  const c = pal[type] || muted;
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 10,
      padding: "10px 14px", borderRadius: 4, marginBottom: 18,
      background: c + "12", border: `1px solid ${c}44`,
      color: c, fontSize: 12, fontFamily: mono,
      animation: "fadeUp 0.2s ease",
    }}>
      <span style={{ fontWeight: 700, whiteSpace: "nowrap", paddingTop: 1 }}>{icons[type]}</span>
      <span style={{ flex: 1, lineHeight: 1.6 }}>{msg}</span>
      {onClear && (
        <button onClick={onClear} style={{ background: "none", border: "none", color: c, padding: 0, fontSize: 14, opacity: 0.6 }}>✕</button>
      )}
    </div>
  );
}

function DropZone({ drag, handlers, onFile, accept, busy, hint, children }) {
  const ref = useRef(null);
  return (
    <div
      className={`file-drop${drag ? " drag" : ""}`}
      {...handlers}
      onClick={() => !busy && ref.current?.click()}
      style={{
        border: `1px dashed ${drag ? amber : border}`,
        borderRadius: 4, padding: "28px 20px",
        textAlign: "center", cursor: busy ? "default" : "pointer",
        transition: "all 0.15s", background: "transparent", marginBottom: 18,
        position: "relative",
      }}
    >
      <input ref={ref} type="file" accept={accept} style={{ display: "none" }}
        onChange={e => { const f = e.target.files[0]; if (f) { onFile(f); e.target.value = ""; } }} />
      {children || (
        <>
          <div style={{ fontSize: 28, marginBottom: 8, filter: busy ? "none" : "grayscale(1)", opacity: busy ? 1 : 0.4 }}>
            {busy ? "⌛" : "◈"}
          </div>
          <div style={{ color: busy ? amber : muted, fontSize: 12, fontFamily: mono, letterSpacing: "0.05em" }}>
            {busy ? "PROCESSING AUDIO DATA…" : hint}
          </div>
          {!busy && (
            <div style={{ color: border, fontSize: 11, fontFamily: mono, marginTop: 6 }}>
              MP3 · WAV · OGG · FLAC · M4A · AAC
            </div>
          )}
        </>
      )}
    </div>
  );
}

function FileChip({ file, onReplace }) {
  const ref = useRef(null);
  const kb = (file.size / 1024).toFixed(1);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "8px 12px", background: elevated,
      border: `1px solid ${border}`, borderRadius: 4, marginBottom: 18,
      fontFamily: mono,
    }}>
      <span style={{ color: amber, fontSize: 14 }}>◈</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, color: text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{file.name}</div>
        <div style={{ fontSize: 10, color: muted, marginTop: 2 }}>{kb} KB LOADED</div>
      </div>
      <button
        className="ghost-btn"
        onClick={() => ref.current?.click()}
        style={{
          background: "none", border: `1px solid ${border}`,
          color: muted, borderRadius: 2, padding: "3px 10px",
          fontSize: 10, fontFamily: mono, letterSpacing: "0.08em",
          transition: "all 0.15s",
        }}
      >SWAP</button>
      <input ref={ref} type="file" accept="audio/*" style={{ display: "none" }}
        onChange={e => { const f = e.target.files[0]; if (f) { onReplace(f); e.target.value = ""; } }} />
    </div>
  );
}

function CapacityBar({ msgBytes, capacity }) {
  const pct = Math.min(100, (msgBytes / capacity) * 100);
  const over = msgBytes > capacity;
  const color = over ? red : pct > 80 ? "#f59e0b" : green;
  return (
    <div style={{ marginTop: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 10, fontFamily: mono, color: muted, letterSpacing: "0.06em" }}>
          CAPACITY USED
        </span>
        <span style={{ fontSize: 10, fontFamily: mono, color: over ? red : muted }}>
          {msgBytes.toLocaleString()} / {capacity.toLocaleString()} B
        </span>
      </div>
      <div style={{ background: elevated, borderRadius: 1, height: 3, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${pct}%`,
          background: color, transition: "width 0.25s, background 0.25s",
        }} />
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   ENCODE PANEL
   ════════════════════════════════════════════════════════ */

function EncodePanel({ ctx }) {
  const [file, setFile] = useState(null);
  const [audioBuf, setAudioBuf] = useState(null);
  const [capacity, setCapacity] = useState(null);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);

  async function loadFile(f) {
    setBusy(true); setStatus(null); setCapacity(null); setAudioBuf(null);
    try {
      const ab = await ctx().decodeAudioData(await f.arrayBuffer());
      const cap = capacityBytes(ab);
      setFile(f); setAudioBuf(ab); setCapacity(cap);
      setStatus({
        type: "info",
        msg: `CARRIER LOADED: ${ab.duration.toFixed(2)}s · ${ab.sampleRate} Hz · ${ab.numberOfChannels}ch · CAPACITY: ${cap.toLocaleString()} bytes (${(cap / 1024).toFixed(1)} KB)`,
      });
    } catch (e) {
      setStatus({ type: "error", msg: `DECODE FAILURE: ${e.message}` });
    }
    setBusy(false);
  }

  async function handleEncode() {
    if (!audioBuf || !message.trim()) return;
    setBusy(true); setStatus(null);
    try {
      const wavBuf = stegEncode(audioBuf, message);
      const blob = new Blob([wavBuf], { type: "audio/wav" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name.replace(/\.[^.]+$/, "") + "_stego.wav";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setStatus({ type: "success", msg: `TRANSMISSION ENCODED: payload concealed in ${file.name}. WAV file exported.` });
    } catch (e) {
      setStatus({ type: "error", msg: e.message });
    }
    setBusy(false);
  }

  const handlers = {
    onDragOver: e => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); },
  };

  const msgBytes = new TextEncoder().encode(message).length;
  const over = capacity !== null && msgBytes > capacity;
  const canGo = !!audioBuf && message.trim().length > 0 && !over && !busy;

  return (
    <div style={{ animation: "fadeUp 0.25s ease" }}>
      <Label>01 · SELECT CARRIER AUDIO</Label>
      {file
        ? <FileChip file={file} onReplace={loadFile} />
        : <DropZone drag={drag} handlers={handlers} onFile={loadFile} accept="audio/*" busy={busy}
            hint="DROP AUDIO FILE OR CLICK TO BROWSE" />
      }

      <StatusBar type={status?.type} msg={status?.msg} onClear={() => setStatus(null)} />

      <Label>02 · COMPOSE SECRET PAYLOAD</Label>
      <div style={{ position: "relative", marginBottom: 4 }}>
        <div style={{
          position: "absolute", top: "10px", left: "12px",
          color: amber, fontFamily: mono, fontSize: 12, userSelect: "none", pointerEvents: "none",
        }}>{">"}</div>
        <textarea
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder={`Type your secret message here…\nAll processing is local — nothing leaves your device.`}
          rows={7}
          style={{
            width: "100%", background: elevated,
            border: `1px solid ${over ? red : message ? amber + "55" : border}`,
            borderRadius: 4, padding: "10px 12px 10px 28px",
            color: text, fontSize: 12, fontFamily: mono, lineHeight: 1.7,
            transition: "border-color 0.2s", caretColor: amber,
          }}
        />
      </div>
      {capacity !== null && <CapacityBar msgBytes={msgBytes} capacity={capacity} />}

      <div style={{ height: 20 }} />

      <Label>03 · ENCODE &amp; EXPORT</Label>
      <button
        className="encode-btn"
        onClick={handleEncode}
        disabled={!canGo}
        style={{
          width: "100%", padding: "12px 16px", borderRadius: 4,
          border: `1px solid ${canGo ? amber : border}`,
          background: canGo ? amber + "18" : "transparent",
          color: canGo ? amber : muted,
          fontFamily: mono, fontWeight: 700, fontSize: 13,
          letterSpacing: "0.1em", transition: "all 0.2s",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "ENCODING…" : "⇩ DOWNLOAD STEGO WAV"}
      </button>

      <div style={{ marginTop: 10, color: muted, fontFamily: mono, fontSize: 10, lineHeight: 1.6 }}>
        OUTPUT FORMAT: 16-bit PCM WAV · LSB channel-0 encoding · MP3 re-encode not possible (lossy)
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   DECODE PANEL
   ════════════════════════════════════════════════════════ */

function DecodePanel({ ctx }) {
  const [file, setFile] = useState(null);
  const [decoded, setDecoded] = useState("");
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [copied, setCopied] = useState(false);

  async function loadFile(f) {
    setBusy(true); setStatus(null); setDecoded(""); setFile(null);
    try {
      const ab = await ctx().decodeAudioData(await f.arrayBuffer());
      const msg = stegDecode(ab);
      setFile(f); setDecoded(msg);
      setStatus({ type: "success", msg: `PAYLOAD RECOVERED FROM: ${f.name} · ${msg.length.toLocaleString()} chars · ${new TextEncoder().encode(msg).length.toLocaleString()} bytes` });
    } catch (e) {
      setStatus({ type: "error", msg: e.message });
    }
    setBusy(false);
  }

  function copy() {
    navigator.clipboard.writeText(decoded).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const handlers = {
    onDragOver: e => { e.preventDefault(); setDrag(true); },
    onDragLeave: () => setDrag(false),
    onDrop: e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) loadFile(f); },
  };

  return (
    <div style={{ animation: "fadeUp 0.25s ease" }}>
      <Label>01 · LOAD STEGO AUDIO</Label>
      <DropZone drag={drag} handlers={handlers} onFile={loadFile} accept="audio/*" busy={busy}
        hint="DROP ENCODED WAV FILE TO EXTRACT PAYLOAD" />

      <StatusBar type={status?.type} msg={status?.msg} onClear={() => setStatus(null)} />

      {decoded ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <Label style={{ margin: 0 }}>02 · RECOVERED PAYLOAD</Label>
            <button
              className="ghost-btn"
              onClick={copy}
              style={{
                background: "none", border: `1px solid ${border}`,
                color: copied ? green : muted, borderRadius: 2,
                padding: "3px 12px", fontSize: 10, fontFamily: mono,
                letterSpacing: "0.08em", transition: "all 0.15s",
              }}
            >{copied ? "✓ COPIED" : "COPY"}</button>
          </div>
          <div style={{
            background: elevated, border: `1px solid ${green}44`,
            borderRadius: 4, padding: "14px 16px",
            color: green, fontSize: 12, fontFamily: mono,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            maxHeight: 360, overflowY: "auto", lineHeight: 1.8,
            boxShadow: `0 0 30px ${green}08`,
          }}>
            {decoded}
          </div>
          <div style={{ marginTop: 8, color: muted, fontFamily: mono, fontSize: 10, display: "flex", justifyContent: "space-between" }}>
            <span>END OF TRANSMISSION</span>
            <button
              className="ghost-btn"
              onClick={() => { setFile(null); setDecoded(""); setStatus(null); }}
              style={{ background: "none", border: "none", color: muted, fontFamily: mono, fontSize: 10, padding: 0, transition: "color 0.15s" }}
            >
              [ CLEAR ]
            </button>
          </div>
        </>
      ) : !busy && !status && (
        <div style={{ textAlign: "center", color: border, fontFamily: mono, fontSize: 11, padding: "16px 0", letterSpacing: "0.08em" }}>
          AWAITING INPUT · CARRIER NOT LOADED
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   SHARED COMPONENTS
   ════════════════════════════════════════════════════════ */

function Label({ children, style }) {
  return (
    <div style={{
      fontSize: 10, fontFamily: mono, color: amber,
      letterSpacing: "0.12em", marginBottom: 10,
      borderLeft: `2px solid ${amber}`,
      paddingLeft: 8, ...style,
    }}>
      {children}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   ABOUT DRAWER
   ════════════════════════════════════════════════════════ */

function AboutDrawer() {
  return (
    <details style={{ background: surface, border: `1px solid ${border}`, borderRadius: 4, padding: "12px 16px", marginTop: 16 }}>
      <summary style={{ cursor: "pointer", fontFamily: mono, fontSize: 10, color: muted, letterSpacing: "0.1em", userSelect: "none" }}>
        ▸ TECHNICAL BRIEFING · HOW LSB STEGANOGRAPHY WORKS
      </summary>
      <div style={{ marginTop: 14, fontFamily: mono, fontSize: 11, color: muted, lineHeight: 1.9, borderTop: `1px solid ${border}`, paddingTop: 14 }}>
        <p style={{ margin: "0 0 10px", color: text + "aa" }}>
          <span style={{ color: amber }}>METHOD:</span> Least Significant Bit (LSB) steganography
        </p>
        <p style={{ margin: "0 0 10px" }}>
          Each digital audio sample is a 16-bit integer (−32768 to 32767). Flipping the final bit shifts the
          amplitude by exactly 1 — a change of {"<"}0.003%. To human ears: indistinguishable from the original.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          <span style={{ color: amber }}>ENCODING:</span> Your MP3/WAV is decoded to raw PCM via the Web Audio API.
          The message is prepended with a 32-bit length header, then each bit is written into the LSB of successive
          samples on channel 0. Output is exported as lossless 16-bit PCM WAV.
        </p>
        <p style={{ margin: "0 0 10px" }}>
          <span style={{ color: amber }}>WHY NOT MP3?</span> MP3 is lossy — re-encoding discards the LSB modifications.
          The steganographic data survives only in lossless formats (WAV, FLAC, AIFF).
        </p>
        <p style={{ margin: 0 }}>
          <span style={{ color: amber }}>CAPACITY:</span> 44,100 Hz mono audio holds ~330 KB/min.
          A 3-minute song carrier can conceal ~1 MB of payload. All computation is client-side;
          no data is transmitted to any server.
        </p>
      </div>
    </details>
  );
}

/* ════════════════════════════════════════════════════════
   APP SHELL
   ════════════════════════════════════════════════════════ */

export default function App() {
  const [tab, setTab] = useState("encode");
  const ctxRef = useRef(null);

  function getCtx() {
    if (!ctxRef.current) {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctxRef.current;
  }

  // Blinking cursor state
  const [cursorOn, setCursorOn] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setCursorOn(v => !v), 530);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <style>{globalCSS}</style>
      <Scanlines />

      <div style={{
        minHeight: "100vh", background: bg, color: text,
        fontFamily: mono, padding: "32px 16px",
        backgroundImage: `radial-gradient(ellipse at 50% 0%, #1a0f0020 0%, transparent 70%)`,
      }}>
        <div style={{ maxWidth: 660, margin: "0 auto" }}>

          {/* ── Header ── */}
          <div style={{ marginBottom: 36 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 0, marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: muted, letterSpacing: "0.2em", marginRight: 16 }}>
                SYS/CRYPTO
              </span>
              <span style={{ color: border, marginRight: 16 }}>·</span>
              <h1 style={{
                margin: 0, fontSize: 28, fontWeight: 700,
                letterSpacing: "0.18em", color: amber,
                textShadow: `0 0 40px ${amber}44`,
              }}>
                AUDIOSTEG
              </h1>
              <span style={{
                marginLeft: 3, color: amber,
                opacity: cursorOn ? 1 : 0,
                fontSize: 26, lineHeight: 1,
              }}>█</span>
            </div>
            <p style={{ margin: 0, fontSize: 11, color: muted, letterSpacing: "0.06em", lineHeight: 1.6 }}>
              COVERT CHANNEL UTILITY · LSB AUDIO STEGANOGRAPHY · CLIENT-SIDE ONLY
            </p>
            <div style={{ marginTop: 12, height: 1, background: `linear-gradient(90deg, ${amber}44, transparent)` }} />
          </div>

          {/* ── Mode selector ── */}
          <div style={{ display: "flex", gap: 0, marginBottom: 24, border: `1px solid ${border}`, borderRadius: 4, overflow: "hidden" }}>
            {[["encode", "⊕ ENCODE"], ["decode", "⊖ DECODE"]].map(([id, label]) => (
              <button
                key={id}
                className="tab-btn"
                onClick={() => setTab(id)}
                style={{
                  flex: 1, padding: "11px", border: "none",
                  borderRight: id === "encode" ? `1px solid ${border}` : "none",
                  background: tab === id ? amber + "18" : "transparent",
                  color: tab === id ? amber : muted,
                  fontFamily: mono, fontWeight: 700, fontSize: 12,
                  letterSpacing: "0.12em", transition: "all 0.15s",
                  borderBottom: tab === id ? `1px solid ${amber}` : "1px solid transparent",
                  marginBottom: -1,
                }}
              >{label}</button>
            ))}
          </div>

          {/* ── Panel ── */}
          <div style={{ background: surface, border: `1px solid ${border}`, borderRadius: 4, padding: "24px 22px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <span style={{ fontSize: 10, color: muted, letterSpacing: "0.1em" }}>
                {tab === "encode" ? "ENCODE MODE · HIDE PAYLOAD IN CARRIER" : "DECODE MODE · EXTRACT PAYLOAD FROM CARRIER"}
              </span>
              <span style={{ fontSize: 10, color: border, fontFamily: mono }}>
                {new Date().toISOString().slice(0, 10)}
              </span>
            </div>

            {tab === "encode"
              ? <EncodePanel ctx={getCtx} />
              : <DecodePanel ctx={getCtx} />
            }
          </div>

          <AboutDrawer />

          <div style={{ marginTop: 20, textAlign: "center", fontSize: 10, color: border, letterSpacing: "0.1em" }}>
            ALL OPERATIONS EXECUTE LOCALLY · ZERO NETWORK TRANSMISSION · NO SERVER CONTACT
          </div>
        </div>
      </div>
    </>
  );
}
