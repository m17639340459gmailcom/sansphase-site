package com.sansphase.captcha;

import cloud.tianai.captcha.validator.common.model.dto.ImageCaptchaTrack;
import com.fasterxml.jackson.core.JsonFactory;
import com.fasterxml.jackson.core.StreamReadConstraints;
import com.fasterxml.jackson.core.StreamReadFeature;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.MapperFeature;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

/** Private loopback-only adapter. The public Node service owns login bindings and final proofs. */
public final class CaptchaHttpServer implements AutoCloseable {
    private static final int MAX_BODY = 40 * 1024;
    private static final JsonMapper JSON = JsonMapper.builder(JsonFactory.builder()
                    .streamReadConstraints(StreamReadConstraints.builder().maxNestingDepth(6).maxStringLength(256).maxNumberLength(24).build())
                    .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION).build())
            .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
            .enable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .disable(DeserializationFeature.ACCEPT_FLOAT_AS_INT)
            .disable(MapperFeature.ALLOW_COERCION_OF_SCALARS).build();
    private final HttpServer server;
    private final CaptchaEngine engine;
    private final byte[] authorizationHash;
    private final ThreadPoolExecutor executor;

    record VerifyRequest(String id, ImageCaptchaTrack track) { }
    record VerifyResult(boolean verified) { }

    CaptchaHttpServer(int port, String secret, CaptchaEngine engine) throws IOException {
        validateSecret(secret);
        if (port < 0 || port > 65535) throw new IllegalArgumentException("invalid port");
        this.engine = engine;
        authorizationHash = hash("Bearer " + secret);
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", port), 16);
        executor = new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(16),
                runnable -> Thread.ofPlatform().name("login-captcha-worker").unstarted(runnable), new ThreadPoolExecutor.AbortPolicy());
        server.setExecutor(executor);
        server.createContext("/", this::handle);
    }

    public static void main(String[] args) throws Exception {
        // Configure transport deadlines before creating the JDK HTTP server.
        System.setProperty("sun.net.httpserver.maxReqTime", "5");
        System.setProperty("sun.net.httpserver.maxRspTime", "5");
        System.setProperty("sun.net.httpserver.idleInterval", "10");
        System.setProperty("jdk.httpserver.maxConnections", "32");
        System.setProperty("sun.net.httpserver.maxReqHeaders", "32");
        System.setProperty("sun.net.httpserver.maxReqHeaderSize", "8192");
        System.setProperty("java.awt.headless", "true");
        String secret = System.getenv("CAPTCHA_SERVICE_SECRET");
        validateSecret(secret);
        String value = System.getenv().getOrDefault("PORT", "4253");
        int port = Integer.parseInt(value);
        if (port < 1024 || port > 65535) throw new IllegalArgumentException("PORT must be between 1024 and 65535");
        var service = new CaptchaHttpServer(port, secret, new CaptchaEngine());
        Runtime.getRuntime().addShutdownHook(Thread.ofPlatform().unstarted(service::close));
        service.start();
        System.out.println("Login captcha service listening on 127.0.0.1:" + port);
    }

    static void validateSecret(String secret) {
        if (secret == null || secret.getBytes(StandardCharsets.UTF_8).length < 32 || secret.length() > 512
                || secret.chars().anyMatch(character -> character < 33 || character > 126)) {
            throw new IllegalArgumentException("CAPTCHA_SERVICE_SECRET must be 32 or more printable ASCII bytes");
        }
    }

    void start() { server.start(); }
    InetSocketAddress address() { return server.getAddress(); }

    private void handle(HttpExchange exchange) throws IOException {
        try {
            var headers = exchange.getRequestHeaders();
            var authHeaders = headers.get("Authorization");
            if (authHeaders == null || authHeaders.size() != 1 || authHeaders.getFirst().length() > 1024
                    || !MessageDigest.isEqual(authorizationHash, hash(authHeaders.getFirst()))) {
                respond(exchange, 401, Map.of("error", "unauthorized"));
                return;
            }
            if (exchange.getRequestURI().getRawQuery() != null) {
                respond(exchange, 400, Map.of("error", "invalid request"));
                return;
            }
            var path = exchange.getRequestURI().getRawPath();
            if (!PATHS.contains(path)) {
                respond(exchange, 404, Map.of("error", "not found"));
                return;
            }
            var method = exchange.getRequestMethod();
            if ("/health".equals(path)) {
                if (!"GET".equals(method)) { respond(exchange, 405, Map.of("error", "method not allowed")); return; }
                respond(exchange, 200, Map.of("ok", true));
                return;
            }
            if (!"POST".equals(method)) {
                respond(exchange, 405, Map.of("error", "method not allowed"));
                return;
            }
            String contentType = headers.getFirst("Content-Type");
            if (contentType == null || !contentType.matches("(?i)application/json(?:;\\s*charset=utf-8)?")) {
                respond(exchange, 415, Map.of("error", "JSON required"));
                return;
            }
            var lengths = headers.get("Content-Length");
            if (lengths != null && (lengths.size() != 1 || Long.parseLong(lengths.getFirst()) > MAX_BODY)) {
                respond(exchange, 413, Map.of("error", "request too large"));
                return;
            }
            if (headers.containsKey("Content-Encoding")) {
                respond(exchange, 415, Map.of("error", "encoded requests unsupported"));
                return;
            }
            byte[] body = exchange.getRequestBody().readNBytes(MAX_BODY + 1);
            if (body.length > MAX_BODY) { respond(exchange, 413, Map.of("error", "request too large")); return; }
            if ("/challenge".equals(path)) {
                var input = JSON.readTree(body);
                if (input == null || !input.isObject() || !input.isEmpty()) throw new IllegalArgumentException("empty JSON object required");
                respond(exchange, 200, engine.challenge());
            } else {
                VerifyRequest request = JSON.readValue(body, VerifyRequest.class);
                if (request == null) throw new IllegalArgumentException("verification object required");
                respond(exchange, 200, new VerifyResult(engine.verify(request.id(), request.track())));
            }
        } catch (com.fasterxml.jackson.core.JsonProcessingException | IllegalArgumentException error) {
            respondError(exchange, 400, "invalid request");
        } catch (CaptchaEngine.BusyException error) {
            respondError(exchange, 503, "temporarily busy");
        } catch (Exception error) {
            // Do not expose or log upstream values, challenge answers or user trajectories.
            respondError(exchange, 503, "verification unavailable");
        } finally {
            exchange.close();
        }
    }

    private static final java.util.Set<String> PATHS = java.util.Set.of("/health", "/challenge", "/verify");

    private static byte[] hash(String value) {
        try { return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)); }
        catch (java.security.NoSuchAlgorithmException error) { throw new IllegalStateException(error); }
    }

    private static void respondError(HttpExchange exchange, int status, String error) {
        try { respond(exchange, status, Map.of("error", error)); } catch (IOException ignored) { }
    }

    private static void respond(HttpExchange exchange, int status, Object data) throws IOException {
        byte[] bytes = JSON.writeValueAsBytes(data);
        var headers = exchange.getResponseHeaders();
        headers.set("Content-Type", "application/json; charset=utf-8");
        headers.set("Cache-Control", "no-store");
        headers.set("X-Content-Type-Options", "nosniff");
        exchange.sendResponseHeaders(status, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    @Override public void close() {
        server.stop(0);
        executor.shutdownNow();
        engine.close();
    }
}
