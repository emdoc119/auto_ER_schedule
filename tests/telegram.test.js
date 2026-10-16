'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {MAX_FILE_BYTES, createTelegramHandler, createTelegramApi, TelegramError} = require('../backend/telegram');
const {RunnerError, readConfig, openPollingState, checkPollingOwnership, pollUpdates, runTelegramReceiver} = require('../backend/telegram-runner');

// All identities, workbook bytes, tokens, responses and transport events are synthetic.
const CHAT = '10101', USER = '20202', secret = 'synthetic-private-detail';
const bytes = Buffer.from('PK-synthetic-workbook');
const fakeToken = ['123', 'synthetic_test_only'].join(':');
function update(id = 1, changes = {}) {
  return {update_id: id, message: {chat: {id: Number(CHAT), type: 'private'}, from: {id: Number(USER)},
    document: {file_id: 'synthetic_file', file_name: 'schedule.xlsx', file_size: bytes.length}, ...changes}};
}
function fixture(overrides = {}) {
  const calls = [], previews = [], applies = [], downloads = [];
  const api = {call: async (method, params) => { calls.push({method, params}); },
    downloadFile: async (...args) => { downloads.push(args); return bytes; }, ...overrides.api};
  const service = {preview: async (...args) => { previews.push(args); return {
    planId: 'plan-123', blocked: false, writesEnabled: true, counts: {create: 1, update: 2, adopt: 4, noop: 3, review: 0},
    actions: [{name: secret}], range: {start: secret}}; },
  apply: async (...args) => { applies.push(args); return {created: 1, updated: 2, unchanged: 3, adopted: 4}; }, ...overrides.service};
  return {api, service, calls, previews, applies, downloads,
    handle: createTelegramHandler({api, service, person: 'Synthetic Owner', residents: [secret], calendarId: 'synthetic-calendar',
      allowedChatId: CHAT, allowedUserId: USER})};
}
const texts = f => f.calls.map(call => call.params.text).join('\n');

test('only the configured sender in the configured private chat is accepted silently', async () => {
  const f = fixture();
  for (const changes of [{chat: {id: 999, type: 'private'}}, {from: {id: 999}},
    {chat: {id: CHAT, type: 'group'}}, {chat: {id: CHAT, type: 'supergroup'}},
    {chat: {id: CHAT, type: 'channel'}}, {from: {id: USER, is_bot: true}}, {from: undefined}]) {
    await f.handle(update(1, changes));
  }
  await f.handle({update_id: 1, edited_message: update().message});
  await f.handle({update_id: 1, channel_post: update().message});
  await f.handle(update(-1));
  assert.equal(f.calls.length + f.downloads.length + f.previews.length + f.applies.length, 0);
  await f.handle(update());
  assert.equal(f.previews.length, 1);
});

test('document metadata is validated before download', async () => {
  const f = fixture();
  let id = 0;
  for (const change of [{file_size: MAX_FILE_BYTES + 1}, {file_size: 0}, {file_size: -1}, {file_size: undefined},
    {file_size: '20'}, {file_name: 'schedule.xls'}, {file_name: 'schedule.xlsx.exe'},
    {file_name: '../schedule.xlsx'}, {file_name: 'x\\schedule.xlsx'}, {file_name: 'x\nx.xlsx'},
    {file_name: undefined}, {file_id: '../file'}, {file_id: undefined}]) {
    await f.handle(update(++id, {document: {...update().message.document, ...change}}));
  }
  assert.equal(f.downloads.length, 0);
  assert.equal(f.previews.length, 0);
  assert.equal(f.calls.length, id);
});

test('preview uses the shared service, sends counts only, and explicit apply binds the same server channel', async () => {
  const f = fixture();
  await f.handle(update());
  assert.deepEqual(f.downloads, [['synthetic_file', MAX_FILE_BYTES]]);
  assert.deepEqual(f.previews[0], [bytes, {person: 'Synthetic Owner', residents: [secret],
    calendarId: 'synthetic-calendar', channel: `telegram:${CHAT}:${USER}`}]);
  assert.match(texts(f), /create 1, update 2, adopt 4, unchanged 3, review 0/);
  assert.match(texts(f), /\/aer_apply plan-123/);
  assert.doesNotMatch(texts(f), new RegExp(secret));
  assert.equal(f.applies.length, 0);
  await f.handle(update(2, {document: undefined, text: '/aer_apply plan-123', channel: 'attacker'}));
  assert.deepEqual(f.applies, [['plan-123', {channel: `telegram:${CHAT}:${USER}`}]]);
  assert.match(texts(f), /created 1, updated 2, unchanged 3, adopted 4/);
});

