// Vrdct standing-board keeper. It only opens the result it re-executed, and it is also the
// feeder that defends its own challenged positions. Market definitions bind the source, window,
// commitment, economics, and question hash, so the PDA is the idempotency key for a window.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import {
  ComputeBudgetProgram, Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import * as cmls from '../claimtypes/closed-market-soundness.mjs';
import { marketStatus } from '../core/campana.mjs';
import {
  CAL_2026_VERSION, FLAG_ID, FLAG_NAME, SOURCE_KIND, inputsCommitment, marketDefinitionHash,
  marketId, yesWhenMask,
} from '../core/encode.mjs';
import { fetchObservations } from '../core/rpc.mjs';

export const DEFAULT_PROGRAM_ID = '7EtJACKUvpWGB524uqTykTzyCx1DyxKb76iEZVAiWwKS';
export const MARKET_SIZE = 314;
export const STATE = ['OPEN', 'CHALLENGED', 'SETTLED'];
const MARKET_DISCRIMINATOR = createHash('sha256').update('account:Market').digest().subarray(0, 8);
const FEED_DISCRIMINATOR = createHash('sha256').update('account:Feed').digest().subarray(0, 8);
const MIN_CHALLENGE_WINDOW_SECS = 60 * 60;
const MAX_CHALLENGE_WINDOW_SECS = 7 * 24 * 60 * 60;

