import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getPayload } from "payload";
import { makePayloadConfig } from "./config.mjs";
import { createPayloadStore } from "./store.mjs";
import { createAuthorService } from "../author-service.mjs";
import { createContentService } from "../content-service.mjs";

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
  const store = createPayloadStore(payload, settings);
  const options = { ...settings, url: settings.sourceURL, store };
  return {
    payload,
    store,
    settings,
    contentService: createContentService(options),
    authorService: createAuthorService(options),
    healthCheck:async()=>{await payload.find({collection:'site_profile',limit:1,depth:0});},
    close: async () => {
      await payload.destroy();
      payload.db.client.close();
    },
  };
}
