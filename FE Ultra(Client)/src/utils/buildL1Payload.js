/**
 * Builds the on_device_pre_analyze payload from the L1 config state.
 * 
 * The actual upload-video telemetry payload structure is:
 *  - telemetry_timestamp, network_time_offset_ms, device_manufacturer, device_model,
 *    android_sdk, android_release, capture_mode, device_lat, device_lon, geo_accuracy_m
 *  - ng_file_processing: null
 *  - on_device_pre_analyze: { ... full L1 result ... }
 */
export function buildL1Payload(l1Config, telemetry) {
  if (!l1Config.enabled) return { ng_file_processing: null }

  const claimedDate = telemetry.claimed_time ? new Date(telemetry.claimed_time) : new Date()
  const captureTimestampMs = claimedDate.getTime()

  const captureContext = {
    capture_timestamp_ms: captureTimestampMs,
    telemetry_iso: claimedDate.toISOString(),
  }

  const layers = l1Config.layers.map(layer => ({
    id: layer.id,
    name: layer.name,
    pass: layer.pass,
    score100: layer.score100,
    cumulative100: layer.cumulative100,
    reasons: layer.reasons || [],
    ms: layer.ms,
    meta: layer.meta || {},
  }))

  const totalMs = layers.reduce((sum, l) => sum + l.ms, 0)
  const failedLayer = layers.find(l => !l.pass)

  const onDevicePreAnalyze = {
    status: l1Config.status,
    newsworthy: l1Config.newsworthy,
    confidence: l1Config.confidence,
    categories: l1Config.categories,
    summary: l1Config.summary,
    eis_score: l1Config.eis_score,
    eis_sub_scores: { ...l1Config.eis_sub_scores },
    capture_context: captureContext,
    debug: {
      layers,
      durationSeconds: Math.round(totalMs / 1000 * 100) / 100,
      totalMs,
      on_device_l1_engine: 'dart',
      l1_policy_version: l1Config.l1_policy_version,
      movinet_top1_label: l1Config.layers[3]?.meta?.matched_subset?.[0] || 'unknown',
      movinet_top1_prob: l1Config.layers[3]?.meta?.movinet_confidence_01 || 0,
    },
    failedAt: failedLayer ? failedLayer.id : null,
  }

  return {
    ng_file_processing: null,
    on_device_pre_analyze: onDevicePreAnalyze,
  }
}
