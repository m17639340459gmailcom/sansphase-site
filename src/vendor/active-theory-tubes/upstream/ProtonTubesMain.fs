void main() {
    vec3 index = getData(tIndices, vUv);

    float CHAIN = index.x;
    float LINE = index.y;
    float HEAD = index.z;

    if (HEAD > 0.9) {

        //main

    } else {

        float followIndex = getIndex(LINE, CHAIN-1.0, lineSegments);
        float headIndex = getIndex(LINE, 0.0, lineSegments);
        vec3 followPos = texture2D(tInput, getUVFromIndex(followIndex, textureSize)).xyz;
        vec4 followSpawn = texture2D(tSpawn, getUVFromIndex(headIndex, textureSize));

        if (followSpawn.x <= 0.0) {
            pos.x = 9999.0;
            gl_FragColor = vec4(pos, data);
            return;
        }

        if (length(followPos - pos) > uResetDelta) {
            followPos = texture2D(tInput, getUVFromIndex(headIndex, textureSize)).xyz;
            pos = followPos;
        }

        pos += (followPos - pos) * (uLerp * timeScale * HZ);
    }
}