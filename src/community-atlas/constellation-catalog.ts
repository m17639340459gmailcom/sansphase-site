/**
 * Small offline catalog for the community-entry constellation composition.
 *
 * Star positions, apparent visual magnitudes and B-V colour indices: D3-Celestial
 * data/stars.6.json, derived from Anderson & Francis (2012), XHIP (VizieR V/137D).
 * Lines: data/constellations.lines.json (Olaf Frohn; the upstream README cites
 * IAU constellation illustrations with the author's line modifications).
 * Fixed upstream revision: 7e720a3de062059d4c5400a379146a601d9010e0
 * https://github.com/ofrohn/d3-celestial/tree/7e720a3de062059d4c5400a379146a601d9010e0
 * https://github.com/ofrohn/d3-celestial/blob/7e720a3de062059d4c5400a379146a601d9010e0/data/readme.md
 * https://github.com/ofrohn/d3-celestial/blob/7e720a3de062059d4c5400a379146a601d9010e0/readme.md
 *
 * Coordinates are J2000, in DEGREES: ra is right ascension in [0, 360), dec is
 * declination in [-90, 90]. Negative source GeoJSON longitudes are wrapped to
 * positive RA; source precision is retained. IDs are Hipparcos catalog numbers.
 * Magnitudes are fixed catalog values, not current variable-star predictions.
 *
 * UMa uses the first source polyline (the seven-star Big Dipper asterism); the
 * other five outlines retain their source polylines in full. Duplicate endpoints
 * are merged. Edges address group.stars only; fieldStars have no added edges.
 * Each group has 24 real nearby field stars with magnitude 4..6, selected once:
 * exclude outline stars; retain projected offsets within outline radius + 6
 * degrees of the arithmetic centre; sort by HIP number; take 24 evenly spaced
 * entries. The selection uses RA offset * cos(centre declination) and Dec offset.
 * Neighbourhood membership does not imply membership in the IAU constellation.
 *
 * Renderers may project, translate, rotate and uniformly scale groups separately.
 * The combined layout is an artistic composition, not the whole sky as seen at a
 * particular observer location or moment. No runtime network or dependencies.
 *
 * Upstream data license: BSD-3-Clause. Required notice follows in full.
 */

/*! D3-Celestial data — BSD-3-Clause
 * Copyright (c) 2015, Olaf Frohn
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.
 *
 * 3. Neither the name of the copyright holder nor the names of its contributors may be used to endorse or promote products derived from this software without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

export interface CatalogStar {
  readonly id: string;
  /** J2000 right ascension in degrees, normalized to [0, 360). */
  readonly ra: number;
  /** J2000 declination in degrees. */
  readonly dec: number;
  readonly magnitude: number;
  /** B-V colour index from the source catalog, when available. */
  readonly colorIndex?: number;
}

export interface CatalogConstellation {
  readonly id: string;
  readonly name: string;
  readonly englishName: string;
  readonly stars: readonly CatalogStar[];
  readonly edges: readonly (readonly [number, number])[];
  readonly fieldStars: readonly CatalogStar[];
}