test('duplicate updates including concurrent deliveries run preview/apply once', async () => {
  const f = fixture();
  await Promise.all([f.handle(update()), f.handle(update()), f.handle(update())]);
  assert.equal(f.previews.length, 1);
  const apply = update(2, {document: undefined, text: '/aer_apply plan-123'});
  await Promise.all([f.handle(apply), f.handle(apply)]);
  assert.equal(f.applies.length, 1);
  assert.equal(f.calls.length, 2);
});

test('blocked or malformed previews never offer apply; commands must be exact', async () => {
  for (const plan of [{blocked: true}, {}, {blocked: false, planId: 'bad\nsecret'},
    {blocked: false, counts: {review: 1}}, {blocked: false, planId: undefined}]) {
    const f = fixture({service: {preview: async () => ({planId: 'plan-123', writesEnabled: true, ...plan})}});
    await f.handle(update());
    assert.doesNotMatch(texts(f), /\/aer_apply/);
    assert.match(texts(f), /Review required/);
  }
  const f = fixture();
  let id = 1;
  for (const text of ['/aer_apply', '/aer_apply plan-123 extra', '/aer_apply@other plan-123', '/aer_apply ../plan',
    '/aer_apply plan-123\nsecret', 'apply plan-123', '/aer_applyfoo plan-123']) {
    await f.handle(update(id++, {document: undefined, text}));
  }
  assert.equal(f.applies.length, 0);
});

test('writing-disabled previews never offer apply even when unblocked', async () => {
  for (const writesEnabled of [false, undefined, 'true']) {
    const f = fixture({service: {preview: async () => ({planId: 'plan-123', blocked: false, writesEnabled,
      counts: {adopt: 2}})}});
    await f.handle(update());
    assert.match(texts(f), /adopt 2/);
    assert.match(texts(f), /writing is disabled/);
    assert.doesNotMatch(texts(f), /\/aer_apply/);
  }
});

test('another chat or sender cannot apply; the service rejects foreign-channel plans safely', async () => {
  const f = fixture({service: {apply: async (id, {channel}) => {
    assert.equal(id, 'web-plan'); assert.equal(channel, `telegram:${CHAT}:${USER}`);
    throw Error(`Wrong channel: ${secret}`);
  }}});
  await f.handle(update(1, {document: undefined, text: '/aer_apply web-plan', from: {id: 999}}));
  await f.handle(update(2, {document: undefined, text: '/aer_apply web-plan', chat: {id: 999, type: 'private'}}));
  assert.equal(f.calls.length, 0);
  await f.handle(update(3, {document: undefined, text: '/aer_apply web-plan'}));
  assert.match(texts(f), /could not be completed/);
  assert.doesNotMatch(texts(f), new RegExp(secret));
});

test('download, parser, apply and send errors never leak diagnostics', async () => {
  for (const overrides of [{api: {downloadFile: async () => { throw Error(secret); }}},
    {service: {preview: async () => { throw Error(secret); }}},
    {api: {downloadFile: async () => Buffer.alloc(MAX_FILE_BYTES + 1)}},
    {api: {downloadFile: async () => Buffer.from('short')}}]) {
    const f = fixture(overrides);
    await f.handle(update());
    assert.match(texts(f), /could not be completed/);
    assert.doesNotMatch(texts(f), new RegExp(secret));
  }
  for (const apply of [async () => { throw Error(secret); }, async () => ({created: 1, errors: [secret]})]) {
    const f = fixture({service: {apply}});
    await f.handle(update(1, {document: undefined, text: '/aer_apply plan-123'}));
    assert.match(texts(f), /could not be completed/);
    assert.match(texts(f), /some Calendar changes may already exist\. Review a fresh preview before applying\./);
    assert.doesNotMatch(texts(f), /Applied:|synthetic-private-detail/);
  }
  await fixture({api: {call: async () => { throw Error(secret); }}}).handle(update());
});