const disc = (name) => createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
const u8 = (v) => Buffer.from([v]);
const u32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32LE(v); return b; };
const u64 = (v) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(v)); return b; };
const i64 = (v) => { const b = Buffer.alloc(8); b.writeBigInt64LE(BigInt(v)); return b; };
const vecU8 = (v) => Buffer.concat([u32(v.length), v]);
const rw = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: true });
const ro = (pubkey, isSigner = false) => ({ pubkey, isSigner, isWritable: false });
const iso = (ts) => new Date(Number(ts) * 1000).toISOString().replace('.000', '');
const sol = (lamports) => `${(Number(lamports) / 1_000_000_000).toFixed(4)} SOL`;
const ix = (programId, name, args, keys) => new TransactionInstruction({ programId, keys, data: Buffer.concat([disc(name), ...args]) });
const markdown = (value) => String(value).replace(/[\r\n|`]/g, ' ').trim();

function requireValue(ok, message) {
  if (!ok) throw new Error(message);
}

function asLamports(value) {
  requireValue(typeof value === 'string' && /^(?:[1-9][0-9]*)$/.test(value), 'bondLamports must be a positive decimal string');
  return BigInt(value);
}

function asPublicKey(value, label) {
  try { return new PublicKey(value); } catch { throw new Error(`${label} must be a valid Solana public key`); }
}

export function normalizeConfig(raw, { configPath = null } = {}) {
  requireValue(raw && typeof raw === 'object' && !Array.isArray(raw), 'keeper config must be an object');
  requireValue(typeof raw.rpc === 'string' && raw.rpc.length > 0, 'rpc is required');
  requireValue(raw.sourceRpc == null || (typeof raw.sourceRpc === 'string' && raw.sourceRpc.length > 0), 'sourceRpc must be a non-empty string when provided');
  const programId = asPublicKey(raw.programId || DEFAULT_PROGRAM_ID, 'programId');
  const bondLamports = asLamports(raw.bondLamports);
  const challengeWindowSecs = raw.challengeWindowSecs;
  requireValue(Number.isSafeInteger(challengeWindowSecs) && challengeWindowSecs >= MIN_CHALLENGE_WINDOW_SECS && challengeWindowSecs <= MAX_CHALLENGE_WINDOW_SECS,
    `challengeWindowSecs must be an integer between ${MIN_CHALLENGE_WINDOW_SECS} and ${MAX_CHALLENGE_WINDOW_SECS}`);
  requireValue(typeof raw.keypair === 'string' && raw.keypair.length > 0, 'keypair is required');
  requireValue(Array.isArray(raw.subjects) && raw.subjects.length > 0, 'subjects must be a non-empty array');
  const base = configPath ? dirname(resolve(configPath)) : process.cwd();
  const questions = new Set();
  const subjects = raw.subjects.map((subject, index) => {
    requireValue(subject && typeof subject === 'object' && !Array.isArray(subject), `subjects[${index}] must be an object`);
    requireValue(typeof subject.venue === 'string' && subject.venue.trim(), `subjects[${index}].venue is required`);
    requireValue(typeof subject.question === 'string' && subject.question.trim(), `subjects[${index}].question is required`);
    requireValue(!questions.has(subject.question), `subjects[${index}].question must be unique`);
    questions.add(subject.question);
    const priceAccount = asPublicKey(subject.priceAccount, `subjects[${index}].priceAccount`);
    requireValue(subject.windowSecs == null, `subjects[${index}].windowSecs is no longer supported; keeper windows are trading-day close-to-close`);
    requireValue(Array.isArray(subject.yesWhen) && subject.yesWhen.length > 0 && subject.yesWhen.every((flag) => flag in FLAG_ID),
      `subjects[${index}].yesWhen must contain known flags`);
    return { venue: subject.venue, question: subject.question, priceAccount, yesWhen: subject.yesWhen };
  });
  return {
    rpc: raw.rpc,
    sourceRpc: raw.sourceRpc || raw.rpc,
    programId,
    keypairPath: resolve(base, raw.keypair),
    bondLamports,
    challengeWindowSecs,
    boardDir: resolve(base, raw.boardDir || '../board'),
    cacheDir: resolve(base, raw.cacheDir || '../.vrdct-keeper-cache'),
    subjects,
  };
}

export function loadConfig(configPath) {
  return normalizeConfig(JSON.parse(readFileSync(configPath, 'utf8')), { configPath });
}

export function signerFromConfig(config) {
  try { return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(config.keypairPath, 'utf8')))); }
  catch { throw new Error(`could not read keeper keypair ${config.keypairPath}`); }
}

export function decodeMarket(data) {
  requireValue(Buffer.isBuffer(data) && data.length >= MARKET_SIZE, `invalid Market account length ${data?.length ?? 0}`);
  requireValue(data.subarray(0, 8).equals(MARKET_DISCRIMINATOR), 'account is not a Vrdct Market');
  const pk = (offset) => new PublicKey(data.subarray(offset, offset + 32));
  return {
    definitionHash: Buffer.from(data.subarray(9, 41)), marketId: Buffer.from(data.subarray(41, 73)),
    claimType: data[73], calendarVersion: data.readUInt32LE(74), nRecords: data.readUInt32LE(78), inputsHash: Buffer.from(data.subarray(82, 114)),
    source: { kind: data[114], account: pk(115), fromTs: data.readBigInt64LE(147), toTs: data.readBigInt64LE(155) },
    yesWhen: data[163], resolver: pk(164), resolverFlag: data[196], resolverBond: data.readBigUInt64LE(197),
    challenger: pk(205), challengerFlag: data[237], challengeBond: data.readBigUInt64LE(238),
    openedTs: data.readBigInt64LE(278), challengeUntil: data.readBigInt64LE(286), settleBy: data.readBigInt64LE(294),
    settledTs: data.readBigInt64LE(302), state: data[310], settledFlag: data[311], resolved: data[312], byReexecution: data[313],
  };
}

function decodeFeed(data) {
  requireValue(Buffer.isBuffer(data) && data.length >= 109, `invalid Feed account length ${data?.length ?? 0}`);
  requireValue(data.subarray(0, 8).equals(FEED_DISCRIMINATOR), 'account is not a Vrdct Feed');
  return { digest: Buffer.from(data.subarray(73, 105)), count: data.readUInt32LE(105) };
}

export async function chainTime(connection) {
  const slot = await connection.getSlot('finalized');
  const timestamp = await connection.getBlockTime(slot);
  requireValue(timestamp != null, `validator returned no blockTime for finalized slot ${slot}`);
  return timestamp;
}

export function tradingWindow(now) {
  const toTs = marketStatus(now).last_close_ts;
  requireValue(toTs != null, `no completed trading session before chain time ${now}`);
  // One second before the completed close is still in the preceding bucket, so Campana returns
  // the prior trading-day close through weekends, holidays, and shortened sessions alike.
  const fromTs = marketStatus(toTs - 1).last_close_ts;
  requireValue(fromTs != null, `no prior trading session before close ${toTs}`);
  return { fromTs, toTs, chainNow: now };
}

export async function windowFor(connection, now = null) {
  if (now == null) now = await chainTime(connection);
  return tradingWindow(now);
}

function claimForSource(source, observations) {
  return cmls.build({
    subject: { chain: 'solana', priceAccount: source.account.toBase58() },
    window: { from_ts: Number(source.fromTs), to_ts: Number(source.toTs), from_iso: iso(source.fromTs), to_iso: iso(source.toTs) },
    observations,
  });
}

async function reconstruct({ rpc, source, calendarVersion, fetch = fetchObservations }) {
  requireValue(source.kind === SOURCE_KIND.SOLANA_ACCOUNT_SIGNATURES, 'keeper supports only sourced CMLS markets');
  const observations = await fetch(rpc, source.account.toBase58(), { from: Number(source.fromTs), to: Number(source.toTs) });
  requireValue(observations.length > 0, `source ${source.account.toBase58()} window ${source.fromTs}-${source.toTs} returned no observations`);
  const claim = claimForSource(source, observations);
  return { observations, claim, commitment: inputsCommitment(claim, { calendarVersion }) };
}

async function simulateAndSend(connection, transaction, signer, label) {
  const latest = await connection.getLatestBlockhash('confirmed');
  transaction.feePayer = signer.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(signer);
  const simulation = await connection.simulateTransaction(transaction);
  if (simulation.value.err) throw new Error(`${label} simulation failed: ${JSON.stringify(simulation.value.err)} ${simulation.value.logs?.join('\n') || ''}`);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true, preflightCommitment: 'confirmed' });
  const result = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
  if (result.value.err) throw new Error(`${label} failed: ${JSON.stringify(result.value.err)}`);
  return signature;
}

async function readMarket(connection, programId, address) {
  const info = await connection.getAccountInfo(address, 'confirmed');
  requireValue(info, `market ${address.toBase58()} was not found`);
  requireValue(info.owner.equals(programId), `market ${address.toBase58()} is not owned by ${programId.toBase58()}`);
  return decodeMarket(info.data);
}

function subjectSource(subject, window) {
  return { kind: SOURCE_KIND.SOLANA_ACCOUNT_SIGNATURES, account: subject.priceAccount, fromTs: window.fromTs, toTs: window.toTs };
}

function cachePath(config, market) {
  return resolve(config.cacheDir, `${market.toBase58()}.json`);
}

function cacheCommitment(config, market, commitment) {
  requireValue(commitment.nRecords > 0 && commitment.chunks.length > 0, 'cannot cache an empty commitment');
  const recordBytes = commitment.chunks.reduce((n, chunk) => n + chunk.length, 0);
  requireValue(recordBytes === commitment.nRecords * 4, 'commitment chunk lengths do not match record count');
  const record = {
    format: 'vrdct-keeper-commitment-v1',
    market: market.toBase58(),
    nRecords: commitment.nRecords,
    inputsHash: commitment.inputsHash.toString('hex'),
    chunks: commitment.chunks.map((chunk) => Buffer.from(chunk).toString('base64')),
  };
  mkdirSync(config.cacheDir, { recursive: true });
  const file = cachePath(config, market);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  renameSync(temp, file);
}

function cachedCommitment(config, marketKey, market) {
  const file = cachePath(config, marketKey);
  let record;
  try { record = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`no usable cached commitment for ${marketKey.toBase58()}: ${error.message}`); }
  requireValue(record?.format === 'vrdct-keeper-commitment-v1' && record.market === marketKey.toBase58(), `cached commitment ${file} belongs to another market`);
  requireValue(Number.isSafeInteger(record.nRecords) && record.nRecords === market.nRecords, `cached commitment ${file} record count does not match Market`);
  requireValue(typeof record.inputsHash === 'string' && /^[0-9a-f]{64}$/.test(record.inputsHash)
    && Buffer.from(record.inputsHash, 'hex').equals(market.inputsHash), `cached commitment ${file} inputs_hash does not match Market`);
  requireValue(Array.isArray(record.chunks) && record.chunks.length > 0 && record.chunks.every((chunk) => typeof chunk === 'string'), `cached commitment ${file} has malformed chunks`);
  const chunks = record.chunks.map((chunk) => Buffer.from(chunk, 'base64'));
  requireValue(chunks.every((chunk) => chunk.length > 0 && chunk.length % 4 === 0), `cached commitment ${file} has malformed record bytes`);
  requireValue(chunks.reduce((n, chunk) => n + chunk.length, 0) === market.nRecords * 4, `cached commitment ${file} chunk length does not match Market`);
  return { nRecords: record.nRecords, inputsHash: Buffer.from(record.inputsHash, 'hex'), chunks };
}

export async function openSubject({ connection, config, signer, subject, fetch, chainNow = null }) {
  const window = await windowFor(connection, chainNow);
  const source = subjectSource(subject, window);
  // Opening is the integrity gate: never post a bond for a source window that cannot be rebuilt.
  const rebuilt = await reconstruct({ rpc: config.sourceRpc, source, calendarVersion: CAL_2026_VERSION, fetch });
  const id = marketId(subject.question);
  const definition = marketDefinitionHash({
    marketId: id, claimTypeId: rebuilt.commitment.claimTypeId, calendarVersion: rebuilt.commitment.calendarVersion,
    nRecords: rebuilt.commitment.nRecords, inputsHash: rebuilt.commitment.inputsHash,
    source: { ...source, account: source.account.toBuffer() }, yesWhen: yesWhenMask(subject.yesWhen),
    bond: config.bondLamports, challengeWindowSecs: config.challengeWindowSecs,
  });
  const [market] = PublicKey.findProgramAddressSync([Buffer.from('market'), definition], config.programId);
  const existing = await connection.getAccountInfo(market, 'confirmed');
  if (existing) {
    requireValue(existing.owner.equals(config.programId), `definition PDA ${market.toBase58()} has an unexpected owner`);
    const decoded = decodeMarket(existing.data);
    requireValue(decoded.definitionHash.equals(definition), `definition PDA ${market.toBase58()} does not contain its requested definition`);
    requireValue(decoded.resolver.equals(signer.publicKey), `equivalent market ${market.toBase58()} exists but was opened by ${decoded.resolver.toBase58()}, not this keeper`);
    cacheCommitment(config, market, rebuilt.commitment);
    return { action: 'deduped', market, definition, claim: rebuilt.claim, commitment: rebuilt.commitment, state: decoded.state };
  }
  // Persist before bonding. A failed local cache write must leave the keeper with no new position
  // rather than a position it cannot defend after source history ages out.
  cacheCommitment(config, market, rebuilt.commitment);
  const transaction = new Transaction().add(ix(config.programId, 'open_market', [
    definition, id, u8(rebuilt.commitment.claimTypeId), u32(rebuilt.commitment.calendarVersion), u32(rebuilt.commitment.nRecords),
    rebuilt.commitment.inputsHash, u8(source.kind), source.account.toBuffer(), i64(source.fromTs), i64(source.toTs),
    u8(yesWhenMask(subject.yesWhen)), u8(FLAG_ID[rebuilt.claim.verdict.flag]), u64(config.bondLamports), i64(config.challengeWindowSecs),
  ], [rw(signer.publicKey, true), rw(market), ro(SystemProgram.programId)]));
  const signature = await simulateAndSend(connection, transaction, signer, `open ${subject.venue}`);
  const decoded = await readMarket(connection, config.programId, market);
  requireValue(decoded.resolverFlag === FLAG_ID[rebuilt.claim.verdict.flag], 'opened market flag differs from the keeper re-execution');
  return { action: 'opened', market, definition, claim: rebuilt.claim, commitment: rebuilt.commitment, state: decoded.state, signature };
}

function rewardFor(market, truth) {
  const cut = (amount) => amount / 10_000n * 1_000n + amount % 10_000n * 1_000n / 10_000n;
  if (truth === market.resolverFlag) return cut(market.challengeBond);
  if (truth === market.challengerFlag) return cut(market.resolverBond);
  return cut(market.resolverBond + market.challengeBond);
}

async function prepareOwnFeed({ connection, config, signer, marketKey, market, commitment }) {
  const [feed] = PublicKey.findProgramAddressSync([Buffer.from('feed'), marketKey.toBuffer(), signer.publicKey.toBuffer()], config.programId);
  const info = await connection.getAccountInfo(feed, 'confirmed');
  if (info) {
    requireValue(info.owner.equals(config.programId), `feed ${feed.toBase58()} has an unexpected owner`);
    const current = decodeFeed(info.data);
    if (current.count === market.nRecords && current.digest.equals(commitment.inputsHash)) return { feed, completed: true };
    await simulateAndSend(connection, new Transaction().add(ix(config.programId, 'close_feed', [], [
      rw(signer.publicKey, true), ro(marketKey), rw(feed),
    ])), signer, `discard incomplete feed ${feed.toBase58()}`);
  }
  await simulateAndSend(connection, new Transaction().add(ix(config.programId, 'open_feed', [], [
    rw(signer.publicKey, true), ro(marketKey), rw(feed), ro(SystemProgram.programId),
  ])), signer, `open feed ${feed.toBase58()}`);
  return { feed, completed: false };
}

export async function crankMarket({ connection, config, signer, marketKey }) {
  const market = await readMarket(connection, config.programId, marketKey);
  requireValue(market.state === 1, `market ${marketKey.toBase58()} is not CHALLENGED`);
  requireValue(market.resolver.equals(signer.publicKey), `market ${marketKey.toBase58()} is not this keeper's position`);
  requireValue(market.claimType === 1 && market.source.kind === SOURCE_KIND.SOLANA_ACCOUNT_SIGNATURES, 'keeper can crank only sourced CMLS markets');
  // The cached bytes are exactly those committed before open. `settle` independently requires
  // both Feed.count and Feed.digest to equal the Market commitment, so an unavailable source RPC
  // is not an integrity reason to abandon a challenged bond.
  const commitment = cachedCommitment(config, marketKey, market);
  const { feed, completed } = await prepareOwnFeed({ connection, config, signer, marketKey, market, commitment });
  if (!completed) {
    for (const chunk of commitment.chunks) {
      await simulateAndSend(connection, new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }))
        .add(ix(config.programId, 'feed', [vecU8(chunk)], [ro(signer.publicKey, true), ro(marketKey), rw(feed)])), signer, `feed ${marketKey.toBase58()}`);
    }
  }
  await simulateAndSend(connection, new Transaction()
    .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 400_000 }))
    .add(ix(config.programId, 'settle', [], [
      ro(signer.publicKey, true), rw(marketKey), rw(market.resolver), rw(market.challenger), rw(signer.publicKey), rw(feed),
    ])), signer, `settle ${marketKey.toBase58()}`);
  const settled = await readMarket(connection, config.programId, marketKey);
  const truth = settled.settledFlag;
  requireValue(settled.state === 2 && settled.byReexecution === 1 && settled.settledFlag === truth, `market ${marketKey.toBase58()} did not settle from its re-execution`);
  return { market: marketKey, feed, rewardLamports: rewardFor(market, truth), state: settled.state };
}

