#!ATTRIBUTES

#!UNIFORMS
uniform sampler2D tMap;
uniform sampler2D tVideo;
uniform sampler2D tNormal;
uniform sampler2D tRefraction;
uniform float uAlpha;
uniform float uNormalScale;
uniform float uScrollDelta;
uniform float uVisible;
uniform float uScroll;
uniform float uFooter;
uniform float uPhone;

#!VARYINGS
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec3 vViewDir;
varying vec2 vMUV;
varying vec3 vCameraPos;

#!SHADER: Vertex
#require(matcap.vs)

void main() {
    vUv = uv;
    vec3 pos = position;

    pos.x += cos(pos.y * 6.0 + uScrollDelta * 2.0) * 0.005 * uScrollDelta;
    pos.z += sin(pos.y * 6.0 + uScrollDelta * 2.0) * 0.005 * uScrollDelta;

    vPos = pos;
    vWorldPos = vec3(modelMatrix * vec4(pos, 1.0));
    vNormal = normalMatrix * normal;
    vCameraPos = cameraPosition;
    vViewDir = -vec3(modelViewMatrix * vec4(pos, 1.0));
    vMUV = reflectMatcap(vWorldPos, vNormal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}

#!SHADER: Fragment

#require(range.glsl)
#require(simplenoise.glsl)
#require(fresnel.glsl)
#require(rgbshift.fs)
#require(radialblur.fs)
#require(normalmap.glsl)
#require(transformUV.glsl)
#require(blendmodes.glsl)
#require(rgb2hsv.fs)

vec3 rainbowColor(float t) {
    t = mod(t, 1.0); // Wraps the t value between 0.0 and 1.0
    if (t < 0.03) return mix(vec3(0.5, 0.0, 0.5), vec3(0.5, 0.0, 1.0), t / 0.03); // violet to blue
    else if (t < 0.06) return mix(vec3(0.5, 0.0, 1.0), vec3(0.0, 0.0, 1.0), (t - 0.03) / 0.03); // blue to darker blue
    else if (t < 0.09) return mix(vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 1.0), (t - 0.06) / 0.03); // darker blue to cyan
    else if (t < 0.12) return mix(vec3(0.0, 1.0, 1.0), vec3(0.0, 1.0, 0.0), (t - 0.09) / 0.03); // cyan to green
    else if (t < 0.18) return mix(vec3(0.0, 1.0, 0.0), vec3(1.0, 1.0, 0.0), (t - 0.12) / 0.06); // green to yellow
    else if (t < 0.24) return mix(vec3(1.0, 1.0, 0.0), vec3(1.0, 0.5, 0.0), (t - 0.18) / 0.06); // yellow to orange
    else return mix(vec3(1.0, 0.5, 0.0), vec3(1.0, 0.0, 0.0), (t - 0.24) / 0.06); // orange to red
}

void main() {
    vec2 uv = vUv;
    vec2 screenuv = gl_FragCoord.xy / resolution;

    vec2 normalUV = scaleUV(mix(screenuv, vUv, 0.5), vec2(0.5)) - vNormal.xy * 0.05 - vViewDir.xy * 0.001;
    //normalUV.y += vCameraPos.y * 0.015;
    normalUV -= time*0.01;
    vec3 normal = crange(texture2D(tNormal, normalUV).rgb, vec3(0.0), vec3(1.0), vec3(-1.0), vec3(1.0));
    uv = rotateUV(uv, vCameraPos.y * 0.2 - 1.5 - time * 0.2);
    uv += normal.xy * 0.02;

    float center = smoothstep(0.4, 0.25, length(vPos));
    float highlight = smoothstep(0.03, 0.0, abs(0.97-uVisible + vPos.y * 0.01));
    
    // Base Color
    vec3 color = texture2D(tRefraction, screenuv - vNormal.xy * 0.05 - normal.xy * 0.005).rgb;

    vec2 baseUv = scaleUV(uv, vec2(2.0)) - vViewDir.xy * 0.05 - vNormal.xy * 0.2;
    color += getRGB(tMap, baseUv, 0.2, 0.002).rgb * smoothstep(0.5, 0.4, abs(0.5-uv.x));

    color *= smoothstep(0.0, 0.1, vUv.x);
    color *= smoothstep(0.75, 0.65, vUv.x);

    // Video Add
    vec3 video = texture2D(tVideo, scaleUV(screenuv, vec2(0.5)) - normal.xy * 0.02).rgb;
    color = blendAdd(color, video, 0.1);
    color = blendSoftLight(color, video, 0.2);

    // Refraction

    // Stylizations
    float f = getFresnel(vNormal, vViewDir, 1.5 + sin(time * 0.1) * 0.3);
    //f += normal.x * 0.1;
    vec3 r = rainbowColor(f*3.0);
    if (r.r > 0.99) r *= 0.0;

    r = rgb2hsv(r);
    r.x += 0.5;
    r = hsv2rgb(r);

    color += r * f * mix(0.8, 2.0, highlight) * mix(0.0, 1.0, uVisible) * 0.4;
    //color *= 1.0 + f * 1.0;
    //color += pow(f, 2.0) * mix(0.4, 0.5, uFooter) * video;
    //color += f * mix(0.2, 0.5, uFooter);
    color += pow(f, 2.0) * mix(0.55, 1.0, uFooter) * mix(video, vec3(1.0), 0.5);
    color += highlight * 0.15;
    //color *= 1.0 + highlight * 5.0 + mix(-0.5, 2.0, center);

    vec3 hueShift = rgb2hsv(color);
    hueShift.y *= 0.9;
    color = hsv2rgb(hueShift);

    color *= mix(0.5, 1.0, uVisible);
    color = pow(color * mix(1.5, 2.5, highlight), vec3(1.8));

    //color *= highlight;
    
    gl_FragColor = vec4(color, uAlpha);
}