// Minimal in-memory HTTPS transport. No sockets, fetches, real Telegram, or credentials.
function transport(replies) {
  const calls = [];
  const request = (options, callback) => {
    const req = new EventEmitter();
    const record = {options}; calls.push(record);
    req.destroy = () => { record.destroyed = true; };
    req.end = body => {
      record.body = body;
      const reply = replies.shift();
      assert.ok(reply, 'unexpected transport call');
      queueMicrotask(() => {
        if (reply.error) { req.emit('error', Error(reply.error)); return; }
        if (reply.hang) return;
        const res = new EventEmitter();
        res.statusCode = reply.status ?? 200;
        res.headers = reply.headers || {};
        res.complete = false;
        res.destroy = () => { record.responseDestroyed = true; };
        callback(res);
        for (const chunk of reply.chunks || [reply.json === undefined ? Buffer.from('') : Buffer.from(JSON.stringify(reply.json))]) {
          if (!record.responseDestroyed) res.emit('data', chunk);
        }
        if (reply.aborted) { res.emit('aborted'); return; }
        if (reply.close) { res.emit('close'); return; }
        if (!record.responseDestroyed) { res.complete = true; res.emit('end'); res.emit('close'); }
      });
    };
    return req;
  };
  return {request, calls};
}
function apiFixture(replies, options = {}) {
  const wire = transport(replies);
  return {...wire, api: createTelegramApi({token: fakeToken, request: wire.request, ...options})};
}
const ok = result => ({json: {ok: true, result}});
const redacted = error => {
  assert.ok(error instanceof TelegramError);
  assert.doesNotMatch(JSON.stringify(error) + error.stack, /synthetic-private-detail|synthetic_test_only/);
  return true;
};

test('client pins HTTPS origin and downloads capped workbook bytes', async () => {
  const f = apiFixture([ok({file_path: 'documents/file_1.xlsx', file_size: bytes.length}), {chunks: [bytes]}]);
  assert.deepEqual(await f.api.downloadFile('synthetic_file', MAX_FILE_BYTES), bytes);
  assert.equal(f.calls.length, 2);
  for (const {options} of f.calls) {
    assert.equal(options.hostname, 'api.telegram.org');
    assert.equal(options.protocol, 'https:');
    assert.equal(options.port, 443);
    assert.equal(options.rejectUnauthorized, true);
  }
  assert.equal(f.calls[0].options.method, 'POST');
  assert.equal(f.calls[1].options.method, 'GET');
  assert.deepEqual(JSON.parse(f.calls[0].body), {file_id: 'synthetic_file'});
});

test('getFile response paths and sizes are validated before download', async () => {
  for (const file_path of ['../file.xlsx', 'documents/../file.xlsx', '/documents/file.xlsx',
    'documents/%2e%2e/file.xlsx', 'documents/file.xlsx?token=x', 'https://evil.invalid/file.xlsx',
    'documents/file.xls', 'documents/file.xlsx#x', 'documents\\file.xlsx', 'documents//file.xlsx']) {
    const f = apiFixture([ok({file_path})]);
    await assert.rejects(f.api.downloadFile('synthetic_file'), redacted);
    assert.equal(f.calls.length, 1);
  }
  for (const file_size of [MAX_FILE_BYTES + 1, -1, 0, '20']) {
    const f = apiFixture([ok({file_path: 'documents/file.xlsx', file_size})]);
    await assert.rejects(f.api.downloadFile('synthetic_file'), redacted);
    assert.equal(f.calls.length, 1);
  }
  const f = apiFixture([]);
  await assert.rejects(f.api.downloadFile('bad/file'), redacted);
  await assert.rejects(f.api.downloadFile('file', MAX_FILE_BYTES + 1), redacted);
  await assert.rejects(f.api.call('deleteWebhook'), redacted);
  assert.equal(f.calls.length, 0);
});

