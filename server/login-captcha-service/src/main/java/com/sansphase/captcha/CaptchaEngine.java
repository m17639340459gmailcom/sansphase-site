package com.sansphase.captcha;

import cloud.tianai.captcha.application.ImageCaptchaApplication;
import cloud.tianai.captcha.application.TACBuilder;
import cloud.tianai.captcha.cache.CacheStore;
import cloud.tianai.captcha.generator.impl.StandardSliderImageCaptchaGenerator;
import cloud.tianai.captcha.resource.DefaultBuiltInResources;
import cloud.tianai.captcha.resource.ResourceProviders;
import cloud.tianai.captcha.resource.common.model.dto.Resource;
import cloud.tianai.captcha.resource.impl.DefaultImageCaptchaResourceManager;
import cloud.tianai.captcha.resource.impl.LocalMemoryResourceStore;
import cloud.tianai.captcha.validator.common.model.dto.ImageCaptchaTrack;
import cloud.tianai.captcha.validator.impl.BasicCaptchaTrackValidator;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.Semaphore;

final class CaptchaEngine implements AutoCloseable {
    private final ImageCaptchaApplication application;
    private final CacheStore cache;
    private final Semaphore generation = new Semaphore(2);
    private static final Set<String> TRACK_TYPES = Set.of("down", "move", "up", "DOWN", "MOVE", "UP");

    record Challenge(String id, String type, String backgroundImage, String templateImage,
                     int backgroundImageWidth, int backgroundImageHeight,
                     int templateImageWidth, int templateImageHeight) { }

    CaptchaEngine() { this(new CaptchaCache()); }

    CaptchaEngine(CacheStore cache) {
        this.cache = cache;
        try {
            var store = new LocalMemoryResourceStore();
            new DefaultBuiltInResources(DefaultBuiltInResources.PATH_PREFIX).addDefaultTemplate("SLIDER", store);
            var backgrounds = new BackgroundResources();
            for (int i = 0; i < backgrounds.size(); i++) {
                store.addResource("SLIDER", new Resource(backgrounds.getName(), Integer.toString(i)));
            }
            var providers = new ResourceProviders();
            // No network resources are used or accepted by this service.
            providers.deleteResourceProviderByName("URL");
            providers.registerResourceProvider(backgrounds);
            var resources = new DefaultImageCaptchaResourceManager(store, providers);
            application = TACBuilder.builder().setResourceStore(store).setCacheStore(cache)
                    .setGenerator(new StandardSliderImageCaptchaGenerator(resources))
                    .setValidator(new BasicCaptchaTrackValidator()).prefix("sansphase")
                    .expire("SLIDER", 120_000L).build();
        } catch (IOException error) {
            try { cache.close(); } catch (Exception ignored) { }
            throw new IllegalStateException("captcha scenery initialization failed", error);
        } catch (Exception error) {
            try { cache.close(); } catch (Exception ignored) { }
            throw new IllegalStateException("captcha initialization failed", error);
        }
    }

    Challenge challenge() {
        if (!generation.tryAcquire()) throw new BusyException();
        try {
            var result = application.generateCaptcha("SLIDER");
            if (!result.isSuccess() || result.getData() == null) throw new IllegalStateException("captcha generation failed");
            var value = result.getData();
            // Explicit projection deliberately excludes upstream answer and extra-data fields.
            return new Challenge(value.getId(), "SLIDER", value.getBackgroundImage(), value.getTemplateImage(),
                    value.getBackgroundImageWidth(), value.getBackgroundImageHeight(), value.getTemplateImageWidth(), value.getTemplateImageHeight());
        } finally { generation.release(); }
    }

    boolean verify(String id, ImageCaptchaTrack track) {
        if (id == null || !id.matches("SLIDER_[a-f0-9]{32}")) throw new IllegalArgumentException("invalid challenge id");
        try {
            validateTrack(track);
        } catch (IllegalArgumentException error) {
            // Malformed attempts consume the challenge as well; no repeated probing.
            cache.getAndRemoveCache("sansphase:" + id);
            throw error;
        }
        // Tianai consumes via our atomic, expiry-aware Caffeine adapter, for success and failure.
        return application.matching(id, track).isSuccess();
    }

    static void validateTrack(ImageCaptchaTrack track) {
        if (track == null || track.getData() != null) {
            throw new IllegalArgumentException("unsupported track fields");
        }
        requireDimension(track.getBgImageWidth());
        requireDimension(track.getBgImageHeight());
        requireDimension(track.getTemplateImageWidth());
        requireDimension(track.getTemplateImageHeight());
        if (track.getTemplateImageWidth() > track.getBgImageWidth()
                || track.getTemplateImageHeight() > track.getBgImageHeight()) throw new IllegalArgumentException("invalid template dimensions");
        if (track.getLeft() != null && (track.getLeft() < 0 || track.getLeft() > track.getBgImageWidth() - track.getTemplateImageWidth())) {
            throw new IllegalArgumentException("invalid slider position");
        }
        if (track.getTop() != null && track.getTop() != 0) throw new IllegalArgumentException("invalid vertical slider position");
        Long start = track.getStartTime(), stop = track.getStopTime();
        if (start == null || stop == null || start < 1 || stop < start || start > 9_000_000_000_000L
                || stop - start > 120_000) throw new IllegalArgumentException("invalid track duration");
        var points = track.getTrackList();
        if (points == null || points.size() < 2 || points.size() > 512) throw new IllegalArgumentException("invalid track length");
        float previous = -1;
        for (var point : points) {
            if (point == null || point.getType() == null || !TRACK_TYPES.contains(point.getType())) throw new IllegalArgumentException("invalid track type");
            requireFiniteBounded(point.getX(), 4096);
            requireFiniteBounded(point.getY(), 4096);
            requireFiniteBounded(point.getT(), 120_000);
            if (point.getT() < previous || point.getT() < 0 || point.getT() > stop - start + 20) throw new IllegalArgumentException("invalid track timing");
            previous = point.getT();
        }
        if (!"down".equalsIgnoreCase(points.getFirst().getType()) || !"up".equalsIgnoreCase(points.getLast().getType())) throw new IllegalArgumentException("invalid track events");
    }

    private static void requireDimension(Integer dimension) {
        if (dimension == null || dimension < 1 || dimension > 2048) throw new IllegalArgumentException("invalid image dimensions");
    }

    private static void requireFiniteBounded(Float value, float bound) {
        if (value == null || !Float.isFinite(value) || Math.abs(value) > bound) throw new IllegalArgumentException("invalid track coordinate");
    }

    CacheStore cacheForTests() { return cache; }

    @Override public void close() {
        try { application.close(); }
        catch (Exception error) { throw new IllegalStateException("captcha shutdown failed", error); }
    }

    static final class BusyException extends RuntimeException { }
}