function configuredSubject(config, market) {
  return config.subjects.find((subject) => marketId(subject.question).equals(market.marketId)
    && subject.priceAccount.equals(market.source.account));
}

export async function keeperMarkets({ connection, config, signer }) {
  const accounts = await connection.getProgramAccounts(config.programId, { commitment: 'confirmed' });
  return accounts.flatMap(({ pubkey, account }) => {
    try {
      const market = decodeMarket(account.data);
      const subject = configuredSubject(config, market);
      return market.resolver.equals(signer.publicKey) ? [{ pubkey, market, subject }] : [];
    } catch { return []; }
  }).sort((a, b) => a.pubkey.toBase58().localeCompare(b.pubkey.toBase58()));
}

function errorText(error) {
  return error instanceof Error ? error.message.replace(/\s+/g, ' ').trim() : String(error);
}

export function renderBoard({ config, rows, skipped = [], failures = [] }) {
  const rendered = [
    '# Vrdct standing board',
    '',
    '> **Honest scope — devnet bonds are not real capital.** A devnet dispute is reputation, not an economic incentive.',
    '> What is real here is the claimed input set, its source descriptor, the deterministic re-execution, and that anyone can independently run the command on every row.',
    '> An uncontested row is uncontested, **not proven**. A settled row is only as reproducible as the descriptor history an RPC still serves.',
    `> Source reconstruction endpoint: \`${config.sourceRpc}\`. Public RPCs may rate-limit or prune historical signature history; an endpoint that can serve this exact history is part of this evidence.`,
    '> This board has no sound (market-hours-guarded) row yet: finding one needs an indexer-grade historical RPC and remains an explicit open measurement task.',
    '',
    'This committed record is regenerated by `keeper/vrdct-keeper.mjs`; the dated filename is derived from chain time. It is not a landing page.',
  ];
  if (!rows.length) rendered.push('', '_No configured keeper positions exist on this cluster yet._');
  for (const row of rows) {
    rendered.push('', `## ${markdown(row.subject.venue)} — ${markdown(row.subject.question)}`, '');
    rendered.push(`- Market: \`${row.address}\``, `- \`market_id\`: \`${row.market.marketId.toString('hex')}\``,
      `- Source: account \`${row.market.source.account.toBase58()}\`; window ${iso(row.market.source.fromTs)} → ${iso(row.market.source.toTs)}`,
      `- Re-executed verdict: **${FLAG_NAME[row.claim.verdict.flag]}** — ${markdown(row.claim.verdict.reason)}`,
      `- State: **${STATE[row.market.state] || `STATE_${row.market.state}`}**; resolver bond ${sol(row.market.resolverBond)}; challenger bond ${sol(row.market.challengeBond)}`,
      `- Deadlines: challenge_until ${iso(row.market.challengeUntil)}; settle_by ${iso(row.market.settleBy)}`,
      `- Falsify this row: \`cd cli && RPC=${config.rpc} SOURCE_RPC=${config.sourceRpc} PROGRAM_ID=${config.programId.toBase58()} node vrdct.mjs check ${row.address}\``);
    if (row.market.state === 2) rendered.push(`- Settlement: ${row.market.byReexecution ? 'on-chain re-execution' : 'optimistic/expiry path'}; stored flag ${FLAG_NAME[row.market.settledFlag]}`);
  }
  if (skipped.length) {
    rendered.push('', '## Skipped rows — not independently checkable now', '');
    for (const skippedRow of skipped) rendered.push(`- Market \`${skippedRow.address}\` was not published: ${markdown(skippedRow.error)}`);
  }
  if (failures.length) {
    rendered.push('', '## Keeper run failures', '');
    for (const failure of failures) {
      const target = failure.subject ? `${failure.subject.venue} — ${failure.subject.question}` : failure.market || failure.stage;
      const prefix = failure.stage === 'open' ? 'Subject did not open this window' : `${failure.stage} did not complete`;
      rendered.push(`- ${prefix}: ${markdown(target)} — ${markdown(failure.error)}`);
    }
  }
  return `${rendered.join('\n')}\n`;
}

