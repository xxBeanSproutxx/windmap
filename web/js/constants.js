// constants.js — Shared constants for Blue Lake Wave
'use strict';

var FETCH_CAP_KM = 5.0;               // shoreline fetch cap (km)
var GRID_FETCH_CAP_KM = 1.0;          // grid cell fetch cap (km)
var SHIELD_DISTANCE_M = 100;          // distance for full shielding (m)
var HIGH_IMPACT_THRESHOLD = 0.45;     // threshold for "high impact" classification
var NWS_UA = 'blue-lake-wave/1.0';    // NWS API User-Agent header
var TIMEOUT_MS = 15000;               // API fetch timeout (ms)
