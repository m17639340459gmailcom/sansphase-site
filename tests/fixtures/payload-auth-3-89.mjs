// Captured from actual Payload 3.89.0 using isolated synthetic accounts.
// No production data or credentials are included.
export const legacyAuthFixture = {
  "version": "3.89.0",
  "password": "isolated-upgrade-fixture-password-2026",
  "schema": [
    {
      "type": "index",
      "name": "authors_created_at_idx",
      "tbl_name": "authors",
      "sql": "CREATE INDEX `authors_created_at_idx` ON `authors` (`created_at`)"
    },
    {
      "type": "index",
      "name": "authors_email_idx",
      "tbl_name": "authors",
      "sql": "CREATE UNIQUE INDEX `authors_email_idx` ON `authors` (`email`)"
    },
    {
      "type": "index",
      "name": "authors_sessions_order_idx",
      "tbl_name": "authors_sessions",
      "sql": "CREATE INDEX `authors_sessions_order_idx` ON `authors_sessions` (`_order`)"
    },
    {
      "type": "index",
      "name": "authors_sessions_parent_id_idx",
      "tbl_name": "authors_sessions",
      "sql": "CREATE INDEX `authors_sessions_parent_id_idx` ON `authors_sessions` (`_parent_id`)"
    },
    {
      "type": "index",
      "name": "authors_updated_at_idx",
      "tbl_name": "authors",
      "sql": "CREATE INDEX `authors_updated_at_idx` ON `authors` (`updated_at`)"
    },
    {
      "type": "index",
      "name": "readers_created_at_idx",
      "tbl_name": "readers",
      "sql": "CREATE INDEX `readers_created_at_idx` ON `readers` (`created_at`)"
    },
    {
      "type": "index",
      "name": "readers_email_idx",
      "tbl_name": "readers",
      "sql": "CREATE UNIQUE INDEX `readers_email_idx` ON `readers` (`email`)"
    },
    {
      "type": "index",
      "name": "readers_sessions_order_idx",
      "tbl_name": "readers_sessions",
      "sql": "CREATE INDEX `readers_sessions_order_idx` ON `readers_sessions` (`_order`)"
    },
    {
      "type": "index",
      "name": "readers_sessions_parent_id_idx",
      "tbl_name": "readers_sessions",
      "sql": "CREATE INDEX `readers_sessions_parent_id_idx` ON `readers_sessions` (`_parent_id`)"
    },
    {
      "type": "index",
      "name": "readers_updated_at_idx",
      "tbl_name": "readers",
      "sql": "CREATE INDEX `readers_updated_at_idx` ON `readers` (`updated_at`)"
    },
    {
      "type": "table",
      "name": "authors",
      "tbl_name": "authors",
      "sql": "CREATE TABLE `authors` (\n\t`id` text(36) PRIMARY KEY NOT NULL,\n\t`first_name` text,\n\t`role` text DEFAULT 'owner' NOT NULL,\n\t`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,\n\t`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,\n\t`email` text NOT NULL,\n\t`reset_password_token` text,\n\t`reset_password_expiration` text,\n\t`salt` text,\n\t`hash` text,\n\t`login_attempts` numeric DEFAULT 0,\n\t`lock_until` text\n)"
    },
    {
      "type": "table",
      "name": "authors_sessions",
      "tbl_name": "authors_sessions",
      "sql": "CREATE TABLE `authors_sessions` (\n\t`_order` integer NOT NULL,\n\t`_parent_id` text(36) NOT NULL,\n\t`id` text PRIMARY KEY NOT NULL,\n\t`created_at` text,\n\t`expires_at` text NOT NULL,\n\tFOREIGN KEY (`_parent_id`) REFERENCES `authors`(`id`) ON UPDATE no action ON DELETE cascade\n)"
    },
    {
      "type": "table",
      "name": "reader_uids",
      "tbl_name": "reader_uids",
      "sql": "CREATE TABLE reader_uids (\n  uid INTEGER PRIMARY KEY AUTOINCREMENT,\n  reader_id text NOT NULL UNIQUE\n)"
    },
    {
      "type": "table",
      "name": "readers",
      "tbl_name": "readers",
      "sql": "CREATE TABLE `readers` (\n\t`id` text(36) PRIMARY KEY NOT NULL,\n\t`nickname` text NOT NULL,\n\t`phone` text,\n\t`signature` text,\n\t`avatar` text,\n\t`vip_started_at` text,\n\t`vip_until` text,\n\t`disabled` integer DEFAULT false,\n\t`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,\n\t`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,\n\t`email` text NOT NULL,\n\t`reset_password_token` text,\n\t`reset_password_expiration` text,\n\t`salt` text,\n\t`hash` text,\n\t`_verified` integer,\n\t`_verificationtoken` text,\n\t`login_attempts` numeric DEFAULT 0,\n\t`lock_until` text\n)"
    },
    {
      "type": "table",
      "name": "readers_sessions",
      "tbl_name": "readers_sessions",
      "sql": "CREATE TABLE `readers_sessions` (\n\t`_order` integer NOT NULL,\n\t`_parent_id` text(36) NOT NULL,\n\t`id` text PRIMARY KEY NOT NULL,\n\t`created_at` text,\n\t`expires_at` text NOT NULL,\n\tFOREIGN KEY (`_parent_id`) REFERENCES `readers`(`id`) ON UPDATE no action ON DELETE cascade\n)"
    },
    {
      "type": "trigger",
      "name": "reader_uids_on_insert",
      "tbl_name": "readers",
      "sql": "CREATE TRIGGER reader_uids_on_insert AFTER INSERT ON readers\nBEGIN\n  INSERT INTO reader_uids (reader_id) VALUES (NEW.id);\nEND"
    }
  ],
  "accounts": {
    "authors": [
      {
        "id": "11111111-1111-4111-8111-111111111111",
        "first_name": "模拟作者",
        "role": "owner",
        "updated_at": "2026-10-10T00:50:05.204Z",
        "created_at": "2026-10-10T00:50:05.203Z",
        "email": "owner@payload-upgrade.example.test",
        "reset_password_token": null,
        "reset_password_expiration": null,
        "salt": "eeca1c05a036e97335821ac11678914bcd6e3cbb9e55d6fe3e7d9a1671dbfb5a",
        "hash": "bbd00197273df8e737fb9e8e7d6b35610c8b5b99c4215dc7b101ec4c585b5bc03d5c23d3b16166986dc5c3a1e1e04b1163cbf654e4ba3f2d1515e971c7c5b46fab6abb8747fc4a035a66dd4561ec440e27d11557584e335646b3c17c085589d0e72142af1c542d26aad9b45347acf227c67483566adf6d3b9e8000e39736b92f17653331817fafb1260939e6966fb690e4ec8398bb8488e2e2df583ecdbcef030135901111a9d622fb49d1f4d8d4f89f0b027b75791489b5ca339c3c6cc87d2b17beed039460509bbf896688dcd05da92dacf104d77e6f23baff003848061a4c147d1a621ca796de682e5a25225c540880adcc352bfa8317dce1799015ed0bfc92c41b65a8a0a570552020b180942ef081d9804818c97fadeee9eaae10ef2760494629c3f54aeed469b8cf7aeaf46f37e8b3b1084f5fe1d360a6216660e5177cd20997dcc4338d95774d8aac904a761b08be88429a3ef23d469fa9d8fa17fd695ff9eafa4295ee370f2bac94fe29e8e92aeade96a10319e8893736a4badfc1627adcd20e4eaefa2b5087907569bba04b259e2aee568482acc9ed6de776cd73e9951699681e739204499bea54deec2e9a6eb45e191fd2977fd5580cac78266e5ebacf04e7cea7e678901d33eee526210d06e54e14e2f5f64b712be580c43db9027f42df87c06a4552047e1e6df959ec3f5deb0ce85be871819e4e1ce65f3480b9",
        "login_attempts": 0,
        "lock_until": null
      }
    ],
    "readers": [
      {
        "id": "22222222-2222-4222-8222-222222222222",
        "nickname": "模拟读者",
        "phone": "13800138000",
        "signature": "模拟资料应保持原样",
        "avatar": "33333333-3333-4333-8333-333333333333",
        "vip_started_at": "2026-10-01T00:00:00.000Z",
        "vip_until": "2030-01-01T00:00:00.000Z",
        "disabled": 0,
        "updated_at": "2026-10-10T00:50:05.266Z",
        "created_at": "2026-10-10T00:50:05.265Z",
        "email": "reader@payload-upgrade.example.test",
        "reset_password_token": null,
        "reset_password_expiration": null,
        "salt": "c819bd67dc83c1f30811a8053a34c59fb3d0ab36e202c74b6286c3d27a5035cb",
        "hash": "0b56d766573ebc044e7a6f9479766654f29985a12df91c41ff96f6687deba58e4a6a9bc4de5805e3da4efaa7bba6556a48e80de32238fb26576eecd62e4269babd58142ceed207ad3a624d731ea74de7dcfdc9087412423c1aba5d6fcbd277cf5a9e8f3a8f31e4fc0225933484194511eae0b1d3cf93fe8b89db99d0d5978bde9a299db3930e31d4b79a68c8273ce69cc1ab4e75f29fa7503ecb4d10302d34573645599e4979d9c4c9ac41c84d8ad1325066f8deb7e10c71166b775c1b0e9d8649d66300135f5ee9d159856a788cbd63dfa5a9a3762667ccc226b2f63a01bc8979c5251cf12a079fc45b34e6b9910af9788c86122181be73ded1e55e6503f601df84f362dc47f71b472fb2d14829de34bee0b240fb065491d6360e1dc120a8de5236513f1c0571aa318f8eca9793b677522f512d868e8a5188de0da655b23e9cc1d4650a3d8cbd8bdeec23e64cd42ab07287b7fd2b90951fcccfceca44eec2740799b94f5971b1ab09334e8bd874b8a500e8103ef742381a8304758262d7186f5abc7a4b3e5dcfada263f1cf7e51bdb1807c71d2b5a9af246d6cce5e8fcb21855e8b39a2b93523255bc277e895a089abad22a2be9cbbb562c5a7821adf2eb90a41162174e891280388856123263c5ff25046292642855ebcf4cf3ede642f28d4e9bc08528a565fdb1976434fb476f685aa6b1b3599ec0b68a179149365b813ff",
        "_verified": 1,
        "_verificationtoken": "2f7195ebfdd012837596c3e2d70bb32025a50aca",
        "login_attempts": 0,
        "lock_until": null
      }
    ]
  }
};
