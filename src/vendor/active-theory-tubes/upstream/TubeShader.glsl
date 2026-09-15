#!ATTRIBUTES

#!UNIFORMS
uniform sampler2D tColor;
uniform sampler2D tRefraction;

#!VARYINGS
varying vec2 vUv;
varying vec2 vUv2;
varying float vLife;
varying float vLength;
varying vec3 vPos;
varying vec3 vWorldPos;

#!SHADER: Vertex

#require(fbr.vs)

void main() {
    setupFBR(pos);
    vPos = pos;
    vWorldNormal = mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz) * transformedNormal;
    vWorldPos = vec3(modelMatrix * vec4(pos, 1.0));
}

#!SHADER: Fragment

#require(fbr.fs)
#require(range.glsl)
#require(blendmodes.glsl)
#require(rgb2hsv.fs)

void main() {
    vec3 myColor = texture2D(tColor, vUv2).rgb;
    vec3 color = getFBR(vec3(0.2), vUv * 5.0);
    //color = mix(vec3(1.0), color, step(vUv.x, 0.99));

    float b = crange(vLife, 0.1, 0.2, 0.0, 1.0);
    float tb = rangeTransition(b, vLength, 0.01);
    if (tb < 0.5) discard;

    vec2 ruv = gl_FragCoord.xy / resolution;
    ruv += vNormal.xy * 0.1;
    color += texture2D(tRefraction, ruv).rgb;

    color = blendOverlay(color, myColor, 1.0);
    color = mix(myColor, color, 1.0-(step(vUv.x, 0.98) - step(vUv.x, 0.9)));

    color = rgb2hsv(color);
    color.x -= vLength * 0.2 + sin(time * 0.2 + length(vWorldPos) * 0.1) * 0.1;
    color.y *= 0.7;
    color = hsv2rgb(color);

    color += sin(-time * 6.0 + vLength * 4.0 + length(vWorldPos)) * 0.1;
    color *= smoothstep(0.0, 0.3, vLife);
    color = pow(color, vec3(mix(1.0, 2.0, vLength)));


    #drawbuffer Color gl_FragColor = vec4(color, 1.0);
    #drawbuffer HomeRefraction gl_FragColor = vec4(color, 1.0);
    #drawbuffer HomeVolumetricLight gl_FragColor = vec4(color * 0.35, 1.0);
}