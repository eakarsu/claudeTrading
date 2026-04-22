import React, { useEffect, useState } from 'react';
import {
  me, changePassword, deleteAccount,
  enroll2fa, verify2fa, disable2fa, logout,
  listSessions, revokeSession,
  getWebhookSecret, rotateWebhookSecret, deleteWebhookSecret,
} from '../api';

/**
 * Account settings page.
 *
 * Three concerns, kept visually distinct:
 *   1. Profile summary (read-only — email + 2FA state)
 *   2. Security (password change, 2FA enroll/disable)
 *   3. Danger zone (delete account)
 *
 * 2FA enrollment is a two-step flow:
 *   a. click "Enable 2FA" → server returns otpauth URL + raw secret
 *   b. user enters a 6-digit code → server confirms + hands back backup codes
 * The backup codes are shown exactly once; we surface a prominent warning.
 */
export default function AccountSettings() {
  const [profile, setProfile] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  async function refresh() {
    try { setProfile(await me()); } catch (e) { setErr(e.message); }
  }
  useEffect(() => { refresh(); }, []);

  function flash(msg, isError) {
    if (isError) { setErr(msg); setOk(''); }
    else         { setOk(msg);  setErr(''); }
    setTimeout(() => { setErr(''); setOk(''); }, 4000);
  }

  if (!profile) return <div style={{ padding: 24, color: '#888' }}>Loading…</div>;

  return (
    <div style={{ padding: 24, maxWidth: 720 }}>
      <h2>Account Settings</h2>
      {err && <div style={banner('#400', '#fcc')}>{err}</div>}
      {ok &&  <div style={banner('#040', '#cfc')}>{ok}</div>}

      <Section title="Profile">
        <Row label="Email">{profile.email}</Row>
        <Row label="Name">{profile.name}</Row>
        <Row label="2FA">
          {profile.totpEnabled
            ? <span style={{ color: '#4c4' }}>Enabled ({profile.backupCodesRemaining} backup codes left)</span>
            : <span style={{ color: '#c84' }}>Disabled</span>}
        </Row>
      </Section>

      <Section title="Change password">
        <ChangePasswordForm onResult={flash} />
      </Section>

      <Section title="Two-factor authentication">
        {profile.totpEnabled
          ? <Disable2faForm onResult={(m, e) => { flash(m, e); if (!e) refresh(); }} />
          : <Enroll2faForm   onResult={(m, e) => { flash(m, e); if (!e) refresh(); }} />}
      </Section>

      <Section title="Active sessions">
        <SessionsList onResult={flash} />
      </Section>

      <Section title="Webhook ingress">
        <WebhookPanel onResult={flash} />
      </Section>

      <Section title="Danger zone" danger>
        <DeleteAccountForm onResult={flash} />
      </Section>
    </div>
  );
}