test('HTTP redirects, error bodies, invalid JSON, network errors and timeouts are redacted', async () => {
  for (const response of [{status: 302, headers: {location: `https://${secret}.invalid`}},
    {status: 401, chunks: [Buffer.from(secret)]}, {chunks: [Buffer.from(secret)]},
    {json: {ok: false, description: secret}}, {error: secret}, {aborted: true}, {close: true}, {hang: true}]) {
    const f = apiFixture([response], {timeoutMs: 10});
    await assert.rejects(f.api.call('getMe'), redacted);
    assert.equal(f.calls.length, 1);
  }
  for (const response of [{status: 409}, {json: {ok: false, error_code: 409, description: secret}}]) {
    await assert.rejects(apiFixture([response]).api.call('getUpdates'), error => {
      redacted(error); assert.equal(error.status, 409); assert.equal(error.code, 'POLLING_CONFLICT'); return true;
    });
  }
});

test('stream limits stop downloads with and without Content-Length, including truncation', async () => {
  for (const response of [{headers: {'content-length': '100'}, chunks: [bytes]},
    {headers: {'content-length': 'garbage'}, chunks: [bytes]},
    {chunks: [Buffer.alloc(3), Buffer.alloc(3)]}, {headers: {'content-length': '3'}, chunks: [Buffer.alloc(2)]}]) {
    const f = apiFixture([ok({file_path: 'documents/file.xlsx'}), response]);
    await assert.rejects(f.api.downloadFile('file', 4), redacted);
    assert.equal(f.calls[1].destroyed, true);
  }
  const huge = apiFixture([{chunks: [Buffer.alloc(1024 * 1024 + 1)]}]);
  await assert.rejects(huge.api.call('getMe'), redacted);
  const mismatched = apiFixture([ok({file_path: 'documents/file.xlsx', file_size: 3}), {chunks: [Buffer.alloc(2)]}]);
  await assert.rejects(mismatched.api.downloadFile('file'), redacted);
});

function environment(stateDir) {
  return {AER_TELEGRAM_EXCLUSIVE_POLLING: '1', AER_ENABLE_WRITES: '1', AER_TELEGRAM_BOT_TOKEN: fakeToken,
    AER_TELEGRAM_EXPECTED_BOT_USERNAME: 'SyntheticBot', AER_TELEGRAM_ALLOWED_CHAT_ID: CHAT,
    AER_TELEGRAM_ALLOWED_USER_ID: USER, AER_TELEGRAM_STATE_DIR: stateDir,
    AER_PERSON: 'Synthetic Owner', AER_CALENDAR_ID: 'synthetic-calendar', AER_RESIDENTS: '[]'};
}
function temp(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aer-telegram-test-'));
  fs.chmodSync(root, 0o700);
  t.after(() => fs.rmSync(root, {recursive: true, force: true}));
  return root;
}
function runnerApi(batches = []) {
  const calls = [];
  return {calls, call: async (method, params) => {
    calls.push({method, params});
    if (method === 'getMe') return {is_bot: true, username: 'SyntheticBot'};
    if (method === 'getWebhookInfo') return {url: ''};
    if (method === 'getUpdates') return batches.shift() || [];
    if (method === 'sendMessage') return {};
    throw Error(secret);
  }, downloadFile: async () => bytes};
}

test('polling opt-in and explicit identities are required independently of writer opt-in', async t => {
  const root = temp(t), env = environment(root);
  assert.equal(readConfig(env).allowedChatId, CHAT);
  const readonly = {...env}; delete readonly.AER_ENABLE_WRITES;
  assert.equal(readConfig(readonly).allowedChatId, CHAT);
  assert.equal(readConfig({...env, AER_ENABLE_WRITES: '0'}).allowedChatId, CHAT);
  for (const key of ['AER_TELEGRAM_EXCLUSIVE_POLLING', 'AER_TELEGRAM_ALLOWED_CHAT_ID',
    'AER_TELEGRAM_ALLOWED_USER_ID', 'AER_TELEGRAM_EXPECTED_BOT_USERNAME', 'AER_TELEGRAM_STATE_DIR']) {
    const copy = {...env}; delete copy[key];
    const api = runnerApi(); let runtime = false;
    await assert.rejects(runTelegramReceiver({env: copy, api, createRuntime: async () => { runtime = true; }, maxPolls: 0}), RunnerError);
    assert.equal(runtime, false); assert.equal(api.calls.length, 0);
  }
  for (const change of [{AER_TELEGRAM_ALLOWED_CHAT_ID: '-1'}, {AER_TELEGRAM_ALLOWED_USER_ID: '999999999999999999'},
    {AER_RESIDENTS: secret}, {AER_RESIDENTS: '{}'}, {AER_CALENDAR_ID: 'primary'}, {AER_TELEGRAM_STATE_DIR: '.'}]) {
    assert.throws(() => readConfig({...env, ...change}), RunnerError);
  }
});

