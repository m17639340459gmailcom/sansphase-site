import { buildConfig } from "payload";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { nodemailerAdapter } from '@payloadcms/email-nodemailer';
import sharp from "sharp";
import { resolve } from "node:path";
import { MAX_BODY_LENGTH } from '../content-limits.ts';
import { smtpConfigured, smtpTransportOptions } from './smtp-settings.ts';

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
  { name: "body", type: "textarea", maxLength: MAX_BODY_LENGTH },
  text("cover"),
  text("published_at"),
];

export function makePayloadConfig({ directory, secret, push = false, siteOrigin = 'http://127.0.0.1:4176', smtp, emailAdapter, includeReaders = true }) {
  if (!secret || secret.length < 32)
    throw new Error("Payload secret is missing or too short.");
  return buildConfig({
    secret,
    serverURL: siteOrigin,
    telemetry: false,
    sharp,
    email: emailAdapter || (smtpConfigured(smtp) ? nodemailerAdapter({
      defaultFromAddress: smtp.from,
      defaultFromName: smtp.name || 'SANSPHASE',
      transportOptions: smtpTransportOptions(smtp),
    }) : () => ({
      name: "disabled",
      defaultFromAddress: "no-reply@localhost",
      defaultFromName: "SANSPHASE",
      sendEmail: async () => {
        throw new Error("Email delivery is not configured.");
      },
    })),
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
      ...(includeReaders ? [{
        slug: 'readers',
        // Public registration is exposed only through the narrow reader service.
        // Payload's Local API defaults to bypassing collection access; never
        // expose an unrestricted Payload REST/GraphQL route for this collection.
        access,
        auth: {
          verify: {
            generateEmailSubject: () => '验证你的 SANSPHASE 账号',
            generateEmailHTML: ({ token }) => `<p>点击链接验证邮箱并启用账号：</p><p><a href="${siteOrigin}/#/verify/${encodeURIComponent(token)}">验证邮箱</a></p><p>如果不是你注册的账号，可以忽略这封邮件。</p>`,
          },
          forgotPassword: {
            generateEmailSubject: () => '重置你的 SANSPHASE 密码',
            generateEmailHTML: ({ token }) => `<p>点击链接重置密码：</p><p><a href="${siteOrigin}/#/reset/${encodeURIComponent(token)}">重置密码</a></p><p>如果不是你申请的，可以忽略这封邮件。</p>`,
          },
          tokenExpiration: 7 * 86400,
          useSessions: true,
          maxLoginAttempts: 8,
          lockTime: 600000,
        },
        fields: [
          text('nickname', { required: true }),
          // Older reader accounts may predate the phone requirement. The public
          // registration endpoint enforces it for every new account.
          text('phone'),
          text('signature'),
          text('avatar'),
          text('vip_started_at'),
          text('vip_until'),
          { name: 'disabled', type: 'checkbox', defaultValue: false },
        ],
      }] : []),
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
          text("showcase_cover"),
          { name: "vip_only", type: "checkbox", defaultValue: false },
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
          json("content_order"),
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
