/**
 * Compatibility re-export — widget health checker lives in `./widget-health-checker/`.
 * Existing imports of `../services/widget-health-checker.ts` keep working.
 */
export {
  probePuppeteer,
  isPuppeteerAvailable,
  executeWidgetHealthCheck,
  runAndRecordWidgetCheck,
  type WidgetHealthCheckResult,
} from './widget-health-checker/index.ts';