export const CONSTELLATION_CATALOG: readonly CatalogConstellation[] = [
  {
    id: 'Ori', name: '猎户座', englishName: 'Orion',
    stars: [
      { id: 'HIP 29038', ra: 91.893, dec: 14.7685, magnitude: 4.42, colorIndex: -0.164 },
      { id: 'HIP 27913', ra: 88.5958, dec: 20.2762, magnitude: 4.39, colorIndex: 0.594 },
      { id: 'HIP 28716', ra: 90.9799, dec: 20.1385, magnitude: 4.64, colorIndex: 0.236 },
      { id: 'HIP 29426', ra: 92.985, dec: 14.2088, magnitude: 4.45, colorIndex: -0.18 },
      { id: 'HIP 28614', ra: 90.5958, dec: 9.6473, magnitude: 4.12, colorIndex: 0.17 },
      { id: 'HIP 27989', ra: 88.7929, dec: 7.4071, magnitude: 0.45, colorIndex: 1.5 },
      { id: 'HIP 25336', ra: 81.2828, dec: 6.3497, magnitude: 1.64, colorIndex: -0.224 },
      { id: 'HIP 22845', ra: 73.7239, dec: 10.1508, magnitude: 4.64, colorIndex: 0.085 },
      { id: 'HIP 23123', ra: 74.6371, dec: 1.714, magnitude: 4.47, colorIndex: 1.369 },
      { id: 'HIP 22797', ra: 73.5629, dec: 2.4407, magnitude: 3.71, colorIndex: -0.179 },
      { id: 'HIP 22549', ra: 72.8015, dec: 5.6051, magnitude: 3.68, colorIndex: -0.157 },
      { id: 'HIP 22449', ra: 72.46, dec: 6.9613, magnitude: 3.19, colorIndex: 0.484 },
      { id: 'HIP 22509', ra: 72.653, dec: 8.9002, magnitude: 4.35, colorIndex: 0.01 },
      { id: 'HIP 22957', ra: 74.0928, dec: 13.5145, magnitude: 4.06, colorIndex: 1.158 },
      { id: 'HIP 23607', ra: 76.1423, dec: 15.4041, magnitude: 4.65, colorIndex: -0.064 },
      { id: 'HIP 24010', ra: 77.4248, dec: 15.5972, magnitude: 4.81, colorIndex: 0.313 },
      { id: 'HIP 24436', ra: 78.6345, dec: -8.2016, magnitude: 0.18, colorIndex: -0.03 },
      { id: 'HIP 25281', ra: 81.1192, dec: -2.3971, magnitude: 3.35, colorIndex: -0.24 },
      { id: 'HIP 25930', ra: 83.0017, dec: -0.2991, magnitude: 2.25, colorIndex: -0.175 },
      { id: 'HIP 26207', ra: 83.7845, dec: 9.9342, magnitude: 3.39, colorIndex: -0.16 },
      { id: 'HIP 26727', ra: 85.1897, dec: -1.9426, magnitude: 1.74, colorIndex: -0.199 },
      { id: 'HIP 27366', ra: 86.9391, dec: -9.6696, magnitude: 2.07, colorIndex: -0.168 },
      { id: 'HIP 26311', ra: 84.0534, dec: -1.2019, magnitude: 1.69, colorIndex: -0.184 },
    ],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [8, 9], [9, 10], [10, 11], [11, 12], [12, 7], [7, 13], [13, 14], [14, 15], [16, 17], [17, 18], [18, 6], [6, 19], [19, 5], [5, 20], [20, 21], [20, 22], [22, 18]],
    fieldStars: [
      { id: 'HIP 18089', ra: 58.001, dec: 6.5349, magnitude: 5.66, colorIndex: 0.046 },
      { id: 'HIP 19587', ra: 62.9664, dec: -6.8376, magnitude: 4.04, colorIndex: 0.327 },
      { id: 'HIP 20261', ra: 65.1513, dec: 15.0955, magnitude: 5.26, colorIndex: 0.225 },
      { id: 'HIP 20635', ra: 66.3424, dec: 22.2939, magnitude: 4.21, colorIndex: 0.136 },
      { id: 'HIP 20901', ra: 67.209, dec: 13.0476, magnitude: 5.02, colorIndex: 0.215 },
      { id: 'HIP 21515', ra: 69.307, dec: 0.9983, magnitude: 5.32, colorIndex: -0.107 },
      { id: 'HIP 22024', ra: 71.0222, dec: -8.5036, magnitude: 5.78, colorIndex: -0.076 },
      { id: 'HIP 22834', ra: 73.6991, dec: 7.7791, magnitude: 5.33, colorIndex: 1.214 },
      { id: 'HIP 23497', ra: 75.7739, dec: 21.59, magnitude: 4.62, colorIndex: 0.155 },
      { id: 'HIP 24019', ra: 77.4379, dec: 28.0305, magnitude: 5.93, colorIndex: 0.311 },
      { id: 'HIP 24822', ra: 79.8192, dec: 22.0965, magnitude: 4.96, colorIndex: 0.937 },
      { id: 'HIP 25278', ra: 81.1061, dec: 17.3835, magnitude: 5, colorIndex: 0.544 },
      { id: 'HIP 25737', ra: 82.4333, dec: -1.0922, magnitude: 4.71, colorIndex: 1.592 },
      { id: 'HIP 26108', ra: 83.5169, dec: -1.4703, magnitude: 5.92, colorIndex: 1.535 },
      { id: 'HIP 26345', ra: 84.1487, dec: -6.0648, magnitude: 5.71, colorIndex: -0.212 },
      { id: 'HIP 26762', ra: 85.2733, dec: 0.3378, magnitude: 5.93, colorIndex: 0.311 },
      { id: 'HIP 27468', ra: 87.254, dec: 24.5675, magnitude: 4.88, colorIndex: 1.021 },
      { id: 'HIP 27750', ra: 88.1102, dec: 1.8551, magnitude: 4.76, colorIndex: 1.382 },
      { id: 'HIP 28325', ra: 89.768, dec: -9.5583, magnitude: 5.04, colorIndex: 0.189 },
      { id: 'HIP 29225', ra: 92.4333, dec: 23.1135, magnitude: 5.75, colorIndex: 0.192 },
      { id: 'HIP 29736', ra: 93.9374, dec: 12.5511, magnitude: 5.44, colorIndex: 0.015 },
      { id: 'HIP 30545', ra: 96.3189, dec: -0.9459, magnitude: 5.88, colorIndex: 0.564 },
      { id: 'HIP 31216', ra: 98.2259, dec: 7.333, magnitude: 4.47, colorIndex: 0.023 },
      { id: 'HIP 32463', ra: 101.6351, dec: 8.5872, magnitude: 5.92, colorIndex: -0.173 },
    ],
  },
  {
    id: 'Cas', name: '仙后座', englishName: 'Cassiopeia',
    stars: [
      { id: 'HIP 8886', ra: 28.5989, dec: 63.6701, magnitude: 3.35, colorIndex: -0.15 },
      { id: 'HIP 6686', ra: 21.454, dec: 60.2353, magnitude: 2.66, colorIndex: 0.16 },
      { id: 'HIP 4427', ra: 14.1772, dec: 60.7167, magnitude: 2.15, colorIndex: -0.046 },
      { id: 'HIP 3179', ra: 10.1268, dec: 56.5373, magnitude: 2.24, colorIndex: 1.17 },
      { id: 'HIP 746', ra: 2.2945, dec: 59.1498, magnitude: 2.28, colorIndex: 0.38 },
    ],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
    fieldStars: [
      { id: 'HIP 124', ra: 0.4042, dec: 61.2228, magnitude: 5.58, colorIndex: 0.407 },
      { id: 'HIP 379', ra: 1.1749, dec: 67.1664, magnitude: 5.68, colorIndex: 1.051 },
      { id: 'HIP 1354', ra: 4.2377, dec: 61.5332, magnitude: 5.74, colorIndex: 0.898 },
      { id: 'HIP 1960', ra: 6.1979, dec: 61.8311, magnitude: 5.38, colorIndex: 0.008 },
      { id: 'HIP 2505', ra: 7.9432, dec: 54.5223, magnitude: 4.74, colorIndex: -0.098 },
      { id: 'HIP 2854', ra: 9.0346, dec: 54.1685, magnitude: 5.08, colorIndex: -0.098 },
      { id: 'HIP 3300', ra: 10.5162, dec: 50.5125, magnitude: 4.8, colorIndex: -0.105 },
      { id: 'HIP 3504', ra: 11.1813, dec: 48.2844, magnitude: 4.48, colorIndex: -0.069 },
      { id: 'HIP 3951', ra: 12.6817, dec: 64.2475, magnitude: 5.35, colorIndex: 0.528 },
      { id: 'HIP 4422', ra: 14.1663, dec: 59.1811, magnitude: 4.62, colorIndex: 0.957 },
      { id: 'HIP 4998', ra: 16.01, dec: 52.5022, magnitude: 5.99, colorIndex: 1.447 },
      { id: 'HIP 5361', ra: 17.1394, dec: 58.2634, magnitude: 5.77, colorIndex: -0.019 },
      { id: 'HIP 5566', ra: 17.8565, dec: 64.2027, magnitude: 5.56, colorIndex: -0.052 },
      { id: 'HIP 6692', ra: 21.4834, dec: 68.13, magnitude: 4.72, colorIndex: 1.047 },
      { id: 'HIP 7251', ra: 23.3571, dec: 58.3273, magnitude: 5.69, colorIndex: 1.435 },
      { id: 'HIP 8016', ra: 25.7328, dec: 70.6225, magnitude: 5.18, colorIndex: -0.022 },
      { id: 'HIP 8362', ra: 26.9368, dec: 63.8525, magnitude: 5.63, colorIndex: 0.804 },
      { id: 'HIP 9009', ra: 29.0001, dec: 68.6852, magnitude: 4.97, colorIndex: -0.084 },
      { id: 'HIP 9480', ra: 30.4894, dec: 70.907, magnitude: 4.49, colorIndex: 0.164 },
      { id: 'HIP 9990', ra: 32.1691, dec: 58.4236, magnitude: 5.66, colorIndex: 0.595 },
      { id: 'HIP 10729', ra: 34.5191, dec: 57.5163, magnitude: 5.99, colorIndex: 1.039 },
      { id: 'HIP 115395', ra: 350.6356, dec: 60.1335, magnitude: 5.56, colorIndex: 1.679 },
      { id: 'HIP 117265', ra: 356.6531, dec: 66.7822, magnitude: 5.95, colorIndex: -0.049 },
      { id: 'HIP 117447', ra: 357.209, dec: 62.2145, magnitude: 5.43, colorIndex: 0.67 },
    ],
  },
  {
    id: 'Cyg', name: '天鹅座', englishName: 'Cygnus',
    stars: [
      { id: 'HIP 104732', ra: 318.2341, dec: 30.2269, magnitude: 3.21, colorIndex: 0.99 },
      { id: 'HIP 102488', ra: 311.5528, dec: 33.9703, magnitude: 2.48, colorIndex: 1.021 },
      { id: 'HIP 100453', ra: 305.5571, dec: 40.2567, magnitude: 2.23, colorIndex: 0.673 },
      { id: 'HIP 97165', ra: 296.2437, dec: 45.1308, magnitude: 2.86, colorIndex: -0.002 },
      { id: 'HIP 95853', ra: 292.4265, dec: 51.7298, magnitude: 3.76, colorIndex: 0.148 },
      { id: 'HIP 94779', ra: 289.2757, dec: 53.3685, magnitude: 3.8, colorIndex: 0.95 },
      { id: 'HIP 102098', ra: 310.358, dec: 45.2803, magnitude: 1.25, colorIndex: 0.092 },
      { id: 'HIP 98110', ra: 299.0765, dec: 35.0834, magnitude: 3.89, colorIndex: 1.019 },
      { id: 'HIP 95947', ra: 292.6803, dec: 27.9597, magnitude: 3.05, colorIndex: 1.088 },
    ],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [6, 2], [2, 7], [7, 8]],
    fieldStars: [
      { id: 'HIP 89482', ra: 273.9116, dec: 42.1593, magnitude: 5.56, colorIndex: -0.111 },
      { id: 'HIP 91755', ra: 280.6581, dec: 55.5395, magnitude: 5.03, colorIndex: -0.07 },
      { id: 'HIP 92549', ra: 282.8956, dec: 52.9751, magnitude: 5.51, colorIndex: 0.843 },
      { id: 'HIP 92997', ra: 284.1877, dec: 57.8149, magnitude: 5.67, colorIndex: 1.155 },
      { id: 'HIP 93718', ra: 286.2411, dec: 31.7441, magnitude: 5.63, colorIndex: 1.548 },
      { id: 'HIP 94481', ra: 288.4395, dec: 39.146, magnitude: 4.43, colorIndex: -0.15 },
      { id: 'HIP 95372', ra: 291.0316, dec: 29.6213, magnitude: 4.99, colorIndex: -0.12 },
      { id: 'HIP 96014', ra: 292.8305, dec: 50.3067, magnitude: 5.55, colorIndex: 1.274 },
      { id: 'HIP 96620', ra: 294.6716, dec: 54.9738, magnitude: 5.89, colorIndex: 0.482 },
      { id: 'HIP 97295', ra: 296.6067, dec: 33.7276, magnitude: 5, colorIndex: 0.476 },
      { id: 'HIP 97774', ra: 298.0299, dec: 47.9318, magnitude: 5.91, colorIndex: -0.174 },
      { id: 'HIP 98325', ra: 299.6583, dec: 30.9837, magnitude: 5.51, colorIndex: -0.06 },
      { id: 'HIP 98863', ra: 301.1507, dec: 32.2186, magnitude: 5.62, colorIndex: 0.76 },
      { id: 'HIP 99531', ra: 303.0029, dec: 26.4788, magnitude: 5.91, colorIndex: -0.107 },
      { id: 'HIP 99874', ra: 303.9422, dec: 27.8142, magnitude: 4.5, colorIndex: 1.258 },
      { id: 'HIP 100435', ra: 305.5143, dec: 24.4461, magnitude: 5.5, colorIndex: -0.09 },
      { id: 'HIP 101076', ra: 307.3489, dec: 30.3686, magnitude: 4.01, colorIndex: 0.404 },
      { id: 'HIP 101899', ra: 309.748, dec: 30.3343, magnitude: 5.68, colorIndex: 1.088 },
      { id: 'HIP 102571', ra: 311.7948, dec: 34.3741, magnitude: 4.93, colorIndex: 1.294 },
      { id: 'HIP 103200', ra: 313.6402, dec: 28.0576, magnitude: 5.03, colorIndex: 1.481 },
      { id: 'HIP 103632', ra: 314.9565, dec: 47.521, magnitude: 4.74, colorIndex: -0.084 },
      { id: 'HIP 105102', ra: 319.354, dec: 39.3947, magnitude: 4.22, colorIndex: 0.098 },
      { id: 'HIP 105769', ra: 321.3315, dec: 46.7143, magnitude: 5.59, colorIndex: 0.335 },
      { id: 'HIP 106711', ra: 324.2374, dec: 40.4135, magnitude: 5.04, colorIndex: 0.198 },
    ],
  },
  {
    id: 'UMa', name: '大熊座', englishName: 'Ursa Major',
    stars: [
      { id: 'HIP 59774', ra: 183.8565, dec: 57.0326, magnitude: 3.32, colorIndex: 0.077 },
      { id: 'HIP 54061', ra: 165.932, dec: 61.751, magnitude: 1.81, colorIndex: 1.061 },
      { id: 'HIP 53910', ra: 165.4603, dec: 56.3824, magnitude: 2.34, colorIndex: 0.033 },
      { id: 'HIP 58001', ra: 178.4577, dec: 53.6948, magnitude: 2.41, colorIndex: 0.044 },
      { id: 'HIP 62956', ra: 193.5073, dec: 55.9598, magnitude: 1.76, colorIndex: -0.022 },
      { id: 'HIP 65378', ra: 200.9814, dec: 54.9254, magnitude: 2.23, colorIndex: 0.057 },
      { id: 'HIP 67301', ra: 206.8852, dec: 49.3133, magnitude: 1.85, colorIndex: -0.099 },
    ],
    edges: [[0, 1], [1, 2], [2, 3], [3, 0], [0, 4], [4, 5], [5, 6]],
    fieldStars: [
      { id: 'HIP 49005', ra: 149.9654, dec: 56.8118, magnitude: 5.5, colorIndex: 1.487 },
      { id: 'HIP 50546', ra: 154.8616, dec: 48.3968, magnitude: 6, colorIndex: 1.022 },
      { id: 'HIP 52136', ra: 159.7736, dec: 53.6683, magnitude: 5.55, colorIndex: 1.27 },
      { id: 'HIP 52469', ra: 160.887, dec: 46.2039, magnitude: 5.18, colorIndex: 0.324 },
      { id: 'HIP 53064', ra: 162.8488, dec: 59.3201, magnitude: 5.57, colorIndex: 1.16 },
      { id: 'HIP 53721', ra: 164.8666, dec: 40.4303, magnitude: 5.03, colorIndex: 0.624 },
      { id: 'HIP 55086', ra: 169.1744, dec: 49.4763, magnitude: 5.88, colorIndex: 1.102 },
      { id: 'HIP 56034', ra: 172.2672, dec: 39.337, magnitude: 5.3, colorIndex: 0.019 },
      { id: 'HIP 56510', ra: 173.7704, dec: 54.7854, magnitude: 5.63, colorIndex: 1.032 },
      { id: 'HIP 57477', ra: 176.7318, dec: 55.6282, magnitude: 5.27, colorIndex: 1.276 },
      { id: 'HIP 59746', ra: 183.7854, dec: 70.2, magnitude: 5.72, colorIndex: 1.179 },
      { id: 'HIP 60122', ra: 184.953, dec: 48.9841, magnitude: 5.28, colorIndex: 1.623 },
      { id: 'HIP 60646', ra: 186.4622, dec: 39.0186, magnitude: 5.01, colorIndex: 0.955 },
      { id: 'HIP 61317', ra: 188.4356, dec: 41.3575, magnitude: 4.24, colorIndex: 0.588 },
      { id: 'HIP 62402', ra: 191.829, dec: 62.7812, magnitude: 5.88, colorIndex: 0.215 },
      { id: 'HIP 63024', ra: 193.7355, dec: 47.1967, magnitude: 5.75, colorIndex: 1.451 },
      { id: 'HIP 63432', ra: 194.9795, dec: 66.5973, magnitude: 5.37, colorIndex: 1.282 },
      { id: 'HIP 64540', ra: 198.4289, dec: 40.1529, magnitude: 4.94, colorIndex: 1.061 },
      { id: 'HIP 65072', ra: 200.079, dec: 40.1505, magnitude: 5.6, colorIndex: 1.204 },
      { id: 'HIP 66198', ra: 203.5304, dec: 55.3484, magnitude: 5.6, colorIndex: -0.014 },
      { id: 'HIP 66738', ra: 205.1845, dec: 54.6816, magnitude: 4.63, colorIndex: 1.63 },
      { id: 'HIP 67485', ra: 207.4396, dec: 61.4893, magnitude: 5.97, colorIndex: 0.974 },
      { id: 'HIP 69068', ra: 212.0721, dec: 49.4582, magnitude: 5.26, colorIndex: 1.637 },
      { id: 'HIP 70497', ra: 216.2992, dec: 51.8507, magnitude: 4.04, colorIndex: 0.497 },
    ],
  },
  {
    id: 'Lyr', name: '天琴座', englishName: 'Lyra',
    stars: [
      { id: 'HIP 91971', ra: 281.1932, dec: 37.6051, magnitude: 4.34, colorIndex: 0.192 },
      { id: 'HIP 91926', ra: 281.0949, dec: 39.6127, magnitude: 4.59, colorIndex: 0.18 },
      { id: 'HIP 91262', ra: 279.2347, dec: 38.7837, magnitude: 0.03, colorIndex: -0.001 },
      { id: 'HIP 92791', ra: 283.6262, dec: 36.8986, magnitude: 4.22, colorIndex: 1.575 },
      { id: 'HIP 93194', ra: 284.7359, dec: 32.6896, magnitude: 3.25, colorIndex: -0.049 },
      { id: 'HIP 92420', ra: 282.52, dec: 33.3627, magnitude: 3.52, colorIndex: 0.003 },
    ],
    edges: [[0, 1], [1, 2], [2, 0], [0, 3], [3, 4], [4, 5], [5, 0]],
    fieldStars: [
      { id: 'HIP 88636', ra: 271.4567, dec: 32.2307, magnitude: 5.72, colorIndex: 1.179 },
      { id: 'HIP 88745', ra: 271.7564, dec: 30.5621, magnitude: 5.05, colorIndex: 0.528 },
      { id: 'HIP 89008', ra: 272.4958, dec: 36.4663, magnitude: 5.57, colorIndex: 0.915 },
      { id: 'HIP 89172', ra: 272.9757, dec: 31.4053, magnitude: 4.96, colorIndex: 1.643 },
      { id: 'HIP 89482', ra: 273.9116, dec: 42.1593, magnitude: 5.56, colorIndex: -0.111 },
      { id: 'HIP 89925', ra: 275.2374, dec: 29.8589, magnitude: 5.61, colorIndex: 0.231 },
      { id: 'HIP 90191', ra: 276.0574, dec: 39.5072, magnitude: 5.11, colorIndex: 0.047 },
      { id: 'HIP 90342', ra: 276.4949, dec: 29.8289, magnitude: 5.81, colorIndex: 0.068 },
      { id: 'HIP 91235', ra: 279.1556, dec: 33.469, magnitude: 5.41, colorIndex: -0.101 },
      { id: 'HIP 91919', ra: 281.0848, dec: 39.6701, magnitude: 4.67, colorIndex: 0.17 },
      { id: 'HIP 91973', ra: 281.2008, dec: 37.5946, magnitude: 5.73, colorIndex: 0.285 },
      { id: 'HIP 92398', ra: 282.4413, dec: 32.8128, magnitude: 5.93, colorIndex: -0.154 },
      { id: 'HIP 92728', ra: 283.4315, dec: 36.9717, magnitude: 5.58, colorIndex: -0.138 },
      { id: 'HIP 92768', ra: 283.5552, dec: 27.9095, magnitude: 5.64, colorIndex: 1.361 },
      { id: 'HIP 92833', ra: 283.7188, dec: 33.9686, magnitude: 5.99, colorIndex: 0.922 },
      { id: 'HIP 93017', ra: 284.2567, dec: 32.9013, magnitude: 5.2, colorIndex: 0.594 },
      { id: 'HIP 93104', ra: 284.5079, dec: 38.2662, magnitude: 5.89, colorIndex: -0.09 },
      { id: 'HIP 93718', ra: 286.2411, dec: 31.7441, magnitude: 5.63, colorIndex: 1.548 },
      { id: 'HIP 93903', ra: 286.8255, dec: 36.1002, magnitude: 5.25, colorIndex: -0.109 },
      { id: 'HIP 93917', ra: 286.8566, dec: 32.5017, magnitude: 5.2, colorIndex: 0.367 },
      { id: 'HIP 94481', ra: 288.4395, dec: 39.146, magnitude: 4.43, colorIndex: -0.15 },
      { id: 'HIP 94713', ra: 289.0921, dec: 38.1337, magnitude: 4.35, colorIndex: 1.258 },
      { id: 'HIP 95352', ra: 290.9854, dec: 43.3882, magnitude: 5.85, colorIndex: 0.924 },
      { id: 'HIP 95556', ra: 291.538, dec: 36.3179, magnitude: 5.17, colorIndex: -0.12 },
    ],
  },
  {
    id: 'Sco', name: '天蝎座', englishName: 'Scorpius',
    stars: [
      { id: 'HIP 78265', ra: 239.713, dec: -26.1141, magnitude: 2.89, colorIndex: -0.18 },
      { id: 'HIP 78401', ra: 240.0834, dec: -22.6217, magnitude: 2.29, colorIndex: -0.117 },
      { id: 'HIP 78820', ra: 241.3593, dec: -19.8055, magnitude: 2.56, colorIndex: -0.065 },
      { id: 'HIP 80112', ra: 245.2972, dec: -25.5928, magnitude: 2.9, colorIndex: 0.299 },
      { id: 'HIP 80763', ra: 247.3519, dec: -26.432, magnitude: 1.06, colorIndex: 1.865 },
      { id: 'HIP 81266', ra: 248.9706, dec: -28.216, magnitude: 2.82, colorIndex: -0.206 },
      { id: 'HIP 82396', ra: 252.5409, dec: -34.2932, magnitude: 2.29, colorIndex: 1.144 },
      { id: 'HIP 82514', ra: 252.9676, dec: -38.0474, magnitude: 3, colorIndex: -0.2 },
      { id: 'HIP 82729', ra: 253.6459, dec: -42.3613, magnitude: 3.62, colorIndex: 1.393 },
      { id: 'HIP 84143', ra: 258.0383, dec: -43.2392, magnitude: 3.32, colorIndex: 0.441 },
      { id: 'HIP 86228', ra: 264.3297, dec: -42.9978, magnitude: 1.86, colorIndex: 0.406 },
      { id: 'HIP 87073', ra: 266.8962, dec: -40.127, magnitude: 2.99, colorIndex: 0.509 },
      { id: 'HIP 86670', ra: 265.622, dec: -39.03, magnitude: 2.39, colorIndex: -0.171 },
      { id: 'HIP 85927', ra: 263.4022, dec: -37.1038, magnitude: 1.62, colorIndex: -0.231 },
    ],
    edges: [[0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13]],
    fieldStars: [
      { id: 'HIP 73937', ra: 226.6383, dec: -30.9185, magnitude: 5.97, colorIndex: -0.076 },
      { id: 'HIP 75439', ra: 231.1875, dec: -39.7103, magnitude: 5.36, colorIndex: -0.093 },
      { id: 'HIP 76532', ra: 234.4502, dec: -23.1417, magnitude: 5.79, colorIndex: 1.074 },
      { id: 'HIP 76945', ra: 235.6709, dec: -34.7104, magnitude: 4.75, colorIndex: -0.151 },
      { id: 'HIP 77858', ra: 238.4746, dec: -24.5332, magnitude: 5.38, colorIndex: -0.011 },
      { id: 'HIP 78207', ra: 239.5474, dec: -14.2794, magnitude: 4.95, colorIndex: -0.08 },
      { id: 'HIP 78821', ra: 241.3606, dec: -19.8019, magnitude: 4.9, colorIndex: -0.024 },
      { id: 'HIP 79302', ra: 242.7586, dec: -29.4162, magnitude: 5.09, colorIndex: 1.131 },
      { id: 'HIP 79881', ra: 244.5746, dec: -28.614, magnitude: 4.8, colorIndex: 0.008 },
      { id: 'HIP 80343', ra: 246.0258, dec: -20.0373, magnitude: 4.48, colorIndex: 0.996 },
      { id: 'HIP 80815', ra: 247.552, dec: -25.1152, magnitude: 4.79, colorIndex: -0.116 },
      { id: 'HIP 81702', ra: 250.3351, dec: -48.763, magnitude: 5.57, colorIndex: 0.169 },
      { id: 'HIP 82369', ra: 252.4585, dec: -10.783, magnitude: 4.64, colorIndex: 0.478 },
      { id: 'HIP 82925', ra: 254.2002, dec: -23.1503, magnitude: 5.57, colorIndex: -0.018 },
      { id: 'HIP 83431', ra: 255.7863, dec: -53.237, magnitude: 5.27, colorIndex: 0.498 },
      { id: 'HIP 84226', ra: 258.244, dec: -32.4383, magnitude: 5.95, colorIndex: 0.071 },
      { id: 'HIP 84720', ra: 259.766, dec: -46.6362, magnitude: 5.47, colorIndex: 0.764 },
      { id: 'HIP 85340', ra: 261.5926, dec: -24.1753, magnitude: 4.16, colorIndex: 0.283 },
      { id: 'HIP 86092', ra: 263.915, dec: -46.5057, magnitude: 4.56, colorIndex: -0.02 },
      { id: 'HIP 86847', ra: 266.175, dec: -42.7293, magnitude: 5.87, colorIndex: 0.163 },
      { id: 'HIP 87616', ra: 268.4782, dec: -34.7527, magnitude: 6, colorIndex: -0.06 },
      { id: 'HIP 88380', ra: 270.7129, dec: -24.2825, magnitude: 5.37, colorIndex: 0.495 },
      { id: 'HIP 89112', ra: 272.8073, dec: -45.9544, magnitude: 4.52, colorIndex: 1.009 },
      { id: 'HIP 90074', ra: 275.7212, dec: -36.6696, magnitude: 5.33, colorIndex: -0.121 },
    ],
  },
];
