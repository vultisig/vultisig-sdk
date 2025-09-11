/**
 * Balance lookup monitoring utilities for debugging and observability
 */

import {
  getBalanceLookupStats,
  getRecentBalanceFailures,
  resetBalanceStats,
} from './index'

/**
 * Get a comprehensive status report of balance lookups
 */
export function getBalanceStatusReport() {
  const stats = getBalanceLookupStats()
  const recentFailures = getRecentBalanceFailures()

  return {
    timestamp: new Date().toISOString(),
    summary: {
      totalLookups: stats.total,
      successfulLookups: stats.successful,
      failedLookups: stats.failed,
      successRate: `${stats.successRate.toFixed(1)}%`,
      fallbackRate: `${stats.fallbackRate.toFixed(1)}%`,
      averageDuration: `${stats.averageDuration.toFixed(0)}ms`,
    },
    health: {
      isHealthy: stats.successRate > 80,
      hasRecentFailures: recentFailures.length > 0,
      performance:
        stats.averageDuration < 2000
          ? 'good'
          : stats.averageDuration < 5000
            ? 'fair'
            : 'poor',
    },
    recentFailures: recentFailures.map(failure => ({
      chain: failure.chain,
      address: failure.address.substring(0, 10) + '...', // Truncate for privacy
      errorType: failure.error,
      duration: `${failure.duration}ms`,
      attempts: failure.attempts,
      timestamp: new Date(Date.now() - failure.duration).toISOString(),
    })),
  }
}

/**
 * Log a balance status summary to console
 */
export function logBalanceStatus() {
  const report = getBalanceStatusReport()

  console.log('🔍 Balance Lookup Status Report')
  console.log('================================')
  console.log(`📊 Total Lookups: ${report.summary.totalLookups}`)
  console.log(
    `✅ Successful: ${report.summary.successfulLookups} (${report.summary.successRate})`
  )
  console.log(`❌ Failed: ${report.summary.failedLookups}`)
  console.log(`🛟 Fallback Used: ${report.summary.fallbackRate}`)
  console.log(`⚡ Average Duration: ${report.summary.averageDuration}`)
  console.log(
    `🏥 Health Status: ${report.health.isHealthy ? '✅ Healthy' : '❌ Unhealthy'}`
  )
  console.log(
    `📈 Performance: ${report.health.performance === 'good' ? '✅' : report.health.performance === 'fair' ? '⚠️' : '❌'} ${report.health.performance.toUpperCase()}`
  )

  if (report.recentFailures.length > 0) {
    console.log('\n🚨 Recent Failures:')
    report.recentFailures.slice(0, 3).forEach((failure, i) => {
      console.log(
        `  ${i + 1}. ${failure.chain} - ${failure.errorType} (${failure.duration})`
      )
    })
  }

  console.log('================================')
}

/**
 * Reset monitoring stats (useful for testing)
 */
export function resetBalanceMonitoring() {
  resetBalanceStats()
  console.log('🔄 Balance monitoring stats reset')
}

// Export convenience functions
export { getBalanceLookupStats, getRecentBalanceFailures, resetBalanceStats }