// ─── Active sessions ──────────────────────────────────────────────────────
function SessionsList({ onResult }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  async function refresh() {
    setLoading(true);
    try { setRows(await listSessions()); }
    catch (e) { onResult(e.message, true); }
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function onRevoke(id) {
    if (!window.confirm('Revoke this session? The device will be signed out on its next request.')) return;
    try {
      await revokeSession(id);
      onResult('Session revoked');
      refresh();
    } catch (e) { onResult(e.message, true); }
  }

  if (loading) return <div style={{ color: '#888' }}>Loading…</div>;
  if (!rows.length) return <div style={{ color: '#888' }}>No active sessions.</div>;

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {rows.map((s) => (
        <div key={s.id} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: 10, border: '1px solid #333', borderRadius: 6,
          background: s.current ? '#0d1b2a' : '#181818',
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ color: '#ddd', fontSize: 13 }}>
              {s.userAgent || 'Unknown device'}
              {s.current && <span style={{ marginLeft: 8, color: '#4c4', fontSize: 11 }}>● This device</span>}
            </div>
            <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
              IP {s.ip || '—'} · last seen {new Date(s.lastSeenAt).toLocaleString()} · expires {new Date(s.expiresAt).toLocaleDateString()}
            </div>
          </div>
          {!s.current && (
            <button style={btn} onClick={() => onRevoke(s.id)}>Revoke</button>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Webhook ingress ──────────────────────────────────────────────────────
function WebhookPanel({ onResult }) {
  const [state, setState] = useState({ loading: true, hasSecret: false, ingressUrl: '' });
  const [freshSecret, setFreshSecret] = useState(''); // shown exactly once after rotate
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const r = await getWebhookSecret();
      setState({ loading: false, hasSecret: r.hasSecret, ingressUrl: r.ingressUrl });
    } catch (e) {
      setState({ loading: false, hasSecret: false, ingressUrl: '' });
      onResult(e.message, true);
    }
  }
  useEffect(() => { load(); }, []);

  async function rotate() {
    if (state.hasSecret && !window.confirm('Rotating invalidates the current secret. External systems using it will start failing with 401. Continue?')) return;
    setBusy(true);
    try {
      const r = await rotateWebhookSecret();
      setFreshSecret(r.secret);
      setState((s) => ({ ...s, hasSecret: true, ingressUrl: r.ingressUrl }));
      onResult('Webhook secret generated. Copy it now — it will not be shown again.', false);
    } catch (e) { onResult(e.message, true); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!window.confirm('Delete the secret? Any existing webhook integration will stop working.')) return;
    setBusy(true);
    try {
      await deleteWebhookSecret();
      setFreshSecret('');
      setState((s) => ({ ...s, hasSecret: false }));
      onResult('Webhook secret removed.', false);
    } catch (e) { onResult(e.message, true); }
    finally { setBusy(false); }
  }

  if (state.loading) return <div style={{ color: '#888' }}>Loading…</div>;

  const fullUrl = `${window.location.origin}${state.ingressUrl}`;

  return (
    <div>
      <p style={{ color: '#aaa', marginTop: 0 }}>
        Let TradingView alerts, Python scripts, or Zapier post signed JSON payloads to your
        account without logging in. POST to the ingress URL with an HMAC-SHA256 signature
        of the raw body in <code>X-Signature: sha256=&lt;hex&gt;</code>.
      </p>

      <Row label="Ingress URL">
        <code style={{ color: '#9fc', wordBreak: 'break-all' }}>{fullUrl}</code>
      </Row>
      <Row label="Status">
        {state.hasSecret
          ? <span style={{ color: '#4c4' }}>Active</span>
          : <span style={{ color: '#c84' }}>No secret set</span>}
      </Row>

      {freshSecret && (
        <div style={{ margin: '12px 0' }}>
          <p style={{ color: '#fc4' }}>
            <strong>Copy this secret now.</strong> It is shown exactly once; store it in your
            alerting tool's secret manager.
          </p>
          <pre style={pre}>{freshSecret}</pre>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button onClick={rotate} disabled={busy} style={btn}>
          {busy ? 'Working…' : state.hasSecret ? 'Rotate secret' : 'Generate secret'}
        </button>
        {state.hasSecret && (
          <button onClick={remove} disabled={busy} style={{ ...btn, background: '#722' }}>
            Remove secret
          </button>
        )}
      </div>

      <details style={{ marginTop: 16, color: '#aaa' }}>
        <summary style={{ cursor: 'pointer' }}>Example payload &amp; signing</summary>
        <pre style={pre}>{`POST ${state.ingressUrl}
Content-Type: application/json
X-Signature: sha256=<hex HMAC-SHA256 of raw body>
X-Timestamp: <ms since epoch, optional replay guard>

{
  "symbol": "AAPL",
  "signalType": "buy",
  "strategy": "tradingview-alert",
  "entryPrice": 195.80,
  "targetPrice": 205.00,
  "stopPrice": 190.00,
  "timeframe": "1H",
  "confidence": 70,
  "notes": "Breakout above resistance"
}`}</pre>
        <p style={{ fontSize: 12 }}>
          Python quickstart:
        </p>
        <pre style={pre}>{`import hmac, hashlib, json, time, requests
body = json.dumps({"symbol":"AAPL","signalType":"buy"})
sig = hmac.new(SECRET.encode(), body.encode(), hashlib.sha256).hexdigest()
requests.post(URL, data=body, headers={
  "Content-Type": "application/json",
  "X-Signature": "sha256=" + sig,
  "X-Timestamp": str(int(time.time() * 1000)),
})`}</pre>
      </details>
    </div>
  );
}

// ─── Layout helpers ───────────────────────────────────────────────────────
function Section({ title, danger, children }) {
  return (
    <section style={{
      border: danger ? '1px solid #622' : '1px solid #333',
      borderRadius: 6, padding: 16, margin: '16px 0',
      background: danger ? '#1a0d0d' : '#151515',
    }}>
      <h3 style={{ marginTop: 0, color: danger ? '#f88' : '#ddd' }}>{title}</h3>
      {children}
    </section>
  );
}
function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 16, padding: '6px 0' }}>
      <div style={{ width: 140, color: '#999' }}>{label}</div>
      <div>{children}</div>
    </div>
  );
}
function banner(bg, fg) {
  return { background: bg, color: fg, padding: 10, borderRadius: 4, margin: '8px 0' };
}

// ─── Password change ──────────────────────────────────────────────────────
function ChangePasswordForm({ onResult }) {
  const [cur, setCur] = useState('');
  const [nw, setNw]   = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await changePassword(cur, nw);
      setCur(''); setNw('');
      onResult('Password updated.', false);
    } catch (err) { onResult(err.message, true); }
    finally { setBusy(false); }
  }
  return (
    <form onSubmit={submit}>
      <input type="password" placeholder="Current password" value={cur}
             onChange={(e) => setCur(e.target.value)} style={inp} />
      <input type="password" placeholder="New password (min 8 chars)" value={nw}
             onChange={(e) => setNw(e.target.value)} style={inp} />
      <button type="submit" disabled={busy || nw.length < 8} style={btn}>
        {busy ? 'Updating…' : 'Update password'}
      </button>
    </form>
  );
}

