'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {randomBytes} = require('node:crypto');
const {createTelegramApi, createTelegramHandler} = require('./telegram');
const {readPrivateJSON} = require('./state');

class RunnerError extends Error {
  constructor(code) {
    super('Telegram receiver stopped. Check private configuration and polling ownership.');
    this.name = 'RunnerError';
    this.code = code;
  }
}
const inside = (root, child) => child === root || child.startsWith(root + path.sep);
const validOffset = value => Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER;

function readConfig(env = process.env) {
  if (env.AER_TELEGRAM_EXCLUSIVE_POLLING !== '1') throw new RunnerError('POLLING_OPT_IN_REQUIRED');
  const required = ['AER_TELEGRAM_EXPECTED_BOT_USERNAME',
    'AER_TELEGRAM_ALLOWED_CHAT_ID', 'AER_TELEGRAM_ALLOWED_USER_ID', 'AER_TELEGRAM_STATE_DIR', 'AER_PERSON', 'AER_CALENDAR_ID'];
  if (required.some(key => typeof env[key] !== 'string' || !env[key].trim())) throw new RunnerError('CONFIGURATION');
  const validId = value => /^[1-9][0-9]{0,15}$/.test(value) && Number.isSafeInteger(Number(value));
  let residents;
  try { residents = JSON.parse(env.AER_RESIDENTS || '[]'); } catch { throw new RunnerError('CONFIGURATION'); }
  if (!validId(env.AER_TELEGRAM_ALLOWED_CHAT_ID) || !validId(env.AER_TELEGRAM_ALLOWED_USER_ID) ||
      !/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(env.AER_TELEGRAM_EXPECTED_BOT_USERNAME) ||
      !path.isAbsolute(env.AER_TELEGRAM_STATE_DIR) || env.AER_CALENDAR_ID === 'primary' ||
      !Array.isArray(residents) || residents.some(name => typeof name !== 'string' || name.length > 100) ||
      env.AER_PERSON.length > 100) throw new RunnerError('CONFIGURATION');
  const hasToken = env.AER_TELEGRAM_BOT_TOKEN !== undefined;
  const hasTokenFile = env.AER_TELEGRAM_BOT_TOKEN_FILE !== undefined;
  if (hasToken === hasTokenFile) throw new RunnerError('CONFIGURATION');
  let token;
  try {
    token = hasTokenFile ? readPrivateJSON(env.AER_TELEGRAM_BOT_TOKEN_FILE)?.token : env.AER_TELEGRAM_BOT_TOKEN;
  } catch { throw new RunnerError('CONFIGURATION'); }
  if (typeof token !== 'string' || !/^[0-9]+:[A-Za-z0-9_-]+$/.test(token) || token.length > 256) {
    throw new RunnerError('CONFIGURATION');
  }
  return {token, expectedBotUsername: env.AER_TELEGRAM_EXPECTED_BOT_USERNAME.replace(/^@/, ''),
    allowedChatId: env.AER_TELEGRAM_ALLOWED_CHAT_ID, allowedUserId: env.AER_TELEGRAM_ALLOWED_USER_ID,
    stateDir: env.AER_TELEGRAM_STATE_DIR, person: env.AER_PERSON, residents, calendarId: env.AER_CALENDAR_ID};
}

function privateFile(stat) {
  return stat.isFile() && stat.nlink === 1 && (stat.mode & 0o777) === 0o600 &&
    (typeof process.getuid !== 'function' || stat.uid === process.getuid());
}

