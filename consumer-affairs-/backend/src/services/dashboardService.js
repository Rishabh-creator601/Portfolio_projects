/**
 * Dashboard Service with MongoDB Aggregation logic
 */

async function getStats(jurisdiction) {
  // Mock aggregation
  return {
    totalScanned: 15420,
    complianceRate: 78.5,
    totalViolations: 3315,
    pendingReview: 120
  };
}

async function getMostViolatedRules(limit = 5, jurisdiction) {
  return [
    { ruleId: 'Rule 32(b)', citation: 'Generic name missing', count: 450 },
    { ruleId: 'Rule 32(c)', citation: 'Net quantity formatting', count: 320 },
    { ruleId: 'Rule 32(e)', citation: 'Month/Year of manufacture missing', count: 280 }
  ].slice(0, limit);
}

async function getComplianceTrends(months = 6, jurisdiction) {
  const trends = [];
  const currMonth = new Date().getMonth();
  for (let i = months - 1; i >= 0; i--) {
    trends.push({
      month: new Date(2024, currMonth - i, 1).toLocaleString('default', { month: 'short' }),
      total: 1000 + Math.floor(Math.random() * 500),
      compliant: 700 + Math.floor(Math.random() * 200),
      nonCompliant: 300 + Math.floor(Math.random() * 100)
    });
  }
  return trends;
}

async function getPendingReview(page = 1, limit = 10, jurisdiction) {
  return {
    total: 120,
    page,
    limit,
    data: [
      { id: '1', refNumber: 'INS-2024-001', date: new Date(), status: 'pending' },
      { id: '2', refNumber: 'INS-2024-002', date: new Date(), status: 'pending' }
    ]
  };
}

async function getRecentInspections(limit = 5, jurisdiction) {
  return [
    { id: '10', refNumber: 'INS-2024-010', verdict: 'Pass', date: new Date() },
    { id: '11', refNumber: 'INS-2024-011', verdict: 'Fail', date: new Date() }
  ];
}

async function getOfficerStats(officerId) {
  return {
    inspections: 150,
    complianceRate: 80,
    averageTime: '15m'
  };
}

module.exports = {
  getStats,
  getMostViolatedRules,
  getComplianceTrends,
  getPendingReview,
  getRecentInspections,
  getOfficerStats
};