test('private token JSON file is an alternative to token env; missing, conflicting and unsafe sources are redacted', t => {
  const root = temp(t), file = path.join(root, 'synthetic-token.json');
  fs.writeFileSync(file, JSON.stringify({token: fakeToken}), {mode: 0o600});
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const env = environment(root); delete env.AER_TELEGRAM_BOT_TOKEN;
  assert.equal(readConfig({...env, AER_TELEGRAM_BOT_TOKEN_FILE: file}).token, fakeToken);
  const rejectConfig = config => assert.throws(() => readConfig(config), error => {
    assert.ok(error instanceof RunnerError); assert.equal(error.code, 'CONFIGURATION');
    assert.doesNotMatch(error.stack + JSON.stringify(error), /synthetic_test_only|synthetic-private-detail|synthetic-token\.json/);
    return true;
  });
  rejectConfig(env);
  rejectConfig({...environment(root), AER_TELEGRAM_BOT_TOKEN_FILE: path.join(root, 'not-read.json')});
  rejectConfig({...env, AER_TELEGRAM_BOT_TOKEN: ''});
  rejectConfig({...env, AER_TELEGRAM_BOT_TOKEN: secret});
  rejectConfig({...env, AER_TELEGRAM_BOT_TOKEN_FILE: 'relative.json'});
  rejectConfig({...env, AER_TELEGRAM_BOT_TOKEN_FILE: path.join(root, 'missing.json')});
  fs.chmodSync(file, 0o644);
  rejectConfig({...env, AER_TELEGRAM_BOT_TOKEN_FILE: file});
  fs.chmodSync(file, 0o600);
  const linked = path.join(root, 'linked.json'); fs.symlinkSync(file, linked);
  rejectConfig({...env, AER_TELEGRAM_BOT_TOKEN_FILE: linked});
  for (const content of [secret, '{}', JSON.stringify({token: secret}), JSON.stringify({token: 123})]) {
    fs.writeFileSync(file, content);
    rejectConfig({...env, AER_TELEGRAM_BOT_TOKEN_FILE: file});
  }
});

test('private persistent cursor survives restart and lock excludes a second owner', t => {
  const root = temp(t);
  let state = openPollingState({stateDir: root});
  assert.equal(state.offset, 0);
  assert.equal(fs.statSync(path.join(root, 'polling.lock')).mode & 0o777, 0o600);
  assert.throws(() => openPollingState({stateDir: root}), error => error.code === 'POLLING_LOCKED');
  state.save(123);
  assert.equal(fs.statSync(path.join(root, 'offset.json')).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'offset.json'))), {offset: 123});
  assert.throws(() => state.save(122), RunnerError);
  state.close(); state.close();
  state = openPollingState({stateDir: root});
  assert.equal(state.offset, 123);
  state.close();
});

