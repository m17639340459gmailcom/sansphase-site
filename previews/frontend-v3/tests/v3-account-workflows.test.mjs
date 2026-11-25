import assert from "node:assert/strict";
import test from "node:test";
import {
  readPersonalProfile, readerRegistrationEnabled, registerReader, removeReaderAvatar, resendReaderCode,
  resetReaderPassword, requestReaderReset, saveReaderProfile, uploadReaderAvatar, verifyReaderCode,
} from "../src/lib/account-session.ts";
import {
  accountReturn, accountInvitation, resetTokenFromAddress, signInDestination,
} from "../src/components/account/account-paths.ts";

const requestId = "c42cdabc-c64c-49b2-9fcf-a5ccade9e430";
const resetToken = "test-token-for-reader-reset";
const signal = new AbortController().signal;

test("reader forms call the existing same-origin account endpoints with the correct fields", async () => {
  const calls = [];
  const fetchStub = async (path, options) => {
    calls.push({ path, options, body: options.body && JSON.parse(options.body) });
    return Response.json({ requestId });
  };
  const registration = { email: "reader@example.test", nickname: "Reader", phone: "13800000000", password: "synthetic-password", inviteCode: "A".repeat(24) };
  assert.equal(await registerReader(registration, signal, fetchStub), requestId);
  assert.equal(await resendReaderCode(registration.email, requestId, signal, fetchStub), requestId);
  await verifyReaderCode(registration.email, requestId, "012345", signal, fetchStub);
  await requestReaderReset(registration.email, signal, fetchStub);
  await resetReaderPassword(resetToken, registration.password, signal, fetchStub);
  await saveReaderProfile({ nickname: "Reader", signature: "", phone: "13800000000" }, signal, fetchStub);
  assert.deepEqual(calls.map(({ path, body }) => [path, body]), [
    ["/api/reader/register", registration],
    ["/api/reader/resend", { email: registration.email, requestId }],
    ["/api/reader/verify", { email: registration.email, requestId, code: "012345" }],
    ["/api/reader/forgot", { email: registration.email }],
    ["/api/reader/reset", { token: resetToken, password: registration.password }],
    ["/api/reader/profile", { nickname: "Reader", signature: "", phone: "13800000000" }],
  ]);
  for (const { path, options } of calls) {
    assert.equal(path.includes("?"), false);
    assert.equal(options.method, "POST");
    assert.equal(options.cache, "no-store");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers.get("X-Reader-Request"), "1");
  }
});

test("registration capability comes from the backend and avatar URLs stay on the reader API", async () => {
  assert.equal(await readerRegistrationEnabled(signal, async (path, options) => {
    assert.equal(path, "/api/content?view=bootstrap&public=1");
    assert.equal(options.credentials, "omit");
    return Response.json({ readerRegistrationEnabled: true });
  }), true);
  const profile = await readPersonalProfile(signal, async () => Response.json({
    nickname: "Reader", email: "reader@example.test", phone: "13800000000",
    vip: false, vipUntil: "2026-01-01T00:00:00Z", pendingAvatar: true,
    avatar: "https://external.example.test/avatar.webp",
  }));
  assert.equal(profile.vip, false);
  assert.equal(profile.vipUntil, "2026-01-01T00:00:00Z");
  assert.equal(profile.avatar, null);
  assert.equal(profile.pendingAvatar, true);
});

test("avatar changes reuse the existing multipart upload and authenticated removal endpoints", async () => {
  const file = new File(["fixture"], "avatar.webp", { type: "image/webp" });
  await uploadReaderAvatar(file, signal, async (path, options) => {
    assert.equal(path, "/api/reader/avatar");
    assert.equal(options.method, "POST");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.headers.get("X-Reader-Request"), "1");
    assert.equal(options.headers.has("Content-Type"), false, "fetch supplies the multipart boundary");
    assert.deepEqual(Array.from(options.body.entries()), [["file", file]]);
    return Response.json({ reviewPending: true });
  });
  await removeReaderAvatar(signal, async (path, options) => {
    assert.equal(path, "/api/reader/avatar/remove");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.get("X-Reader-Request"), "1");
    assert.equal(options.body, "{}");
    return Response.json({});
  });
});

test("account return handling only accepts known local pages and keeps admin returns owner-only", () => {
  assert.equal(accountReturn(new URLSearchParams({ return: "/community" })).page, "/community");
  assert.equal(accountReturn(new URLSearchParams({ returnTo: "/en/learning/course" })).page, "/en/learning/course");
  assert.equal(accountReturn(new URLSearchParams({ return: "/work/example" })).page, "/projects/example");
  for (const rejected of ["//example.test/", "/\\example.test/", "/resources/%2f%2fabc", "/account", "/verify", "/admin-console/", "/learning/../account"]) {
    assert.equal(accountReturn(new URLSearchParams({ return: rejected })).page, null, rejected);
  }
  const admin = accountReturn(new URLSearchParams({ adminReturn: "maintenance" }));
  assert.equal(signInDestination("owner", admin), "/admin-console/#/maintenance");
  assert.equal(signInDestination("reader", admin), null);
  assert.equal(accountReturn(new URLSearchParams("return=/community&returnTo=/projects")).page, null);
  assert.equal(accountReturn(new URLSearchParams("adminReturn=maintenance&adminReturn=activity")).admin, null);
});

test("invitations and old reset links are validated without converting old verification tokens to codes", () => {
  const invitation = "A".repeat(24);
  assert.deepEqual(accountInvitation(new URLSearchParams({ invite: invitation })), { present: true, code: invitation });
  assert.deepEqual(accountInvitation(new URLSearchParams("invite=x&invite=y")), { present: true, code: null });
  assert.equal(resetTokenFromAddress(new URL(`https://site.example/#/reset/${resetToken}`)), resetToken);
  assert.equal(resetTokenFromAddress(new URL(`https://site.example/reset#${resetToken}`)), resetToken);
  assert.equal(resetTokenFromAddress(new URL(`https://site.example/en/reset/${resetToken}`)), resetToken);
  assert.equal(resetTokenFromAddress(new URL(`https://site.example/reset?token=${resetToken}`)), resetToken);
  assert.equal(resetTokenFromAddress(new URL(`https://site.example/verify/${resetToken}`)), null);
  assert.equal(resetTokenFromAddress(new URL(`https://site.example/reset?token=${resetToken}#${resetToken}`)), null);
});
