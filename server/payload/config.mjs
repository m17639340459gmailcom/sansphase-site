import { buildConfig } from "payload";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import sharp from "sharp";
import { resolve } from "node:path";

const owner = ({ req }) =>
  req.user?.collection === "authors" && req.user?.role === "owner";
const access = { read: owner, create: owner, update: owner, delete: owner };
const text = (name, extra = {}) => ({ name, type: "text", ...extra });
const json = (name) => ({ name, type: "json" });
const common = () => [
  text("title", { required: true }),
  {
    name: "status",
    type: "select",
    options: ["draft", "published", "archived"],
    defaultValue: "draft",
    required: true,
  },
  { name: "summary", type: "textarea" },
  json("pending_content"),
  text("date_created"),
  text("date_updated"),
];
const content = () => [
  ...common(),
  text("slug", { required: true, unique: true }),
  text("category"),
  json("tags"),
  { name: "body", type: "textarea" },
  text("cover"),
  text("published_at"),
];

export function makePayloadConfig({ directory, secret, push = false }) {
  if (!secret || secret.length < 32)
    throw new Error("Payload secret is missing or too short.");
  return buildConfig({
    secret,
    telemetry: false,
    sharp,
    email: () => ({
      name: "disabled",
      defaultFromAddress: "no-reply@localhost",
      defaultFromName: "SANSPHASE",
      sendEmail: async () => {
        throw new Error("Email delivery is not configured.");
      },
    }),
    admin: { user: "authors", disable: true },
    typescript: { autoGenerate: false },
    db: sqliteAdapter({
      client: {
        url: `file:${resolve(directory, "content.db").replaceAll("\\", "/")}`,
      },
      idType: "uuid",
      allowIDOnCreate: true,
      push,
      busyTimeout: 10000,
    }),
    collections: [
      {
        slug: "authors",
        access,
        auth: {
          tokenExpiration: 86400,
          useSessions: true,
          maxLoginAttempts: 8,
          lockTime: 600000,
        },
        fields: [
          text("first_name"),
          {
            name: "role",
            type: "select",
            options: ["owner"],
            required: true,
            defaultValue: "owner",
          },
        ],
      },
      {
        slug: "articles",
        access,
        fields: [...content(), json("attachments")],
        versions: { maxPerDoc: 30 },
      },
      {
        slug: "library_entries",
        access,
        fields: [
          ...content(),
          {
            name: "kind",
            type: "select",
            options: ["works", "resources", "software", "resource-center"],
            required: true,
          },
          text("file"),
          text("external_url"),
        ],
        versions: { maxPerDoc: 30 },
      },
      {
        slug: "announcements",
        access,
        fields: [
          ...common(),
          text("image"),
          text("link"),
          { name: "sort", type: "number", defaultValue: 0 },
        ],
        versions: { maxPerDoc: 30 },
      },
      {
        slug: "site_profile",
        access,
        fields: [
          text("name", { required: true }),
          text("signature"),
          { name: "bio", type: "textarea" },
          text("avatar"),
          text("background"),
          json("background_library"),
          json("social_links"),
          json("music_settings"),
          json("appearance"),
        ],
      },
      {
        slug: "media",
        access,
        upload: {
          staticDir: resolve(directory, "uploads"),
          disableLocalStorage: false,
          // This owner-only library distributes software (EXE/MSI/DMG/etc.).
          // Public files go through our authorized download route with attachment
          // headers; this directory is not served as executable site content.
          allowRestrictedFileTypes: true,
        },
        fields: [text("title"), text("originalName"), text("legacyFilename")],
      },
    ],
  });
}