test('unsafe state directories/files and stale locks fail closed', t => {
  const root = temp(t), checkout = path.join(root, 'checkout');
  fs.mkdirSync(checkout, {mode: 0o700});
  assert.throws(() => openPollingState({stateDir: checkout, checkoutDir: checkout}), RunnerError);
  const linked = path.join(root, 'linked'); fs.symlinkSync(checkout, linked);
  assert.throws(() => openPollingState({stateDir: linked, checkoutDir: checkout}), RunnerError);
  assert.throws(() => openPollingState({stateDir: path.join(linked, 'new-state'), checkoutDir: checkout}), RunnerError);
  assert.equal(fs.existsSync(path.join(checkout, 'new-state')), false);
  const publicDir = path.join(root, 'public'); fs.mkdirSync(publicDir, {mode: 0o755}); fs.chmodSync(publicDir, 0o755);
  assert.throws(() => openPollingState({stateDir: publicDir}), RunnerError);
  const offset = path.join(root, 'offset.json');
  fs.writeFileSync(offset, JSON.stringify({offset: 1}), {mode: 0o644}); fs.chmodSync(offset, 0o644);
  assert.throws(() => openPollingState({stateDir: root}), RunnerError);
  fs.unlinkSync(offset); fs.symlinkSync(path.join(root, 'missing'), offset);
  assert.throws(() => openPollingState({stateDir: root}), RunnerError);
  fs.unlinkSync(offset); fs.writeFileSync(offset, JSON.stringify({offset: -1}), {mode: 0o600});
  assert.throws(() => openPollingState({stateDir: root}), RunnerError);
  fs.unlinkSync(offset); fs.writeFileSync(path.join(root, 'polling.lock'), 'stale', {mode: 0o600});
  assert.throws(() => openPollingState({stateDir: root}), error => error.code === 'POLLING_LOCKED');
  assert.equal(fs.readFileSync(path.join(root, 'polling.lock'), 'utf8'), 'stale');
});

test('expected bot and empty webhook are required; ownership checks never mutate webhook or pending updates', async () => {
  for (const [me, webhook, code] of [[{is_bot: true, username: 'OtherBot'}, {url: ''}, 'BOT_MISMATCH'],
    [{is_bot: false, username: 'SyntheticBot'}, {url: ''}, 'BOT_MISMATCH'],
    [{is_bot: true, username: 'SyntheticBot'}, {url: `https://${secret}.invalid`}, 'WEBHOOK_CONFIGURED'],
    [{is_bot: true, username: 'SyntheticBot'}, {}, 'WEBHOOK_CONFIGURED']]) {
    const methods = [];
    await assert.rejects(checkPollingOwnership({call: async method => {
      methods.push(method); return method === 'getMe' ? me : webhook;
    }}, 'SyntheticBot'), error => error.code === code && !error.message.includes(secret));
    assert.ok(methods.every(method => ['getMe', 'getWebhookInfo'].includes(method)));
  }
});

test('runner persists monotonic cursor, skips duplicates after restart, and advances ignored updates', async t => {
  const root = temp(t), seen = [];
  let state = openPollingState({stateDir: root});
  const api = runnerApi([[update(3), update(1), update(3), update(2, {from: {id: 999}})], [update(1), update(4)]]);
  await pollUpdates({api, state, handleUpdate: async update => { seen.push(update.update_id); }, maxPolls: 2});
  assert.deepEqual(seen, [1, 2, 3, 4]);
  assert.equal(state.offset, 5);
  assert.deepEqual(api.calls.map(call => call.params.offset), [0, 4]);
  for (const call of api.calls) {
    assert.deepEqual(call.params.allowed_updates, ['message']); assert.equal(call.params.timeout, 25);
    assert.equal(call.params.limit, 100); assert.equal(call.params.drop_pending_updates, undefined);
  }
  state.close(); state = openPollingState({stateDir: root});
  await pollUpdates({api: runnerApi([[update(4), update(5)]]), state,
    handleUpdate: async update => { seen.push(update.update_id); }, maxPolls: 1});
  assert.deepEqual(seen, [1, 2, 3, 4, 5]);
  state.close();
});

test('409 conflict aborts polling immediately without retries or cursor loss', async t => {
  const root = temp(t), state = openPollingState({stateDir: root});
  let calls = 0;
  await assert.rejects(pollUpdates({api: {call: async () => { calls++; throw new TelegramError('POLLING_CONFLICT', 409); }},
    state, handleUpdate: async () => { throw Error('unreachable'); }, maxPolls: 5}), error => error.code === 'POLLING_CONFLICT');
  assert.equal(calls, 1); assert.equal(state.offset, 0); state.close();
});

