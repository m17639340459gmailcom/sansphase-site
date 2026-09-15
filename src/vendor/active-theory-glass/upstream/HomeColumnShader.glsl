#!ATTRIBUTES

#!UNIFORMS
uniform sampler2D tMap;
uniform sampler2D tVideo;
uniform sampler2D tRefraction;
uniform float uAlpha;
uniform float uVisible;
uniform float uOffset;
uniform float uDirection;

#!VARYINGS
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vWorldPos;
varying vec3 vCameraPosition;
varying vec3 vNormal;
varying vec3 vViewDir;
varying float vTop;

#!SHADER: Vertex


void main() {
    vUv = uv;
    vec3 pos = position;

    vTop = smoothstep(9.8, 9.8-2.0*smoothstep(0.8, 1.0, uVisible), pos.y);

    pos.y -= pow((1.0-uVisible), 1.15) * 20.0;

    float radius = mix(1.9, 4.0, smoothstep(10.0, -10.0, pos.y));
    pos.x += cos(-pos.y * 0.32 * uDirection + uOffset) * radius;
    pos.z += sin(-pos.y * 0.32 * uDirection + uOffset) * radius;


    pos.x += cos(-pos.y * 10.0 * uDirection) * 0.1 * pow((1.0-uVisible), 1.25);
    pos.z += sin(-pos.y * 10.0 * uDirection) * 0.1 * pow((1.0-uVisible), 1.25);

    vWorldPos = vec3(modelMatrix * vec4(pos, 1.0));
    vCameraPosition = cameraPosition;
    vPos = pos;
    
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}

#!SHADER: Fragment

#require(rgbshift.fs)
#require(blendmodes.glsl)
#require(transformUV.glsl)
#require(fresnel.glsl)

void main() {
    vec2 uv = vUv;
    vec2 screenuv = gl_FragCoord.xy / resolution;
    //uv.y += time * 0.1;
    uv.y *= 1.2;
    uv.y += uVisible;

    vec2 texUV = uv;
    texUV.y += time * 0.1 - cameraPosition.y * 0.03;

    vec4 color = texture2D(tRefraction, screenuv);
    vec3 video = texture2D(tVideo, screenuv).rgb;

    float highlight = smoothstep(0.03, 0.0, abs(0.97-uVisible)) * smoothstep(0.8, 1.0, vUv.y); 

    color.rgb += getRGB(tMap, texUV, 0.2, 0.00001).rgb * 0.5;
    color.rgb = pow(color.rgb * mix(0.8, 1.5, highlight), vec3(1.2));
    color.rgb = blendSoftLight(color.rgb, video, 0.7);
    //color.rgb = blendSoftLight(color.rgb, texture2D(tRefraction, screenuv).rgb, 1.0);
    color.rgb += pow(highlight, 2.0) * 0.5 * video;
    color.rgb *= mix(1.0, 1.5, highlight);

    color.a = mix(vTop, 1.0, highlight*0.3);
    color.rgb = pow(0.1 + color.rgb * mix(1.5, 2.5, highlight) * 1.5, vec3(1.5));

    color.a *= uAlpha;

    
    gl_FragColor = color;
    //gl_FragColor.a *= uAlpha;
}