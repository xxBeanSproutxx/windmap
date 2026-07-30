// colors.js — Color helpers for Blue Lake Wave
'use strict';

// ── Color helper ──
function lerpColor(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

// ── Grid impact color (5-anchor continuous gradient) ──
function gridImpactColor(score) {
  const anchors = [
    { score: 0.00, rgb: [0x10, 0xb9, 0x81] },  // green  — LOW
    { score: 0.35, rgb: [0xea, 0xb3, 0x08] },  // yellow — MODERATE
    { score: 0.45, rgb: [0xf9, 0x73, 0x16] },  // orange — ELEVATED
    { score: 0.60, rgb: [0xef, 0x44, 0x44] },  // red    — HIGH
    { score: 0.80, rgb: [0xdb, 0x27, 0x77] }   // magenta — VERY HIGH
  ];
  if (score <= anchors[0].score) {
    const c = anchors[0].rgb;
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  if (score >= anchors[anchors.length - 1].score) {
    const c = anchors[anchors.length - 1].rgb;
    return '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  for (let i = 0; i < anchors.length - 1; i++) {
    if (score >= anchors[i].score && score <= anchors[i + 1].score) {
      const t = (score - anchors[i].score) / (anchors[i + 1].score - anchors[i].score);
      const lerp = lerpColor(anchors[i].rgb, anchors[i + 1].rgb, t);
      return '#' + lerp.map(v => v.toString(16).padStart(2, '0')).join('');
    }
  }
  return '#10b981';
}