function openPollingState({stateDir, checkoutDir = path.resolve(__dirname, '..')}) {
  let lockFd, directoryFd, lockPath, ownLock = false;
  const flags = fs.constants;
  try {
    if (!path.isAbsolute(stateDir)) throw new RunnerError('UNSAFE_STATE');
    const checkout = fs.realpathSync(checkoutDir);
    const requested = path.resolve(stateDir);
    if (inside(checkout, requested)) throw new RunnerError('UNSAFE_STATE');
    // Resolve the nearest existing ancestor before creating anything, including through aliases.
    let ancestor = requested;
    while (!fs.existsSync(ancestor)) ancestor = path.dirname(ancestor);
    const destination = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, requested));
    if (inside(checkout, destination)) throw new RunnerError('UNSAFE_STATE');
    fs.mkdirSync(requested, {recursive: true, mode: 0o700});
    const directory = fs.lstatSync(requested);
    const realDirectory = fs.realpathSync(requested);
    if (directory.isSymbolicLink() || inside(checkout, realDirectory) || !directory.isDirectory() ||
        (directory.mode & 0o777) !== 0o700 ||
        (typeof process.getuid === 'function' && directory.uid !== process.getuid())) throw new RunnerError('UNSAFE_STATE');
    directoryFd = fs.openSync(realDirectory, flags.O_RDONLY | flags.O_DIRECTORY | flags.O_NOFOLLOW);
    lockPath = path.join(realDirectory, 'polling.lock');
    lockFd = fs.openSync(lockPath, flags.O_WRONLY | flags.O_CREAT | flags.O_EXCL | flags.O_NOFOLLOW, 0o600);
    ownLock = true;
    if (!privateFile(fs.fstatSync(lockFd))) throw new RunnerError('UNSAFE_STATE');
    fs.writeFileSync(lockFd, JSON.stringify({pid: process.pid}));
    fs.fsyncSync(lockFd);
    const offsetPath = path.join(realDirectory, 'offset.json');
    let offset = 0;
    try {
      const offsetFd = fs.openSync(offsetPath, flags.O_RDONLY | flags.O_NOFOLLOW);
      try {
        const stat = fs.fstatSync(offsetFd);
        if (!privateFile(stat) || stat.size > 128) throw new RunnerError('UNSAFE_STATE');
        const saved = JSON.parse(fs.readFileSync(offsetFd, 'utf8'));
        if (!validOffset(saved.offset)) throw new RunnerError('UNSAFE_STATE');
        offset = saved.offset;
      } finally { fs.closeSync(offsetFd); }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    let closed = false;
    return {
      get offset() { return offset; },
      save(next) {
        if (closed || !validOffset(next) || next < offset) throw new RunnerError('INVALID_OFFSET');
        const temp = path.join(realDirectory, `.offset-${randomBytes(12).toString('hex')}`);
        let tempFd;
        try {
          tempFd = fs.openSync(temp, flags.O_WRONLY | flags.O_CREAT | flags.O_EXCL | flags.O_NOFOLLOW, 0o600);
          if (!privateFile(fs.fstatSync(tempFd))) throw new RunnerError('UNSAFE_STATE');
          fs.writeFileSync(tempFd, JSON.stringify({offset: next}));
          fs.fsyncSync(tempFd);
          fs.closeSync(tempFd); tempFd = undefined;
          fs.renameSync(temp, offsetPath);
          fs.fsyncSync(directoryFd);
          offset = next;
        } catch {
          throw new RunnerError('STATE_WRITE_FAILED');
        } finally {
          if (tempFd !== undefined) fs.closeSync(tempFd);
          try { fs.unlinkSync(temp); } catch {}
        }
      },
      close() {
        if (closed) return;
        closed = true;
        // Only remove our own lock; stale locks deliberately require operator review.
        const held = fs.fstatSync(lockFd);
        const current = fs.lstatSync(lockPath);
        if (held.ino === current.ino && held.dev === current.dev) fs.unlinkSync(lockPath);
        fs.closeSync(lockFd);
        fs.closeSync(directoryFd);
      }
    };
  } catch (error) {
    if (ownLock) { try { fs.unlinkSync(lockPath); } catch {} }
    if (lockFd !== undefined) fs.closeSync(lockFd);
    if (directoryFd !== undefined) fs.closeSync(directoryFd);
    throw new RunnerError(error.code === 'EEXIST' ? 'POLLING_LOCKED' : 'UNSAFE_STATE');
  }
}

async function checkPollingOwnership(api, expectedBotUsername) {
  try {
    if (typeof expectedBotUsername !== 'string' || !expectedBotUsername) throw new RunnerError('BOT_MISMATCH');
    const me = await api.call('getMe', {});
    if (me?.is_bot !== true || typeof me.username !== 'string' ||
        me.username.toLowerCase() !== expectedBotUsername.replace(/^@/, '').toLowerCase()) throw new RunnerError('BOT_MISMATCH');
    const webhook = await api.call('getWebhookInfo', {});
    if (webhook?.url !== '') throw new RunnerError('WEBHOOK_CONFIGURED');
  } catch (error) {
    if (error instanceof RunnerError) throw error;
    throw new RunnerError(error?.status === 409 ? 'POLLING_CONFLICT' : 'OWNERSHIP_CHECK_FAILED');
  }
}

async function pollUpdates({api, handleUpdate, state, signal, maxPolls = Infinity}) {
  try {
    for (let poll = 0; poll < maxPolls && !signal?.aborted; poll++) {
      const updates = await api.call('getUpdates', {offset: state.offset, timeout: 25, limit: 100, allowed_updates: ['message']});
      if (!Array.isArray(updates) || updates.length > 100 || updates.some(update => !validOffset(update?.update_id))) {
        throw new RunnerError('INVALID_UPDATES');
      }
      for (const update of [...updates].sort((a, b) => a.update_id - b.update_id)) {
        if (signal?.aborted) return;
        if (update.update_id < state.offset) continue;
        // Claim durably before side effects: a crash may lose this update, but cannot replay an apply.
        state.save(update.update_id + 1);
        await handleUpdate(update);
      }
    }
  } catch (error) {
    if (error instanceof RunnerError) throw error;
    throw new RunnerError(error?.status === 409 || error?.code === 'POLLING_CONFLICT' ? 'POLLING_CONFLICT' : 'POLLING_FAILED');
  }
}

async function runTelegramReceiver({env = process.env, api, createRuntime, signal, maxPolls = Infinity} = {}) {
  const config = readConfig(env);
  const state = openPollingState({stateDir: config.stateDir});
  try {
    api ||= createTelegramApi({token: config.token});
    await checkPollingOwnership(api, config.expectedBotUsername);
    // Import lazily: requiring this module or checking ownership never starts the writer.
    const runtime = await (createRuntime || require('./runtime').createRuntime)();
    const service = runtime.service;
    const handleUpdate = createTelegramHandler({...config, service, api});
    await pollUpdates({api, handleUpdate, state, signal, maxPolls});
  } catch (error) {
    if (error instanceof RunnerError) throw error;
    throw new RunnerError(error?.status === 409 ? 'POLLING_CONFLICT' : 'START_FAILED');
  } finally { state.close(); }
}

if (require.main === module) {
  const controller = new AbortController();
  process.once('SIGINT', () => controller.abort());
  process.once('SIGTERM', () => controller.abort());
  runTelegramReceiver({signal: controller.signal}).catch(() => {
    console.error('Telegram receiver stopped. Check private configuration and polling ownership.');
    process.exitCode = 1;
  });
}

module.exports = {RunnerError, readConfig, openPollingState, checkPollingOwnership, pollUpdates, runTelegramReceiver};
