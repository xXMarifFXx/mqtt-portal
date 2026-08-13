'use strict';

function validateProductionEnv(env) {
  if (env.NODE_ENV !== 'production') return [];
  const errors = [];
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) errors.push('SESSION_SECRET must be at least 32 characters');
  if (!/^[0-9a-f]{16,}:[0-9a-f]{64}$/i.test(env.ADMIN_PASSWORD_HASH || '')) errors.push('ADMIN_PASSWORD_HASH is missing or invalid');
  if ((env.DYNSEC_MODE || 'real') !== 'real') errors.push('DYNSEC_MODE must be real in production');
  if (!env.DYNSEC_ADMIN_PASS || env.DYNSEC_ADMIN_PASS.length < 8) errors.push('DYNSEC_ADMIN_PASS must be at least 8 characters');
  if (!env.PUBLIC_BROKER_HOST || /your-broker|example\.com/i.test(env.PUBLIC_BROKER_HOST)) errors.push('PUBLIC_BROKER_HOST must be the real broker hostname');
  const port = Number(env.PUBLIC_BROKER_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PUBLIC_BROKER_PORT must be a valid port');
  try {
    const u = new URL(env.PUBLIC_BROKER_WSS_URL || '');
    if (u.protocol !== 'wss:') errors.push('PUBLIC_BROKER_WSS_URL must use wss://');
  } catch (_) { errors.push('PUBLIC_BROKER_WSS_URL must be a valid wss:// URL'); }
  if (env.COOKIE_SECURE === 'false') errors.push('COOKIE_SECURE cannot be false in production');
  const cap = Number(env.REGISTRATION_HOURLY_CAP || 200);
  if (!Number.isInteger(cap) || cap < 20 || cap > 5000) errors.push('REGISTRATION_HOURLY_CAP must be an integer from 20 to 5000');
  const retention = Number(env.DATA_RETENTION_DAYS || 180);
  if (!Number.isInteger(retention) || retention < 30 || retention > 730) errors.push('DATA_RETENTION_DAYS must be an integer from 30 to 730');
  if (!env.PRIVACY_CONTROLLER || env.PRIVACY_CONTROLLER.trim().length < 3) errors.push('PRIVACY_CONTROLLER must identify the course/institution responsible for the data');
  if (!env.PRIVACY_CONTACT || env.PRIVACY_CONTACT.trim().length < 5) errors.push('PRIVACY_CONTACT must provide a working privacy contact');
  return errors;
}

function assertProductionEnv(env) {
  const errors = validateProductionEnv(env);
  if (errors.length) throw new Error('Invalid production configuration:\n- ' + errors.join('\n- '));
}

module.exports = { validateProductionEnv, assertProductionEnv };
