// Kevin Levron, threejs-components 0.0.19 (ISC per published package metadata).
// See sources.json. Extracted component body; imports use the site's single Three runtime.
import { MathUtils as o, Object3D as c, Vector3 as h, Color as a, HalfFloatType as p, BufferGeometry as m, Float32BufferAttribute as g, PointsMaterial as l, AdditiveBlending as d, TextureLoader as v, Points as f } from 'three';
import { GPUComputationRenderer as S } from 'three/addons/misc/GPUComputationRenderer.js';
// BEGIN UPSTREAM BODY
const { randFloat: I, randFloatSpread: _ } = o, N = { gpgpuSize: 512, size: 5, colors: [65280, 255], color: 16711680, decay: 25e-4, noiseCoordScale: 0.5, noiseIntensity: 1e-3, noiseTimeCoef: 0.1 };
class q extends c {
  #M;
  #F;
  #V;
  #A;
  uniforms;
  #T;
  #L;
  #j;
  constructor(e2, t2 = {}) {
    super(), this.config = { ...N, ...t2 }, this.#M = e2, this.#F = e2.renderer, this.#A = { uTime: { value: 0 }, uPointerPosition: { value: new h() }, uPointerDirection: { value: new h() }, uDecay: { value: this.config.decay }, uNoiseCoordScale: { value: this.config.noiseCoordScale }, uNoiseIntensity: { value: this.config.noiseIntensity }, uColor: { value: new a(this.config.color) }, uPointSize: { value: this.config.size } }, this.uniforms = { tPosition: { value: null }, tVelocity: { value: null }, ...this.#A }, this.#D(), this.#I();
  }
  #D() {
    this.#T = new S(this.config.gpgpuSize, this.config.gpgpuSize, this.#F), this.#F.capabilities.isWebGL2 || this.#T.setDataType(p), this.#L = this.#T.createTexture(), this.#j = this.#T.createTexture(), this.#_(this.#L, this.#j), this.velocityVariable = this.#T.addVariable("textureVelocity", "\n      vec4 permute(vec4 x){vec4 xm=mod(x,289.0);return mod(((xm*34.0)+10.0)*xm,289.0);}float psrdnoise(vec3 x,vec3 period,float alpha,out vec3 gradient){\n#ifndef PERLINGRID\nconst mat3 M=mat3(0.0,1.0,1.0,1.0,0.0,1.0,1.0,1.0,0.0);const mat3 Mi=mat3(-0.5,0.5,0.5,0.5,-0.5,0.5,0.5,0.5,-0.5);\n#endif\nvec3 uvw;\n#ifndef PERLINGRID\nuvw=M*x;\n#else\nuvw=x+dot(x,vec3(1.0/3.0));\n#endif\nvec3 i0=floor(uvw);vec3 f0=fract(uvw);vec3 g_=step(f0.xyx,f0.yzz);vec3 l_=1.0-g_;vec3 g=vec3(l_.z,g_.xy);vec3 l=vec3(l_.xy,g_.z);vec3 o1=min(g,l);vec3 o2=max(g,l);vec3 i1=i0+o1;vec3 i2=i0+o2;vec3 i3=i0+vec3(1.0);vec3 v0,v1,v2,v3;\n#ifndef PERLINGRID\nv0=Mi*i0;v1=Mi*i1;v2=Mi*i2;v3=Mi*i3;\n#else\nv0=i0-dot(i0,vec3(1.0/6.0));v1=i1-dot(i1,vec3(1.0/6.0));v2=i2-dot(i2,vec3(1.0/6.0));v3=i3-dot(i3,vec3(1.0/6.0));\n#endif\nvec3 x0=x-v0;vec3 x1=x-v1;vec3 x2=x-v2;vec3 x3=x-v3;if(any(greaterThan(period,vec3(0.0)))){vec4 vx=vec4(v0.x,v1.x,v2.x,v3.x);vec4 vy=vec4(v0.y,v1.y,v2.y,v3.y);vec4 vz=vec4(v0.z,v1.z,v2.z,v3.z);if(period.x>0.0)vx=mod(vx,period.x);if(period.y>0.0)vy=mod(vy,period.y);if(period.z>0.0)vz=mod(vz,period.z);\n#ifndef PERLINGRID\ni0=M*vec3(vx.x,vy.x,vz.x);i1=M*vec3(vx.y,vy.y,vz.y);i2=M*vec3(vx.z,vy.z,vz.z);i3=M*vec3(vx.w,vy.w,vz.w);\n#else\nv0=vec3(vx.x,vy.x,vz.x);v1=vec3(vx.y,vy.y,vz.y);v2=vec3(vx.z,vy.z,vz.z);v3=vec3(vx.w,vy.w,vz.w);i0=v0+dot(v0,vec3(1.0/3.0));i1=v1+dot(v1,vec3(1.0/3.0));i2=v2+dot(v2,vec3(1.0/3.0));i3=v3+dot(v3,vec3(1.0/3.0));\n#endif\ni0=floor(i0+0.5);i1=floor(i1+0.5);i2=floor(i2+0.5);i3=floor(i3+0.5);}vec4 hash=permute(permute(permute(vec4(i0.z,i1.z,i2.z,i3.z))+vec4(i0.y,i1.y,i2.y,i3.y))+vec4(i0.x,i1.x,i2.x,i3.x));vec4 theta=hash*3.883222077;vec4 sz=hash*-0.006920415+0.996539792;vec4 psi=hash*0.108705628;vec4 Ct=cos(theta);vec4 St=sin(theta);vec4 sz_prime=sqrt(1.0-sz*sz);vec4 gx,gy,gz;\n#ifdef FASTROTATION\nvec4 qx=St;vec4 qy=-Ct;vec4 qz=vec4(0.0);vec4 px=sz*qy;vec4 py=-sz*qx;vec4 pz=sz_prime;psi+=alpha;vec4 Sa=sin(psi);vec4 Ca=cos(psi);gx=Ca*px+Sa*qx;gy=Ca*py+Sa*qy;gz=Ca*pz+Sa*qz;\n#else\nif(alpha!=0.0){vec4 Sp=sin(psi);vec4 Cp=cos(psi);vec4 px=Ct*sz_prime;vec4 py=St*sz_prime;vec4 pz=sz;vec4 Ctp=St*Sp-Ct*Cp;vec4 qx=mix(Ctp*St,Sp,sz);vec4 qy=mix(-Ctp*Ct,Cp,sz);vec4 qz=-(py*Cp+px*Sp);vec4 Sa=vec4(sin(alpha));vec4 Ca=vec4(cos(alpha));gx=Ca*px+Sa*qx;gy=Ca*py+Sa*qy;gz=Ca*pz+Sa*qz;}else{gx=Ct*sz_prime;gy=St*sz_prime;gz=sz;}\n#endif\nvec3 g0=vec3(gx.x,gy.x,gz.x);vec3 g1=vec3(gx.y,gy.y,gz.y);vec3 g2=vec3(gx.z,gy.z,gz.z);vec3 g3=vec3(gx.w,gy.w,gz.w);vec4 w=0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3));w=max(w,0.0);vec4 w2=w*w;vec4 w3=w2*w;vec4 gdotx=vec4(dot(g0,x0),dot(g1,x1),dot(g2,x2),dot(g3,x3));float n=dot(w3,gdotx);vec4 dw=-6.0*w2*gdotx;vec3 dn0=w3.x*g0+dw.x*x0;vec3 dn1=w3.y*g1+dw.y*x1;vec3 dn2=w3.z*g2+dw.z*x2;vec3 dn3=w3.w*g3+dw.w*x3;gradient=39.5*(dn0+dn1+dn2+dn3);return 39.5*n;}\n      uniform float uTime;\n      uniform float uNoiseCoordScale;\n      uniform float uNoiseIntensity;\n      void main() {\n        vec2 uv = gl_FragCoord.xy / resolution.xy;\n        vec4 pos = texture2D(texturePosition, uv);\n        vec4 vel = texture2D(textureVelocity, uv);\n\n        if (pos.w < 0.0) {\n          vel.x = 0.0; vel.y = 0.0; vel.z = 0.0;\n        } else {\n          vec3 grad;\n          psrdnoise(pos.xyz * uNoiseCoordScale, vec3(0.0), uTime, grad);\n          vel.xyz += grad * uNoiseIntensity * pos.w;\n        }\n        gl_FragColor = vel;\n      }\n    ", this.#j), this.positionVariable = this.#T.addVariable("texturePosition", "\n      uniform float uDecay;\n      uniform vec3 uPointerPosition;\n      void main() {\n        vec2 uv = gl_FragCoord.xy / resolution.xy;\n        vec4 pos = texture2D(texturePosition, uv);\n        vec4 vel = texture2D(textureVelocity, uv);\n        if (pos.w < 0.0) { pos.w = vel.w; }\n        pos.w -= uDecay;\n        if (pos.w <= 0.0) {\n          pos.xyz = uPointerPosition;\n        } else {\n          pos.xyz += vel.xyz;\n        }\n        gl_FragColor = pos;\n      }\n    ", this.#L), this.#T.setVariableDependencies(this.velocityVariable, [this.positionVariable, this.velocityVariable]), this.#T.setVariableDependencies(this.positionVariable, [this.positionVariable, this.velocityVariable]), this.#T.uniforms = { ...this.#A }, Object.assign(this.velocityVariable.material.uniforms, this.#T.uniforms), Object.assign(this.positionVariable.material.uniforms, this.#T.uniforms);
    const e2 = this.#T.init();
    if (null !== e2) throw new Error(e2);
  }
  #_(e2, t2) {
    const i2 = new h(), s2 = e2.image.data, n2 = t2.image.data;
    for (let e3 = 0; e3 < this.config.gpgpuSize; e3++) for (let t3 = 0; t3 < this.config.gpgpuSize; t3++) {
      const o2 = 4 * (e3 + t3 * this.config.gpgpuSize);
      i2.x = e3 / this.config.gpgpuSize - 0.5, i2.y = t3 / this.config.gpgpuSize - 0.5, i2.toArray(s2, o2), s2[o2 + 3] = I(0.1, 1), i2.set(0, 0, 0).toArray(n2, o2), n2[o2 + 3] = I(0.1, 1);
    }
  }
  #I() {
    this.geometry = (function(e2) {
      const t2 = new m(), i2 = new Float32Array(e2 * e2 * 3).fill(0), s2 = new Float32Array(e2 * e2 * 2), n2 = new Float32Array(e2 * e2 * 3);
      for (let t3 = 0; t3 < e2; t3++) for (let i3 = 0; i3 < e2; i3++) {
        const n3 = t3 * e2 + i3;
        s2[2 * n3] = t3 / e2, s2[2 * n3 + 1] = i3 / e2;
      }
      return t2.setAttribute("position", new g(i2, 3)), t2.setAttribute("positionUv", new g(s2, 2)), t2.setAttribute("color", new g(n2, 3)), t2;
    })(this.config.gpgpuSize), this.setColors(this.config.colors), this.material = new l({ blending: d, depthTest: false, depthWrite: false, size: this.config.size, sizeAttenuation: false, transparent: true, vertexColors: true }), this.config.map && this.loadMap(this.config.map), this.material.onBeforeCompile = (e2) => {
      Object.assign(e2.uniforms, this.uniforms), e2.vertexShader = "\n        uniform sampler2D tPosition;\n        uniform sampler2D tVelocity;\n        uniform float uPointSize;\n        attribute vec2 positionUv;\n        varying float alpha;\n      " + e2.vertexShader, e2.vertexShader = e2.vertexShader.replace("#include <begin_vertex>", "\n        vec4 pos = texture2D(tPosition, positionUv);\n        vec4 vel = texture2D(tVelocity, positionUv);\n        vec3 transformed = pos.xyz;\n        alpha = pos.w;\n      "), e2.vertexShader = e2.vertexShader.replace("gl_PointSize = size;", "\n        gl_PointSize = uPointSize * pos.w * (vel.w + 0.5);\n      "), e2.fragmentShader = "\n        uniform vec3 uColor;\n        varying float alpha;\n      " + e2.fragmentShader, e2.fragmentShader = e2.fragmentShader.replace("#include <color_fragment>", "\n        #ifndef USE_MAP\n          float dist = length(gl_PointCoord - 0.5);\n          if (dist > 0.5) discard;\n        #endif\n        diffuseColor *= vec4(mix(vColor, uColor, alpha), alpha);\n      ");
    }, this.particles = new f(this.geometry, this.material), this.add(this.particles);
  }
  loadMap(e2) {
    null === e2 ? (this.material.map = null, this.material.needsUpdate = true) : (this.#V || (this.#V = new v()), this.material.map = this.#V.load(e2), this.material.needsUpdate = true);
  }
  setColors(e2) {
    const t2 = this.geometry.attributes.color.array, i2 = (function(e3) {
      let t3, i3;
      return s3(e3), { setColors: s3, getColorAt: function(e4, s4 = new a()) {
        const n2 = Math.max(0, Math.min(1, e4)) * (t3.length - 1), o2 = Math.floor(n2), r2 = i3[o2];
        if (o2 >= t3.length - 1) return r2.clone();
        const c2 = n2 - o2, h2 = i3[o2 + 1];
        return s4.r = r2.r + c2 * (h2.r - r2.r), s4.g = r2.g + c2 * (h2.g - r2.g), s4.b = r2.b + c2 * (h2.b - r2.b), s4;
      } };
      function s3(e4) {
        t3 = e4, i3 = [], t3.forEach((e5) => {
          const t4 = new a(e5);
          i3.push(t4);
        });
      }
    })(e2), s2 = new a();
    for (let e3 = 0; e3 < this.config.gpgpuSize * this.config.gpgpuSize; e3++) i2.getColorAt(Math.random(), s2), s2.toArray(t2, 3 * e3);
    this.geometry.attributes.color.needsUpdate = true;
  }
  update(e2) {
    this.uniforms.uTime.value += e2.delta * this.config.noiseTimeCoef, this.#T.compute(), this.uniforms.tPosition.value = this.#T.getCurrentRenderTarget(this.positionVariable).texture, this.uniforms.tVelocity.value = this.#T.getCurrentRenderTarget(this.velocityVariable).texture;
  }
  dispose() {
    this.#T.dispose();
  }
}
// END UPSTREAM BODY
export { q as FlowParticles };
