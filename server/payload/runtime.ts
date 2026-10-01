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
type RuntimeSettings = {directory: string; secret: string; siteOrigin: string; sourceURL: string; authorId: string; smtp?: unknown; push?: boolean};

export async function createPayloadRuntime(
  configPath = process.env.PAYLOAD_CONFIG_FILE || ".local/payload-env.json",
) {
  const settings = JSON.parse(await readFile(resolve(configPath), "utf8")) as RuntimeSettings;
  settings.directory = resolve(settings.directory);
  settings.siteOrigin = process.env.SITE_ORIGIN || settings.siteOrigin;
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
  const readerRetention = createReaderRetention({ payload: payload as unknown as Parameters<typeof createReaderRetention>[0]['payload'], directory: settings.directory, uidStore, loginLedger, workflow, mediaRetention,
    keepReader: id => community.store?.hasContent(id) ?? false });
  return {
    payload,
    store,
    settings,
    contentService: createContentService({...options,revision:publicationRevision.read}),
    authorService,
    readerService,
    communityService: community.service,
    readerAdminService:createReaderAdminService({payload,authorService,siteOrigin:settings.siteOrigin,directory:settings.directory,authorId:settings.authorId,loginLedger,uidStore,workflow,mediaRetention}),
    readerRetention,
    healthCheck:async()=>{await payload.find({collection:'site_profile',limit:1,depth:0});},
    close: async () => {
      publicationRevision.close();
      await readerRetention.close();
      community.close();
      loginLedger.close();
      uidStore.close();
      await payload.destroy();
      (payload.db as unknown as {client: {close: () => void}}).client.close();
    },
  };
}