test('cursor is claimed before side effects, so a crash cannot replay an apply', async t => {
  const root = temp(t); let state = openPollingState({stateDir: root}), attempts = 0;
  await assert.rejects(pollUpdates({api: runnerApi([[update(10)]]), state, maxPolls: 1,
    handleUpdate: async () => { attempts++; assert.equal(state.offset, 11); throw Error(secret); }}), RunnerError);
  state.close(); state = openPollingState({stateDir: root});
  await pollUpdates({api: runnerApi([[update(10)]]), state, maxPolls: 1, handleUpdate: async () => { attempts++; }});
  assert.equal(attempts, 1); state.close();
});

test('writer-disabled runtime starts without write opt-in and accepts maxPolls zero', async t => {
  const root = temp(t), api = runnerApi(), env = environment(root);
  delete env.AER_ENABLE_WRITES;
  await runTelegramReceiver({env, api, maxPolls: 0,
    createRuntime: async () => ({service: fixture().service, writesEnabled: false})});
  assert.deepEqual(api.calls.map(c => c.method), ['getMe', 'getWebhookInfo']);
  assert.equal(fs.existsSync(path.join(root, 'polling.lock')), false);
});

test('readonly receiver previews without apply instruction and leaves apply gating to service', async t => {
  const root = temp(t), env = environment(root); delete env.AER_ENABLE_WRITES;
  const api = runnerApi([[update(1), update(2, {document: undefined, text: '/aer_apply plan-123'})]]);
  let attempts = 0;
  const service = {preview: async () => ({planId: 'plan-123', blocked: false, writesEnabled: false, counts: {adopt: 2}}),
    apply: async (planId, options) => {
      attempts++;
      assert.equal(planId, 'plan-123'); assert.deepEqual(options, {channel: `telegram:${CHAT}:${USER}`});
      throw Error(secret);
    }};
  await runTelegramReceiver({env, api, maxPolls: 1, createRuntime: async () => ({service, writesEnabled: false})});
  const messages = api.calls.filter(c => c.method === 'sendMessage').map(c => c.params.text);
  assert.equal(messages.length, 2);
  assert.match(messages[0], /writing is disabled/); assert.doesNotMatch(messages[0], /\/aer_apply/);
  assert.match(messages[1], /some Calendar changes may already exist/);
  assert.doesNotMatch(messages.join('\n'), new RegExp(secret)); assert.equal(attempts, 1);
});

test('runner loads writer lazily after ownership checks, releases lock, and integrates only the injected service', async t => {
  const root = temp(t), api = runnerApi([[update(1), update(2, {document: undefined, text: '/aer_apply plan-123'})]]);
  const f = fixture(); let runtimes = 0;
  await runTelegramReceiver({env: environment(root), api, maxPolls: 1, createRuntime: async () => {
    runtimes++; assert.deepEqual(api.calls.map(c => c.method), ['getMe', 'getWebhookInfo']); return {service: f.service, writesEnabled: true};
  }});
  assert.equal(runtimes, 1); assert.equal(f.previews.length, 1); assert.equal(f.applies.length, 1);
  assert.equal(fs.existsSync(path.join(root, 'polling.lock')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'offset.json'))).offset, 3);
  api.call = async () => ({is_bot: true, username: 'WrongBot'});
  await assert.rejects(runTelegramReceiver({env: environment(root), api, maxPolls: 0,
    createRuntime: async () => { throw Error('must not start'); }}), error => error.code === 'BOT_MISMATCH');
  assert.equal(fs.existsSync(path.join(root, 'polling.lock')), false);
});
test('standalone polling CLI is disabled before loading credentials or starting network',()=>{
  const {spawnSync}=require('node:child_process');
  const child=spawnSync(process.execPath,[path.resolve(__dirname,'../backend/telegram-runner.js')],{encoding:'utf8',env:{}});
  assert.equal(child.status,1);assert.match(child.stderr,/Standalone AER polling is disabled/);
  assert.equal(JSON.parse(fs.readFileSync(path.resolve(__dirname,'../package.json'),'utf8')).scripts.telegram,undefined);
});
