import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getPayload } from "payload";
import { makePayloadConfig } from "./config.mjs";
import { createPayloadStore } from "./store.mjs";
import { createAuthorService } from "../author-service.mjs";
import { createReaderService } from '../reader-service.mjs';
import {createReaderAdminService} from '../reader-admin-service.mjs';
import { createContentService } from "../content-service.mjs";
import {createPublicationRevision} from './publication-revision.mjs';
import { smtpConfigured } from './smtp-settings.mjs';
import { createLoginLedger } from '../login-ledger.mjs';
import { createReaderUidStore } from '../reader-uids.ts';
import { createReaderRetention } from '../reader-retention.ts';
import { createReaderWorkflow } from '../reader-workflow.ts';
import { createMediaRetention } from './media-retention.mjs';

export async function createPayloadRuntime(
  configPath = process.env.PAYLOAD_CONFIG_FILE || ".local/payload-env.json",
) {
  const settings = JSON.parse(await readFile(resolve(configPath), "utf8"));
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
  const readerRetention = createReaderRetention({ payload, directory: settings.directory, uidStore, loginLedger, workflow, mediaRetention });
  const store = createPayloadStore(payload, { ...settings, mediaRetention });
  const publicationRevision=createPublicationRevision(settings.directory);
  const options = { ...settings, url: settings.sourceURL, store, loginLedger };
  const authorService=createAuthorService(options);
  return {
    payload,
    store,
    settings,
    contentService: createContentService({...options,revision:publicationRevision.read}),
    authorService,
    readerService: createReaderService({payload,siteOrigin:settings.siteOrigin,directory:settings.directory,emailReady:smtpConfigured(settings.smtp),authorService,loginLedger,uidStore,workflow}),
    readerAdminService:createReaderAdminService({payload,authorService,siteOrigin:settings.siteOrigin,directory:settings.directory,authorId:settings.authorId,loginLedger,uidStore,workflow,mediaRetention}),
    readerRetention,
    healthCheck:async()=>{await payload.find({collection:'site_profile',limit:1,depth:0});},
    close: async () => {
      publicationRevision.close();
      await readerRetention.close();
      loginLedger.close();
      uidStore.close();
      await payload.destroy();
      payload.db.client.close();
    },
  };
}
