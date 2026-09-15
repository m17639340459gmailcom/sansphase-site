import test from "node:test";
import assert from "node:assert/strict";
import {
  sceneAssetUrl,
  staticAssetUrl,
  validateSceneCdnOrigin,
} from "../src/scene-delivery.mjs";

test("versioned static URLs keep API calls, navigation and external files on their original destinations", () => {
  const base="https://static.example/assets/site/abc/";
  assert.equal(staticAssetUrl('/assets/materials/normal.png',base),base+'assets/materials/normal.png');
  assert.equal(staticAssetUrl('./cosmos.bundle.mjs',base),base+'cosmos.bundle.mjs');
  for(const path of ['/api/author/login','/api/media/image','https://other.example/image.png','#/notes','/../server.mjs']) assert.equal(staticAssetUrl(path,base),path);
  assert.equal(staticAssetUrl('/assets/materials/normal.png',''),'/assets/materials/normal.png');
});

test("scene delivery keeps the original asset path and only relocates public scene images", () => {
  const path = "./assets/scene/eso0932a-4NHRAVJH.jpg";
  assert.equal(sceneAssetUrl(path, ""), path);
  assert.equal(
    sceneAssetUrl(path, "https://static.sansphase.com"),
    "https://static.sansphase.com/assets/scene/eso0932a-4NHRAVJH.jpg",
  );
  for (const other of [
    "./author.bundle.mjs",
    "/api/author/me",
    "/api/media/private.jpg",
    "https://other.example/photo.jpg",
  ]) {
    assert.equal(sceneAssetUrl(other, "https://static.sansphase.com"), other);
  }
});

test("CDN configuration accepts an HTTPS origin and rejects ambiguous or unsafe destinations", () => {
  assert.equal(validateSceneCdnOrigin(""), "");
  assert.equal(
    validateSceneCdnOrigin("https://static.sansphase.com/"),
    "https://static.sansphase.com",
  );
  for (const value of [
    "http://static.example",
    "//static.example",
    "https://u:p@static.example",
    "https://static.example/images",
    "https://static.example/?v=1",
    "https://static.example/#x",
  ]) {
    assert.throws(() => validateSceneCdnOrigin(value));
  }
});
