#require(curl.glsl)


vec3 velocity = texture2D(tVelocity, vUv).xyz * uVelocityStrength;
pos += velocity * 0.1;

vec3 curl = curlNoise(pos * uCurlNoiseScale*0.1 + (time * uCurlTimeScale * 0.1));
pos += curl * uCurlNoiseSpeed * 0.01 * HZ;