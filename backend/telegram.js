'use strict';
const https = require('node:https');

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const PLAN_ID = /^[A-Za-z0-9_-]{1,128}$/;
const METHODS = new Set(['getMe', 'getWebhookInfo', 'getUpdates', 'getFile', 'sendMessage']);

class TelegramError extends Error {
  constructor(code = 'REQUEST_FAILED', status) {
    super('Telegram request failed.');
    this.name = 'TelegramError';
    this.code = code;
    if (Number.isInteger(status)) this.status = status;
  }
}

function identity(value) {
  const id = String(value ?? '');
  return /^[1-9][0-9]{0,15}$/.test(id) && Number.isSafeInteger(Number(id)) ? id : null;
}

function validDocument(document) {
  return document && typeof document.file_id === 'string' && /^[A-Za-z0-9_-]{1,512}$/.test(document.file_id) &&
    typeof document.file_name === 'string' && document.file_name.length <= 255 &&
    !/[\\/\x00-\x1f\x7f]/.test(document.file_name) && /\.xlsx$/i.test(document.file_name) &&
    Number.isSafeInteger(document.file_size) && document.file_size > 0 && document.file_size <= MAX_FILE_BYTES;
}

const count = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
function createTelegramHandler({service, api, person, residents = [], calendarId, allowedChatId, allowedUserId}) {
  const chatId = identity(allowedChatId), userId = identity(allowedUserId);
  if (!chatId || !userId || typeof service?.preview !== 'function' || typeof service?.apply !== 'function' ||
      typeof api?.call !== 'function' || typeof api?.downloadFile !== 'function') throw Error('Invalid Telegram configuration.');
  const seen = new Set();
  let pending = Promise.resolve();
  const send = text => api.call('sendMessage', {chat_id: chatId, text});

  async function processUpdate(update) {
    const message = update?.message;
    if (message?.chat?.type !== 'private' || identity(message.chat.id) !== chatId ||
        identity(message.from?.id) !== userId || message.from?.is_bot === true) return;
    if (!Number.isSafeInteger(update.update_id) || update.update_id < 0 || seen.has(update.update_id)) return;
    seen.add(update.update_id);
    if (seen.size > 2048) seen.delete(seen.values().next().value);
    const channel = `telegram:${chatId}:${userId}`;
    try {
      if (message.document) {
        if (!validDocument(message.document)) {
          await send('Send an .xlsx document up to 8 MiB with valid file metadata.');
          return;
        }
        const bytes = await api.downloadFile(message.document.file_id, MAX_FILE_BYTES);
        if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_FILE_BYTES || bytes.length !== message.document.file_size) {
          throw Error('Invalid download.');
        }
        const plan = await service.preview(bytes, {person, residents, calendarId, channel});
        const counts = plan?.counts || {};
        const summary = `Preview: create ${count(counts.create)}, update ${count(counts.update)}, adopt ${count(counts.adopt)}, unchanged ${count(counts.noop ?? counts.unchanged)}, review ${count(counts.review)}.`;
        if (plan?.writesEnabled !== true) {
          await send(`${summary}\nCalendar writing is disabled. Apply is unavailable.`);
        } else if (plan?.blocked !== false || count(counts.review) > 0 || typeof plan?.planId !== 'string' || !PLAN_ID.test(plan.planId)) {
          await send(`${summary}\nReview required. Apply is unavailable.`);
        } else {
          await send(`${summary}\nTo approve: /aer_apply ${plan.planId}`);
        }
        return;
      }
      if (typeof message.text !== 'string' || !message.text.startsWith('/aer_apply')) return;
      const match = /^\/aer_apply ([A-Za-z0-9_-]{1,128})$/.exec(message.text.trim());
      if (!match) {
        await send('Use /aer_apply PLANID from an unblocked preview.');
        return;
      }
      const result = await service.apply(match[1], {channel});
      if (!result || result.blocked || result.error || (Array.isArray(result.errors) ? result.errors.length : result.errors)) {
        throw Error('Apply incomplete.');
      }
      await send(`Applied: created ${count(result.created)}, updated ${count(result.updated)}, unchanged ${count(result.unchanged)}, adopted ${count(result.adopted)}.`);
    } catch {
      // Never include parser, Calendar, HTTP, file, or authentication diagnostics in chat.
      try { await send('Request could not be completed; some Calendar changes may already exist. Review a fresh preview before applying.'); } catch {}
    }
  }

  return function handleUpdate(update) {
    const task = pending.then(() => processUpdate(update));
    pending = task.catch(() => {});
    return task;
  };
}

