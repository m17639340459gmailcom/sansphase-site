import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getPayload } from "payload";
import { makePayloadConfig } from "./config.ts";
import { createPayloadStore } from "./store.ts";
import { createAuthorService } from "../author-service.ts";
import { createReaderService } from '../reader-service.ts';
import {createReaderAdminService} from '../reader-admin-service.ts';
import { createContentService } from "../content-service.ts";
import {createPublicationRevision} from './publication-revision.ts';
import { smtpConfigured } from './smtp-settings.ts';
import { createLoginLedger } from '../login-ledger.ts';
import { createReaderUidStore } from '../reader-uids.ts';
import { createReaderRetention } from '../reader-retention.ts';
import { createReaderWorkflow } from '../reader-workflow.ts';
import { createMediaRetention } from './media-retention.ts';
import { createCommunityRuntime } from '../community-runtime.ts';
import { createIdentityAuthority } from '../community-identity-authority.ts';
import { createIdentityClient } from '../community-identity-protocol.ts';
import { createIdentityStore } from '../community-identity-store.ts';
export type MainCommunityIdentitySettings = { communityOrigin: 'https://community.sansphase.com'; bridgeSecret: string; stateEncryptionKey: string };
type RuntimeSettings = {directory: string; secret: string; siteOrigin: string; sourceURL: string; authorId: string; smtp?: unknown; push?: boolean; communityEnabled?: boolean; communityIdentity?: unknown};

export function readMainCommunityIdentitySettings(settings: Pick<RuntimeSettings, 'secret' | 'communityIdentity'>): MainCommunityIdentitySettings | null {
  const config = settings.communityIdentity;
  if (config === undefined) return null;
  if (!config || typeof config !== 'object' || !('communityOrigin' in config) || config.communityOrigin !== 'https://community.sansphase.com'
    || !('bridgeSecret' in config) || typeof config.bridgeSecret !== 'string' || Buffer.byteLength(config.bridgeSecret) < 32
    || !('stateEncryptionKey' in config) || typeof config.stateEncryptionKey !== 'string' || Buffer.byteLength(config.stateEncryptionKey) < 32
    || config.bridgeSecret === config.stateEncryptionKey || config.bridgeSecret === settings.secret || config.stateEncryptionKey === settings.secret) throw Error('Main community identity configuration requires the approved destination and separate private keys.');
  return { communityOrigin: config.communityOrigin, bridgeSecret: config.bridgeSecret, stateEncryptionKey: config.stateEncryptionKey };
}

export async function createPayloadRuntime(
  configPath = process.env.PAYLOAD_CONFIG_FILE || ".local/payload-env.json",
) {
  const settings = JSON.parse(await readFile(resolve(configPath), "utf8")) as RuntimeSettings;
  settings.directory = resolve(settings.directory);
  settings.siteOrigin = process.env.SITE_ORIGIN || settings.siteOrigin;
  const bridgeSettings = readMainCommunityIdentitySettings(settings);
  if (bridgeSettings) {
    // Fail before opening the account runtime if explicit state preparation is
    // missing. Startup never initializes this server-to-server state database.
    const prepared = createIdentityStore({ directory: settings.directory, stateEncryptionKey: bridgeSettings.stateEncryptionKey });
    prepared.close();
  }
  const manifest = JSON.parse(
    await readFile(
      resolve(settings.directory, "migration-complete.json"),
      "utf8",
    ),
  );
  if (manifest.provider !== "payload")
    throw new Error("Payload data has not passed migration validation.");
  const payload = await getPayload({ config: makePayloadConfig(settings) });
  const loginLedger = createLoginLedger(settings.directory);
  const uidStore = createReaderUidStore(settings.directory);
  const workflow = createReaderWorkflow(settings.directory, settings.secret);
  const mediaRetention = createMediaRetention({ payload, directory: settings.directory });
  const store = createPayloadStore(payload, { ...settings, mediaRetention });
  const publicationRevision=createPublicationRevision(settings.directory);
  const options = { ...settings, url: settings.sourceURL, store, loginLedger };
  const authorService=createAuthorService(options);
  const readerService=createReaderService({payload,siteOrigin:settings.siteOrigin,directory:settings.directory,emailReady:smtpConfigured(settings.smtp),authorService,loginLedger,uidStore,workflow});
  const community = createCommunityRuntime({
    payload, directory: settings.directory, siteOrigin: settings.siteOrigin, authorId: settings.authorId, uidStore,
    readerIdentity: readerService.identity,
    ownerIdentity: req => authorService.identity(req),
    ownerName: async () => {
      const found = await payload.find({ collection: 'site_profile', limit: 1, depth: 0, overrideAccess: true });
      return String((found.docs[0] as { name?: string } | undefined)?.name || '無相');
    },
  });
  const purgeClient = bridgeSettings ? createIdentityClient({ origin: bridgeSettings.communityOrigin, secret: bridgeSettings.bridgeSecret, path: '/api/community-identity/purge' }) : null;
  const identityAuthority = bridgeSettings ? createIdentityAuthority({
    directory: settings.directory, siteOrigin: settings.siteOrigin, communityOrigin: bridgeSettings.communityOrigin,
    ownerId: settings.authorId, secret: bridgeSettings.bridgeSecret, stateEncryptionKey: bridgeSettings.stateEncryptionKey,
    readerIdentity: readerService.identityStrict, ownerIdentity: req => authorService.identityStrict(req),
    ...community.directory,
    purgeRemote: async readerId => {
      const result = await purgeClient!.request<{ ok?: boolean }>('purge', { readerId });
      if (result?.ok !== true) throw Error('Independent community cleanup was not confirmed.');
    },
  }) : undefined;
  const purgeCommunity = async (id: string) => {
    community.purgeReaderData(id, workflow.queueFile);
    if (identityAuthority) await identityAuthority.purgeReaderData(id);
  };
  const readerRetention = createReaderRetention({ payload: payload as unknown as Parameters<typeof createReaderRetention>[0]['payload'], directory: settings.directory, uidStore, loginLedger, workflow, mediaRetention, purgeCommunity });
  return {
    payload,
    store,
    settings,
    contentService: createContentService({...options,revision:publicationRevision.read}),
    authorService,
    readerService,
    communityService: community.service,
    identityAuthority,
    communityDestination: bridgeSettings?.communityOrigin,
    // Access is opt-in; the store still serves the existing account cleanup path.
    communityEnabled: !bridgeSettings && settings.communityEnabled === true && Boolean(community.store),
    readerAdminService:createReaderAdminService({payload,authorService,siteOrigin:settings.siteOrigin,directory:settings.directory,authorId:settings.authorId,loginLedger,uidStore,workflow,mediaRetention,purgeCommunity}),
    readerRetention,
    healthCheck:async()=>{await payload.find({collection:'site_profile',limit:1,depth:0});},
    close: async () => {
      publicationRevision.close();
      await readerRetention.close();
      identityAuthority?.close();
      community.close();
      loginLedger.close();
      uidStore.close();
      await payload.destroy();
      (payload.db as unknown as {client: {close: () => void}}).client.close();
    },
  };
}