// ─── 2FA enroll ───────────────────────────────────────────────────────────
function Enroll2faForm({ onResult }) {
  const [step, setStep]       = useState('idle'); // idle | enrolling | verifying | done
  const [otpauth, setOtpauth] = useState('');
  const [secret, setSecret]   = useState('');
  const [code, setCode]       = useState('');
  const [backupCodes, setBackupCodes] = useState(null);

  async function startEnroll() {
    try {
      const { secret, otpauthUrl } = await enroll2fa();
      setSecret(secret); setOtpauth(otpauthUrl); setStep('verifying');
    } catch (e) { onResult(e.message, true); }
  }
  async function finishEnroll() {
    try {
      const { backupCodes } = await verify2fa(code);
      setBackupCodes(backupCodes); setStep('done');
      onResult('2FA enabled. Save your backup codes!', false);
    } catch (e) { onResult(e.message, true); }
  }

  if (step === 'idle') {
    return (
      <div>
        <p style={{ color: '#aaa' }}>
          Add a second factor — an authenticator app (Google Authenticator, 1Password, Authy).
        </p>
        <button onClick={startEnroll} style={btn}>Enable 2FA</button>
      </div>
    );
  }
  if (step === 'verifying') {
    return (
      <div>
        <p style={{ color: '#aaa' }}>
          1. Add this URL to your authenticator app — most apps let you paste an
             <code> otpauth:// </code> link directly, or scan it as a QR:
        </p>
        <pre style={pre}>{otpauth}</pre>
        <p style={{ color: '#777', fontSize: 12 }}>
          Manual entry key: <code>{secret}</code>
        </p>
        <p style={{ color: '#aaa' }}>2. Enter the 6-digit code the app shows:</p>
        <input value={code} onChange={(e) => setCode(e.target.value)}
               placeholder="123456" maxLength={6} style={inp} />
        <button onClick={finishEnroll} disabled={code.length !== 6} style={btn}>Verify + enable</button>
      </div>
    );
  }
  // step === 'done'
  return (
    <div>
      <p style={{ color: '#fc4' }}>
        <strong>Save these backup codes.</strong> They will not be shown again. Each code
        can be used once in place of a 2FA code.
      </p>
      <pre style={pre}>{backupCodes.join('\n')}</pre>
    </div>
  );
}

// ─── 2FA disable ──────────────────────────────────────────────────────────
function Disable2faForm({ onResult }) {
  const [password, setPassword] = useState('');
  const [code, setCode]         = useState('');
  async function submit(e) {
    e.preventDefault();
    try {
      await disable2fa(password, code);
      setPassword(''); setCode('');
      onResult('2FA disabled.', false);
    } catch (err) { onResult(err.message, true); }
  }
  return (
    <form onSubmit={submit}>
      <input type="password" placeholder="Password" value={password}
             onChange={(e) => setPassword(e.target.value)} style={inp} />
      <input placeholder="6-digit code or backup code" value={code}
             onChange={(e) => setCode(e.target.value)} style={inp} />
      <button type="submit" style={btn}>Disable 2FA</button>
    </form>
  );
}

// ─── Delete account ───────────────────────────────────────────────────────
function DeleteAccountForm({ onResult }) {
  const [password, setPassword] = useState('');
  const [confirmText, setConfirmText] = useState('');
  async function submit(e) {
    e.preventDefault();
    // window.confirm — shadowed if we named state `confirm`, so we renamed.
    if (!window.confirm('This cannot be undone. Delete your account and all data?')) return;
    try {
      await deleteAccount(password);
      await logout().catch(() => null);
      localStorage.removeItem('token');
      window.location.href = '/login';
    } catch (err) { onResult(err.message, true); }
  }
  return (
    <form onSubmit={submit}>
      <p style={{ color: '#aaa' }}>
        Removes your user row and all associated data. Open Alpaca positions are
        not closed — flatten your book first.
      </p>
      <input type="password" placeholder="Password" value={password}
             onChange={(e) => setPassword(e.target.value)} style={inp} />
      <input placeholder='Type "DELETE" to confirm'
             value={confirmText} onChange={(e) => setConfirmText(e.target.value)} style={inp} />
      <button type="submit" disabled={confirmText !== 'DELETE' || !password}
              style={{ ...btn, background: '#722' }}>Delete account</button>
    </form>
  );
}

// ─── Shared inline styles ────────────────────────────────────────────────
const inp = {
  display: 'block', margin: '6px 0', padding: 8, width: 320,
  background: '#0c0c0c', color: '#eee', border: '1px solid #333', borderRadius: 4,
};
const btn = {
  padding: '8px 14px', margin: '6px 0', border: 'none', borderRadius: 4,
  background: '#264', color: '#fff', cursor: 'pointer',
};
const pre = {
  background: '#0a0a0a', color: '#9fc', padding: 10, borderRadius: 4,
  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
};
