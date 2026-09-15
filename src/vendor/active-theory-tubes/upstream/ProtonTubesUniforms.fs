uniform sampler2D tIndices;
uniform float textureSize;
uniform float lineSegments;
uniform float uLerp;
uniform float uResetDelta;

vec2 getUVFromIndex(float index, float textureSize) {
    float size = textureSize;
    vec2 ruv = vec2(0.0);
    float p0 = index / size;
    float y = floor(p0);
    float x = p0 - y;
    ruv.x = x;
    ruv.y = y / size;
    return ruv;
}

float getIndex(float line, float chain, float lineSegments) {
    return (line * lineSegments) + chain;
}