export async function writeBoard({ connection, config, signer, fetch, chainNow = null, failures = [] }) {
  if (chainNow == null) chainNow = await chainTime(connection);
  let positions = [];
  try { positions = await keeperMarkets({ connection, config, signer }); }
  catch (error) { failures.push({ stage: 'scan board positions', error: errorText(error) }); }
  const rows = [];
  const skipped = [];
  for (const { pubkey, market, subject } of positions) {
    if (!subject) {
      skipped.push({ address: pubkey.toBase58(), error: 'the current keeper config no longer names this position; it remains in custody and is still cranked/claimed' });
      continue;
    }
    if (market.claimType !== 1 || market.source.kind !== SOURCE_KIND.SOLANA_ACCOUNT_SIGNATURES) {
      skipped.push({ address: pubkey.toBase58(), error: 'keeper publishes only sourced CMLS positions' });
      continue;
    }
    try {
      const rebuilt = await reconstruct({ rpc: config.sourceRpc, source: market.source, calendarVersion: market.calendarVersion, fetch });
      requireValue(rebuilt.commitment.inputsHash.equals(market.inputsHash), 'source does not rebuild its committed inputs_hash');
      rows.push({ address: pubkey.toBase58(), market, subject, claim: rebuilt.claim });
    } catch (error) {
      skipped.push({ address: pubkey.toBase58(), error: `source rebuild warning: ${errorText(error)}` });
    }
  }
  const content = renderBoard({ config, rows, skipped, failures });
  const dated = `${new Date(chainNow * 1000).toISOString().slice(0, 10)}.md`;
  mkdirSync(config.boardDir, { recursive: true });
  writeFileSync(resolve(config.boardDir, 'README.md'), content);
  writeFileSync(resolve(config.boardDir, dated), content);
  return { content, rows, skipped, files: [resolve(config.boardDir, 'README.md'), resolve(config.boardDir, dated)] };
}

