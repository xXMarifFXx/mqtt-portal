'use strict';

const NOTICE_VERSION = '2026-08-13';

function settings(env = process.env) {
  const days = Number.parseInt(env.DATA_RETENTION_DAYS || '180', 10);
  return {
    controller: env.PRIVACY_CONTROLLER || 'Course instructor',
    contact: env.PRIVACY_CONTACT || 'Contact your course instructor',
    retentionDays: Number.isInteger(days) ? days : 180,
    noticeVersion: NOTICE_VERSION,
  };
}

function cutoffIso(days, now = new Date()) {
  return new Date(now.getTime() - days * 86400000).toISOString();
}

function isExpired(meta, days, now = new Date()) {
  if (!meta || !meta.createdAt) return false;
  const created = Date.parse(meta.createdAt);
  return Number.isFinite(created) && created < Date.parse(cutoffIso(days, now));
}

module.exports = { NOTICE_VERSION, settings, cutoffIso, isExpired };