function safeFilePath(value) {
  return typeof value === 'string' && value.length <= 512 &&
    /^(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9_-][A-Za-z0-9_.-]*\.xlsx$/i.test(value) &&
    value.split('/').every(part => part !== '.' && part !== '..');
}

function createTelegramApi({token, request = https.request, timeoutMs = 45000} = {}) {
  if (typeof token !== 'string' || !/^[0-9]+:[A-Za-z0-9_-]+$/.test(token) || token.length > 256 ||
      !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new TelegramError('CONFIGURATION');

  // Fixed HTTPS origin, no redirects, no user-supplied URL or proxy transport.
  function transfer(route, body, maxBytes) {
    return new Promise((resolve, reject) => {
      let req, response, settled = false;
      const finish = (error, bytes) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          reject(error);
          response?.destroy();
          req?.destroy();
        } else resolve(bytes);
      };
      const timer = setTimeout(() => finish(new TelegramError('TIMEOUT')), timeoutMs);
      try {
        req = request({protocol: 'https:', hostname: 'api.telegram.org', port: 443, path: route,
          method: body === undefined ? 'GET' : 'POST', rejectUnauthorized: true,
          headers: body === undefined ? {} : {'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body)}}, res => {
          response = res;
          if (settled) { res.destroy(); return; }
          // Do not surface Telegram's error bodies or redirect locations.
          res.on('error', () => finish(new TelegramError()));
          if (res.statusCode < 200 || res.statusCode >= 300) {
            finish(new TelegramError(res.statusCode === 409 ? 'POLLING_CONFLICT' : 'HTTP_ERROR', res.statusCode));
            return;
          }
          const declared = res.headers['content-length'];
          if (declared !== undefined && (!/^[0-9]+$/.test(String(declared)) || Number(declared) > maxBytes)) {
            finish(new TelegramError('RESPONSE_TOO_LARGE')); return;
          }
          let size = 0;
          const chunks = [];
          res.on('data', chunk => {
            if (settled) return;
            size += chunk.length;
            if (size > maxBytes) { finish(new TelegramError('RESPONSE_TOO_LARGE')); return; }
            chunks.push(Buffer.from(chunk));
          });
          res.on('aborted', () => finish(new TelegramError()));
          res.on('end', () => {
            if (declared !== undefined && size !== Number(declared)) { finish(new TelegramError()); return; }
            finish(null, Buffer.concat(chunks, size));
          });
          res.on('close', () => { if (!res.complete) finish(new TelegramError()); });
        });
        req.on('error', () => finish(new TelegramError()));
        req.end(body);
      } catch { finish(new TelegramError()); }
    });
  }

  async function call(method, params = {}) {
    if (!METHODS.has(method)) throw new TelegramError('METHOD_NOT_ALLOWED');
    let body;
    try { body = JSON.stringify(params); } catch { throw new TelegramError(); }
    const bytes = await transfer(`/bot${token}/${method}`, body, 1024 * 1024);
    let reply;
    try { reply = JSON.parse(bytes.toString('utf8')); } catch { throw new TelegramError(); }
    if (reply?.ok !== true) {
      throw new TelegramError(reply?.error_code === 409 ? 'POLLING_CONFLICT' : 'API_ERROR',
        reply?.error_code === 409 ? 409 : undefined);
    }
    return reply.result;
  }

  async function downloadFile(fileId, maxBytes = MAX_FILE_BYTES) {
    if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(fileId) ||
        !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_FILE_BYTES) throw new TelegramError('INVALID_FILE');
    const file = await call('getFile', {file_id: fileId});
    if (!safeFilePath(file?.file_path) || (file.file_size !== undefined &&
        (!Number.isSafeInteger(file.file_size) || file.file_size < 1 || file.file_size > maxBytes))) throw new TelegramError('INVALID_FILE');
    const bytes = await transfer(`/file/bot${token}/${file.file_path}`, undefined, maxBytes);
    if (!bytes.length || (file.file_size !== undefined && bytes.length !== file.file_size)) throw new TelegramError('INVALID_FILE');
    return bytes;
  }
  return {call, downloadFile};
}

module.exports = {MAX_FILE_BYTES, TelegramError, createTelegramHandler, createTelegramApi, safeFilePath};