export async function claimUncontested({ connection, config, signer, marketKey }) {
  const market = await readMarket(connection, config.programId, marketKey);
  requireValue(market.state === 0, `market ${marketKey.toBase58()} is not OPEN`);
  requireValue(market.resolver.equals(signer.publicKey), `market ${marketKey.toBase58()} is not this keeper's position`);
  await simulateAndSend(connection, new Transaction().add(ix(config.programId, 'claim_uncontested', [], [
    rw(marketKey), rw(signer.publicKey),
  ])), signer, `claim uncontested ${marketKey.toBase58()}`);
  const settled = await readMarket(connection, config.programId, marketKey);
  requireValue(settled.state === 2 && settled.byReexecution === 0 && settled.settledFlag === market.resolverFlag,
    `market ${marketKey.toBase58()} did not settle as uncontested`);
  return { market: marketKey, bondReturned: market.resolverBond, state: settled.state };
}

export async function runKeeper({ config, signer = signerFromConfig(config), connection = new Connection(config.rpc, 'confirmed'), fetch = fetchObservations, write = true, chainNow = null } = {}) {
  requireValue(config, 'config is required');
  // Defend custody before trying to create the next window. A quiet/missing current source must
  // never prevent an already challenged position from reaching its Feed before `settle_by`.
  const failures = [];
  const recordFailure = (stage, error, detail = {}) => failures.push({ stage, error: errorText(error), ...detail });
  let positions = [];
  try { positions = await keeperMarkets({ connection, config, signer }); }
  catch (error) { recordFailure('scan custody', error); }
  const cranked = [];
  for (const { pubkey, market } of positions) {
    if (market.state !== 1) continue;
    try { cranked.push(await crankMarket({ connection, config, signer, marketKey: pubkey })); }
    catch (error) { recordFailure('crank', error, { market: pubkey.toBase58() }); }
  }
  const claimed = [];
  // Claim deadlines are custody state, so they always use the validator's current clock. The
  // optional `chainNow` seam below exists solely to replay an already closed source window in
  // tests; using it for a live deadline would reintroduce host/chain time mixing.
  let custodyNow = null;
  try { custodyNow = await chainTime(connection); }
  catch (error) { recordFailure('read chain time', error); }
  const effectiveChainNow = chainNow ?? custodyNow;
  if (custodyNow != null) {
    for (const { pubkey, market } of positions) {
      if (market.state !== 0 || BigInt(custodyNow) <= market.challengeUntil) continue;
      try { claimed.push(await claimUncontested({ connection, config, signer, marketKey: pubkey })); }
      catch (error) { recordFailure('claim uncontested', error, { market: pubkey.toBase58() }); }
    }
  }
  const opened = [];
  for (const subject of config.subjects) {
    try { opened.push(await openSubject({ connection, config, signer, subject, fetch, chainNow: effectiveChainNow })); }
    catch (error) { recordFailure('open', error, { subject }); }
  }
  let board = null;
  if (write) {
    try { board = await writeBoard({ connection, config, signer, fetch, chainNow: effectiveChainNow, failures }); }
    catch (error) { recordFailure('write board', error); }
  }
  return { opened, cranked, claimed, failures, board };
}
