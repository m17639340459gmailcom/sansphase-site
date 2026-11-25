package com.sansphase.captcha;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

import static org.junit.jupiter.api.Assertions.*;

class CaptchaHttpServerTest {
    private static final String SECRET = "test-only-service-secret-at-least-thirty-two-bytes";
    private static final ObjectMapper JSON = new ObjectMapper();

    @Test void healthAndGenerationRequireServiceAuthentication() throws Exception {
        try (var server = new CaptchaHttpServer(0, SECRET, new CaptchaEngine())) {
            server.start();
            assertEquals(401, request(server, "/health", "GET", null, false).statusCode());
            assertEquals(200, request(server, "/health", "GET", null, true).statusCode());
            assertEquals(401, request(server, "/challenge", "POST", "{}", false).statusCode());
            var response = request(server, "/challenge", "POST", "{}", true);
            assertEquals(200, response.statusCode());
            assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
            assertEquals("SLIDER", JSON.readTree(response.body()).get("type").asText());
            assertTrue(server.address().getAddress().isLoopbackAddress());
        }
    }

    @Test void rejectsUnknownRoutesWrongMethodsMalformedAndOversizedBodies() throws Exception {
        try (var server = new CaptchaHttpServer(0, SECRET, new CaptchaEngine())) {
            server.start();
            assertEquals(405, request(server, "/challenge", "GET", null, true).statusCode());
            assertEquals(404, request(server, "/challenge/solve", "POST", "{}", true).statusCode());
            assertEquals(400, request(server, "/challenge", "POST", "{\"answer\":1}", true).statusCode());
            assertEquals(400, request(server, "/challenge", "POST", "{}{}", true).statusCode());
            assertEquals(400, request(server, "/verify", "POST", "{\"id\":\"a\",\"id\":\"b\"}", true).statusCode());
            assertEquals(413, request(server, "/verify", "POST", " ".repeat(41 * 1024), true).statusCode());
        }
    }

    @Test void noSolveEndpointExistsAndValidProofIsSingleUseOverHttp() throws Exception {
        var engine = new CaptchaEngine();
        try (var server = new CaptchaHttpServer(0, SECRET, engine)) {
            server.start();
            var challenge = engine.challenge();
            var fixture = CaptchaEngineTest.correctTrack(engine, challenge.id());
            fixture.setLeft(Math.round(fixture.getTrackList().getLast().getX()));
            fixture.setTop(0);
            for (var point : fixture.getTrackList()) point.setType(point.getType().toUpperCase(java.util.Locale.ROOT));
            var body = JSON.writeValueAsString(new CaptchaHttpServer.VerifyRequest(challenge.id(), fixture));
            var result = request(server, "/verify", "POST", body, true);
            assertEquals(200, result.statusCode());
            assertTrue(JSON.readTree(result.body()).get("verified").asBoolean());
            assertFalse(JSON.readTree(request(server, "/verify", "POST", body, true).body()).get("verified").asBoolean());
            assertEquals(404, request(server, "/solve", "POST", "{}", true).statusCode());
        }
    }

    @Test void shortMissingOrControlCharacterSecretsCannotStart() {
        assertThrows(IllegalArgumentException.class, () -> CaptchaHttpServer.validateSecret("short"));
        assertThrows(IllegalArgumentException.class, () -> CaptchaHttpServer.validateSecret(null));
        assertThrows(IllegalArgumentException.class, () -> CaptchaHttpServer.validateSecret(SECRET + "\n"));
    }

    private HttpResponse<String> request(CaptchaHttpServer server, String path, String method, String body, boolean authorized) throws Exception {
        var request = HttpRequest.newBuilder(new URI("http://127.0.0.1:" + server.address().getPort() + path)).timeout(Duration.ofSeconds(5));
        if (authorized) request.header("Authorization", "Bearer " + SECRET);
        if (body != null) request.header("Content-Type", "application/json");
        request.method(method, body == null ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        return HttpClient.newHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofString());
    }
}
