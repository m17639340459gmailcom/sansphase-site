package com.sansphase.captcha;

import cloud.tianai.captcha.cache.CacheStore;
import cloud.tianai.captcha.common.AnyMap;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.Ticker;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

/** Thin adapter to Caffeine: bounded storage, expiry checked by reads and atomic removal. */
final class CaptchaCache implements CacheStore {
    private final Cache<String, AnyMap> cache;

    CaptchaCache() {
        this(Duration.ofSeconds(120), 2048, Ticker.systemTicker());
    }

    CaptchaCache(Duration lifetime, int maximumSize, Ticker ticker) {
        if (lifetime.isZero() || lifetime.isNegative() || maximumSize < 1) {
            throw new IllegalArgumentException("invalid cache limits");
        }
        cache = Caffeine.newBuilder().maximumSize(maximumSize).expireAfterWrite(lifetime)
                .ticker(ticker).executor(Runnable::run).build();
    }

    @Override public AnyMap getCache(String key) {
        return cache.getIfPresent(key);
    }

    @Override public AnyMap getAndRemoveCache(String key) {
        return cache.asMap().remove(key);
    }

    @Override public boolean setCache(String key, AnyMap data, Long expire, TimeUnit unit) {
        // Every challenge has the same service-level TTL; no public caller can extend it.
        cache.put(key, data);
        cache.cleanUp();
        return true;
    }

    @Override public Long incr(String key, long delta, Long expire, TimeUnit unit) {
        throw new UnsupportedOperationException("login challenge cache does not store counters");
    }

    @Override public Long getLong(String key) {
        throw new UnsupportedOperationException("login challenge cache does not store counters");
    }

    @Override public void close() {
        cache.invalidateAll();
        cache.cleanUp();
    }
}
