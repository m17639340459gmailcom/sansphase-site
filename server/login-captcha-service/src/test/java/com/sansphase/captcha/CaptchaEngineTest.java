package com.sansphase.captcha;

import cloud.tianai.captcha.common.AnyMap;
import cloud.tianai.captcha.validator.common.model.dto.ImageCaptchaTrack;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

import static org.junit.jupiter.api.Assertions.*;

class CaptchaEngineTest {
    @Test void challengeContainsOnlyImagesAndPublicDimensions() throws Exception {
        try (var engine = new CaptchaEngine()) {
            var challenge = engine.challenge();
            var json = new ObjectMapper().valueToTree(challenge);
            assertEquals(8, json.size());
            assertEquals("SLIDER", json.get("type").asText());
            assertTrue(challenge.id().matches("SLIDER_[a-f0-9]{32}"));
            assertTrue(challenge.backgroundImage().startsWith("data:image/"));
            assertTrue(challenge.templateImage().startsWith("data:image/png;base64,"));
            assertEquals(600, challenge.backgroundImageWidth());
            assertEquals(360, challenge.backgroundImageHeight());
            assertEquals(360, challenge.templateImageHeight());
            assertFalse(json.has("percentage"));
            assertFalse(json.has("randomX"));
            assertFalse(json.has("data"));
        }
    }

    @Test void genuineLibraryMatchingAcceptsCorrectTrackAndConsumesOnce() {
        try (var engine = new CaptchaEngine()) {
            var challenge = engine.challenge();
            var track = correctTrack(engine, challenge.id());
            assertTrue(engine.verify(challenge.id(), track));
            assertFalse(engine.verify(challenge.id(), track));
        }
    }

    @Test void sharedNodeContractWithUppercaseTypesAndLeftTopUsesRealMatching() {
        try (var engine = new CaptchaEngine()) {
            var challenge = engine.challenge();
            var track = correctTrack(engine, challenge.id());
            track.setLeft(Math.round(track.getTrackList().getLast().getX()));
            track.setTop(0);
            for (var point : track.getTrackList()) point.setType(point.getType().toUpperCase(java.util.Locale.ROOT));
            assertTrue(engine.verify(challenge.id(), track));
        }
    }

    @Test void wrongPositionAndTooFastMovementNeverVerify() {
        try (var engine = new CaptchaEngine()) {
            var wrong = engine.challenge();
            var track = correctTrack(engine, wrong.id());
            track.getTrackList().getLast().setX(0f);
            assertFalse(engine.verify(wrong.id(), track));
            assertFalse(engine.verify(wrong.id(), correctTrackFixture(200)));

            var fast = engine.challenge();
            var fastTrack = correctTrack(engine, fast.id());
            fastTrack.setStopTime(fastTrack.getStartTime() + 100);
            for (var point : fastTrack.getTrackList()) point.setT(point.getT() / 12);
            assertFalse(engine.verify(fast.id(), fastTrack));
        }
    }

    @Test void expirationIsCheckedOnAtomicRemovalWithoutMaintenanceThread() {
        var ticker = new AtomicLong();
        var cache = new CaptchaCache(Duration.ofSeconds(1), 64, ticker::get);
        try (var engine = new CaptchaEngine(cache)) {
            var challenge = engine.challenge();
            var track = correctTrack(engine, challenge.id());
            ticker.set(Duration.ofSeconds(2).toNanos());
            assertFalse(engine.verify(challenge.id(), track));
        }
    }

    @Test void simultaneousVerificationCanSucceedOnlyOnce() throws Exception {
        try (var engine = new CaptchaEngine(); var executor = Executors.newFixedThreadPool(8)) {
            var challenge = engine.challenge();
            var target = correctTrack(engine, challenge.id()).getTrackList().getLast().getX();
            var results = new ArrayList<java.util.concurrent.Future<Boolean>>();
            for (int i = 0; i < 16; i++) {
                results.add(executor.submit(() -> engine.verify(challenge.id(), correctTrackFixture(target))));
            }
            int successes = 0;
            for (var result : results) if (result.get()) successes++;
            assertEquals(1, successes);
        }
    }

    @Test void tracksAreBoundedAndRejectNonFiniteAndNonMonotonicValues() {
        var good = correctTrackFixture(200);
        assertDoesNotThrow(() -> CaptchaEngine.validateTrack(good));
        good.getTrackList().get(2).setX(Float.NaN);
        assertThrows(IllegalArgumentException.class, () -> CaptchaEngine.validateTrack(good));
        var reversed = correctTrackFixture(200);
        reversed.getTrackList().get(2).setT(-2f);
        assertThrows(IllegalArgumentException.class, () -> CaptchaEngine.validateTrack(reversed));
        var many = correctTrackFixture(200);
        many.setTrackList(java.util.Collections.nCopies(513, many.getTrackList().getFirst()));
        assertThrows(IllegalArgumentException.class, () -> CaptchaEngine.validateTrack(many));
    }

    @Test void challengeCacheIsBoundedWithoutAnUnboundedRegistry() {
        var cache = new CaptchaCache(Duration.ofMinutes(2), 4, System::nanoTime);
        for (int i = 0; i < 100; i++) cache.setCache("item-" + i, AnyMap.of(new java.util.HashMap<>()), 120_000L, java.util.concurrent.TimeUnit.MILLISECONDS);
        int present = 0;
        for (int i = 0; i < 100; i++) if (cache.getCache("item-" + i) != null) present++;
        assertTrue(present <= 4);
        cache.close();
    }

    @Test void malformedAttemptConsumesItsChallengeAndAllowsNoSecondProbe() {
        try (var engine = new CaptchaEngine()) {
            var challenge = engine.challenge();
            var track = correctTrack(engine, challenge.id());
            assertThrows(IllegalArgumentException.class, () -> engine.verify(challenge.id(), null));
            assertFalse(engine.verify(challenge.id(), track));
        }
    }

    static ImageCaptchaTrack correctTrack(CaptchaEngine engine, String id) {
        AnyMap data = engine.cacheForTests().getCache("sansphase:" + id);
        assertNotNull(data);
        return correctTrackFixture(data.getFloat("percentage") * 600);
    }

    static ImageCaptchaTrack correctTrackFixture(float targetX) {
        var track = new ImageCaptchaTrack();
        track.setBgImageWidth(600);
        track.setBgImageHeight(360);
        track.setTemplateImageWidth(110);
        track.setTemplateImageHeight(360);
        track.setStartTime(1_700_000_000_000L);
        track.setStopTime(1_700_000_001_200L);
        List<ImageCaptchaTrack.Track> points = new ArrayList<>();
        points.add(new ImageCaptchaTrack.Track(0f, 0f, 0f, "down"));
        for (int i = 1; i < 30; i++) {
            float fraction = i / 30f;
            points.add(new ImageCaptchaTrack.Track(targetX * fraction, (float) Math.sin(i), i * 30f, "move"));
        }
        points.add(new ImageCaptchaTrack.Track(targetX, 1f, 1200f, "up"));
        track.setTrackList(points);
        return track;
    }
}
