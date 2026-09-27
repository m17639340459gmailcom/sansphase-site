// GPU adapter of Three.js r186 Curve.computeFrenetFrames (MIT).
// https://github.com/mrdoob/three.js/blob/r186/src/extras/core/Curve.js
// Same minimum-axis initialization and parallel transport; the tangents come
// from ProtonTubes' existing GPU positions rather than a CPU Curve object.
// The published rotation.glsl uses row-vector multiplication.
vec3 frameHead = texture2D(tPos, getUVFromIndex(headIndex, textureSize)).xyz;
vec3 frameNext = texture2D(tPos, getUVFromIndex(headIndex + 1.0, textureSize)).xyz;
vec3 previousT = frameNext - frameHead;
previousT = dot(previousT, previousT) > 0.00000001 ? normalize(previousT) : T;
vec3 axis = vec3(1.0, 0.0, 0.0);
float minimum = abs(previousT.x);
if (abs(previousT.y) <= minimum) { minimum = abs(previousT.y); axis = vec3(0.0, 1.0, 0.0); }
if (abs(previousT.z) <= minimum) { axis = vec3(0.0, 0.0, 1.0); }
vec3 B = cross(previousT, normalize(cross(previousT, axis)));
for (int frameIndex = 1; frameIndex < 11; frameIndex++) {
    if (float(frameIndex) > dIndex) break;
    float frameSample = getIndex(cNumber, float(frameIndex), lineSegments);
    vec3 a = texture2D(tPos, getUVFromIndex(frameSample, textureSize)).xyz;
    vec3 b = texture2D(tPos, getUVFromIndex(frameSample + 1.0, textureSize)).xyz;
    vec3 frameT = b - a;
    if (dot(frameT, frameT) < 0.00000001) continue;
    frameT = normalize(frameT);
    vec3 transportAxis = cross(previousT, frameT);
    if (dot(transportAxis, transportAxis) > 0.000000000001) {
        float theta = acos(clamp(dot(previousT, frameT), -1.0, 1.0));
        B = (vec4(B, 0.0) * rotationMatrix(normalize(transportAxis), theta)).xyz;
    }
    previousT = frameT;
}
vec3 N = normalize(cross(T, B));
