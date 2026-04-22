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

  const fillDemo = () => {
    setEmail('trader@claude.ai');
    setPassword('trading123');
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
        {!challenge && (
          <button className="btn btn-demo" onClick={fillDemo}>
            Fill Demo Credentials
          </button>
        )}
      </div>
    </div>
  );
}
