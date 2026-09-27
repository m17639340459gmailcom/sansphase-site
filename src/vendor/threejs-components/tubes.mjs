// Kevin Levron, threejs-components 0.0.19 (ISC per published package metadata).
// See sources.json. Extracted component body; imports use the site's single Three runtime.
import { Mesh as Pr, Vector3 as it, TubeGeometry as Fi, CatmullRomCurve3 as Ni, Group as Yr, PointLight as tn, MeshStandardMaterial as Ii, MathUtils as tt, Color as Qs } from 'three';
// BEGIN UPSTREAM BODY
function PC(e2, t2, s2, r2) {
  let i2 = [0, 0, 0];
  i2 = [e2[0] + LC(e2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]), e2[1] + LC(e2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]), e2[2] + LC(e2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333])];
  let n2 = IC(i2);
  const a2 = OC(i2), o2 = VC([a2[0], a2[1], a2[0]], [a2[1], a2[2], a2[2]]), u2 = [1 - o2[0], 1 - o2[1], 1 - o2[2]], l2 = [u2[2], o2[0], o2[1]], h2 = [u2[0], u2[1], o2[2]], c2 = (function(e3, t3) {
    if (e3.length) return t3.length ? e3.map(function(e4, s3) {
      return Math.min(e4, t3[s3]);
    }) : e3.map(function(e4, s3) {
      return Math.min(e4, t3);
    });
    return Math.min(e3, t3);
  })(l2, h2), d2 = DC(l2, h2);
  let p2 = [n2[0] + c2[0], n2[1] + c2[1], n2[2] + c2[2]], m2 = [n2[0] + d2[0], n2[1] + d2[1], n2[2] + d2[2]], g2 = [n2[0] + 1, n2[1] + 1, n2[2] + 1], f2 = [0, 0, 0], y2 = [0, 0, 0], x2 = [0, 0, 0], b2 = [0, 0, 0];
  f2 = [n2[0] - LC(n2, [0.16666666666666666, 0.16666666666666666, 0.16666666666666666]), n2[1] - LC(n2, [0.16666666666666666, 0.16666666666666666, 0.16666666666666666]), n2[2] - LC(n2, [0.16666666666666666, 0.16666666666666666, 0.16666666666666666])], y2 = [p2[0] - LC(p2, [0.16666666666666666, 0.16666666666666666, 0.16666666666666666]), p2[1] - LC(p2, [0.16666666666666666, 0.16666666666666666, 0.16666666666666666]), p2[2] - LC(p2, [0.16666666666666666, 0.16666666666666666, 0.16666666666666666])], x2 = [m2[0] - LC(m2, [0.16666666666666666, 0.16666666666666666, 0.16666666666666666]), m2[1] - LC(m2, [0.16666666666666666, 0.16666666666666666, 0.16666666666666666]), m2[2] - LC(m2, [0.16666666666666666, 0.16666666666666666, 0.16666666666666666])], b2 = [g2[0] - LC(g2, [0.16666666666666666, 0.16666666666666666, 0.16666666666666666]), g2[1] - LC(g2, [0.16666666666666666, 0.16666666666666666, 0.16666666666666666]), g2[2] - LC(g2, [0.16666666666666666, 0.16666666666666666, 0.16666666666666666])];
  const T2 = [e2[0] - f2[0], e2[1] - f2[1], e2[2] - f2[2]], v2 = [e2[0] - y2[0], e2[1] - y2[1], e2[2] - y2[2]], _2 = [e2[0] - x2[0], e2[1] - x2[1], e2[2] - x2[2]], S2 = [e2[0] - b2[0], e2[1] - b2[1], e2[2] - b2[2]];
  if ((function(e3) {
    return e3.some(function(e4) {
      return e4;
    });
  })((function(e3, t3) {
    if (e3.length) {
      const s3 = Array(e3.length);
      for (let r3 = 0; r3 < e3.length; r3++) s3[r3] = e3[r3] > t3[r3];
      return s3;
    }
    return e3 > t3;
  })(t2, [0, 0, 0]))) {
    let e3 = [f2[0], y2[0], x2[0], b2[0]], s3 = [f2[1], y2[1], x2[1], b2[1]], r3 = [f2[2], y2[2], x2[2], b2[2]];
    t2[0] > 0 && (e3 = FC(e3, t2[0])), t2[1] > 0 && (s3 = FC(s3, t2[1])), t2[2] > 0 && (r3 = FC(r3, t2[2])), f2 = [e3[0], s3[0], r3[0]], y2 = [e3[1], s3[1], r3[1]], x2 = [e3[2], s3[2], r3[2]], b2 = [e3[3], s3[3], r3[3]], n2 = [f2[0] + LC(f2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]), f2[1] + LC(f2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]), f2[2] + LC(f2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333])], p2 = [y2[0] + LC(y2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]), y2[1] + LC(y2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]), y2[2] + LC(y2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333])], m2 = [x2[0] + LC(x2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]), x2[1] + LC(x2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]), x2[2] + LC(x2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333])], g2 = [b2[0] + LC(b2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]), b2[1] + LC(b2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333]), b2[2] + LC(b2, [0.3333333333333333, 0.3333333333333333, 0.3333333333333333])], n2 = IC([n2[0] + 0.5, n2[1] + 0.5, n2[2] + 0.5]), p2 = IC([p2[0] + 0.5, p2[1] + 0.5, p2[2] + 0.5]), m2 = IC([m2[0] + 0.5, m2[1] + 0.5, m2[2] + 0.5]), g2 = IC([g2[0] + 0.5, g2[1] + 0.5, g2[2] + 0.5]);
  }
  const w2 = WC(UC.add([], WC(UC.add([], WC([n2[2], p2[2], m2[2], g2[2]]), [n2[1], p2[1], m2[1], g2[1]])), [n2[0], p2[0], m2[0], g2[0]])), N2 = [3.883222077 * w2[0], 3.883222077 * w2[1], 3.883222077 * w2[2], 3.883222077 * w2[3]], M2 = [-6920415e-9 * w2[0] + 0.996539792, -6920415e-9 * w2[1] + 0.996539792, -6920415e-9 * w2[2] + 0.996539792, -6920415e-9 * w2[3] + 0.996539792];
  let A2 = [0.108705628 * w2[0], 0.108705628 * w2[1], 0.108705628 * w2[2], 0.108705628 * w2[3]];
  const R2 = zC(N2), E2 = kC(N2), C2 = GC([1 - M2[0] * M2[0], 1 - M2[1] * M2[1], 1 - M2[2] * M2[2], 1 - M2[3] * M2[3]]);
  let B2 = [0, 0, 0, 0], P2 = [0, 0, 0, 0], F2 = [0, 0, 0, 0];
  const L2 = E2, I2 = [-R2[0], -R2[1], -R2[2], -R2[3]], O2 = [0, 0, 0, 0], V2 = [M2[0] * I2[0], M2[1] * I2[1], M2[2] * I2[2], M2[3] * I2[3]], D2 = [-M2[0] * L2[0], -M2[1] * L2[1], -M2[2] * L2[2], -M2[3] * L2[3]], U2 = C2;
  A2 = [A2[0] + s2, A2[1] + s2, A2[2] + s2, A2[3] + s2];
  const z2 = kC(A2), k2 = zC(A2);
  B2 = [k2[0] * V2[0] + z2[0] * L2[0], k2[1] * V2[1] + z2[1] * L2[1], k2[2] * V2[2] + z2[2] * L2[2], k2[3] * V2[3] + z2[3] * L2[3]], P2 = [k2[0] * D2[0] + z2[0] * I2[0], k2[1] * D2[1] + z2[1] * I2[1], k2[2] * D2[2] + z2[2] * I2[2], k2[3] * D2[3] + z2[3] * I2[3]], F2 = [k2[0] * U2[0] + z2[0] * O2[0], k2[1] * U2[1] + z2[1] * O2[1], k2[2] * U2[2] + z2[2] * O2[2], k2[3] * U2[3] + z2[3] * O2[3]];
  const G2 = [B2[0], P2[0], F2[0]], W2 = [B2[1], P2[1], F2[1]], H2 = [B2[2], P2[2], F2[2]], $2 = [B2[3], P2[3], F2[3]];
  let j2 = [LC(T2, T2), LC(v2, v2), LC(_2, _2), LC(S2, S2)].map(function(e3) {
    return 0.5 - e3;
  });
  j2 = DC(j2, 0);
  const q2 = [j2[0] * j2[0], j2[1] * j2[1], j2[2] * j2[2], j2[3] * j2[3]], X2 = [q2[0] * j2[0], q2[1] * j2[1], q2[2] * j2[2], q2[3] * j2[3]], Y2 = [LC(G2, T2), LC(W2, v2), LC(H2, _2), LC($2, S2)], Q2 = LC(X2, Y2), K2 = [-6 * q2[0] * Y2[0], -6 * q2[1] * Y2[1], -6 * q2[2] * Y2[2], -6 * q2[3] * Y2[3]], J2 = [X2[0] * G2[0] + K2[0] * T2[0], X2[0] * G2[1] + K2[0] * T2[1], X2[0] * G2[2] + K2[0] * T2[2]], Z2 = [X2[1] * W2[0] + K2[1] * v2[0], X2[1] * W2[1] + K2[1] * v2[1], X2[1] * W2[2] + K2[1] * v2[2]], ee2 = [X2[2] * H2[0] + K2[2] * _2[0], X2[2] * H2[1] + K2[2] * _2[1], X2[2] * H2[2] + K2[2] * _2[2]], te2 = [X2[3] * $2[0] + K2[3] * S2[0], X2[3] * $2[1] + K2[3] * S2[1], X2[3] * $2[2] + K2[3] * S2[2]];
  return r2[0] = 39.5 * (J2[0] + Z2[0] + ee2[0] + te2[0]), r2[1] = 39.5 * (J2[1] + Z2[1] + ee2[1] + te2[1]), r2[2] = 39.5 * (J2[2] + Z2[2] + ee2[2] + te2[2]), 39.5 * Q2;
}
function FC(e2, t2) {
  return e2.length ? t2.length ? e2.map(function(e3, s2) {
    return 0 === e3 || 0 === t2[s2] ? 0 : e3 % t2[s2];
  }) : e2.map(function(e3, s2) {
    return 0 === e3 || 0 === t2 ? 0 : e3 % t2;
  }) : e2 % t2;
}
function LC(e2, t2) {
  let s2 = 0;
  for (let r2 = 0; r2 < e2.length; r2++) s2 += e2[r2] * t2[r2];
  return s2;
}
function IC(e2) {
  return e2.length ? e2.map(IC) : Math.floor(e2);
}
function OC(e2) {
  return e2.length ? e2.map(OC) : e2 - Math.floor(e2);
}
function VC(e2, t2) {
  return t2 || e2 ? t2.length ? e2.length ? t2.map(function(t3, s2) {
    return VC(e2[s2], t3);
  }) : t2.map(function(t3, s2) {
    return VC(e2, t3);
  }) : t2 < e2 ? 0 : 1 : 0;
}
function DC(e2, t2) {
  return e2.length ? t2.length ? e2.map(function(e3, s2) {
    return Math.max(e3, t2[s2]);
  }) : e2.map(function(e3, s2) {
    return Math.max(e3, t2);
  }) : Math.max(e2, t2);
}
function UC(e2, t2, s2, r2) {
  return null == e2 && (e2 = 0), null == t2 && (t2 = e2), null == s2 && (s2 = t2), null == r2 && (r2 = s2), [e2, t2, s2, r2];
}
function zC(e2) {
  return e2.length ? e2.map(zC) : Math.cos(e2);
}
function kC(e2) {
  return e2.length ? e2.map(kC) : Math.sin(e2);
}
function GC(e2) {
  return e2.length ? e2.map(GC) : Math.sqrt(e2);
}
function WC(e2) {
  const t2 = FC(e2, 289);
  return FC([(34 * t2[0] + 10) * t2[0], (34 * t2[1] + 10) * t2[1], (34 * t2[2] + 10) * t2[2], (34 * t2[3] + 10) * t2[3]], 289);
}
UC.add = function(e2, t2, s2) {
  return e2[0] = t2[0] + s2[0], e2[1] = t2[1] + s2[1], e2[2] = t2[2] + s2[2], e2[3] = t2[3] + s2[3], e2;
};
const HC = new Float32Array(3), $C = new Float32Array(3), jC = new Float32Array(3);
class qC extends Pr {
  timeDelta = 100 * Math.random();
  constructor(e2, t2) {
    const s2 = e2.tubularSegments || 64, r2 = e2.radius || 0.5, i2 = e2.radialSegments || 8, n2 = e2.capSegments || 4;
    super(new XC(s2, r2, i2, n2), t2), this.curve = this.geometry.curve, this.points = this.curve.points, this.to = new it(), this.geometry.update();
  }
  lerpTo(e2, t2 = 0.1, s2 = 0.05, r2) {
    jC[0] = 0.01 * e2.x + 0.04 * r2 + this.timeDelta, jC[1] = 0.01 * e2.y + 0.048 * r2 + this.timeDelta, jC[2] = 0.01 * e2.z + 0.06 * r2 + this.timeDelta, PC(jC, HC, 2 * r2, $C), this.to.copy(e2), this.to.x += $C[0] * s2, this.to.y += $C[1] * s2, this.to.z += $C[2] * s2, this.points[0].lerp(this.to, t2);
    for (let e3 = 1; e3 < this.points.length; e3++) this.points[e3].lerp(this.points[e3 - 1], t2);
    this.geometry.update();
  }
}
class XC extends Fi {
  constructor(e2 = 64, t2 = 1, s2 = 8) {
    const r2 = new Array(e2 + 1).fill(0).map(() => new it());
    r2.forEach((t3, s3) => {
      t3.z = -s3 / e2 * 2;
    });
    const i2 = new Ni(r2);
    super(i2, e2, t2, s2, false), this.curve = i2;
  }
  update() {
    !(function(e2) {
      const { curve: t2 } = e2, { tubularSegments: s2, radius: r2, radialSegments: i2 } = e2.parameters, n2 = t2.computeFrenetFrames(t2.points.length, false);
      e2.tangents = n2.tangents, e2.normals = n2.normals, e2.binormals = n2.binormals;
      const a2 = e2.getAttribute("position"), o2 = e2.getAttribute("normal"), u2 = new it(), l2 = new it();
      for (let e3 = 0; e3 <= s2; e3++) h2(e3);
      function h2(e3) {
        const h3 = e3 / s2, c2 = Math.sin(h3 * Math.PI) * r2;
        l2.copy(t2.points[e3]);
        let d2 = e3 * (i2 + 1);
        const p2 = n2.normals[e3], m2 = n2.binormals[e3];
        for (let e4 = 0; e4 <= i2; e4++) {
          const t3 = e4 / i2 * Math.PI * 2, s3 = Math.sin(t3), r3 = -Math.cos(t3);
          u2.x = r3 * p2.x + s3 * m2.x, u2.y = r3 * p2.y + s3 * m2.y, u2.z = r3 * p2.z + s3 * m2.z, u2.normalize(), a2.setXYZ(d2, l2.x + c2 * u2.x, l2.y + c2 * u2.y, l2.z + c2 * u2.z), o2.setXYZ(d2, u2.x, u2.y, u2.z), d2++;
        }
      }
      a2.needsUpdate = true, o2.needsUpdate = true;
    })(this);
  }
}
const YC = { count: 16, colors: [16777215 * Math.random(), 16777215 * Math.random(), 16777215 * Math.random()], minRadius: 5e-3, maxRadius: 0.05, minTubularSegments: 32, maxTubularSegments: 128, material: { metalness: 1, roughness: 0.25 }, lights: { intensity: 200, colors: [16777215 * Math.random(), 16777215 * Math.random(), 16777215 * Math.random(), 16777215 * Math.random()] }, lerp: 0.5, noise: 0.05 };
class QC extends Yr {
  target = new it();
  lights = [];
  tubes = [];
  constructor(e2) {
    super(), this.options = { ...YC, ...e2 }, this.init();
  }
  init() {
    this.initLights(), this.initTubes();
  }
  initLights() {
    for (let e2 = 0; e2 < 4; e2++) {
      const t2 = new tn(this.options.lights.colors[e2], this.options.lights.intensity);
      t2.position.set(e2 < 2 ? -5 : 5, e2 % 2 == 0 ? -5 : 5, 5), this.lights.push(t2), this.add(t2);
    }
  }
  initTubes() {
    for (let e2 = 0; e2 < this.options.count; e2++) {
      const t2 = tt.randFloat(this.options.minRadius, this.options.maxRadius), s2 = tt.randInt(this.options.minTubularSegments, this.options.maxTubularSegments), r2 = new Ii(this.options.material);
      this.tubes[e2] = new qC({ radius: t2, tubularSegments: s2 }, r2), this.add(this.tubes[e2]);
    }
    this.setColors(this.options.colors);
  }
  setColors(e2) {
    const t2 = (function(e3) {
      let t3, s2;
      return r2(e3), { setColors: r2, getColorAt: function(e4, r3 = new Qs()) {
        const i2 = Math.max(0, Math.min(1, e4)) * (t3.length - 1), n2 = Math.floor(i2), a2 = s2[n2];
        if (n2 >= t3.length - 1) return a2.clone();
        const o2 = i2 - n2, u2 = s2[n2 + 1];
        return r3.r = a2.r + o2 * (u2.r - a2.r), r3.g = a2.g + o2 * (u2.g - a2.g), r3.b = a2.b + o2 * (u2.b - a2.b), r3;
      } };
      function r2(e4) {
        t3 = e4, s2 = [], t3.forEach((e5) => {
          const t4 = new Qs(e5);
          s2.push(t4);
        });
      }
    })(e2);
    this.tubes.forEach((e3, s2) => {
      e3.material.color.set(t2.getColorAt(s2 / (this.tubes.length - 1)));
    });
  }
  setLightsColors(e2) {
    for (let t2 = 0; t2 < 4; t2++) this.lights[t2].color.set(e2[t2]);
  }
  setLightsIntensity(e2) {
    this.lights.forEach((t2) => {
      t2.intensity = e2;
    });
  }
  update(e2) {
    for (let t2 = 0; t2 < this.options.count; t2++) this.tubes[t2].lerpTo(this.target, this.options.lerp, this.options.noise, e2.elapsed);
  }
}
// END UPSTREAM BODY
export { QC as Tubes };
