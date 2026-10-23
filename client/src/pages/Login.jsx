import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, verifyTotpLogin } from '../api';
import { FiCpu, FiLogIn } from 'react-icons/fi';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // 2FA state. Set after /login when the server says the account is 2FA-gated;
  // the form then collects the 6-digit code (or a backup code) and finishes
  // the challenge before we store the session token.
  const [challenge, setChallenge] = useState('');
  const [totpCode, setTotpCode]   = useState('');
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await login(email, password);
      if (res.requires2FA) {
        setChallenge(res.challenge);
      } else {
        localStorage.setItem('token', res.token);
        navigate('/');
      }
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  const handleTotp = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await verifyTotpLogin(challenge, totpCode);
      localStorage.setItem('token', res.token);
      navigate('/');
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <FiCpu size={40} />
          <h1>Claude Trading</h1>
          <p>AI-Powered Stock Trading Platform</p>
        </div>
        {!challenge ? (
          <form onSubmit={handleLogin}>
            <div className="form-field">
              <label>Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Enter your email" required />
            </div>
            <div className="form-field">
              <label>Password</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required />
            </div>
            {error && <div className="error-msg">{error}</div>}
            <button
              type="button"
              onClick={async () => {
                if (import.meta.env.VITE_DEMO_EMAIL && import.meta.env.VITE_DEMO_PASSWORD) { setEmail(import.meta.env.VITE_DEMO_EMAIL); setPassword(import.meta.env.VITE_DEMO_PASSWORD); return; }
                try {
                  const response = await fetch('/api/auth/demo-credentials', { cache: 'no-store' });
                  if (response.ok) { const data = await response.json(); if (data?.email && data?.password) { setEmail(data.email); setPassword(data.password); return; } }
                } catch { /* fall through to message below */ }
                setError('Demo credentials are not configured for this environment.');
              }}
              aria-label="Fill demo credentials"
              style={{ width: '100%', marginBottom: '12px', padding: '10px 14px', borderRadius: '8px', border: '1px solid currentColor', background: 'transparent', cursor: 'pointer' }}
            >
              Fill demo credentials
            </button>
            <button type="submit" className="btn btn-primary btn-full" disabled={loading}>
              <FiLogIn size={18} /> {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleTotp}>
            <div className="form-field">
              <label>Two-factor code</label>
              <input
                type="text"
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="6-digit code or backup code"
                autoFocus
                required
              />
            </div>
            {error && <div className="error-msg">{error}</div>}
            <button type="submit" className="btn btn-primary btn-full" disabled={loading || totpCode.length < 6}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>
            <button
              type="button"
              className="btn btn-demo"
              onClick={() => { setChallenge(''); setTotpCode(''); setError(''); }}
            >
              Cancel
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
